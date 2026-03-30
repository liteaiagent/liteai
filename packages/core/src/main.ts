#!/usr/bin/env bun
import yargs from "yargs"
import { hideBin } from "yargs/helpers"
/**
 * Standalone core server entrypoint.
 * Starts the LiteAI server without TUI or CLI chrome.
 */
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

Database.Client()

const server = Server.listen({ port: args.port, hostname: args.hostname })
console.log(`liteai core server listening on http://${server.hostname}:${server.port}`)

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, async () => {
    Log.Default.info("received signal, shutting down", { signal })
    Server.shutdown()
    await Instance.disposeAll().catch(() => {})
    process.exit(0)
  })
}
