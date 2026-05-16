import type { ScrollBoxHandle } from "@liteai/ink"
import { createContext, type ReactNode, useCallback, useContext, useMemo, useRef, useState } from "react"

/**
 * ModalPaneContext — stack-based modal system for nested dialog navigation.
 *
 * Provides a stack-based modal API: dialogs can push sub-views (e.g., Config → Models)
 * and Escape pops back to the parent instead of closing everything.
 *
 * **Stack semantics:**
 * - `openModal(content)` — clears the stack and pushes one item (top-level dialog open)
 * - `pushModal(content)` — pushes onto existing stack (sub-navigation within a dialog)
 * - `popModal()` — pops top of stack; if stack empties, modal closes
 * - `closeModal()` — clears entire stack unconditionally (hard close / Ctrl+C)
 * - `content` — derived: `stack.at(-1) ?? null`
 * - `isOpen` — derived: `stack.length > 0`
 *
 * @example
 * // Top-level open (from slash command):
 * const { openModal, closeModal } = useModalPane()
 * openModal(<DialogModel onClose={closeModal} />)
 *
 * // Sub-navigation (from within a dialog, via useNavigation):
 * const navigation = useNavigation()
 * navigation.open(<DialogProvider onClose={navigation.close} />) // pushes
 * navigation.close() // pops back to parent
 */

export type ModalPaneAPI = {
  /** Clear the stack and render content in the modal pane. Use for top-level dialog opens. */
  openModal: (content: ReactNode) => void
  /** Push content onto the modal stack. Use for sub-navigation within dialogs. */
  pushModal: (content: ReactNode) => void
  /** Pop the top of the modal stack. If stack empties, modal closes. Use for Escape/back. */
  popModal: () => void
  /** Close the modal pane unconditionally, clearing the entire stack. */
  closeModal: () => void
  /** Whether a modal pane is currently showing (stack is non-empty). */
  isOpen: boolean
  /** The topmost modal content, or null if the stack is empty. */
  content: ReactNode | null
  /** Scroll ref for the modal pane's internal ScrollBox (used by tabs, long lists). */
  scrollRef: React.RefObject<ScrollBoxHandle | null>
}

const ModalPaneCtx = createContext<ModalPaneAPI | null>(null)

export function ModalPaneProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<ReactNode[]>([])
  const scrollRef = useRef<ScrollBoxHandle | null>(null)

  const openModal = useCallback((node: ReactNode) => {
    setStack([node])
  }, [])

  const pushModal = useCallback((node: ReactNode) => {
    setStack((prev) => [...prev, node])
  }, [])

  const popModal = useCallback(() => {
    setStack((prev) => (prev.length <= 1 ? [] : prev.slice(0, -1)))
  }, [])

  const closeModal = useCallback(() => {
    setStack([])
  }, [])

  const content = stack.length > 0 ? stack[stack.length - 1] : null
  const isOpen = stack.length > 0

  const api: ModalPaneAPI = useMemo(
    () => ({
      openModal,
      pushModal,
      popModal,
      closeModal,
      isOpen,
      content,
      scrollRef,
    }),
    [openModal, pushModal, popModal, closeModal, isOpen, content],
  )

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
