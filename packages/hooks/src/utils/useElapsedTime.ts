import { useCallback, useSyncExternalStore } from 'react'
import { formatDuration } from './format.js'

/**
 * Hook that returns formatted elapsed time since startTime.
 * Uses useSyncExternalStore with interval-based updates for efficiency.
 *
 * @param startTime - Unix timestamp in ms
 * @param isRunning - Whether to actively update the timer
 * @param ms - How often should we trigger updates?
 * @param pausedMs - Total paused duration to subtract
 * @param endTime - If set, freezes the duration at this timestamp.
 * @returns Formatted duration string (e.g., "1m 23s")
 */
export function useElapsedTime(
  startTime: number,
  isRunning: boolean,
  ms = 1000,
  pausedMs = 0,
  endTime?: number,
): string {
  const get = () => formatDuration(Math.max(0, (endTime ?? Date.now()) - startTime - pausedMs))

  const subscribe = useCallback(
    (notify: () => void) => {
      if (!isRunning) return () => {}
      const interval = setInterval(notify, ms)
      return () => clearInterval(interval)
    },
    [isRunning, ms],
  )

  return useSyncExternalStore(subscribe, get, get)
}
