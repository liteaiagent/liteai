import { Log } from "@liteai/util/log"
import { useCallback, useState } from "react"

export function useCompactCircuitBreaker(maxFailures = 3) {
  const [failures, setFailures] = useState(0)

  const withCircuitBreaker = useCallback(
    async (action: () => Promise<unknown>) => {
      if (failures >= maxFailures) {
        Log.Default.warn("[circuit-breaker] Auto-compact circuit broken due to too many failures")
        return
      }

      try {
        await action()
      } catch (err) {
        Log.Default.error("[circuit-breaker] Auto-compact failed", { error: err })
        setFailures((f) => f + 1)
      }
    },
    [failures, maxFailures],
  )

  return {
    withCircuitBreaker,
    isBroken: failures >= maxFailures,
  }
}
