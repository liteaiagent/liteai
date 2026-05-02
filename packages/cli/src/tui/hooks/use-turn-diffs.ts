import type { Snapshot } from "@liteai/core/snapshot/index"
import { Log } from "@liteai/util/log"
import { useEffect, useState } from "react"
import { useSDK } from "../context/sdk"

export function useTurnDiffs(sessionID: string | undefined, messageID: string | undefined) {
  const sdk = useSDK()
  const [diffs, setDiffs] = useState<Snapshot.FileDiff[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!sessionID || !messageID) return
    setLoading(true)
    const fetchDiffs = async () => {
      try {
        const response = await sdk.fetch(`${sdk.url}/session/${sessionID}/diff?messageID=${messageID}`)
        if (response.ok) {
          const data = await response.json()
          setDiffs(data as Snapshot.FileDiff[])
        } else {
          Log.Default.warn("[use-turn-diffs] Non-OK response fetching turn diffs", {
            sessionID,
            messageID,
            status: response.status,
          })
          setDiffs([])
        }
      } catch (e) {
        Log.Default.warn("[use-turn-diffs] Failed to fetch turn diffs", { sessionID, messageID, error: e })
        setDiffs([])
      } finally {
        setLoading(false)
      }
    }
    void fetchDiffs()
  }, [sdk, sessionID, messageID])

  return { diffs, loading }
}
