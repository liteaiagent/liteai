/**
 * useNavigation — context-aware navigation hook for sub-dialog navigation.
 *
 * Uses ModalPaneProvider's stack semantics:
 * - `open()` pushes a sub-view (e.g., Config → Models)
 * - `close()` pops back to parent (Escape in sub-dialog)
 * - `replace()` atomically swaps the top of the stack (tab switching)
 *
 * Top-level dialog opens from slash commands use `modalPane.openModal()` directly
 * (which clears the stack). This hook is for in-dialog navigation only.
 */

import type { ReactNode } from "react"
import { useMemo } from "react"
import { useModalPane } from "../context/modal-pane"

export type NavigationAPI = {
  /** Push a sub-view onto the modal stack. */
  open: (content: ReactNode) => void
  /** Pop the current view, returning to parent. */
  close: () => void
  /** Atomically replace the current view with new content. */
  replace: (content: ReactNode) => void
}

export function useNavigation(): NavigationAPI {
  const modalPane = useModalPane()

  return useMemo(() => {
    return {
      open: (content: ReactNode) => modalPane.pushModal(content),
      close: () => modalPane.popModal(),
      // Single replaceTop call = single render cycle = no focus flicker.
      replace: (content: ReactNode) => modalPane.replaceTop(content),
    }
  }, [modalPane])
}
