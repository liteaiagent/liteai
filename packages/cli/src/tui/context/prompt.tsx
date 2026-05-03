import type React from "react"
import { createContext, useContext, useMemo, useState } from "react"
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
  const [current, setCurrent] = useState<PromptRef | undefined>()

  const value = useMemo(
    () => ({
      get current() {
        return current
      },
      set(ref: PromptRef | undefined) {
        setCurrent(ref)
      },
    }),
    [current],
  )

  return <PromptRefContext.Provider value={value}>{children}</PromptRefContext.Provider>
}
