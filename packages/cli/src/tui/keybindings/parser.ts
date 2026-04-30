/**
 * Keybinding parser — converts string notation to structured types.
 *
 * Ported from MVP `keybindings/parser.ts`.
 * Handles keystroke strings ("ctrl+shift+k"), chord strings ("ctrl+x ctrl+k"),
 * and display formatting.
 */

import type { Chord, KeybindingBlock, ParsedBinding, ParsedKeystroke } from "./types"

/**
 * Parse a keystroke string like "ctrl+shift+k" into a ParsedKeystroke.
 * Supports various modifier aliases:
 * - ctrl, control
 * - alt, opt, option, meta
 * - cmd, command, super, win
 * - shift
 */
export function parseKeystroke(input: string): ParsedKeystroke {
  const parts = input.split("+")
  const keystroke: ParsedKeystroke = {
    key: "",
    ctrl: false,
    alt: false,
    shift: false,
    meta: false,
    super: false,
  }

  for (const part of parts) {
    const lower = part.toLowerCase()
    switch (lower) {
      case "ctrl":
      case "control":
        keystroke.ctrl = true
        break
      case "alt":
      case "opt":
      case "option":
        keystroke.alt = true
        break
      case "shift":
        keystroke.shift = true
        break
      case "meta":
        keystroke.meta = true
        break
      case "cmd":
      case "command":
      case "super":
      case "win":
        keystroke.super = true
        break
      case "esc":
        keystroke.key = "escape"
        break
      case "return":
        keystroke.key = "enter"
        break
      case "space":
        keystroke.key = " "
        break
      case "\u2191":
        keystroke.key = "up"
        break
      case "\u2193":
        keystroke.key = "down"
        break
      case "\u2190":
        keystroke.key = "left"
        break
      case "\u2192":
        keystroke.key = "right"
        break
      default:
        keystroke.key = lower
        break
    }
  }

  return keystroke
}

/**
 * Parse a chord string like "ctrl+k ctrl+s" into an array of ParsedKeystrokes.
 * A lone space character IS the space key binding, not a separator.
 */
export function parseChord(input: string): Chord {
  if (input === " ") return [parseKeystroke("space")]
  return input.trim().split(/\s+/).map(parseKeystroke)
}

/**
 * Convert a ParsedKeystroke to its canonical string representation.
 */
export function keystrokeToString(ks: ParsedKeystroke): string {
  const parts: string[] = []
  if (ks.ctrl) parts.push("ctrl")
  if (ks.alt) parts.push("alt")
  if (ks.shift) parts.push("shift")
  if (ks.meta) parts.push("meta")
  if (ks.super) parts.push("cmd")
  parts.push(keyToDisplayName(ks.key))
  return parts.join("+")
}

/**
 * Map internal key names to human-readable display names.
 */
function keyToDisplayName(key: string): string {
  switch (key) {
    case "escape":
      return "Esc"
    case " ":
      return "Space"
    case "tab":
      return "tab"
    case "enter":
      return "Enter"
    case "backspace":
      return "Backspace"
    case "delete":
      return "Delete"
    case "up":
      return "\u2191"
    case "down":
      return "\u2193"
    case "left":
      return "\u2190"
    case "right":
      return "\u2192"
    case "pageup":
      return "PageUp"
    case "pagedown":
      return "PageDown"
    case "home":
      return "Home"
    case "end":
      return "End"
    default:
      return key
  }
}

/**
 * Convert a Chord to its canonical string representation for display.
 */
export function chordToString(chord: Chord): string {
  return chord.map(keystrokeToString).join(" ")
}

type DisplayPlatform = "macos" | "windows" | "linux" | "wsl" | "unknown"

/**
 * Convert a ParsedKeystroke to a platform-appropriate display string.
 * Uses "opt" for alt on macOS, "alt" elsewhere.
 */
export function keystrokeToDisplayString(ks: ParsedKeystroke, platform: DisplayPlatform = "linux"): string {
  const parts: string[] = []
  if (ks.ctrl) parts.push("ctrl")
  // Alt and meta are equivalent in terminals
  if (ks.alt || ks.meta) {
    parts.push(platform === "macos" ? "opt" : "alt")
  }
  if (ks.shift) parts.push("shift")
  if (ks.super) {
    parts.push(platform === "macos" ? "cmd" : "super")
  }
  parts.push(keyToDisplayName(ks.key))
  return parts.join("+")
}

/**
 * Convert a Chord to a platform-appropriate display string.
 */
export function chordToDisplayString(chord: Chord, platform: DisplayPlatform = "linux"): string {
  return chord.map((ks) => keystrokeToDisplayString(ks, platform)).join(" ")
}

/**
 * Parse keybinding blocks (from config) into a flat list of ParsedBindings.
 */
export function parseBindings(blocks: KeybindingBlock[]): ParsedBinding[] {
  const bindings: ParsedBinding[] = []
  for (const block of blocks) {
    for (const [key, action] of Object.entries(block.bindings)) {
      bindings.push({
        chord: parseChord(key),
        action,
        context: block.context,
      })
    }
  }
  return bindings
}
