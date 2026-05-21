import { Box, type ScrollBoxHandle, TerminalSizeContext } from "@liteai/ink"
import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import { CommandPalette } from "../../components/command-palette"
import { DialogMemory } from "../../components/dialog-memory"
import { DialogSearch } from "../../components/dialog-search"
import { DialogSessionList } from "../../components/dialog-session-list"
import { HomeScreen } from "../../components/home-screen"
import { dispatchMessageAction, type MessageActionCaps } from "../../components/message-action-handlers"
import type { MessageActionContext } from "../../components/message-action-registry"
import { MessageActionsBar } from "../../components/message-actions-bar"
import { PlanReview } from "../../components/plan-review"
import { PromptInput } from "../../components/prompt/prompt-input"
import { TipBanner } from "../../components/prompt/tip-banner"
import { ScrollHandler } from "../../components/scroll-handler"
import { SessionLayout } from "../../components/session-layout"
import { StatusLine } from "../../components/status-line"
import { TodoTray } from "../../components/todo-tray"
import { TokenWarning } from "../../components/token-warning"
import { TranscriptSearch } from "../../components/transcript-search"
import { isCompactEligible } from "../../constants/compact-allowlist"
import { useExit } from "../../context/exit"
import { useLocal } from "../../context/local"
import { MessageCursorContext } from "../../context/message-cursor"
import { useModalPane } from "../../context/modal-pane"
import { usePromptRef } from "../../context/prompt-ref"
import { useRoute } from "../../context/route"
import { useSDK } from "../../context/sdk"
import { useSession } from "../../context/session"
import { StatsProvider, useStats } from "../../context/stats"
import { useToast } from "../../context/toast"
import { useTuiConfig } from "../../context/tui-config"
import { useClipboard } from "../../hooks/use-clipboard"
import { useMessageCursor } from "../../hooks/use-message-cursor"
import { useWindowTitle } from "../../hooks/use-window-title"
import { useRegisterKeybindingContext } from "../../keybindings/keybinding-context"
import { useKeybindings } from "../../keybindings/use-keybinding"
import {
  selectMessages,
  selectPermissions,
  selectQuestions,
  selectSessionStatus,
  selectTodos,
  useAppActions,
  useAppState,
  useAppStore,
  useSetAppState,
} from "../../state"
import {
  getNextPermissionMode,
  isDefaultMode,
  permissionModeSymbol,
  permissionModeTitle,
} from "../../util/permission-mode"
import { type DisplayMode, SessionProvider } from "./ctx"
import { Messages } from "./messages"
import { PermissionPrompt } from "./permission"
import { QuestionPrompt } from "./question"

function getFolderName(dir: string): string {
  const parts = dir.replace(/\\/g, "/").split("/")
  return parts[parts.length - 1] || dir
}

