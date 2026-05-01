import { Box, type ScrollBoxHandle, TerminalSizeContext } from "@liteai/ink"
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import { DialogSessionList } from "../../components/dialog-session-list"
import { dispatchMessageAction, type MessageActionCaps } from "../../components/message-action-handlers"
import type { MessageActionContext } from "../../components/message-action-registry"
import { MessageActionsBar } from "../../components/message-actions-bar"
import { PromptInput } from "../../components/prompt/prompt-input"
import { ScrollHandler } from "../../components/scroll-handler"
import { SessionLayout } from "../../components/session-layout"
import { StatusLine } from "../../components/status-line"
import { ThinkingToggleDialog } from "../../components/thinking-toggle"
import { TokenWarning } from "../../components/token-warning"
import { useDialog } from "../../context/dialog"
import { MessageCursorContext } from "../../context/message-cursor"
import { usePromptRef } from "../../context/prompt"
import { useRoute } from "../../context/route"
import { useSession } from "../../context/session"
import { StatsProvider, useStats } from "../../context/stats"
import { useSync } from "../../context/sync"
import { useClipboard } from "../../hooks/use-clipboard"
import { useMessageCursor } from "../../hooks/use-message-cursor"
import { useRegisterKeybindingContext } from "../../keybindings/keybinding-context"
import { useKeybindings } from "../../keybindings/use-keybinding"
import { SessionProvider } from "./ctx"
import { Messages } from "./messages"
import { PermissionPrompt } from "./permission"
import { QuestionPrompt } from "./question"

