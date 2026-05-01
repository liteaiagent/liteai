import { useAnimationFrame } from "@liteai/ink"
import { useEffect, useState } from "react"
import { formatElapsed } from "../util/format-elapsed"

export function useElapsedTime(props: { startTime: number | null; endTime?: number | null; interval?: number }): {
  elapsed: number
  formatted: string
} {
  const { startTime, endTime, interval = 1000 } = props
  const [elapsed, setElapsed] = useState(0)

  // Use useAnimationFrame for stable background-aware tick
  const [, time] = useAnimationFrame(interval)

  useEffect(() => {
    if (startTime === null) {
      setElapsed(0)
      return
    }

    if (endTime != null) {
      setElapsed(Math.max(0, endTime - startTime))
      return
    }

    // Using Date.now() instead of time directly because time is monotonic since mount,
    // while startTime is a Unix timestamp. The tick just triggers the re-render.
    setElapsed(Math.max(0, Date.now() - startTime))
  }, [startTime, endTime, time])

  return {
    elapsed,
    formatted: formatElapsed(elapsed),
  }
}
