import type React from "react"
import { createContext, useContext } from "react"
import { type SessionStats, useSessionStats } from "../hooks/use-session-stats"
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

const StatsContext = createContext<SessionStats | undefined>(undefined)

export function useStats(): SessionStats {
  const context = useContext(StatsContext)
  if (context === undefined) {
    throw new Error("Stats context must be used within a context provider")
  }
  return context
}

export function StatsProvider({ children }: { children?: React.ReactNode }) {
  const session = useSession()
  const sessionID = session.sessionID

  // We cannot conditionally call hooks, so we must always call useSessionStats.
  // When sessionID is undefined, we pass a dummy ID and then return DEFAULT_STATS.
  // However, useSessionStats takes a string.
  const stats = useSessionStats(sessionID ?? "none")

  const value = sessionID ? stats : DEFAULT_STATS

  return <StatsContext.Provider value={value}>{children}</StatsContext.Provider>
}
