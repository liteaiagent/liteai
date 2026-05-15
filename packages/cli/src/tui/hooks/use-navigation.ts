/**
 * useNavigation — context-aware navigation hook.
 *
 * Uses the ModalPaneProvider to open dialogs inside the session layout.
 */

import type { ReactNode } from "react"
import { useMemo } from "react"
import { useModalPane } from "../context/modal-pane"

export type NavigationAPI = {
  /** Open a sub-view. */
  open: (content: ReactNode) => void
  /** Close the current view and return to parent. */
  close: () => void
  /** Replace the current view with new content. */
  replace: (content: ReactNode) => void
}

export function useNavigation(): NavigationAPI {
  const modalPane = useModalPane()

  return useMemo(() => {
    return {
      open: (content: ReactNode) => modalPane.openModal(content),
      close: () => modalPane.closeModal(),
      replace: (content: ReactNode) => {
        // Single-slot: close then open achieves replace semantics.
        // React batches these into one render cycle.
        modalPane.closeModal()
        modalPane.openModal(content)
      },
    }
  }, [modalPane])
}
