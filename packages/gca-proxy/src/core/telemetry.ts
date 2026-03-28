/**
 * Local telemetry logger — JSONL append-only file.
 *
 * Appends one JSON line per LLM request to ~/.liteai/telemetry.jsonl.
 * Fire-and-forget: never throws, never blocks the request path.
 */

import { appendFile, mkdir } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { createLogger } from "./logger.js"

const logger = createLogger("core.telemetry")

// ── Types ──────────────────────────────────────────────────────────────────

export interface TelemetryEntry {
  /** ISO 8601 timestamp */
  timestamp: string
  /** Resolved model name */
  model: string
  /** Code Assist traceId (if available) */
  traceId?: string
  /** Request round-trip latency in ms */
  latencyMs: number
  /** Token usage */
  tokens?: {
    prompt?: number
    completion?: number
    total?: number
    thinking?: number
  }
  /** Gemini finish reason */
  finishReason?: string
  /** Whether the request was streaming */
  stream: boolean
  /** Error message if the request failed */
  error?: string
}

// ── File Path ──────────────────────────────────────────────────────────────

let _telemetryDir: string | null = null

export function getTelemetryPath(): string {
  const configDir = process.env.LITEAI_DATA_DIR || join(homedir(), ".liteai")
  return join(configDir, "telemetry.jsonl")
}

// ── Logger ─────────────────────────────────────────────────────────────────

/**
 * Append a telemetry entry to the JSONL file.
 * Fire-and-forget: errors are logged but never thrown.
 */
export function logTelemetry(entry: TelemetryEntry): void {
  const filePath = getTelemetryPath()
  const line = `${JSON.stringify(entry)}\n`

  // Async write — fire and forget
  ;(async () => {
    try {
      const dir = dirname(filePath)
      if (_telemetryDir !== dir) {
        await mkdir(dir, { recursive: true })
        _telemetryDir = dir
      }
      await appendFile(filePath, line, "utf-8")
    } catch (err) {
      logger.debug(`Failed to write telemetry: ${err}`)
    }
  })()
}
