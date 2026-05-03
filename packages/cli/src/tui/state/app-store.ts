/**
 * Minimal external store — inspired by Claude Code's store.ts (35 lines).
 *
 * No zustand, no immer. Direct `Object.is` short-circuit prevents
 * unnecessary re-renders. Listeners are notified synchronously after
 * each state transition.
 */

type Listener = () => void

export type OnChange<T> = (args: { newState: T; oldState: T }) => void

export interface AppStore<T> {
  getState: () => T
  setState: (updater: (prev: T) => T) => void
  subscribe: (listener: Listener) => () => void
}

export function createAppStore<T>(initialState: T, onChange?: OnChange<T>): AppStore<T> {
  let state = initialState
  const listeners = new Set<Listener>()

  return {
    getState: () => state,

    setState: (updater: (prev: T) => T) => {
      const prev = state
      const next = updater(prev)
      if (Object.is(next, prev)) return
      state = next
      onChange?.({ newState: next, oldState: prev })
      for (const listener of listeners) listener()
    },

    subscribe: (listener: Listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
