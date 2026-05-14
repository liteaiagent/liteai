import type { ScrollBoxHandle } from "@liteai/ink"
import { createContext, type ReactNode, useCallback, useContext, useRef, useState } from "react"

/**
 * ModalPaneContext — the replacement for DialogProvider's stack-based overlay system.
 *
 * Provides a single-slot modal API: one modal at a time, no stacking.
 * Content passed to `openModal` renders in SessionLayout's bottom-anchored
 * `modal` slot (absolute-positioned pane with ▔ divider + ModalContext).
 *
 * Pattern mirrors Claude Code's centeredModal approach: the REPL owns a single
 * ReactNode slot, and commands receive an `onClose` callback rather than
 * manipulating a dialog stack.
 *
 * @example
 * const { openModal, closeModal } = useModalPane()
 * openModal(<DialogModel onClose={closeModal} />)
 */

export type ModalPaneAPI = {
  /** Render content in the bottom-anchored modal pane. Replaces any currently open modal. */
  openModal: (content: ReactNode) => void
  /** Close the currently open modal pane. Safe to call when no modal is open. */
  closeModal: () => void
  /** Whether a modal pane is currently showing. */
  isOpen: boolean
  /** The current modal content (used by SessionRoute to wire into SessionLayout.modal). */
  content: ReactNode | null
  /** Scroll ref for the modal pane's internal ScrollBox (used by tabs, long lists). */
  scrollRef: React.RefObject<ScrollBoxHandle | null>
}

const ModalPaneCtx = createContext<ModalPaneAPI | null>(null)

export function ModalPaneProvider({ children }: { children: ReactNode }) {
  const [content, setContent] = useState<ReactNode | null>(null)
  const scrollRef = useRef<ScrollBoxHandle | null>(null)

  const openModal = useCallback((node: ReactNode) => {
    setContent(node)
  }, [])

  const closeModal = useCallback(() => {
    setContent(null)
  }, [])

  const api: ModalPaneAPI = {
    openModal,
    closeModal,
    isOpen: content != null,
    content,
    scrollRef,
  }

  return <ModalPaneCtx.Provider value={api}>{children}</ModalPaneCtx.Provider>
}

/**
 * Access the modal pane API. Must be called within a ModalPaneProvider.
 *
 * @throws Error if called outside ModalPaneProvider — fail-fast per mandate §5.
 */
export function useModalPane(): ModalPaneAPI {
  const ctx = useContext(ModalPaneCtx)
  if (!ctx) {
    throw new Error(
      "[useModalPane] Must be used within a <ModalPaneProvider>. This is a structural invariant violation.",
    )
  }
  return ctx
}

/**
 * Access the modal pane API if available. Returns null when outside ModalPaneProvider.
 *
 * Used by `useNavigation()` for context detection — not a silent fallback (mandate §5),
 * but an explicit Strategy pattern where both rendering contexts are intentional.
 */
export function useOptionalModalPane(): ModalPaneAPI | null {
  return useContext(ModalPaneCtx)
}
