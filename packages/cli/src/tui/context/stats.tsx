import { type SessionStats, useSessionStats } from "../hooks/use-session-stats"
import { createSimpleContext } from "./helper"
import { useSession } from "./session"

const DEFAULT_STATS: SessionStats = {
  totalTokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  totalCost: null,
  contextUtilization: 0,
  contextLimit: 200_000,
  turnCount: 0,
  toolCalls: { total: 0, success: 0, failed: 0 },
  duration: 0,
  perModel: [],
}

export const { use: useStats, provider: StatsProvider } = createSimpleContext({
  name: "Stats",
  init: () => {
    const session = useSession()
    const sessionID = session.sessionID

    // We cannot conditionally call hooks, so we must always call useSessionStats.
    // When sessionID is undefined, we pass a dummy ID and then return DEFAULT_STATS.
    // However, useSessionStats takes a string.
    const stats = useSessionStats(sessionID ?? "none")

    if (!sessionID) return DEFAULT_STATS
    return stats
  },
})