export function SessionRoute({ sessionID }: { sessionID?: string }) {
  const {
    session: { sync: syncSession, cleanup: cleanupSession },
  } = useAppActions()
  const messages = useAppState(selectMessages(sessionID))
  const partsMap = useAppState((s) => s.part)
  const permissions = useAppState(selectPermissions(sessionID))
  const questions = useAppState(selectQuestions(sessionID))
  const session = useSession()
  const sdk = useSDK()
  const appStore = useAppStore()
  const tuiConfig = useTuiConfig()

  // Terminal title bar status (like Claude Code / Gemini CLI)
  const directory = useAppState((s) => s.path.directory || s.path.worktree)
  const folderName = useMemo(() => getFolderName(directory || process.cwd()), [directory])
  useWindowTitle({ sessionID, folderName })
  useRegisterKeybindingContext("Chat")
  const modalPane = useModalPane()
  const route = useRoute()
  const toast = useToast()
  const { copy } = useClipboard()
  const terminalSize = useContext(TerminalSizeContext)
  const [_sidebarOpen, setSidebarOpen] = useState(false)
  const [showThinking, setShowThinking] = useState(true)
  // TODO: Wire to keybindings (session_timestamps_toggle, session_details_toggle, session_generic_toggle)
  const [showTimestamps, _setShowTimestamps] = useState(false)
  const [showTranscriptSearch, setShowTranscriptSearch] = useState(false)
  const [showPreCompaction, setShowPreCompaction] = useState(false)
  const [todoTrayExpanded, setTodoTrayExpanded] = useState(false)

  const [displayMode, setDisplayMode] = useState<DisplayMode>("compact")
  const showDetails = displayMode === "transcript"
  const showGenericToolOutput = displayMode === "transcript"

  const scrollRef = useRef<ScrollBoxHandle>(null)

  // Cursor state
  const cursor = useMessageCursor(
    messages as import("@liteai/sdk").Message[],
    partsMap as Record<string, import("@liteai/sdk").Part[]>,
  )
  const promptRef = usePromptRef()
  useRegisterKeybindingContext("MessageActions", cursor.active)

  // Sync session on mount — guarded: no-op during boot state (sessionID undefined)
  useEffect(() => {
    if (!sessionID) return
    syncSession(sessionID)
    return () => {
      cleanupSession(sessionID)
    }
  }, [sessionID, syncSession, cleanupSession])

  useKeybindings(
    {
      "chat:sidebarToggle": () => setSidebarOpen((v) => !v),
      "chat:thinkingToggle": () => {
        setShowThinking((prev) => {
          const next = !prev
          toast.show({ variant: "success", message: `Thinking: ${next ? "on" : "off"}` })
          return next
        })
      },
      "chat:newSession": () => route.navigate({ type: "session" }),
      "chat:sessionList": () => modalPane.openModal(<DialogSessionList onClose={() => modalPane.closeModal()} />),
      "chat:memory": () => modalPane.openModal(<DialogMemory onClose={() => modalPane.closeModal()} />),
      "chat:workspaceSearch": () => modalPane.openModal(<DialogSearch onClose={() => modalPane.closeModal()} />),
      "chat:enterMessageCursor": cursor.enterCursor,
      "chat:transcriptSearch": () => setShowTranscriptSearch(true),
      "chat:commandPalette": () => {
        modalPane.openModal(
          <CommandPalette
            onClose={() => modalPane.closeModal()}
            onSelect={(commandName: string) => {
              modalPane.closeModal()
              // Delegate to the prompt interceptor path by prefilling & submitting the slash command
              promptRef.current?.prefill(`/${commandName}`)
              // Schedule a tick to let the prefill propagate before submitting
              setTimeout(() => promptRef.current?.submit(), 0)
            }}
          />,
        )
      },
    },
    { context: "Chat", isActive: !cursor.active },
  )

  // Focus arbiter: prompt receives focus only when no modal is open and cursor is inactive.
  // Derived here (SessionRoute level) so the single owner drives all downstream focus gating.
  const promptFocused = !modalPane.isOpen && !cursor.active

  useKeybindings(
    {
      "app:cyclePermissionMode": () => {
        const sid = session.sessionID
        if (!sid) return

        const current = appStore.getState().permissionMode[sid] ?? "default"
        const next = getNextPermissionMode(current)

        // Optimistic TUI update
        appStore.setState((prev) => ({
          ...prev,
          permissionMode: { ...prev.permissionMode, [sid]: next },
        }))

        // Server-side: setPermissionMode endpoint
        void sdk.client.project.session.setPermissionMode({
          sessionID: sid,
          projectID: sdk.projectID,
          permissionMode: next,
        })

        toast.show({
          variant: isDefaultMode(next) ? "info" : "warning",
          message: `${permissionModeSymbol(next)} ${permissionModeTitle(next)}`,
        })
      },
      "app:toggleTranscript": () => setDisplayMode((m) => (m === "compact" ? "transcript" : "compact")),
      "app:toggleTodos": () => setTodoTrayExpanded((v) => !v),
    },
    { context: "Global", isActive: true },
  )

  useKeybindings(
    {
      "transcript:exit": () => setDisplayMode("compact"),
      "transcript:toggleShowAll": () => setShowPreCompaction((v) => !v),
    },
    { context: "Transcript", isActive: displayMode === "transcript" },
  )

  const makeActionCtx = useCallback((): MessageActionContext | null => {
    if (!cursor.selectedMessage) return null
    return {
      message: cursor.selectedMessage,
      parts: (partsMap[cursor.selectedMessage.id] ?? []) as import("@liteai/sdk").Part[],
      isExpanded: cursor.expandedIds.has(cursor.selectedMessage.id),
    }
  }, [cursor.selectedMessage, partsMap, cursor.expandedIds])

  // Shared capabilities object — single source of truth for all action dispatches.
  // Each capability is the concrete side-effect; the dispatcher only decides *which* to call.
  const actionCaps = useMemo(
    (): MessageActionCaps => ({
      copy: async (t: string) => await copy(t),
      retry: (id: string) => {
        const userMsg = messages.find((m) => m.id === id && m.role === "user")
        if (!userMsg) return
        const parts = partsMap[userMsg.id] ?? []
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
    [copy, messages, partsMap, cursor, session, promptRef],
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

  const permissionRequest = useMemo(() => permissions[0], [permissions])
  const questionRequest = useMemo(() => questions[0], [questions])
  const planApproval = useAppState((s) => s.planApproval)
  const todos = useAppState(selectTodos(sessionID ?? ""))

  const setAppState = useSetAppState()
  const clearPlanApproval = useCallback(() => {
    setAppState((prev) => ({ ...prev, planApproval: null }))
  }, [setAppState])

  const isToolCompact = useCallback(
    (toolName: string) => {
      if (displayMode === "transcript") return false
      return isCompactEligible(toolName)
    },
    [displayMode],
  )

  const lastReasoningId = useMemo(() => {
    if (displayMode !== "transcript") return null
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      if (msg.role === "user") break
      const parts = partsMap[msg.id] ?? []
      for (let j = parts.length - 1; j >= 0; j--) {
        if (parts[j].type === "reasoning") return parts[j].id
      }
    }
    return null
  }, [messages, partsMap, displayMode])

  return (
    <StatsProvider>
      <ExitStatsSync />
      <SessionProvider
        value={{
          sessionID,
          width: terminalSize?.columns ?? 80,
          conceal: false,
          showThinking,
          showTimestamps,
          displayMode,
          showDetails,
          showGenericToolOutput,
          diffWrapMode: "none",
          showPreCompaction,
          isToolCompact,
          lastReasoningId,
          tui: tuiConfig,
        }}
      >
        <SessionLayoutBridge scrollRef={scrollRef}>
          <SessionLayout
            scrollRef={scrollRef}
            scrollable={
              <MessageCursorContext.Provider
                value={{
                  selectedMessageId: cursor.selectedMessage?.id,
                  isExpanded: (id) => cursor.expandedIds.has(id),
                  selectMessage: cursor.selectMessage,
                }}
              >
                {messages.length === 0 ? (
                  // Boot state or empty session: show compact home screen banner.
                  // The banner scrolls up naturally when messages arrive.
                  <HomeScreen />
                ) : (
                  <Messages scrollRef={scrollRef} />
                )}
              </MessageCursorContext.Provider>
            }
            bottom={
              <SessionBottom
                sessionID={sessionID}
                focus={promptFocused}
                cursorContext={makeActionCtx()}
                onSearch={() => setShowTranscriptSearch(true)}
              />
            }
            overlay={
              <Box flexDirection="column">
                {planApproval && planApproval.sessionID === sessionID && (
                  <PlanReview
                    sessionID={sessionID as string}
                    planText={planApproval.planText}
                    planFilePath={planApproval.planFilePath}
                    onApprove={clearPlanApproval}
                    onReject={clearPlanApproval}
                  />
                )}
                {permissionRequest && <PermissionPrompt request={permissionRequest} />}
                {questionRequest && <QuestionPrompt request={questionRequest} />}
                {showTranscriptSearch && (
                  <TranscriptSearch
                    onClose={() => setShowTranscriptSearch(false)}
                    onNavigate={(id) => cursor.selectMessage(id)}
                  />
                )}
                {todos.length > 0 && <TodoTray todos={todos} expanded={todoTrayExpanded} />}
              </Box>
            }
          />
        </SessionLayoutBridge>
        <ScrollHandler scrollRef={scrollRef} />
      </SessionProvider>
    </StatsProvider>
  )
}

import { useCompactCircuitBreaker } from "../../hooks/use-compact-circuit-breaker"
import { useQueueProcessor } from "../../hooks/use-queue-processor"

/**
 * Headless component that continuously syncs session stats into the exit
 * handler's statsRef. Must be rendered inside both `StatsProvider` (for stats)
 * and `ExitProvider` (for exit.stats.set). The snapshot is always fresh when
 * exit fires — no need to capture on demand.
 */
function ExitStatsSync(): null {
  const stats = useStats()
  const exit = useExit()
  const local = useLocal()
  const session = useSession()

  useEffect(() => {
    const model = local.model.current()
    exit.stats.set({
      modelID: model ? `${model.providerID}/${model.modelID}` : undefined,
      turnCount: stats.turnCount,
      toolCalls: stats.toolCalls,
      contextUtilization: stats.contextUtilization,
      totalCost: stats.totalCost,
      durationMs: stats.duration,
      sessionID: session.sessionID,
    })
  }, [stats, exit, local, session])

  return null
}

/**
 * SessionLayoutBridge — wires ModalPaneContext into SessionLayout's `modal` slot.
 *
 * Sits between SessionRoute and SessionLayout. Reads the current modal content
 * and scrollRef from the ModalPaneContext and clones the SessionLayout child
 * to inject them as props. This keeps SessionRoute clean (it doesn't need to
 * know about modal state) while providing the bridge between the context and
 * the layout's rendering infrastructure.
 */
function SessionLayoutBridge({
  scrollRef: _sessionScrollRef,
  children,
}: {
  scrollRef: React.RefObject<ScrollBoxHandle | null>
  children: React.ReactElement<React.ComponentProps<typeof SessionLayout>>
}) {
  const modalPane = useModalPane()
  return React.cloneElement(children, {
    modal: modalPane.content,
    modalScrollRef: modalPane.scrollRef,
  })
}

function SessionBottom({
  sessionID,
  focus,
  cursorContext,
  onSearch,
}: {
  sessionID?: string
  focus: boolean
  cursorContext: MessageActionContext | null
  onSearch?: () => void
}) {
  const stats = useStats()
  const session = useSession()
  const sessionStatus = useAppState(selectSessionStatus(sessionID))
  const sdk = useSDK()
  const breaker = useCompactCircuitBreaker(3)

  useQueueProcessor({
    sessionStatus: sessionStatus?.type ?? "idle",
    submit: session.submit,
  })

  const handleAutoCompact = useCallback(() => {
    if (!sessionID || breaker.isBroken) return
    void breaker.withCircuitBreaker(() => sdk.client.project.session.summarize({ sessionID, projectID: sdk.projectID }))
  }, [breaker, sdk, sessionID])

  return (
    <Box flexDirection="column" width="100%" flexShrink={0}>
      <TokenWarning utilization={stats.contextUtilization} onAutoCompact={handleAutoCompact} />
      {cursorContext && <MessageActionsBar ctx={cursorContext} />}
      <TipBanner isLoading={session.isLoading} cursorModeActive={!!cursorContext} />
      <PromptInput
        debug={false}
        verbose={false}
        isLoading={session.isLoading}
        focus={focus}
        cursorModeActive={!!cursorContext}
        onSearch={onSearch}
      />
      <StatusLine sessionID={sessionID} />
    </Box>
  )
}
