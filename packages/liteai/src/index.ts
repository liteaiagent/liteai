import { EOL } from "node:os"
import { NamedError } from "@liteai/util/error"
import yargs from "yargs"
import { hideBin } from "yargs/helpers"
import { ConsoleCommand } from "./cli/cmd/account"
import { AcpCommand } from "./cli/cmd/acp"
import { AgentCommand } from "./cli/cmd/agent"
import { DbCommand } from "./cli/cmd/db"
import { DebugCommand } from "./cli/cmd/debug"
import { ExportCommand } from "./cli/cmd/export"
import { GenerateCommand } from "./cli/cmd/generate"
import { GithubCommand } from "./cli/cmd/github"
import { ImportCommand } from "./cli/cmd/import"
import { McpCommand } from "./cli/cmd/mcp"
import { ModelsCommand } from "./cli/cmd/models"
import { PrCommand } from "./cli/cmd/pr"
import { ProvidersCommand } from "./cli/cmd/providers"
import { RunCommand } from "./cli/cmd/run"
import { ServeCommand } from "./cli/cmd/serve"
import { SessionCommand } from "./cli/cmd/session"
import { StatsCommand } from "./cli/cmd/stats"
import { TraceCommand } from "./cli/cmd/trace"
import { AttachCommand } from "./cli/cmd/tui/attach"
import { TuiThreadCommand } from "./cli/cmd/tui/thread"
import { UninstallCommand } from "./cli/cmd/uninstall"
import { UpgradeCommand } from "./cli/cmd/upgrade"
import { WebCommand } from "./cli/cmd/web"
import { WorkspaceServeCommand } from "./cli/cmd/workspace-serve"
import { FormatError } from "./cli/error"
import { UI } from "./cli/ui"
import { Installation } from "./installation"
import { Instance } from "./project/instance"
import { Server } from "./server/server"
import { Database } from "./storage/db"
import { Log } from "./util/log"

function serializeError(e: unknown) {
  if (e instanceof NamedError) return { ...e.toObject(), stack: e.stack }
  if (e instanceof Error) return { name: e.name, message: e.message, stack: e.stack, cause: e.cause }
  return { value: e }
}

process.on("unhandledRejection", (e) => {
  Log.Default.error("rejection", serializeError(e))
})

process.on("uncaughtException", (e) => {
  Log.Default.error("exception", serializeError(e))
})

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, async () => {
    Log.Default.info("received signal, shutting down", { signal })
    Server.shutdown()
    await Instance.disposeAll().catch(() => {})
    process.exit(0)
  })
}

let cli = yargs(hideBin(process.argv))
  .parserConfiguration({ "populate--": true })
  .scriptName("liteai")
  .wrap(100)
  .help("help", "show help")
  .alias("help", "h")
  .version("version", "show version number", Installation.VERSION)
  .alias("version", "v")
  .option("print-logs", {
    describe: "print logs to stderr",
    type: "boolean",
  })
  .option("log-level", {
    describe: "log level",
    type: "string",
    choices: ["DEBUG", "INFO", "WARN", "ERROR"],
  })
  .option("plugin-dir", {
    describe: "load plugin(s) from local directory (repeatable)",
    type: "string",
    array: true,
  })
  .middleware(async (opts) => {
    // Set plugin dirs early so Flag.LITEAI_PLUGIN_DIR picks them up during config load
    const pluginDirs = opts.pluginDir as string[] | undefined
    if (pluginDirs?.length) {
      process.env.LITEAI_PLUGIN_DIR = pluginDirs.join(",")
    }

    await Log.init({
      print: process.argv.includes("--print-logs"),
      dev: Installation.isLocal(),
      level: (() => {
        if (opts.logLevel) return opts.logLevel as Log.Level
        if (Installation.isLocal()) return "DEBUG"
        return "INFO"
      })(),
    })

    process.env.AGENT = "1"
    process.env.LITEAI = "1"
    process.env.LITEAI_PID = String(process.pid)

    Log.Default.info("liteai", {
      version: Installation.VERSION,
      args: process.argv.slice(2),
    })

    Database.Client()
  })
  .usage(`\n${UI.logo()}`)
  .completion("completion", "generate shell completion script")
  .command(AcpCommand)
  .command(McpCommand)
  .command(TuiThreadCommand)
  .command(AttachCommand)
  .command(RunCommand)
  .command(GenerateCommand)
  .command(DebugCommand)
  .command(ConsoleCommand)
  .command(ProvidersCommand)
  .command(AgentCommand)
  .command(UpgradeCommand)
  .command(UninstallCommand)
  .command(ServeCommand)
  .command(WebCommand)
  .command(ModelsCommand)
  .command(StatsCommand)
  .command(ExportCommand)
  .command(TraceCommand)
  .command(ImportCommand)
  .command(GithubCommand)
  .command(PrCommand)
  .command(SessionCommand)
  .command(DbCommand)

if (Installation.isLocal()) {
  cli = cli.command(WorkspaceServeCommand)
}

cli = cli
  .fail((msg, err) => {
    if (
      msg?.startsWith("Unknown argument") ||
      msg?.startsWith("Not enough non-option arguments") ||
      msg?.startsWith("Invalid values:")
    ) {
      if (err) throw err
      cli.showHelp("log")
    }
    if (err) throw err
    process.exit(1)
  })
  .strict()

try {
  await cli.parse()
} catch (e) {
  const data: Record<string, unknown> = {}
  if (e instanceof NamedError) {
    const obj = e.toObject()
    Object.assign(data, {
      ...obj.data,
    })
  }

  if (e instanceof Error) {
    Object.assign(data, {
      name: e.name,
      message: e.message,
      cause: e.cause?.toString(),
      stack: e.stack,
    })
  }

  if (e instanceof ResolveMessage) {
    Object.assign(data, {
      name: e.name,
      message: e.message,
      code: e.code,
      specifier: e.specifier,
      referrer: e.referrer,
      position: e.position,
      importKind: e.importKind,
    })
  }
  Log.Default.error("fatal", data)
  const formatted = FormatError(e)
  if (formatted) UI.error(formatted)
  if (formatted === undefined) {
    UI.error(`Unexpected error, check log file at ${Log.file()} for more details${EOL}`)
    process.stderr.write((e instanceof Error ? e.message : String(e)) + EOL)
  }
  process.exitCode = 1
} finally {
  // Some subprocesses don't react properly to SIGTERM and similar signals.
  // Most notably, some docker-container-based MCP servers don't handle such signals unless
  // run using `docker run --init`.
  // Explicitly exit to avoid any hanging subprocesses.
  process.exit()
}
