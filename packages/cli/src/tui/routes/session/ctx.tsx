import { createContext, useContext } from "react"
import type { useTuiConfig } from "../../context/tui-config"

export type DisplayMode = "compact" | "transcript"

export const SessionContext = createContext<{
  width: number
  /** Undefined when no session has been created yet (boot state). */
  sessionID: string | undefined
  conceal: boolean
  showThinking: boolean
  showTimestamps: boolean
  displayMode: DisplayMode
  showDetails: boolean
  showGenericToolOutput: boolean
  diffWrapMode: "word" | "none"
  showPreCompaction: boolean
  isToolCompact: (toolName: string) => boolean
  lastReasoningId: string | null
  tui: ReturnType<typeof useTuiConfig>
} | null>(null)

export const SessionProvider = SessionContext.Provider

/**
 * Access session context. Throws if not within a SessionProvider.
 * Use for components that structurally require an active session (tools, parts, messages).
 */
export function useSessionContext() {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error("useSessionContext must be used within a Session component")
  return ctx
}

/**
 * Access session context without throwing. Returns null when outside a SessionProvider
 * or when sessionID is undefined (boot state). Use for components that render in both
 * boot and active states (e.g., StatusLine).
 */
export function useOptionalSessionContext() {
  return useContext(SessionContext)
}
