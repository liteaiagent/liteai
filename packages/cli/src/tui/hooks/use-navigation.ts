/**
 * useNavigation — context-aware navigation hook (Strategy pattern).
 *
 * Detects whether the component is rendered within a ModalPaneProvider
 * (new system) or only within a DialogProvider (legacy system), and
 * dispatches navigation accordingly.
 *
 * This is NOT a silent fallback (mandate §5). Both rendering contexts
 * are intentional:
 *  - ModalPaneProvider: session-scoped modals (slash commands via PromptInput)
 *  - DialogProvider: app-level overlays (provider setup banner, auth flows)
 *
 * Components that may be rendered in either context (e.g., DialogModel
 * opened from both /models command and provider auth completion) use
 * this hook instead of coupling to a specific context.
 */

import type { ReactNode } from "react"
import { useMemo } from "react"
import { useDialog } from "../context/dialog"
import { useOptionalModalPane } from "../context/modal-pane"

export type NavigationAPI = {
  /** Open a sub-view. Uses modalPane if available, falls back to dialog stack. */
  open: (content: ReactNode) => void
  /** Close the current view and return to parent. */
  close: () => void
  /** Replace the current view with new content. */
  replace: (content: ReactNode) => void
}

export function useNavigation(): NavigationAPI {
  const modalPane = useOptionalModalPane()
  const dialog = useDialog()

  return useMemo(() => {
    if (modalPane) {
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
    }

    // Legacy context: component is rendered via dialog.push() (above ModalPaneProvider).
    // This path is used by auth sub-flows in the legacy dialog stack.
    return {
      open: (content: ReactNode) => dialog.push(() => content),
      close: () => dialog.clear(),
      replace: (content: ReactNode) => dialog.replace(() => content),
    }
  }, [modalPane, dialog])
}
