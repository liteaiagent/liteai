import { useEffect, useRef, useState } from 'react'

/**
 * Hook that debounces a value.
 */
export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value)

  useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delay)
    return () => clearTimeout(handler)
  }, [value, delay])

  return debouncedValue
}

/**
 * Hook that runs an effect exactly once when its dependencies change for the first time.
 */
export function useOneShotEffect(effect: () => void, deps: unknown[]) {
  const hasRun = useRef(false)
  useEffect(() => {
    if (hasRun.current) return
    hasRun.current = true
    effect()
    // biome-ignore lint/correctness/useExhaustiveDependencies: deps is passed from outside
  }, deps)
}

/**
 * Hook that runs an effect only on mount.
 */
export function useOnMount(effect: () => void) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: run once on mount
  useEffect(effect, [])
}
