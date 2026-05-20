/**
 * Exit summary — rendered to stdout after Ink unmounts.
 *
 * Follows Claude Code's `printResumeHint` pattern: write directly to the main
 * buffer after alternate screen exits. Content is Gemini CLI-inspired (richer
 * than Claude's single-line hint).
 *
 * @module util/exit-summary
 */

// ── Types ────────────────────────────────────────────────────────────────

export interface ExitSummaryData {
  modelID?: string
  turnCount: number
  toolCalls: { total: number; success: number; failed: number }
  contextUtilization: number
  totalCost: number | null
  durationMs: number
  sessionID?: string
}

// ── UTF-8 detection ──────────────────────────────────────────────────────

/**
 * Detect whether the terminal supports UTF-8 box-drawing characters.
 *
 * Detection order:
 * 1. `LITEAI_ASCII=1` env → force ASCII
 * 2. Non-TTY (piped/redirected) → ASCII
 * 3. Modern terminal indicators → UTF-8
 * 4. Locale regex → UTF-8
 * 5. Platform fallback
 */
export function supportsUTF8(): boolean {
  // Explicit override
  if (process.env.LITEAI_ASCII === "1") return false

  // Non-TTY — piped or redirected
  if (!process.stdout.isTTY) return false

  // Modern terminal indicators
  if (process.env.WT_SESSION) return true
  const termProgram = process.env.TERM_PROGRAM?.toLowerCase()
  if (termProgram && ["vscode", "cursor", "windsurf"].includes(termProgram)) return true

  // Locale detection
  const locale = process.env.LC_ALL || process.env.LC_CTYPE || process.env.LANG || ""
  if (/utf-?8/i.test(locale)) return true

  // Platform fallback
  if (process.platform === "win32") {
    // Legacy cmd.exe/PowerShell — no locale, no modern terminal
    return false
  }

  // Non-Windows TTY with no locale — most modern *nix terminals default to UTF-8
  return true
}

// ── Duration formatting ──────────────────────────────────────────────────

/**
 * Format a duration in milliseconds to a human-readable string.
 * Adapted from Gemini CLI's `formatDuration` in `formatters.ts`.
 */
export function formatDuration(milliseconds: number): string {
  if (milliseconds <= 0) return "0s"
  if (milliseconds < 1000) return `${Math.round(milliseconds)}ms`

  const totalSeconds = milliseconds / 1000
  if (totalSeconds < 60) return `${totalSeconds.toFixed(1)}s`

  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = Math.floor(totalSeconds % 60)

  const parts: string[] = []
  if (hours > 0) parts.push(`${hours}h`)
  if (minutes > 0) parts.push(`${minutes}m`)
  if (seconds > 0) parts.push(`${seconds}s`)

  return parts.join(" ")
}

// ── Summary formatting ───────────────────────────────────────────────────

/**
 * Format the interaction summary as a box for stdout.
 * Returns an empty string if there's nothing meaningful to show (no session, no turns).
 */
export function formatExitSummary(data: ExitSummaryData): string {
  // Don't show summary for empty sessions
  if (data.turnCount === 0 && data.toolCalls.total === 0 && !data.sessionID) {
    return ""
  }

  const utf8 = supportsUTF8()
  const ok = utf8 ? "✓" : "[OK]"
  const fail = utf8 ? "✗" : "[FAIL]"

  // Box characters
  const tl = utf8 ? "┌" : "+"
  const tr = utf8 ? "┐" : "+"
  const bl = utf8 ? "└" : "+"
  const br = utf8 ? "┘" : "+"
  const h = utf8 ? "─" : "-"
  const v = utf8 ? "│" : "|"

  const innerWidth = 41
  const hr = h.repeat(innerWidth)

  const pad = (text: string): string => {
    const visible = stripAnsi(text)
    const padding = Math.max(0, innerWidth - 2 - visible.length)
    return `${v} ${text}${" ".repeat(padding)} ${v}`
  }

  const lines: string[] = []
  lines.push(`${tl}${hr}${tr}`)
  lines.push(pad("Interaction Summary"))

  if (data.modelID) {
    lines.push(pad(`Model:        ${data.modelID}`))
  }

  if (data.turnCount > 0) {
    lines.push(pad(`Messages:     ${data.turnCount}`))
  }

  if (data.toolCalls.total > 0) {
    lines.push(
      pad(`Tool Calls:   ${data.toolCalls.total} (${data.toolCalls.success} ${ok} / ${data.toolCalls.failed} ${fail})`),
    )
  }

  if (data.contextUtilization > 0) {
    const pct = Math.round(data.contextUtilization * 100)
    lines.push(pad(`Context:      ${pct}% used`))
  }

  if (data.totalCost !== null && data.totalCost > 0) {
    lines.push(pad(`Cost:         $${data.totalCost.toFixed(3)}`))
  }

  if (data.durationMs > 0) {
    lines.push(pad(`Wall Time:    ${formatDuration(data.durationMs)}`))
  }

  if (data.sessionID) {
    lines.push(pad(""))
    lines.push(pad(`To resume: liteai --resume ${data.sessionID}`))
  }

  lines.push(`${bl}${hr}${br}`)

  return `\n${lines.join("\n")}\n`
}

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Strip ANSI escape sequences from a string for accurate width measurement.
 * Minimal implementation — covers SGR (color) sequences only.
 */
function stripAnsi(str: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Intentional — matching ANSI SGR escape sequences
  return str.replace(/\x1B\[[0-9;]*m/g, "")
}
