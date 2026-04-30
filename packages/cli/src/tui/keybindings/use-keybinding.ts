/**
 * React hooks for registering keybinding handlers.
 *
 * Ported from MVP `keybindings/useKeybinding.ts`.
 */

import type { InputEvent, Key } from "@liteai/ink"
import { useInput } from "@liteai/ink"
import { useCallback, useEffect } from "react"
import { useOptionalKeybindingContext } from "./keybinding-context"
import type { KeybindingContextName } from "./types"

type Options = {
  /** Which context this binding belongs to (default: 'Global') */
  context?: KeybindingContextName
  /** Only handle when active (like useInput's isActive) */
  isActive?: boolean
}

/**
 * Ink-native hook for handling a keybinding.
 *
 * The handler stays in the component (React way).
 * Uses stopImmediatePropagation() to prevent other handlers from firing
 * once this binding is handled.
 */
export function useKeybinding(
  action: string,
  handler: () => void | false | Promise<void>,
  options: Options = {},
): void {
  const { context = "Global", isActive = true } = options
  const keybindingContext = useOptionalKeybindingContext()

  // Register handler with the context for ChordInterceptor to invoke
  useEffect(() => {
    if (!keybindingContext || !isActive) return
    return keybindingContext.registerHandler({ action, context, handler })
  }, [action, context, handler, keybindingContext, isActive])

  const handleInput = useCallback(
    (input: string, key: Key, event: InputEvent) => {
      if (!keybindingContext) return

      const contextsToCheck: KeybindingContextName[] = [...keybindingContext.activeContexts, context, "Global"]
      const uniqueContexts = [...new Set(contextsToCheck)]

      const result = keybindingContext.resolve(input, key, uniqueContexts)

      switch (result.type) {
        case "match":
          keybindingContext.setPendingChord(null)
          if (result.action === action) {
            if (handler() !== false) {
              event.stopImmediatePropagation()
            }
          }
          break
        case "chord_started":
          keybindingContext.setPendingChord(result.pending)
          event.stopImmediatePropagation()
          break
        case "chord_cancelled":
          keybindingContext.setPendingChord(null)
          break
        case "unbound":
          keybindingContext.setPendingChord(null)
          event.stopImmediatePropagation()
          break
        case "none":
          break
      }
    },
    [action, context, handler, keybindingContext],
  )

  useInput(handleInput, { isActive })
}

/**
 * Handle multiple keybindings in one hook.
 */
export function useKeybindings(
  handlers: Record<string, () => void | false | Promise<void>>,
  options: Options = {},
): void {
  const { context = "Global", isActive = true } = options
  const keybindingContext = useOptionalKeybindingContext()

  useEffect(() => {
    if (!keybindingContext || !isActive) return

    const unregisterFns: Array<() => void> = []
    for (const [action, handler] of Object.entries(handlers)) {
      unregisterFns.push(keybindingContext.registerHandler({ action, context, handler }))
    }

    return () => {
      for (const unregister of unregisterFns) {
        unregister()
      }
    }
  }, [context, handlers, keybindingContext, isActive])

  const handleInput = useCallback(
    (input: string, key: Key, event: InputEvent) => {
      if (!keybindingContext) return

      const contextsToCheck: KeybindingContextName[] = [...keybindingContext.activeContexts, context, "Global"]
      const uniqueContexts = [...new Set(contextsToCheck)]

      const result = keybindingContext.resolve(input, key, uniqueContexts)

      switch (result.type) {
        case "match":
          keybindingContext.setPendingChord(null)
          if (result.action in handlers) {
            const handler = handlers[result.action]
            if (handler && handler() !== false) {
              event.stopImmediatePropagation()
            }
          }
          break
        case "chord_started":
          keybindingContext.setPendingChord(result.pending)
          event.stopImmediatePropagation()
          break
        case "chord_cancelled":
          keybindingContext.setPendingChord(null)
          break
        case "unbound":
          keybindingContext.setPendingChord(null)
          event.stopImmediatePropagation()
          break
        case "none":
          break
      }
    },
    [context, handlers, keybindingContext],
  )

  useInput(handleInput, { isActive })
}
