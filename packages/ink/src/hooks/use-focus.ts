import { useContext, useMemo } from 'react'
import FocusContext from '../components/FocusContext.js'
import type { DOMElement } from '../dom.js'

export type UseFocus = {
  /**
   * Focus a specific DOM node.
   */
  readonly focus: (node: DOMElement) => void

  /**
   * Blur the currently focused node.
   */
  readonly blur: () => void

  /**
   * The currently focused DOM element.
   */
  readonly activeElement: DOMElement | null

  /**
   * Move focus to the next tabbable element.
   */
  readonly focusNext: () => void

  /**
   * Move focus to the previous tabbable element.
   */
  readonly focusPrevious: () => void
}

/**
 * Hook to access focus management in the Ink TUI.
 */
export default function useFocus(): UseFocus {
  const { focusManager, activeElement, focusNext, focusPrevious } = useContext(FocusContext)

  return useMemo(
    () => ({
      focus: (node: DOMElement) => focusManager?.focus(node),
      blur: () => focusManager?.blur(),
      activeElement,
      focusNext,
      focusPrevious,
    }),
    [focusManager, activeElement, focusNext, focusPrevious],
  )
}
