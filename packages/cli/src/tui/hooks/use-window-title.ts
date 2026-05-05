import { useTerminalTitle } from "@liteai/ink"
import { useMemo } from "react"
import { selectPermissions, selectQuestions, selectSessionStatus, useAppState } from "../state"

/**
 * Terminal title bar status — mirrors Claude Code & Gemini CLI behavior.
 *
 * States (in priority order):
 *   ✋  Action Required (folder)  — permission/question pending
 *   ✦  Working… (folder)          — model is responding
 *   ⏳ Retrying… (folder)         — transient error, auto-retry
 *   ◇  Ready (folder)             — idle, waiting for user input
 *
 * On Windows, sets `process.title` (conhost doesn't support OSC 0).
 * Elsewhere, writes OSC 0 via Ink's stdout.
 *
 * Title is padded to 80 chars to prevent taskbar icon jitter (Gemini CLI pattern).
 */

const MAX_LEN = 80

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  return text.substring(0, maxLen - 1) + "…"
}

interface WindowTitleOptions {
  sessionID: string
  folderName: string
}

export function useWindowTitle({ sessionID, folderName }: WindowTitleOptions): void {
  const sessionStatus = useAppState(selectSessionStatus(sessionID))
  const permissions = useAppState(selectPermissions(sessionID))
  const questions = useAppState(selectQuestions(sessionID))

  const title = useMemo(() => {
    if (process.env.LITEAI_DISABLE_TERMINAL_TITLE) return null

    const hasActionRequired = permissions.length > 0 || questions.length > 0
    const isBusy = sessionStatus?.type === "busy"
    const isRetrying = sessionStatus?.type === "retry"

    const getSuffix = (context: string) => ` (${context})`

    let base: string
    if (hasActionRequired) {
      base = "✋  Action Required"
    } else if (isRetrying) {
      base = "⏳ Retrying…"
    } else if (isBusy) {
      base = "✦  Working…"
    } else {
      base = "◇  Ready"
    }

    const maxContextLen = MAX_LEN - base.length - 3 // " (" + ")"
    const context = truncate(folderName, maxContextLen)
    const raw = `${base}${getSuffix(context)}`

    // Strip control characters, pad to fixed width to prevent taskbar jitter
    // eslint-disable-next-line no-control-regex
    const safe = raw.replace(/[\x00-\x1F\x7F]/g, "")
    return safe.padEnd(MAX_LEN, " ").substring(0, MAX_LEN)
  }, [sessionStatus, permissions, questions, folderName])

  useTerminalTitle(title)
}

/**
 * Idle title for the home route (no active session).
 */
export function useIdleWindowTitle(folderName: string): void {
  const title = useMemo(() => {
    if (process.env.LITEAI_DISABLE_TERMINAL_TITLE) return null

    const base = "LiteAI"
    const maxContextLen = MAX_LEN - base.length - 3
    const context = truncate(folderName, maxContextLen)
    const raw = `${base} (${context})`
    // eslint-disable-next-line no-control-regex
    const safe = raw.replace(/[\x00-\x1F\x7F]/g, "")
    return safe.padEnd(MAX_LEN, " ").substring(0, MAX_LEN)
  }, [folderName])

  useTerminalTitle(title)
}
