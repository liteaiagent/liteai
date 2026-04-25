/**
 * Creates a function that calls one function on the first call and another
 * function on the second call within a certain timeout.
 */

import { useCallback, useEffect, useRef } from "react"

export const DOUBLE_PRESS_TIMEOUT_MS = 800

export function useDoublePress(
  setPending: (pending: boolean) => void,
  onDoublePress: () => void,
  onFirstPress?: () => void,
): () => void {
  const lastPressRef = useRef<number>(0)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const clearTimeoutSafe = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = undefined
    }
  }, [])

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      clearTimeoutSafe()
    }
  }, [clearTimeoutSafe])

  return useCallback(() => {
    const now = Date.now()
    const timeSinceLastPress = now - lastPressRef.current
    const isDoublePress = timeSinceLastPress <= DOUBLE_PRESS_TIMEOUT_MS && timeoutRef.current !== undefined

    if (isDoublePress) {
      // Double press detected
      clearTimeoutSafe()
      setPending(false)
      onDoublePress()
    } else {
      // First press
      onFirstPress?.()
      setPending(true)

      // Clear any existing timeout and set new one
      clearTimeoutSafe()
      timeoutRef.current = setTimeout(
        (cb: (pending: boolean) => void, ref: typeof timeoutRef) => {
          cb(false)
          ref.current = undefined
        },
        DOUBLE_PRESS_TIMEOUT_MS,
        setPending,
        timeoutRef,
      )
    }

    lastPressRef.current = now
  }, [setPending, onDoublePress, onFirstPress, clearTimeoutSafe])
}
