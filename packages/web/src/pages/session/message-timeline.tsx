// Re-export from @liteai/ui/panes/chat for backward compatibility.
// The web app wraps MessageTimeline to inject the web-specific SessionContextUsage slot.

import type { UserMessage } from "@liteai/sdk"
import { MessageTimeline as PaneMessageTimeline } from "@liteai/ui/panes/chat"
import type { JSX } from "solid-js"
import { SessionContextUsage } from "@/components/session-context-usage"

type UserActions = {
  fork?: (input: { sessionID: string; messageID: string }) => Promise<void> | void
  revert?: (input: { sessionID: string; messageID: string }) => Promise<void> | void
}

export function MessageTimeline(props: {
  mobileChanges: boolean
  mobileFallback: JSX.Element
  actions?: UserActions
  scroll: { overflow: boolean; bottom: boolean }
  onResumeScroll: () => void
  setScrollRef: (el: HTMLElement | undefined) => void
  onScheduleScrollState: (el: HTMLElement) => void
  onAutoScrollHandleScroll: () => void
  onMarkScrollGesture: (target?: EventTarget | null) => void
  hasScrollGesture: () => boolean
  onUserScroll: () => void
  onTurnBackfillScroll: () => void
  onAutoScrollInteraction: (event: MouseEvent) => void
  centered: boolean
  setContentRef: (el: HTMLElement) => void
  turnStart: number
  historyMore: boolean
  historyLoading: boolean
  onLoadEarlier: () => void
  renderedUserMessages: UserMessage[]
  anchor: (id: string) => string
  sessionID?: string
  projectID?: string
  sessionKey: string
  onNavigateSession?: (projectID: string, sessionID: string) => void
  onNavigateSessionList?: (projectID: string) => void
}) {
  return <PaneMessageTimeline {...props} contextUsage={<SessionContextUsage placement="bottom" />} />
}
