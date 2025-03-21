/**
 * Structured logging — console + file output.
 *
 * Port of liteai/core/logger.py (simplified for Node.js)
 *
 * Log file: ./logs/liteai-api-node.log
 *
 * Features:
 * - TRACE level for full payload logging
 * - Structured metadata (key-value pairs alongside messages)
 * - Request correlation IDs via AsyncLocalStorage
 */

import { AsyncLocalStorage } from "node:async_hooks"
import { appendFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"

export type LogLevel = "TRACE" | "DEBUG" | "INFO" | "WARN" | "ERROR"

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  TRACE: -1,
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
}

let currentLevel: LogLevel = "INFO"
let fileLogLevel: LogLevel = "DEBUG" // file always captures debug+

// Log file path: ./logs/liteai-api-node.log
const LOG_DIR = join(process.cwd(), "logs")
const LOG_FILE = join(LOG_DIR, "liteai-api-node.log")

// Ensure log directory exists
try {
  mkdirSync(LOG_DIR, { recursive: true })
} catch {
  // ignore — directory may already exist
}

// ── Request Correlation ────────────────────────────────────────────────────

interface RequestContext {
  requestId: string
}

const requestStore = new AsyncLocalStorage<RequestContext>()

/**
 * Run a function with a request correlation ID.
 * All log calls within the callback (and its async children)
 * will include the requestId in file output.
 */
export function withRequestId<T>(requestId: string, fn: () => T | Promise<T>): T | Promise<T> {
  return requestStore.run({ requestId }, fn)
}

/**
 * Get the current request ID from async context, if any.
 */
export function getRequestId(): string | undefined {
  return requestStore.getStore()?.requestId
}

// ── Level Setters / Getters ────────────────────────────────────────────────

export function setLogLevel(level: LogLevel): void {
  currentLevel = level
}

export function setFileLogLevel(level: LogLevel): void {
  fileLogLevel = level
}

export function getLogLevel(): LogLevel {
  return currentLevel
}

export function getLogFilePath(): string {
  return LOG_FILE
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[currentLevel]
}

function shouldFileLog(level: LogLevel): boolean {
  return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[fileLogLevel]
}

// ── Formatting ─────────────────────────────────────────────────────────────

function formatTimestamp(): string {
  return new Date().toISOString().slice(11, 19)
}

function formatFull(): string {
  return new Date().toISOString()
}

/**
 * Format structured metadata as ` key=value key2=value2` suffix.
 */
function formatMeta(meta?: Record<string, unknown>): string {
  if (!meta || Object.keys(meta).length === 0) return ""
  return ` ${Object.entries(meta)
    .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join(" ")}`
}

function writeToFile(line: string): void {
  try {
    appendFileSync(LOG_FILE, `${line}\n`)
  } catch {
    // Silently fail — don't crash the server over logging
  }
}

/**
 * Pad log level name to 5 chars for alignment.
 */
function padLevel(level: LogLevel): string {
  return level.padEnd(5)
}

// ── Logger Factory ─────────────────────────────────────────────────────────

export function createLogger(name: string) {
  function log(
    level: LogLevel,
    consoleFn: (...args: unknown[]) => void,
    message: string,
    meta?: Record<string, unknown>,
  ) {
    const metaSuffix = formatMeta(meta)
    const reqId = getRequestId()
    const reqPrefix = reqId ? ` [${reqId}]` : ""

    if (shouldLog(level)) {
      consoleFn(`${formatTimestamp()} ${padLevel(level)} ${name}${reqPrefix} -- ${message}${metaSuffix}`)
    }
    if (shouldFileLog(level)) {
      writeToFile(`${formatFull()} ${padLevel(level)} ${name}${reqPrefix} -- ${message}${metaSuffix}`)
    }
  }

  return {
    trace(message: string, meta?: Record<string, unknown>) {
      log("TRACE", console.debug, message, meta)
    },
    debug(message: string, meta?: Record<string, unknown>) {
      log("DEBUG", console.debug, message, meta)
    },
    info(message: string, meta?: Record<string, unknown>) {
      log("INFO", console.info, message, meta)
    },
    warn(message: string, meta?: Record<string, unknown>) {
      log("WARN", console.warn, message, meta)
    },
    error(message: string, meta?: Record<string, unknown>) {
      log("ERROR", console.error, message, meta)
    },
  }
}

export type Logger = ReturnType<typeof createLogger>
