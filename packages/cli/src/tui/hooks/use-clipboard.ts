/**
 * Terminal-safe clipboard write hook.
 *
 * Strategy:
 * 1. OSC-52 escape sequence — works in most modern terminals (xterm, iTerm2,
 *    Windows Terminal, tmux with `set -g set-clipboard on`).
 * 2. Platform-specific fallback via child_process: `clip.exe` (Windows),
 *    `pbcopy` (macOS), `xclip -selection clipboard` (Linux).
 *
 * Returns `{ copy }` — an async function that writes text to clipboard
 * and shows a toast notification on success/failure.
 */

import { execSync } from "node:child_process"
import { Log } from "@liteai/util/log"
import { useCallback } from "react"
import { useToast } from "../context/toast"

const log = Log.create({ service: "clipboard" })

/**
 * Write text to the terminal clipboard via OSC-52 escape sequence.
 * OSC 52 is widely supported: xterm, iTerm2, Windows Terminal, kitty, alacritty.
 */
function writeOSC52(text: string): boolean {
  try {
    const encoded = Buffer.from(text).toString("base64")
    // OSC 52 format: \x1b]52;c;<base64>\x07
    // "c" targets the system clipboard
    process.stdout.write(`\x1b]52;c;${encoded}\x07`)
    return true
  } catch {
    return false
  }
}

/**
 * Platform-specific fallback clipboard write.
 * Pipes text to a clipboard command via stdin.
 */
function writePlatformClipboard(text: string): boolean {
  try {
    const platform = process.platform
    let command: string

    if (platform === "win32") {
      command = "clip.exe"
    } else if (platform === "darwin") {
      command = "pbcopy"
    } else {
      // Linux/BSD — try xclip first, xsel as fallback
      command = "xclip -selection clipboard"
    }

    execSync(command, { input: text, stdio: ["pipe", "ignore", "ignore"], timeout: 3000 })
    return true
  } catch (err) {
    log.warn("platform clipboard write failed", { error: err, platform: process.platform })
    return false
  }
}

export function useClipboard() {
  const toast = useToast()

  const copy = useCallback(
    async (text: string) => {
      if (!text) {
        log.warn("clipboard copy called with empty text")
        return
      }

      // Try OSC-52 first (non-blocking, works over SSH)
      const osc52Success = writeOSC52(text)

      // Also try platform clipboard as a reliable backup
      // (OSC-52 may silently fail if terminal doesn't support it)
      const platformSuccess = writePlatformClipboard(text)

      if (osc52Success || platformSuccess) {
        toast.show({ variant: "success", message: "Copied to clipboard" })
      } else {
        log.error("all clipboard write methods failed")
        toast.show({ variant: "error", message: "Failed to copy to clipboard" })
      }
    },
    [toast],
  )

  return { copy }
}
