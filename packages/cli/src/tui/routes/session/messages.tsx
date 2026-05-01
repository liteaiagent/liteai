import type { ScrollBoxHandle } from "@liteai/ink"
import { Box } from "@liteai/ink"
import type { Message, ReasoningPart } from "@liteai/sdk"
import type React from "react"
import { useCallback, useMemo } from "react"
import { type SubagentInfo, SubagentProgress } from "../../components/subagent-progress"
import { VirtualMessageList } from "../../components/virtual-message-list"
import { useMessageCursorContext } from "../../context/message-cursor"
import { useSession } from "../../context/session"
import { useSync } from "../../context/sync"
import { useTheme } from "../../context/theme"
import { RichSpinner } from "../../ui/spinner"
import { useSessionContext } from "./ctx"
import { MessageRow } from "./message-row"

export function Messages({ scrollRef }: { scrollRef: React.RefObject<ScrollBoxHandle | null> }) {
  const ctx = useSessionContext()
  const session = useSession()
  const { theme } = useTheme()
  const sync = useSync()
  const cursorCtx = useMessageCursorContext()
  const messages = sync.message[ctx.sessionID] ?? []

  const itemKey = useCallback((msg: Message) => msg.id, [])

  const renderItem = useCallback(
    (msg: Message, index: number) => {
      const parts = sync.part[msg.id] ?? []
      return <MessageRow key={msg.id} message={msg} parts={parts} index={index} last={index === messages.length - 1} />
    },
    [sync.part, messages.length],
  )

  // Derive selectedIndex from cursor context so VirtualMessageList can scroll to it
  const selectedIndex = useMemo(() => {
    if (!cursorCtx.selectedMessageId) return undefined
    const idx = messages.findIndex((m) => m.id === cursorCtx.selectedMessageId)
    return idx >= 0 ? idx : undefined
  }, [cursorCtx.selectedMessageId, messages])

  const lastMessage = messages.at(-1)
  const lastParts = lastMessage ? (sync.part[lastMessage.id] ?? []) : []
  const hasRunningTools = lastParts.some((p) => p.type === "tool" && p.state.status === "running")
  const showSpinner = session.isLoading && !hasRunningTools

  const assistantMsg = lastMessage?.role === "assistant" ? lastMessage : undefined
  const startTime = assistantMsg?.time.created ?? Date.now()
  const responseLength = useMemo(() => {
    if (!assistantMsg) return 0
    return (sync.part[assistantMsg.id] ?? []).reduce(
      (acc, p) => (p.type === "text" ? acc + (p.text?.length ?? 0) : acc),
      0,
    )
  }, [assistantMsg, sync.part])

  // Type-safe narrowing via type predicate — ReasoningPart has non-optional `time` field
  const thinkingPart = lastParts.find((p): p is ReasoningPart => p.type === "reasoning")
  const thinkingStatus: "thinking" | null = thinkingPart ? (thinkingPart.time.end != null ? null : "thinking") : null

  // Derive subagent info from SyncState.agents (wired via agent.spawned/progress/completed events)
  const subagentInfos = useMemo<SubagentInfo[]>(() => {
    const agents = sync.agents
    if (!agents || Object.keys(agents).length === 0) return []
    return Object.entries(agents)
      .filter(([, agent]) => agent.status === "running" || agent.status === "completed")
      .map(([agentId, agent]) => ({
        partId: agentId,
        description: agent.activity ?? agent.type,
        isRunning: agent.status === "running",
        startTime: agent.startTime,
        endTime: agent.duration != null ? agent.startTime + agent.duration : undefined,
        toolCount: agent.usage?.toolCalls ?? 0,
      }))
  }, [sync.agents])

  const hasActiveSubagents = subagentInfos.some((s) => s.isRunning)

  return (
    <>
      <VirtualMessageList
        messages={messages}
        scrollRef={scrollRef}
        columns={ctx.width}
        itemKey={itemKey}
        renderItem={renderItem}
        trackStickyPrompt={true}
        selectedIndex={selectedIndex}
      />
      {showSpinner && (
        <Box paddingX={1} paddingTop={1} flexDirection="column">
          <RichSpinner
            startTime={startTime}
            responseLength={responseLength}
            hasActiveTools={hasRunningTools}
            columns={ctx.width}
            thinkingStatus={thinkingStatus}
            themeColor={theme.primary as string}
          />
          {hasActiveSubagents && (
            <Box paddingLeft={2} paddingTop={1}>
              <SubagentProgress subagents={subagentInfos} />
            </Box>
          )}
        </Box>
      )}
    </>
  )
}
