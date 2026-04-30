/**
 * Hook for displaying configured shortcut text.
 *
 * Ported from MVP `keybindings/useShortcutDisplay.ts`.
 */

import { useKeybindingContext } from "./keybinding-context"
import type { KeybindingContextName } from "./types"

/**
 * Get the display text for a configured shortcut (e.g., "ctrl+o" for transcript).
 * Automatically updates if the user reconfigures the shortcut.
 *
 * @param action - The action name (e.g., 'app:toggleTranscript')
 * @param context - The context to look in (e.g., 'Global')
 * @param fallback - Text to show if unbound or not found
 */
export function useShortcutDisplay(action: string, context: KeybindingContextName, fallback: string): string {
  const { getDisplayText } = useKeybindingContext()
  const display = getDisplayText(action, context)
  return display ?? fallback
}
