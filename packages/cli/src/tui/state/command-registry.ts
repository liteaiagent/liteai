/**
 * Command Registry — static metadata for Command Palette entries.
 *
 * Maps TUI-only commands to their keybinding hints. Server-side commands
 * (injected via SDK) don't have keybindings and show as `/name` in the palette.
 *
 * The Command Palette consumes this registry to display keybinding hints
 * alongside command labels, without duplicating the execution logic
 * (which lives in PromptInput's `tuiInterceptors`).
 *
 * @module state/command-registry
 */

/**
 * Keybinding hints for TUI commands.
 * Keys match `TUI_COMMANDS[].name` from prompt-input.tsx.
 *
 * Only includes commands that have keyboard shortcuts.
 * Commands without shortcuts (e.g., /doctor, /export) are omitted.
 */
export const COMMAND_KEYBINDINGS: Record<string, string> = {
  models: "ctrl+x m",
  provider: "ctrl+x p",
  sessions: "ctrl+x l",
  clear: "ctrl+x n",
  help: "ctrl+x h",
  config: "ctrl+x c",
  find: "ctrl+x f",
  memory: "ctrl+x w",
  theme: "ctrl+x t",
  diff: "ctrl+x d",
  compact: "ctrl+x k",
}

/**
 * Category assignments for Command Palette grouping.
 * Commands without an explicit category default to "Commands".
 */
export const COMMAND_CATEGORIES: Record<string, string> = {
  // Actions
  models: "Actions",
  provider: "Actions",
  plan: "Actions",
  compact: "Actions",
  agents: "Actions",
  // Navigation
  sessions: "Navigation",
  clear: "Navigation",
  find: "Navigation",
  memory: "Navigation",
  rewind: "Navigation",
  // Display
  config: "Display",
  theme: "Display",
  diff: "Display",
  context: "Display",
  stats: "Display",
  help: "Display",
  status: "Display",
}

export function getCommandCategory(name: string): string {
  return COMMAND_CATEGORIES[name] ?? "Commands"
}

export function getCommandKeybinding(name: string): string | undefined {
  return COMMAND_KEYBINDINGS[name]
}