export function SessionRoute({ sessionID }: { sessionID: string }) {
  const sync = useSync()
  const session = useSession()
  useRegisterKeybindingContext("Chat")
  const dialog = useDialog()
  const route = useRoute()
  const { copy } = useClipboard()
  const terminalSize = useContext(TerminalSizeContext)
  const [_sidebarOpen, setSidebarOpen] = useState(false)
  const [showThinking, setShowThinking] = useState(true)
  // TODO: Wire to keybindings (session_timestamps_toggle, session_details_toggle, session_generic_toggle)
  const [showTimestamps, _setShowTimestamps] = useState(false)
  const [showDetails, _setShowDetails] = useState(true)
  const [showGenericToolOutput, _setShowGenericToolOutput] = useState(false)

  const scrollRef = useRef<ScrollBoxHandle>(null)

  // Cursor state
  const messages = sync.message[sessionID] ?? []
  const cursor = useMessageCursor(messages, sync.part)
  const promptRef = usePromptRef()
  useRegisterKeybindingContext("MessageActions")

  // Sync session on mount
  useEffect(() => {
    sync.session.sync(sessionID)
  }, [sessionID, sync.session])

  useKeybindings(
    {
      "chat:sidebarToggle": () => setSidebarOpen((v) => !v),
      "chat:thinkingToggle": () => {
        dialog.push(() => (
          <ThinkingToggleDialog
            currentValue={showThinking}
            onSelect={(enabled: boolean) => {
              setShowThinking(enabled)
              dialog.pop()
            }}
            onCancel={() => dialog.pop()}
            isMidConversation={messages.length > 0}
          />
        ))
      },
      "chat:newSession": () => route.navigate({ type: "home" }),
      "chat:sessionList": () => dialog.push(() => <DialogSessionList />),
      "chat:enterMessageCursor": cursor.enterCursor,
    },
    { context: "Chat", isActive: !cursor.active },
  )

  const makeActionCtx = useCallback((): MessageActionContext | null => {
    if (!cursor.selectedMessage) return null
    return {
      message: cursor.selectedMessage,
      parts: sync.part[cursor.selectedMessage.id] ?? [],
      isExpanded: cursor.expandedMessages.has(cursor.selectedMessage.id),
    }
  }, [cursor.selectedMessage, sync.part, cursor.expandedMessages])

  // Shared capabilities object — single source of truth for all action dispatches.
  // Each capability is the concrete side-effect; the dispatcher only decides *which* to call.
  const actionCaps = useMemo(
    (): MessageActionCaps => ({
      copy: async (t: string) => await copy(t),
      retry: (id: string) => {
        const userMsg = messages.find((m) => m.id === id && m.role === "user")
        if (!userMsg) return
        const parts = sync.part[userMsg.id] ?? []
        const textPart = parts.find((p) => p.type === "text" && "text" in p)
        if (textPart && "text" in textPart) {
          cursor.exit()
          void session.submit(textPart.text, "prompt")
        }
      },
      edit: (text: string) => {
        cursor.exit()
        promptRef.current?.prefill(text)
      },
    }),
    [copy, messages, sync.part, cursor, session, promptRef],
  )

  const dispatchAction = useCallback(
    (actionKey: string) => {
      const ctx = makeActionCtx()
      if (!ctx) return
      dispatchMessageAction(actionKey, ctx, actionCaps, cursor.toggleExpand)
    },
    [makeActionCtx, actionCaps, cursor.toggleExpand],
  )

  useKeybindings(
    {
      "messageActions:prev": cursor.moveUp,
      "messageActions:next": cursor.moveDown,
      "messageActions:top": cursor.moveToTop,
      "messageActions:bottom": cursor.moveToBottom,
      "messageActions:escape": cursor.exit,
      "messageActions:ctrlc": cursor.exit,
      "messageActions:copy": () => dispatchAction("copy"),
      "messageActions:copyCode": () => dispatchAction("copyCode"),
      "messageActions:primary": () => dispatchAction("primary"),
      "messageActions:retry": () => dispatchAction("retry"),
    },
    { context: "MessageActions", isActive: cursor.active },
  )

  const permissionRequest = useMemo(() => {
    return (sync.permission[sessionID] ?? [])[0]
  }, [sync.permission, sessionID])

  const questionRequest = useMemo(() => {
    return (sync.question[sessionID] ?? [])[0]
  }, [sync.question, sessionID])

  return (
    <StatsProvider>
      <SessionProvider
        value={{
          sessionID,
          width: terminalSize?.columns ?? 80,
          conceal: false,
          showThinking,
          showTimestamps,
          showDetails,
          showGenericToolOutput,
          diffWrapMode: "none",
          sync,
          tui: sync.config,
        }}
      >
        <SessionLayout
          scrollRef={scrollRef}
          scrollable={
            <MessageCursorContext.Provider
              value={{
                selectedMessageId: cursor.selectedMessage?.id,
                isExpanded: (id) => cursor.expandedMessages.has(id),
              }}
            >
              <Messages scrollRef={scrollRef} />
            </MessageCursorContext.Provider>
          }
          bottom={<SessionBottom sessionID={sessionID} cursorContext={makeActionCtx()} />}
          overlay={
            <Box flexDirection="column">
              {permissionRequest && <PermissionPrompt request={permissionRequest} />}
              {questionRequest && <QuestionPrompt request={questionRequest} />}
            </Box>
          }
        />
        <ScrollHandler scrollRef={scrollRef} />
      </SessionProvider>
    </StatsProvider>
  )
}

import { useQueueProcessor } from "../../hooks/use-queue-processor"

function SessionBottom({
  sessionID,
  cursorContext,
}: {
  sessionID: string
  cursorContext: MessageActionContext | null
}) {
  const stats = useStats()
  const session = useSession()
  const sync = useSync()

  useQueueProcessor({
    sessionStatus: sync.session.status(sessionID),
    submit: session.submit,
  })

  return (
    <Box flexDirection="column" width="100%" flexShrink={0}>
      <TokenWarning utilization={stats.contextUtilization} onAutoCompact={() => session.submit("/compact", "prompt")} />
      {cursorContext && <MessageActionsBar ctx={cursorContext} />}
      <PromptInput debug={false} verbose={false} isLoading={session.isLoading} cursorModeActive={!!cursorContext} />
      <StatusLine sessionID={sessionID} />
    </Box>
  )
}
