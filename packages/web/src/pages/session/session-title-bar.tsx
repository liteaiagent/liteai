// Re-export from @liteai/ui/panes/chat for backward compatibility.
// The web app wraps SessionTitleBar to inject the web-specific SessionContextUsage slot.
import { SessionTitleBar as PaneSessionTitleBar } from "@liteai/ui/panes/chat"
import { SessionContextUsage } from "@/components/session-context-usage"

export function SessionTitleBar(props: {
  sessionID: () => string | undefined
  projectID: () => string | undefined
  sessionKey: string
  centered: boolean
  working: boolean
  tint: string | undefined
  onNavigateSession?: (projectID: string, sessionID: string) => void
  onNavigateSessionList?: (projectID: string) => void
}) {
  return <PaneSessionTitleBar {...props} contextUsage={<SessionContextUsage placement="bottom" />} />
}
