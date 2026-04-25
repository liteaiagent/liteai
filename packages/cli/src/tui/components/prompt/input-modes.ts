/**
 * Prompt input mode detection and manipulation utilities.
 * Ported from MVP `PromptInput/inputModes.ts`.
 *
 * Modes:
 * - `prompt` (default) — normal chat prompt
 * - `bash` — shell command, prefixed with `!`
 */

import type { PromptInputMode } from "../../types/text-input"

/**
 * The mode type used by history navigation.
 * Identical to PromptInputMode but exported separately for semantic clarity
 * since arrow-key history partitions entries by mode.
 */
export type HistoryMode = PromptInputMode

/**
 * Prepend the mode-specific prefix character to the raw input value.
 * Used when restoring a history entry that was saved with a mode.
 */
export function prependModeCharacterToInput(input: string, mode: PromptInputMode): string {
  switch (mode) {
    case "bash":
      return `!${input}`
    default:
      return input
  }
}

/**
 * Infer the input mode from the current input string.
 * A leading `!` indicates bash mode; everything else is prompt mode.
 */
export function getModeFromInput(input: string): HistoryMode {
  if (input.startsWith("!")) {
    return "bash"
  }
  return "prompt"
}

/**
 * Strip the mode-prefix character from the raw input value,
 * returning the user's actual text content.
 */
export function getValueFromInput(input: string): string {
  const mode = getModeFromInput(input)
  if (mode === "prompt") {
    return input
  }
  return input.slice(1)
}

/**
 * Check whether a single character is a mode-switch character.
 * Currently only `!` triggers bash mode.
 */
export function isInputModeCharacter(input: string): boolean {
  return input === "!"
}
