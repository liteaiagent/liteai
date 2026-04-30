/**
 * Keybinding matching logic.
 *
 * Ported from MVP `keybindings/match.ts`.
 * Handles modifier equality matching and Ink's specific key parsing quirks
 * (e.g., escape sets meta=true).
 */

import type { Key } from "@liteai/ink"
import type { ParsedBinding, ParsedKeystroke } from "./types"

/**
 * Modifier keys from Ink's Key type that we care about for matching.
 * `fn` is intentionally excluded.
 */
type InkModifiers = Pick<Key, "ctrl" | "shift" | "meta" | "super">

function getInkModifiers(key: Key): InkModifiers {
  return {
    ctrl: key.ctrl,
    shift: key.shift,
    meta: key.meta,
    super: key.super,
  }
}

/**
 * Extract the normalized key name from Ink's Key + input.
 * Maps Ink's boolean flags (key.escape, key.return, etc.) to string names
 * that match our ParsedKeystroke.key format.
 */
export function getKeyName(input: string, key: Key): string | null {
  if (key.escape) return "escape"
  if (key.return) return "enter"
  if (key.tab) return "tab"
  if (key.backspace) return "backspace"
  if (key.delete) return "delete"
  if (key.upArrow) return "up"
  if (key.downArrow) return "down"
  if (key.leftArrow) return "left"
  if (key.rightArrow) return "right"
  if (key.pageUp) return "pageup"
  if (key.pageDown) return "pagedown"
  if (key.wheelUp) return "wheelup"
  if (key.wheelDown) return "wheeldown"
  if (key.home) return "home"
  if (key.end) return "end"
  if (input.length === 1) return input.toLowerCase()
  return null
}

/**
 * Check if all modifiers match between Ink Key and ParsedKeystroke.
 *
 * Alt and Meta: Ink sets `key.meta` for Alt/Option. A `meta` modifier in
 * config is treated as an alias for `alt`.
 */
function modifiersMatch(inkMods: InkModifiers, target: ParsedKeystroke): boolean {
  if (inkMods.ctrl !== target.ctrl) return false
  if (inkMods.shift !== target.shift) return false

  // Alt and meta both map to key.meta in Ink
  const targetNeedsMeta = target.alt || target.meta
  if (inkMods.meta !== targetNeedsMeta) return false

  // Super (cmd/win) is a distinct modifier
  if (inkMods.super !== target.super) return false

  return true
}

/**
 * Check if a ParsedKeystroke matches the given Ink input + Key.
 */
export function matchesKeystroke(input: string, key: Key, target: ParsedKeystroke): boolean {
  const keyName = getKeyName(input, key)
  if (keyName !== target.key) return false

  const inkMods = getInkModifiers(key)

  // QUIRK: Ink sets key.meta=true when escape is pressed.
  // Ignore meta modifier when matching the escape key itself.
  if (key.escape) {
    return modifiersMatch({ ...inkMods, meta: false }, target)
  }

  return modifiersMatch(inkMods, target)
}

/**
 * Check if Ink's Key + input matches a parsed binding's first keystroke.
 */
export function matchesBinding(input: string, key: Key, binding: ParsedBinding): boolean {
  if (binding.chord.length !== 1) return false
  const keystroke = binding.chord[0]
  if (!keystroke) return false
  return matchesKeystroke(input, key, keystroke)
}
