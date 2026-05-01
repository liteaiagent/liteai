/**
 * Keybinding system types.
 *
 * Ported from the MVP keybinding system. Provides the type foundation for
 * context-based keybinding resolution with chord support.
 */

/**
 * Valid context names where keybindings can be applied.
 * More specific contexts (e.g., Chat, Select) take precedence over Global
 * when both are active.
 */
export const KEYBINDING_CONTEXTS = [
  "Global",
  "Chat",
  "Autocomplete",
  "Confirmation",
  "Help",
  "Scroll",
  "Select",
  "Tabs",
  "Settings",
  "Task",
  "ThemePicker",
  "HistorySearch",
  "Plugin",
  "DiffDialog",
  "ModelPicker",
  "MessageSelector",
  "MessageActions",
  "Attachments",
  "Footer",
] as const

export type KeybindingContextName = (typeof KEYBINDING_CONTEXTS)[number]

/**
 * A parsed keystroke with modifier flags.
 * Represents a single key press (one part of a chord).
 */
export type ParsedKeystroke = {
  /** The base key name (lowercase). e.g., "k", "escape", "up", " " for space */
  key: string
  ctrl: boolean
  /** Alt/Option modifier. In terminals, alt and meta are indistinguishable. */
  alt: boolean
  shift: boolean
  /** Meta modifier — alias for alt in terminals. Both map to Ink's key.meta. */
  meta: boolean
  /** Super (Cmd on macOS / Win key). Only arrives via kitty keyboard protocol. */
  super: boolean
}

/**
 * A chord is a sequence of keystrokes. Single-key bindings have length 1.
 * e.g., `ctrl+x ctrl+k` is `[{ctrl:true, key:'x'}, {ctrl:true, key:'k'}]`
 */
export type Chord = ParsedKeystroke[]

/**
 * A fully parsed binding: chord + action + context.
 * Action is `null` when explicitly unbound by the user.
 */
export type ParsedBinding = {
  chord: Chord
  action: string | null
  context: KeybindingContextName
}

/**
 * A keybinding block from configuration.
 * Maps keystroke patterns to action identifiers within a context.
 */
export type KeybindingBlock = {
  context: KeybindingContextName
  bindings: Record<string, string | null>
}
