import { useEffect, useState } from 'react'

/**
 * Hook that returns true after a delay.
 * @param delay Delay in milliseconds
 * @param resetTrigger Optional trigger to reset the timer
 */
export function useTimeout(delay: number, _resetTrigger?: unknown): boolean {
  const [isElapsed, setIsElapsed] = useState(false)

  useEffect(() => {
    setIsElapsed(false)
    const timer = setTimeout(setIsElapsed, delay, true)

    return () => clearTimeout(timer)
  }, [delay])

  return isElapsed
}
