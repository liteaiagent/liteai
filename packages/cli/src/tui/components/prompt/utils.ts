/**
 * Prompt input utility helpers.
 * Adapted port from MVP `PromptInput/utils.ts`.
 *
 * Key adaptations:
 * - `isVimModeEnabled` takes a `Config` parameter instead of reading globals
 * - `getNewlineInstructions` simplified — no terminal detection or keybinding install checks
 * - `isNonSpacePrintable` uses `@liteai/ink` Key type
 */

import type { Key } from "@liteai/ink"

/**
 * Check whether vim mode is currently enabled in the user's config.
 *
 * Unlike the MVP version which read from a global `getGlobalConfig()`,
 * this version takes the config explicitly via parameter, sourced from
 * `useTuiConfig()` in the calling component.
 *
 * Uses Record<string, unknown> because the actual runtime type is
 * TuiConfig.Info (a Zod output), not the SDK Config type.
 */
export function isVimModeEnabled(config: Record<string, unknown>): boolean {
  return config.editorMode === "vim"
}

/**
 * Return the newline instruction hint for the footer.
 *
 * Simplified from the MVP which performed terminal detection
 * (Apple Terminal, iTerm2, VSCode) and keybinding installation checks.
 * Those are MVP-specific integrations we don't carry forward.
 */
export function getNewlineInstructions(): string {
  return "\\⏎ for newline"
}

/**
 * True when the keystroke is a printable character that does not begin
 * with whitespace — i.e., a normal letter/digit/symbol the user typed.
 * Used to gate the lazy space inserted after an image pill.
 */
export function isNonSpacePrintable(input: string, key: Key): boolean {
  if (
    key.ctrl ||
    key.meta ||
    key.escape ||
    key.return ||
    key.tab ||
    key.backspace ||
    key.delete ||
    key.upArrow ||
    key.downArrow ||
    key.leftArrow ||
    key.rightArrow ||
    key.pageUp ||
    key.pageDown ||
    key.home ||
    key.end
  ) {
    return false
  }
  return input.length > 0 && !/^\s/.test(input) && !input.startsWith("\x1b")
}
