/**
 * Modal context utilities.
 *
 * Provides context for components that need to detect whether they are
 * rendered inside the bottom modal slot, and access the modal's scroll ref.
 *
 * Previously co-located in `ui/dialog.tsx` (legacy Dialog wrapper).
 */

import type { ScrollBoxHandle } from "@liteai/ink"
import { createContext, type RefObject, useContext } from "react"

type ModalCtx = {
  rows: number
  columns: number
  scrollRef: RefObject<ScrollBoxHandle> | null
}

export const ModalContext = createContext<ModalCtx | null>(null)

/** Returns true when the component is rendered inside the bottom modal slot. */
export function useIsInsideModal(): boolean {
  return useContext(ModalContext) !== null
}

/** Returns modal dimensions when inside a modal, falling back to terminal size. */
export function useModalOrTerminalSize(fallback: { rows: number; columns: number }): { rows: number; columns: number } {
  const ctx = useContext(ModalContext)
  return ctx ? { rows: ctx.rows, columns: ctx.columns } : fallback
}

/** Returns the ScrollBox ref for the modal slot, or null when not inside a modal. */
export function useModalScrollRef(): RefObject<ScrollBoxHandle> | null {
  return useContext(ModalContext)?.scrollRef ?? null
}
