/**
 * Setup utilities for integrating KeybindingProvider into the app.
 *
 * Ported from MVP `keybindings/KeybindingProviderSetup.tsx`.
 * Combines default bindings, manages the chord timeout, and provides the
 * critical ChordInterceptor which intercepts keys before they reach other hooks.
 */

import type { InputEvent, Key } from "@liteai/ink"
import { useInput } from "@liteai/ink"
import type React from "react"
import { useCallback, useEffect, useRef, useState } from "react"
import { useTuiConfig } from "../context/tui-config"
import { DEFAULT_BINDINGS } from "./default-bindings"
import { type HandlerRegistration, KeybindingProvider } from "./keybinding-context"
import { parseBindings } from "./parser"
import { resolveKeyWithChordState } from "./resolver"
import type { KeybindingContextName, ParsedBinding, ParsedKeystroke } from "./types"

const CHORD_TIMEOUT_MS = 1000

export type KeybindingSetupProps = {
  children: React.ReactNode
}

/**
 * Keybinding provider with default bindings and chord timeout support.
 */
export function KeybindingSetup({ children }: KeybindingSetupProps): React.ReactNode {
  const config = useTuiConfig()

  const [bindings, setBindings] = useState<ParsedBinding[]>(() => parseBindings(DEFAULT_BINDINGS))

  useEffect(() => {
    const defaults = parseBindings(DEFAULT_BINDINGS)
    if (!config.keybinds || config.keybinds.length === 0) {
      setBindings(defaults)
      return
    }

    // Merge overrides
    const overrides = parseBindings(config.keybinds)

    // Actually, overrides override chords. If the user overrides a context+action, we should probably remove the old one.
    // But the spec says: "Merges user overrides from TUI config".
    // Let's just append the overrides at the end. The resolver should probably check bindings in reverse order,
    // or we remove the default binding if the action matches.
    // For now, let's just append them. Wait, if the override unbinds a key (action: null), we need to append it.
    // But actually, it's better to just concatenate them. The resolver uses the first match.
    // Wait, resolver in `resolver.ts` checks sequentially. So overrides should be PREPENDED to take precedence.

    setBindings([...overrides, ...defaults])
  }, [config.keybinds])

  // Chord state management
  const pendingChordRef = useRef<ParsedKeystroke[] | null>(null)
  const [pendingChord, setPendingChordState] = useState<ParsedKeystroke[] | null>(null)
  const chordTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Handler registry
  const handlerRegistryRef = useRef(new Map<string, Set<HandlerRegistration>>())

  // Active contexts
  const activeContextsRef = useRef<Set<KeybindingContextName>>(new Set())

  const registerActiveContext = useCallback((context: KeybindingContextName) => {
    activeContextsRef.current.add(context)
  }, [])

  const unregisterActiveContext = useCallback((context: KeybindingContextName) => {
    activeContextsRef.current.delete(context)
  }, [])

  const clearChordTimeout = useCallback(() => {
    if (chordTimeoutRef.current) {
      clearTimeout(chordTimeoutRef.current)
      chordTimeoutRef.current = null
    }
  }, [])

  const setPendingChord = useCallback(
    (pending: ParsedKeystroke[] | null) => {
      clearChordTimeout()
      if (pending !== null) {
        chordTimeoutRef.current = setTimeout(() => {
          pendingChordRef.current = null
          setPendingChordState(null)
        }, CHORD_TIMEOUT_MS)
      }

      pendingChordRef.current = pending
      setPendingChordState(pending)
    },
    [clearChordTimeout],
  )

  useEffect(() => {
    return () => {
      clearChordTimeout()
    }
  }, [clearChordTimeout])

  return (
    <KeybindingProvider
      bindings={bindings}
      pendingChordRef={pendingChordRef}
      pendingChord={pendingChord}
      setPendingChord={setPendingChord}
      activeContexts={activeContextsRef.current}
      registerActiveContext={registerActiveContext}
      unregisterActiveContext={unregisterActiveContext}
      handlerRegistryRef={handlerRegistryRef}
    >
      <ChordInterceptor
        bindings={bindings}
        pendingChordRef={pendingChordRef}
        setPendingChord={setPendingChord}
        activeContexts={activeContextsRef.current}
        handlerRegistryRef={handlerRegistryRef}
      />
      {children}
    </KeybindingProvider>
  )
}

/**
 * Global chord interceptor that registers useInput FIRST.
 * It intercepts keystrokes that are part of chords or keybindings,
 * and calls stopImmediatePropagation() to prevent child components from seeing them.
 */
function ChordInterceptor({
  bindings,
  pendingChordRef,
  setPendingChord,
  activeContexts,
  handlerRegistryRef,
}: {
  bindings: ParsedBinding[]
  pendingChordRef: React.RefObject<ParsedKeystroke[] | null>
  setPendingChord: (pending: ParsedKeystroke[] | null) => void
  activeContexts: Set<KeybindingContextName>
  handlerRegistryRef: React.RefObject<Map<string, Set<HandlerRegistration>>>
}) {
  useInput((input: string, key: Key, event: InputEvent) => {
    // Skip wheel events when not in a chord
    if ((key.wheelUp || key.wheelDown) && pendingChordRef.current === null) {
      return
    }

    const registry = handlerRegistryRef.current
    const handlerContexts = new Set<KeybindingContextName>()

    if (registry) {
      for (const handlers of registry.values()) {
        for (const registration of handlers) {
          handlerContexts.add(registration.context)
        }
      }
    }

    const contexts = [...handlerContexts, ...activeContexts, "Global"] as KeybindingContextName[]
    const wasInChord = pendingChordRef.current !== null

    const result = resolveKeyWithChordState(input, key, contexts, bindings, pendingChordRef.current)

    switch (result.type) {
      case "chord_started": {
        setPendingChord(result.pending)
        event.stopImmediatePropagation()
        break
      }
      case "match": {
        setPendingChord(null)
        // If we were already in a chord, or we're resolving a normal keybinding
        // Let's check if there's a handler to invoke
        if (wasInChord) {
          const contextsSet = new Set(contexts)
          if (registry) {
            const handlers = registry.get(result.action)
            if (handlers && handlers.size > 0) {
              for (const registration of handlers) {
                if (contextsSet.has(registration.context)) {
                  registration.handler()
                  event.stopImmediatePropagation()
                  break
                }
              }
            }
          }
        }
        break
      }
      case "chord_cancelled": {
        setPendingChord(null)
        event.stopImmediatePropagation()
        break
      }
      case "unbound": {
        setPendingChord(null)
        event.stopImmediatePropagation()
        break
      }
      case "none":
        break
    }
  })

  return null
}
