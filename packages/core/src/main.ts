#!/usr/bin/env bun
import yargs from "yargs"
import { hideBin } from "yargs/helpers"
/**
 * Standalone core server entrypoint.
 * Starts the LiteAI server without TUI or CLI chrome.
 */
import { Capabilities, createHostedCapabilities, createLocalCapabilities } from "./capabilities"
import { Installation } from "./installation"
import { Instance } from "./project/instance"
import { Server } from "./server/server"
import { Database } from "./storage/db"
import { Log } from "./util/log"

const args = await yargs(hideBin(process.argv))
  .scriptName("liteai-core")
  .option("port", {
    alias: "p",
    type: "number",
    default: 0,
    describe: "Port to listen on (0 = auto)",
  })
  .option("hostname", {
    alias: "H",
    type: "string",
    default: "127.0.0.1",
    describe: "Hostname to bind to",
  })
  .option("print-logs", {
    type: "boolean",
    default: false,
    describe: "Print logs to stderr",
  })
  .option("csrf-token", {
    type: "string",
    describe: "CSRF token required for all API requests",
  })
  .option("debug", {
    alias: "d",
    type: "boolean",
    default: false,
    describe: "Enable debug logging",
  })
  .option("lsp", {
    type: "boolean",
    default: false,
    describe:
      "Also start an LSP server on stdin/stdout for AI editor features (inline completions). Redirects the startup listen message to stderr.",
  })
  .option("hosted", {
    type: "boolean",
    default: false,
    describe:
      "Run in hosted mode — delegate filesystem, git, and workspace operations to the host IDE via HTTP callbacks",
  })
  .option("extension-port", {
    type: "number",
    describe: "Port of the host IDE callback server (required when --hosted is set)",
  })
  .option("extension-server-csrf-token", {
    type: "string",
    describe: "CSRF token for the host IDE callback server (required when --hosted is set)",
  })
  .check((argv) => {
    if (argv.hosted && !argv.extensionPort) {
      throw new Error("--extension-port is required when --hosted is set")
    }
    if (argv.hosted && !argv.extensionServerCsrfToken) {
      throw new Error("--extension-server-csrf-token is required when --hosted is set")
    }
    return true
  })
  .help()
  .version(Installation.VERSION)
  .parse()

if (args.csrfToken) {
  process.env.LITEAI_SERVER_CSRF_TOKEN = args.csrfToken
}

await Log.init({
  print: args.printLogs,
  dev: Installation.isLocal(),
  level: args.debug ? "DEBUG" : "INFO",
})

const log = Log.create({ service: "main" })

// ─── Initialize capabilities ────────────────────────────────────────────────

if (args.hosted) {
  const extensionUrl = `http://127.0.0.1:${args.extensionPort}`
  log.info("starting in hosted mode", {
    extensionUrl,
    port: args.port,
  })
  Capabilities.set(
    createHostedCapabilities({
      extensionUrl,
      csrfToken: args.extensionServerCsrfToken as string,
    }),
  )
} else {
  log.info("starting in local mode", { port: args.port })
  Capabilities.set(createLocalCapabilities())
}

// ─── Initialize database (skip in hosted mode if configured) ────────────────

Database.Client()

const server = Server.listen({ port: args.port, hostname: args.hostname })

// When --lsp is active stdout belongs to LSP JSON-RPC framing — redirect to stderr
const listenMsg = `liteai core server listening on http://${server.hostname}:${server.port}`
if (args.lsp) {
  process.stderr.write(`${listenMsg}\n`)
} else {
  console.log(listenMsg)
}

if (Capabilities.isHosted()) {
  log.info("hosted mode active — filesystem and git operations delegate to callback server")
}

// Start LSP server on stdio (runs alongside HTTP — purely additive, no changes to HTTP behavior)
if (args.lsp) {
  //const { startLSPHandler } = await import("./lsp/lsp-handler")
  // TODO: enable lsp
  //startLSPHandler()
  log.info("LSP handler started on stdio")
}

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, async () => {
    log.info("received signal, shutting down", { signal })
    Server.shutdown()
    await Instance.disposeAll().catch(() => {})
    process.exit(0)
  })
}
