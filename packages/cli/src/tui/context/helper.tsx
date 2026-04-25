import type React from "react"
import { createContext, useContext } from "react"

/**
 * Port of SolidJS createSimpleContext to React.
 *
 * Provides a 'ready' gate that prevents rendering children until the context
 * state is initialized (if the state object has a 'ready' property).
 */
export function createSimpleContext<T, Props extends Record<string, unknown>>(input: {
  name: string
  init: ((input: Props) => T) | (() => T)
}) {
  const ctx = createContext<T | undefined>(undefined)

  function Provider({ children, ...props }: { children: React.ReactNode } & Props) {
    // We intentionally don't memoize 'init' here to match the behavior of the Solid version
    // where the provider body is re-executed if the component re-renders.
    const { children: _children, ...rest } = props
    const state = input.init(rest as unknown as Props)

    // ready gate: ready === undefined || ready === true
    // @ts-expect-error - T might not have 'ready' property
    const isReady = state.ready === undefined || state.ready === true

    if (!isReady) {
      return null
    }

    return <ctx.Provider value={state}>{children}</ctx.Provider>
  }

  return {
    provider: Provider,
    use() {
      const value = useContext(ctx)
      if (value === undefined) {
        throw new Error(`${input.name} context must be used within a context provider`)
      }
      return value
    },
  }
}
