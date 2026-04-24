import { createContext } from 'react'
import type { DOMElement } from '../dom.js'
import type { FocusManager } from '../focus.js'

export type FocusContextProps = {
  readonly focusManager: FocusManager | null
  readonly activeElement: DOMElement | null
  readonly focusNext: () => void
  readonly focusPrevious: () => void
}

const FocusContext = createContext<FocusContextProps>({
  focusManager: null,
  activeElement: null,
  focusNext: () => {},
  focusPrevious: () => {},
})

FocusContext.displayName = 'FocusContext'

export default FocusContext
