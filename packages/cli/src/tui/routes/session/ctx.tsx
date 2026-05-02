import { createContext, useContext } from "react"
import type { useSync } from "../../context/sync"
import type { useTuiConfig } from "../../context/tui-config"

export type DisplayMode = "compact" | "transcript"

export const SessionContext = createContext<{
  width: number
  sessionID: string
  conceal: boolean
  showThinking: boolean
  showTimestamps: boolean
  displayMode: DisplayMode
  showDetails: boolean
  showGenericToolOutput: boolean
  diffWrapMode: "word" | "none"
  sync: ReturnType<typeof useSync>
  tui: ReturnType<typeof useTuiConfig>
} | null>(null)

export const SessionProvider = SessionContext.Provider

export function useSessionContext() {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error("useSessionContext must be used within a Session component")
  return ctx
}
