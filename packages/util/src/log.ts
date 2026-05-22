import { AsyncLocalStorage } from "node:async_hooks"
import { createWriteStream, type WriteStream } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"
import { logs, SeverityNumber } from "@opentelemetry/api-logs"
import z from "zod"
import { Glob } from "./glob"

export namespace Log {
  export const context = new AsyncLocalStorage<{ client?: string }>()

  export const Level = z.enum(["DEBUG", "INFO", "WARN", "ERROR"]).meta({ ref: "LogLevel", description: "Log level" })
  export type Level = z.infer<typeof Level>

  const levelPriority: Record<Level, number> = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
  }

  let level: Level = "INFO"

  function shouldLog(input: Level): boolean {
    return levelPriority[input] >= levelPriority[level]
  }

  export type Logger = {
    debug(message?: unknown, extra?: Record<string, unknown>): void
    info(message?: unknown, extra?: Record<string, unknown>): void
    error(message?: unknown, extra?: Record<string, unknown>): void
    warn(message?: unknown, extra?: Record<string, unknown>): void
    tag(key: string, value: string): Logger
    clone(): Logger
    time(
      message: string,
      extra?: Record<string, unknown>,
    ): {
      stop(): void
      [Symbol.dispose](): void
    }
  }

  const loggers = new Map<string, Logger>()

  export const Default = create({ service: "default" })

  // channels list:
  // "acp-agent", "acp-command", "acp-session-manager", "agent", "auth"
  // "bash-tool", "bun", "bus", "config", "db",
  // "event", "file", "format", "hook", "http",
  // "ide", "installation", "lsp", "mcp", "patch",
  // "permission", "plugin", "project", "provider", "pty",
  // "question", "ripgrep", "scheduler", "server", "session",
  // "share-next", "skill", "snapshot", "state", "storage",
  // "trace", "vcs", "workspace-sync", "worktree",
  export const CHANNELS = [
    "agent",
    "auth",
    "bus",
    "config",
    "db",
    "file",
    "format",
    "hook",
    "lsp",
    "mcp",
    "plugin",
    "project",
    "provider",
    "scheduler",
    "server",
    "session",
    "skill",
    "snapshot",
    "telemetry",
    "vcs",
  ] as const

  export const SUPPRESSED = ["http", "permission"] as const

  export interface Options {
    dir: string
    print: boolean
    dev?: boolean
    level?: Level
  }

  let logdir = ""
  let logpath = ""
  export function file() {
    return logpath
  }

  // Channel writers keyed by prefix (e.g. "server", "session")
  const channels = new Map<string, (msg: string) => void>()

  const colors = {
    INFO: "\x1b[32m", // Green
    WARN: "\x1b[33m", // Yellow
    ERROR: "\x1b[31m", // Red
    DEBUG: "\x1b[34m", // Blue
    RESET: "\x1b[0m",
  }

  function colorize(msg: string) {
    if (msg.startsWith("INFO ")) return colors.INFO + msg + colors.RESET
    if (msg.startsWith("WARN ")) return colors.WARN + msg + colors.RESET
    if (msg.startsWith("ERROR ")) return colors.ERROR + msg + colors.RESET
    if (msg.startsWith("DEBUG ")) return colors.DEBUG + msg + colors.RESET
    return msg
  }

  const openStreams = new Set<WriteStream>()

  let write: (msg: string) => number | Promise<number> = (msg) => {
    process.stderr.write(colorize(msg))
    return msg.length
  }

  function streamWriter(stream: WriteStream) {
    return (msg: string) => {
      if (stream.destroyed) return
      try {
        stream.write(msg, (err) => {
          if (err) {
            process.stderr.write(`[Log channel stream write error] ${err.stack || err.message || err}\n`)
          }
        })
      } catch (err) {
        process.stderr.write(
          `[Log channel streamWriter error] ${err instanceof Error ? err.stack || err.message : err}\n`,
        )
      }
    }
  }

  function channelWrite(service: string | undefined, msg: string) {
    if (service) {
      for (const prefix of SUPPRESSED) {
        if (service === prefix || service.startsWith(`${prefix}.`) || service.startsWith(`${prefix}:`)) {
          return // Drop the log entirely
        }
      }

      for (const [prefix, writer] of channels) {
        if (service === prefix || service.startsWith(`${prefix}.`) || service.startsWith(`${prefix}:`)) {
          writer(msg)
          break
        }
      }
    }
    write(msg)
  }

  export async function shutdown() {
    write = (msg) => {
      process.stderr.write(colorize(msg))
      return msg.length
    }
    channels.clear()

    const closePromises = [...openStreams].map((s) => {
      return new Promise<void>((resolve) => {
        if (s.destroyed) {
          resolve()
          return
        }
        s.end(() => {
          s.destroy()
          resolve()
        })
      })
    })
    await Promise.all(closePromises)
    openStreams.clear()
  }

  export async function init(options: Options) {
    await shutdown()

    if (options.level) level = options.level
    logdir = options.dir
    cleanup(options.dir)

    logpath = path.join(
      options.dir,
      options.dev ? "liteai.log" : `${new Date().toISOString().split(".")[0].replace(/:/g, "")}.log`,
    )
    try {
      await fs.mkdir(options.dir, { recursive: true })
    } catch (err) {
      process.stderr.write(`[Log init mkdir error] ${err instanceof Error ? err.stack || err.message : err}\n`)
      return
    }
    await fs.truncate(logpath).catch(() => {})
    const stream = createWriteStream(logpath, { flags: "a" })
    stream.on("error", (err) => {
      process.stderr.write(`[Log stream error] ${err.stack || err.message || err}\n`)
    })
    openStreams.add(stream)
    write = (msg: string) => {
      if (options.print) {
        process.stderr.write(colorize(msg))
      }
      if (stream.destroyed) {
        return Promise.resolve(0)
      }
      return new Promise<number>((resolve) => {
        try {
          stream.write(msg, (err) => {
            if (err) {
              process.stderr.write(`[Log stream write error] ${err.stack || err.message || err}\n`)
            }
            resolve(msg.length)
          })
        } catch (err) {
          process.stderr.write(`[Log write error] ${err instanceof Error ? err.stack || err.message : err}\n`)
          resolve(0)
        }
      })
    }

    // Set up per-channel log files
    for (const ch of CHANNELS) {
      const file = path.join(options.dir, `${ch}.log`)
      await fs.truncate(file).catch(() => {})
      const s = createWriteStream(file, { flags: "a" })
      s.on("error", (err) => {
        process.stderr.write(`[Log channel stream error:${ch}] ${err.stack || err.message || err}\n`)
      })
      openStreams.add(s)
      channels.set(ch, streamWriter(s))
    }
  }

  /** Returns paths to all active channel log files */
  export function channelFiles() {
    return [...channels.keys()].map((ch) => path.join(logdir, `${ch}.log`))
  }

  async function cleanup(dir: string) {
    const files = await Glob.scan("????-??-??T??????.log", {
      cwd: dir,
      absolute: true,
      include: "file",
    })
    if (files.length <= 5) return

    const filesToDelete = files.slice(0, -10)
    await Promise.all(filesToDelete.map((file) => fs.unlink(file).catch(() => {})))
  }

  function formatError(error: Error, depth = 0): string {
    const parts = [`[${error.name}] ${error.message}`]
    if (error.stack) parts.push(`stack=${error.stack.replace(/\n/g, "\\n")}`)
    if (error.cause instanceof Error && depth < 10) parts.push(`cause={${formatError(error.cause, depth + 1)}}`)
    return parts.join(" ")
  }

  let last = Date.now()
  export function create(tags?: Record<string, unknown>) {
    tags = tags || {}

    const service = tags.service as string | undefined
    if (service) {
      const cached = loggers.get(service)
      if (cached) {
        return cached
      }
    }

    function buildPrefix(extra?: Record<string, unknown>) {
      const ctx = context.getStore()
      const clientTag = ctx?.client ? { client: ctx.client } : {}
      return Object.entries({
        ...tags,
        ...clientTag,
        ...extra,
      })
        .filter(([_, value]) => value !== undefined && value !== null)
        .map(([key, value]) => {
          const prefix = `${key}=`
          if (value instanceof Error) return prefix + formatError(value)
          if (typeof value === "object") return prefix + JSON.stringify(value)
          if (typeof value === "string" && (value.includes("\n") || value.includes('"')))
            return prefix + JSON.stringify(value)
          return prefix + value
        })
        .join(" ")
    }

    function build(message: unknown, extra?: Record<string, unknown>) {
      const prefix = buildPrefix(extra)
      const next = new Date()
      const diff = next.getTime() - last
      last = next.getTime()
      return `${[next.toISOString().split(".")[0], `+${diff}ms`, prefix, message].filter(Boolean).join(" ")}\n`
    }

    function otelEmit(lvl: Level, serviceId: string | undefined, msgPayload: unknown, extra?: Record<string, unknown>) {
      try {
        const otelLogger = logs.getLogger("liteai", "1.0.0")

        const severityMap: Record<Level, SeverityNumber> = {
          DEBUG: SeverityNumber.DEBUG,
          INFO: SeverityNumber.INFO,
          WARN: SeverityNumber.WARN,
          ERROR: SeverityNumber.ERROR,
        }

        const rawAttributes: Record<string, unknown> = {
          "service.name": "liteai",
          "service.namespace": "liteai",
          "liteai.channel": serviceId ?? "default",
          ...tags,
          ...context.getStore(),
          ...extra,
        }

        const safeAttributes: Record<string, string | number | boolean> = {}
        for (const [key, value] of Object.entries(rawAttributes)) {
          if (value === undefined || value === null) continue
          if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
            if (typeof value === "string" && value.length > 16000) {
              safeAttributes[key] = `${value.substring(0, 16000)}... [truncated]`
            } else {
              safeAttributes[key] = value
            }
          } else if (value instanceof Error) {
            safeAttributes[key] = value.message
          } else {
            const strVal = JSON.stringify(value)
            if (strVal && strVal.length > 16000) {
              safeAttributes[key] = `${strVal.substring(0, 16000)}... [truncated]`
            } else {
              safeAttributes[key] = strVal
            }
          }
        }

        if (msgPayload instanceof Error) {
          safeAttributes["exception.message"] = msgPayload.message
          safeAttributes["exception.type"] = msgPayload.name
          safeAttributes["exception.stacktrace"] = msgPayload.stack || ""
        }

        let body =
          msgPayload instanceof Error
            ? msgPayload.message
            : typeof msgPayload === "object"
              ? JSON.stringify(msgPayload)
              : String(msgPayload)

        const prefixStr = buildPrefix(extra)
        if (prefixStr) {
          body = `${prefixStr} ${body}`
        }

        if (body.length > 16000) {
          body = `${body.substring(0, 16000)}... [truncated]`
        }

        otelLogger.emit({
          severityNumber: severityMap[lvl],
          severityText: lvl,
          body,
          attributes: safeAttributes as import("@opentelemetry/api-logs").LogAttributes,
        })
      } catch {
        /* Ignore if telemetry is offline */
      }
    }

    const result: Logger = {
      debug(message?: unknown, extra?: Record<string, unknown>) {
        if (shouldLog("DEBUG")) {
          otelEmit("DEBUG", service, message, extra)
          channelWrite(service, `DEBUG ${build(message, extra)}`)
        }
      },
      info(message?: unknown, extra?: Record<string, unknown>) {
        if (shouldLog("INFO")) {
          otelEmit("INFO", service, message, extra)
          channelWrite(service, `INFO  ${build(message, extra)}`)
        }
      },
      error(message?: unknown, extra?: Record<string, unknown>) {
        if (shouldLog("ERROR")) {
          otelEmit("ERROR", service, message, extra)
          const msg =
            message instanceof Error ? `ERROR ${build(formatError(message), extra)}` : `ERROR ${build(message, extra)}`
          channelWrite(service, msg)
        }
      },
      warn(message?: unknown, extra?: Record<string, unknown>) {
        if (shouldLog("WARN")) {
          otelEmit("WARN", service, message, extra)
          channelWrite(service, `WARN  ${build(message, extra)}`)
        }
      },
      tag(key: string, value: string) {
        if (tags) tags[key] = value
        return result
      },
      clone() {
        return Log.create({ ...tags })
      },
      time(message: string, extra?: Record<string, unknown>) {
        const now = Date.now()
        result.info(message, { status: "started", ...extra })
        function stop() {
          result.info(message, {
            status: "completed",
            duration: Date.now() - now,
            ...extra,
          })
        }
        return {
          stop,
          [Symbol.dispose]() {
            stop()
          },
        }
      },
    }

    if (service) {
      loggers.set(service, result)
    }

    return result
  }
}
