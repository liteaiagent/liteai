/**
 * Keybinding Context Provider.
 *
 * Ported from MVP `keybindings/KeybindingContext.tsx`.
 * Manages the state of active contexts, chord tracking, and handler registration.
 */

import type { Key } from "@liteai/ink"
import React, { createContext, useContext, useLayoutEffect } from "react"
import { type ChordResolveResult, getBindingDisplayText, resolveKeyWithChordState } from "./resolver"
import type { KeybindingContextName, ParsedBinding, ParsedKeystroke } from "./types"

export type HandlerRegistration = {
  action: string
  context: KeybindingContextName
  handler: () => void
}

export type KeybindingContextValue = {
  /** Resolve a key input to an action name (with chord support) */
  resolve: (input: string, key: Key, activeContexts: KeybindingContextName[]) => ChordResolveResult

  /** Update the pending chord state */
  setPendingChord: (pending: ParsedKeystroke[] | null) => void

  /** Get display text for an action (e.g., "ctrl+t") */
  getDisplayText: (action: string, context: KeybindingContextName) => string | undefined

  /** All parsed bindings */
  bindings: ParsedBinding[]

  /** Current pending chord keystrokes (null if not in a chord) */
  pendingChord: ParsedKeystroke[] | null

  /** Currently active keybinding contexts (for priority resolution) */
  activeContexts: Set<KeybindingContextName>

  /** Register a context as active (call on mount) */
  registerActiveContext: (context: KeybindingContextName) => void

  /** Unregister a context (call on unmount) */
  unregisterActiveContext: (context: KeybindingContextName) => void

  /** Register a handler for an action (used by useKeybinding) */
  registerHandler: (registration: HandlerRegistration) => () => void

  /** Invoke all handlers for an action (used by ChordInterceptor) */
  invokeAction: (action: string) => boolean
}

const KeybindingContext = createContext<KeybindingContextValue | null>(null)

export type KeybindingProviderProps = {
  bindings: ParsedBinding[]
  /** Ref for immediate access to pending chord (avoids React state delay) */
  pendingChordRef: React.RefObject<ParsedKeystroke[] | null>
  /** State value for re-renders (UI updates) */
  pendingChord: ParsedKeystroke[] | null
  setPendingChord: (pending: ParsedKeystroke[] | null) => void
  activeContexts: Set<KeybindingContextName>
  registerActiveContext: (context: KeybindingContextName) => void
  unregisterActiveContext: (context: KeybindingContextName) => void
  /** Ref to handler registry (used by ChordInterceptor) */
  handlerRegistryRef: React.RefObject<Map<string, Set<HandlerRegistration>>>
  children: React.ReactNode
}

export function KeybindingProvider({
  bindings,
  pendingChordRef,
  pendingChord,
  setPendingChord,
  activeContexts,
  registerActiveContext,
  unregisterActiveContext,
  handlerRegistryRef,
  children,
}: KeybindingProviderProps): React.ReactNode {
  const getDisplay = React.useCallback(
    (action: string, context: KeybindingContextName) => getBindingDisplayText(action, context, bindings),
    [bindings],
  )

  const registerHandler = React.useCallback(
    (registration: HandlerRegistration) => {
      const registry = handlerRegistryRef.current
      if (!registry) return () => {}

      if (!registry.has(registration.action)) {
        registry.set(registration.action, new Set())
      }

      registry.get(registration.action)?.add(registration)

      return () => {
        const handlers = registry.get(registration.action)
        if (handlers) {
          handlers.delete(registration)
          if (handlers.size === 0) {
            registry.delete(registration.action)
          }
        }
      }
    },
    [handlerRegistryRef],
  )

  const invokeAction = React.useCallback(
    (action: string) => {
      const registry = handlerRegistryRef.current
      if (!registry) return false

      const handlers = registry.get(action)
      if (!handlers || handlers.size === 0) return false

      for (const registration of handlers) {
        if (activeContexts.has(registration.context)) {
          registration.handler()
          return true
        }
      }
      return false
    },
    [activeContexts, handlerRegistryRef],
  )

  const resolve = React.useCallback(
    (input: string, key: Key, contexts: KeybindingContextName[]) => {
      return resolveKeyWithChordState(input, key, contexts, bindings, pendingChordRef.current)
    },
    [bindings, pendingChordRef],
  )

  const value = React.useMemo(
    () => ({
      resolve,
      setPendingChord,
      getDisplayText: getDisplay,
      bindings,
      pendingChord,
      activeContexts,
      registerActiveContext,
      unregisterActiveContext,
      registerHandler,
      invokeAction,
    }),
    [
      resolve,
      setPendingChord,
      getDisplay,
      bindings,
      pendingChord,
      activeContexts,
      registerActiveContext,
      unregisterActiveContext,
      registerHandler,
      invokeAction,
    ],
  )

  return <KeybindingContext.Provider value={value}>{children}</KeybindingContext.Provider>
}

export function useKeybindingContext(): KeybindingContextValue {
  const ctx = useContext(KeybindingContext)
  if (!ctx) {
    throw new Error("useKeybindingContext must be used within KeybindingProvider")
  }
  return ctx
}

export function useOptionalKeybindingContext(): KeybindingContextValue | null {
  return useContext(KeybindingContext)
}

/**
 * Hook to register a keybinding context as active while the component is mounted.
 * When a context is registered, its keybindings take precedence over Global bindings.
 */
export function useRegisterKeybindingContext(context: KeybindingContextName, isActive = true) {
  const keybindingContext = useOptionalKeybindingContext()

  useLayoutEffect(() => {
    if (!keybindingContext || !isActive) return

    keybindingContext.registerActiveContext(context)
    return () => {
      keybindingContext.unregisterActiveContext(context)
    }
  }, [context, keybindingContext, isActive])
}
