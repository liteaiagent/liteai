import { NamedError } from "@liteai/util/error"
import { Log } from "@liteai/util/log"
import { getGlobal } from "./config/loader"
import { Global } from "./global/index"
import { Installation } from "./installation/index"
import { Instance } from "./project/instance"
import { Server } from "./server/server"
import { initializeTelemetry, shutdownTelemetry } from "./telemetry/instrumentation"

export interface RuntimeOptions {
  printLogs?: boolean
  debug?: boolean
}

export namespace Runtime {
  function serializeError(e: unknown) {
    if (e instanceof NamedError) return { ...e.toObject(), stack: e.stack }
    if (e instanceof Error) return { name: e.name, message: e.message, stack: e.stack, cause: e.cause }
    return { value: e }
  }

  export async function boot(options: RuntimeOptions = {}) {
    await Log.init({
      dir: Global.Path.log,
      print: options.printLogs ?? false,
      dev: Installation.isLocal(),
      level: options.debug ? "DEBUG" : Installation.isLocal() ? "DEBUG" : "INFO",
    })

    const log = Log.create({ service: "runtime" })

    process.on("unhandledRejection", (reason) => {
      log.error("CRITICAL: Unhandled Promise Rejection detected!", {
        reason: reason instanceof Error ? reason.message : String(reason),
        stack: reason instanceof Error ? reason.stack : undefined,
        reasonObj: reason,
      })
    })

    process.on("uncaughtException", (e) => {
      log.error("exception", serializeError(e))
    })

    await getGlobal()
    await initializeTelemetry()

    log.info("@liteai/core runtime initialized", {
      telemetry: process.env.LITEAI_TELEMETRY_DISABLED === "1" ? "disabled (opt-out)" : "enabled (default)",
    })
  }

  export async function shutdown() {
    const log = Log.create({ service: "runtime" })
    log.info("shutting down runtime")

    await Instance.disposeAll().catch(() => {})
    Server.shutdown()
    await shutdownTelemetry().catch((e) => log.error("telemetry shutdown failed", { error: e }))
  }
}
