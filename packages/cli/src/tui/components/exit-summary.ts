/**
 * Exit Summary — writes a Gemini-style interaction summary to stdout after the
 * TUI unmounts. Captured before Ink teardown and written in the cleanup handler.
 *
 * Output is written after the alternate screen deactivates so it persists in
 * the terminal's scroll buffer.
 *
 * Encoding: detects UTF-8 capability and falls back to ASCII-safe chars.
 * See phase-5-polish.md §Deliverable 7 for the full encoding detection spec.
 */

import type { SessionStats } from "../hooks/use-session-stats"

// ── Encoding detection ─────────────────────────────────────────────────────

function supportsUtf8(): boolean {
  // Explicit override takes priority
  if (process.env.LITEAI_ASCII === "1") return false

  // Windows without a LANG or LC_ALL override is likely a non-UTF-8 code page
  if (process.platform === "win32") {
    const lang = process.env.LANG ?? process.env.LC_ALL ?? ""
    if (!lang) return false
  }

  // Check stdout encoding capability as a final proxy
  if (typeof process.stdout.getColorDepth === "function") {
    return process.stdout.getColorDepth() > 1
  }

  return true
}

// ── Box drawing ────────────────────────────────────────────────────────────

const UTF8 = {
  topLeft: "┌",
  topRight: "┐",
  bottomLeft: "└",
  bottomRight: "┘",
  horizontal: "─",
  vertical: "│",
  ok: "✓",
  fail: "✗",
} as const

const ASCII = {
  topLeft: "+",
  topRight: "+",
  bottomLeft: "+",
  bottomRight: "+",
  horizontal: "-",
  vertical: "|",
  ok: "[OK]",
  fail: "[FAIL]",
} as const

// ── Formatting helpers ─────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const remaining = s % 60
  return `${m}m ${remaining}s`
}

function formatCost(cost: number | null): string {
  if (cost === null) return "n/a"
  return `$${cost.toFixed(4)}`
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return `${n}`
}

// ── Summary builder ────────────────────────────────────────────────────────

export interface ExitSummaryData {
  stats: SessionStats
  sessionID: string | undefined
  model: string | undefined
  wallTimeMs: number
}

export function formatExitSummary(data: ExitSummaryData): string {
  const utf8 = supportsUtf8()
  const chars = utf8 ? UTF8 : ASCII
  const ellipsis = utf8 ? "\u2026" : "..."
  const WIDTH = 45

  const totalToks =
    data.stats.totalTokens.input +
    data.stats.totalTokens.output +
    data.stats.totalTokens.reasoning +
    data.stats.totalTokens.cache.read +
    data.stats.totalTokens.cache.write

  const toolSuccess = data.stats.toolCalls.success
  const toolFailed = data.stats.toolCalls.failed
  const toolTotal = data.stats.toolCalls.total
  const toolLine = toolTotal > 0 ? `${toolTotal} (${toolSuccess} ${chars.ok} / ${toolFailed} ${chars.fail})` : "0"

  const rows: Array<[string, string]> = [
    ["Model", data.model ?? "unknown"],
    ["Messages", `${data.stats.turnCount}`],
    ["Tool Calls", toolLine],
    ["Tokens", formatTokens(totalToks)],
    ["Context", `${Math.round(data.stats.contextUtilization * 100)}% used`],
    ["Cost", formatCost(data.stats.totalCost)],
    ["Wall Time", formatDuration(data.wallTimeMs)],
  ]

  const hr = chars.horizontal.repeat(WIDTH - 2)
  const top = `${chars.topLeft}${hr}${chars.topRight}`
  const bottom = `${chars.bottomLeft}${hr}${chars.bottomRight}`

  function row(label: string, value: string): string {
    const content = ` ${label.padEnd(14)} ${value}`
    const padded = content.padEnd(WIDTH - 2)
    return `${chars.vertical}${padded}${chars.vertical}`
  }

  function blank(): string {
    return `${chars.vertical}${" ".repeat(WIDTH - 2)}${chars.vertical}`
  }

  function heading(text: string): string {
    const content = ` ${text}`
    const padded = content.padEnd(WIDTH - 2)
    return `${chars.vertical}${padded}${chars.vertical}`
  }

  const lines: string[] = [
    top,
    heading("Interaction Summary"),
    blank(),
    ...rows.map(([label, value]) => row(label, value)),
  ]

  if (data.sessionID) {
    lines.push(blank())
    lines.push(row("To resume", `liteai --resume ${data.sessionID.slice(0, 8)}${ellipsis}`))
  }

  lines.push(bottom)

  return lines.join("\n")
}

/**
 * Write the exit summary to stdout. Called after Ink's alternate screen
 * deactivates so the output persists in the terminal scroll buffer.
 */
export function writeExitSummary(data: ExitSummaryData): void {
  const summary = formatExitSummary(data)
  process.stdout.write(`\n${summary}\n\n`)
}
