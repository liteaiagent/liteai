/**
 * IME Composition Handler — manages Input Method Editor state
 * for CJK and other IME-based text entry in contenteditable editors.
 *
 * Extracted from web's PromptInput (Phase 2b of the refactor plan).
 * Zero framework dependencies — returns SolidJS-compatible primitives.
 */

import { createSignal } from "solid-js"

export interface ImeHandler {
  /** Whether an IME composition session is active. */
  composing: () => boolean
  /** Check if a keyboard event is part of an IME composition (use before handling Enter, etc.). */
  isImeComposing: (event: KeyboardEvent) => boolean
  /** Attach to the `compositionstart` event. */
  handleCompositionStart: () => void
  /**
   * Attach to the `compositionend` event.
   * Calls `onCompositionEnd` after a frame if the composition truly ended,
   * allowing the caller to reconcile the editor state.
   */
  handleCompositionEnd: () => void
}

/**
 * Create an IME handler for a contenteditable editor.
 *
 * @param onCompositionEnd  Called _after_ the composition ends (in a
 *   `requestAnimationFrame`), and only if the compositor didn't restart.
 *   Typically used to run the reconciler.
 */
export function createImeHandler(onCompositionEnd?: () => void): ImeHandler {
  const [composing, setComposing] = createSignal(false)

  const isImeComposing = (event: KeyboardEvent): boolean => event.isComposing || composing() || event.keyCode === 229

  const handleCompositionStart = () => {
    setComposing(true)
  }

  const handleCompositionEnd = () => {
    setComposing(false)
    requestAnimationFrame(() => {
      if (composing()) return
      onCompositionEnd?.()
    })
  }

  return {
    composing,
    isImeComposing,
    handleCompositionStart,
    handleCompositionEnd,
  }
}
