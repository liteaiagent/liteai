/** @jsxImportSource react */
import { useMemo, useState } from "react"
import { createSimpleContext } from "./helper"

export type PromptInfo = {
  input: string
  parts: unknown[]
}

export type PromptRef = {
  focused: boolean
  current: PromptInfo
  set(prompt: PromptInfo): void
  reset(): void
  blur(): void
  focus(): void
  submit(): void
}

export const { use: usePromptRef, provider: PromptRefProvider } = createSimpleContext({
  name: "PromptRef",
  init: () => {
    const [current, setCurrent] = useState<PromptRef | undefined>()

    return useMemo(
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
  },
})
