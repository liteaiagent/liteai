import type { Color, ScrollBoxHandle } from "@liteai/ink"
import { Box, Text } from "@liteai/ink"
import type { Message, Part, ReasoningPart } from "@liteai/sdk"
import type React from "react"
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import { type SubagentInfo, SubagentProgress } from "../../components/subagent-progress"
import { VirtualMessageList } from "../../components/virtual-message-list"
import { useMessageCursorContext } from "../../context/message-cursor"
import { useSession } from "../../context/session"
import { useTheme } from "../../context/theme"
import { selectMessages, useAppState } from "../../state"
import { type LocalMessage, LocalMessageStore } from "../../state/local-messages"
import { RichSpinner } from "../../ui/spinner"
import { collapseToolParts } from "../../utils/collapse-tool-groups"
import { useSessionContext } from "./ctx"
import { MessageRow } from "./message-row"

export function Messages({ scrollRef }: { scrollRef: React.RefObject<ScrollBoxHandle | null> }) {
  const ctx = useSessionContext()
  const session = useSession()
  const { theme } = useTheme()
  const cursorCtx = useMessageCursorContext()
  const messages = useAppState(selectMessages(ctx.sessionID))
  const partsMap = useAppState((s) => s.part)
  const agents = useAppState((s) => s.agents)

  const filteredMessages = useMemo(() => {
    if (ctx.showPreCompaction) return messages
    let compactionIndex = -1
    for (let i = messages.length - 1; i >= 0; i--) {
      const parts = partsMap[messages[i].id] ?? []
      if (parts.some((p) => p.type === "compaction")) {
        compactionIndex = i
        break
      }
    }
    if (compactionIndex === -1) return messages
    return messages.slice(compactionIndex)
  }, [messages, partsMap, ctx.showPreCompaction])

  const itemKey = useCallback((msg: Message) => msg.id, [])

  const renderItem = useCallback(
    (msg: Message, index: number) => {
      const parts = partsMap[msg.id] ?? []
      const displayParts = ctx.displayMode === "compact" ? collapseToolParts(parts as Part[]) : (parts as Part[])
      return (
        <MessageRow
          key={msg.id}
          message={msg as Message}
          parts={displayParts}
          index={index}
          last={index === messages.length - 1}
        />
      )
    },
    [partsMap, filteredMessages.length, ctx.displayMode],
  )

  // Derive selectedIndex from cursor context so VirtualMessageList can scroll to it
  const selectedIndex = useMemo(() => {
    if (!cursorCtx.selectedMessageId) return undefined
    const idx = filteredMessages.findIndex((m) => m.id === cursorCtx.selectedMessageId)
    return idx >= 0 ? idx : undefined
  }, [cursorCtx.selectedMessageId, filteredMessages])

  const lastMessage = messages.at(-1)
  const lastParts = lastMessage ? (partsMap[lastMessage.id] ?? []) : []
  const hasRunningTools = lastParts.some((p) => p.type === "tool" && p.state.status === "running")
  const rawShowSpinner = session.isLoading && !hasRunningTools

  // Debounce spinner visibility to prevent rapid mount/unmount cycles.
  // When tool states transition (running → complete → next tool), showSpinner
  // toggles rapidly causing the RichSpinner to remount (new random verb,
  // animation restart, potential ANSI rendering artifacts).
  // Keep the spinner visible for at least 150ms after it was last shown.
  const [debouncedShowSpinner, setDebouncedShowSpinner] = useState(false)
  const spinnerTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => {
    if (rawShowSpinner) {
      // Show immediately
      if (spinnerTimerRef.current) {
        clearTimeout(spinnerTimerRef.current)
        spinnerTimerRef.current = undefined
      }
      setDebouncedShowSpinner(true)
    } else {
      // Delay hiding by 150ms to absorb rapid toggles
      spinnerTimerRef.current = setTimeout(() => {
        setDebouncedShowSpinner(false)
        spinnerTimerRef.current = undefined
      }, 150)
    }
    return () => {
      if (spinnerTimerRef.current) {
        clearTimeout(spinnerTimerRef.current)
        spinnerTimerRef.current = undefined
      }
    }
  }, [rawShowSpinner])
  const showSpinner = debouncedShowSpinner

  const assistantMsg = lastMessage?.role === "assistant" ? lastMessage : undefined
  const startTime = assistantMsg?.time.created ?? Date.now()
  const responseLength = useMemo(() => {
    if (!assistantMsg) return 0
    return (partsMap[assistantMsg.id] ?? []).reduce(
      (acc, p) => (p.type === "text" ? acc + (p.text?.length ?? 0) : acc),
      0,
    )
  }, [assistantMsg, partsMap])

  // Type-safe narrowing via type predicate — ReasoningPart has non-optional `time` field
  const thinkingPart = lastParts.find((p): p is ReasoningPart => p.type === "reasoning")
  const thinkingStatus: "thinking" | null = thinkingPart ? (thinkingPart.time.end != null ? null : "thinking") : null

  // Derive subagent info from SyncState.agents (wired via agent.spawned/progress/completed events)
  const subagentInfos = useMemo<SubagentInfo[]>(() => {
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
  }, [agents])

  const hasActiveSubagents = subagentInfos.some((s) => s.isRunning)

  // ── Local trail messages (Message Trail pattern) ────────────────────────
  const sessionID = ctx.sessionID ?? ""
  const localMessages = useSyncExternalStore(LocalMessageStore.subscribe, () =>
    LocalMessageStore.getSnapshot(sessionID),
  )

  return (
    <>
      <VirtualMessageList
        messages={filteredMessages as Message[]}
        scrollRef={scrollRef}
        columns={ctx.width}
        itemKey={itemKey}
        renderItem={renderItem}
        trackStickyPrompt={true}
        selectedIndex={selectedIndex}
      />
      {localMessages.length > 0 && <TrailMessages messages={localMessages} />}
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

// ── Trail Message Rendering ─────────────────────────────────────────────

function TrailMessages({ messages }: { messages: readonly LocalMessage[] }) {
  const { theme } = useTheme()
  return (
    <Box flexDirection="column" paddingLeft={3} marginTop={1}>
      {messages.map((msg) => (
        <Box key={msg.id} paddingY={0}>
          <Text color={theme.textMuted as Color} italic>
            {msg.text}
          </Text>
        </Box>
      ))}
    </Box>
  )
}
