import type React from "react"
import { createContext, useContext, useRef } from "react"
import type { PromptInfo } from "../types"

export type PromptRef = {
  focused: boolean
  current: PromptInfo
  set(prompt: PromptInfo): void
  reset(): void
  blur(): void
  focus(): void
  submit(): void
  /** Populate the input with text (used by message edit action) */
  prefill(text: string): void
}

export type PromptRefContextValue = {
  readonly current: PromptRef | undefined
  set: (ref: PromptRef | undefined) => void
}

const PromptRefContext = createContext<PromptRefContextValue | undefined>(undefined)

export function usePromptRef(): PromptRefContextValue {
  const context = useContext(PromptRefContext)
  if (context === undefined) {
    throw new Error("PromptRef context must be used within a context provider")
  }
  return context
}

export function PromptRefProvider({ children }: { children?: React.ReactNode }) {
  // Use useRef instead of useState: PromptRef is an imperative handle
  // (a bag of callbacks), not declarative state. Storing it in useState
  // caused an infinite render loop:
  //   PromptInput useEffect → set(newObj) → setCurrent → provider re-renders
  //   → new context value → consumers re-render → effect fires again → ∞
  // useRef holds the value without triggering re-renders.
  const ref = useRef<PromptRef | undefined>(undefined)

  // Stable context value — created once, never changes identity.
  // Consumers read `current` imperatively via the getter.
  const valueRef = useRef<PromptRefContextValue>({
    get current() {
      return ref.current
    },
    set(promptRef: PromptRef | undefined) {
      ref.current = promptRef
    },
  })

  return <PromptRefContext.Provider value={valueRef.current}>{children}</PromptRefContext.Provider>
}
