/**
 * Double-press Ctrl+C / Ctrl+D exit handler.
 *
 * Mirrors Claude Code's `useExitOnCtrlCD`:
 * - First press: fires `onInterrupt` (cancel in-flight generation). If not
 *   handled, shows "Press Ctrl-C again to exit" for 800ms.
 * - Second press within 800ms: exits the application.
 *
 * Ctrl+D uses the same double-press mechanism but without an interrupt callback.
 *
 * These keys use time-based double-press rather than the chord system because
 * the first Ctrl+C should also trigger interrupt (handled elsewhere). The chord
 * system would prevent the first press from firing any action.
 */

import { useCallback, useMemo, useState } from "react"
import { useExit } from "../context/exit"
import { useKeybindings } from "../keybindings/use-keybinding"
import { useDoublePress } from "./use-double-press"

export type ExitState = {
  pending: boolean
  keyName: "Ctrl-C" | "Ctrl-D" | null
}

/**
 * @param onInterrupt - Optional callback for features to handle the first
 *   Ctrl+C press (e.g., abort in-flight generation). Return `true` if handled;
 *   returning `false` falls through to the double-press exit flow.
 * @param isActive - Whether the keybinding is active (default `true`). Set
 *   `false` while an embedded TextInput is focused so its own Ctrl+C/D handlers
 *   don't double-fire.
 */
export function useExitOnCtrlCD(onInterrupt?: () => boolean, isActive = true): ExitState {
  const exit = useExit()
  const [exitState, setExitState] = useState<ExitState>({
    pending: false,
    keyName: null,
  })

  // Double-press handler for Ctrl+C
  const handleCtrlCDoublePress = useDoublePress(
    (pending) => setExitState({ pending, keyName: "Ctrl-C" }),
    () => void exit(),
  )

  // Double-press handler for Ctrl+D
  const handleCtrlDDoublePress = useDoublePress(
    (pending) => setExitState({ pending, keyName: "Ctrl-D" }),
    () => void exit(),
  )

  // Handler for app:interrupt (Ctrl+C by default)
  // Let features handle interrupt first via callback
  const handleInterrupt = useCallback(() => {
    if (onInterrupt?.()) return // Feature handled it
    handleCtrlCDoublePress()
  }, [handleCtrlCDoublePress, onInterrupt])

  // Handler for app:exit (Ctrl+D by default)
  const handleExit = useCallback(() => {
    handleCtrlDDoublePress()
  }, [handleCtrlDDoublePress])

  const handlers = useMemo(
    () => ({
      "app:interrupt": handleInterrupt,
      "app:exit": handleExit,
    }),
    [handleInterrupt, handleExit],
  )

  useKeybindings(handlers, { context: "Global", isActive })

  return exitState
}
