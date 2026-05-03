import { createWriteStream, type WriteStream } from "node:fs"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

/**
 * TUI-safe file-only logger.
 *
 * Unlike the core `Log` utility, this logger NEVER writes to stdout/stderr.
 * All output goes directly to a dedicated `tui.log` file via a WriteStream.
 * This guarantees zero interference with Ink's terminal render loop.
 *
 * The log directory is resolved locally (~/.liteai/logs/) with zero dependency
 * on @liteai/core, which may be running on a remote server.
 *
 * The logger initializes lazily on first write — no explicit init() call needed.
 */

type Level = "DEBUG" | "INFO" | "WARN" | "ERROR"

const LOG_DIR = path.join(os.homedir(), ".liteai", "logs")

let stream: WriteStream | undefined
let initPromise: Promise<void> | undefined

async function ensureStream(): Promise<WriteStream> {
  if (stream) return stream

  if (!initPromise) {
    initPromise = (async () => {
      await fs.mkdir(LOG_DIR, { recursive: true })

      const filePath = path.join(LOG_DIR, "tui.log")
      // Truncate on startup to keep the log fresh per session
      await fs.truncate(filePath).catch(() => {})
      stream = createWriteStream(filePath, { flags: "a" })
    })()
  }

  await initPromise
  if (!stream) throw new Error("TuiLog: stream failed to initialize")
  return stream
}

function formatExtra(extra?: Record<string, unknown>): string {
  if (!extra) return ""
  return Object.entries(extra)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => {
      if (v instanceof Error) return `${k}=[${v.name}] ${v.message}`
      if (typeof v === "object") return `${k}=${JSON.stringify(v)}`
      return `${k}=${v}`
    })
    .join(" ")
}

function write(level: Level, message: string, extra?: Record<string, unknown>) {
  const timestamp = new Date().toISOString().split(".")[0]
  const extraStr = formatExtra(extra)
  const line = `${level.padEnd(5)} ${timestamp} ${message}${extraStr ? ` ${extraStr}` : ""}\n`

  // Fire-and-forget — never block the React render loop
  ensureStream()
    .then((s) => s.write(line))
    .catch(() => {
      // Absolutely nothing — if we can't write to a file, we silently drop.
      // This is the one place a silent fallback is justified: the logger
      // itself must never become a source of unhandled rejections in the TUI.
    })
}

export const TuiLog = {
  debug(message: string, extra?: Record<string, unknown>) {
    write("DEBUG", message, extra)
  },
  info(message: string, extra?: Record<string, unknown>) {
    write("INFO", message, extra)
  },
  warn(message: string, extra?: Record<string, unknown>) {
    write("WARN", message, extra)
  },
  error(message: string, extra?: Record<string, unknown>) {
    write("ERROR", message, extra)
  },
} as const
