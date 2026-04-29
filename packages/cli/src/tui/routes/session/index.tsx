import { Box, type ScrollBoxHandle, TerminalSizeContext, useInput } from "@liteai/ink"
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import { DialogSessionList } from "../../components/dialog-session-list"
import { MessageActionsBar } from "../../components/message-actions-bar"
import { PromptInput } from "../../components/prompt/prompt-input"
import { ScrollHandler } from "../../components/scroll-handler"
import { SessionLayout } from "../../components/session-layout"
import { useDialog } from "../../context/dialog"
import { useKeybind } from "../../context/keybind"
import { useRoute } from "../../context/route"
import { useSession } from "../../context/session"
import { useSync } from "../../context/sync"
import { useClipboard } from "../../hooks/use-clipboard"
import { SessionProvider } from "./ctx"
import { SessionHeader } from "./header"
import { Messages } from "./messages"
import { PermissionPrompt } from "./permission"
import { QuestionPrompt } from "./question"
import { Sidebar } from "./sidebar"

export function SessionRoute({ sessionID }: { sessionID: string }) {
  const sync = useSync()
  const session = useSession()
  const keybind = useKeybind()
  const dialog = useDialog()
  const route = useRoute()
  const { copy } = useClipboard()
  const terminalSize = useContext(TerminalSizeContext)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [showThinking, setShowThinking] = useState(true)
  // TODO: Wire to keybindings (session_timestamps_toggle, session_details_toggle, session_generic_toggle)
  const [showTimestamps, _setShowTimestamps] = useState(false)
  const [showDetails, _setShowDetails] = useState(true)
  const [showGenericToolOutput, _setShowGenericToolOutput] = useState(false)

  const scrollRef = useRef<ScrollBoxHandle>(null)

  // Sync session on mount
  useEffect(() => {
    sync.session.sync(sessionID)
  }, [sessionID, sync.session])

  // ── Derived state for actions ──────────────────────────────────────────

  /** Get the last assistant message text for copy */
  const getLastAssistantText = useCallback(() => {
    const messages = sync.message[sessionID] ?? []
    // Walk backwards to find last assistant message with text parts
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      if (msg?.role !== "assistant") continue
      const parts = sync.part[msg.id] ?? []
      const textParts = parts.filter((p) => p.type === "text" && "text" in p)
      if (textParts.length > 0) {
        return textParts.map((p) => ("text" in p ? p.text : "")).join("\n")
      }
    }
    return null
  }, [sync.message, sync.part, sessionID])

  /** Check if last assistant message has a retryable error */
  const getRetryInfo = useCallback(() => {
    const messages = sync.message[sessionID] ?? []
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      if (msg?.role !== "assistant") continue
      if (!msg.error) return null
      // Find the user message that triggered this
      const parentMsg = messages.find((m) => m.id === msg.parentID)
      if (!parentMsg || parentMsg.role !== "user") return null

      const isRetryable =
        msg.error.name === "ContextOverflowError" ||
        (msg.error.name === "APIError" && (msg.error.data as { isRetryable?: boolean }).isRetryable === true)

      return { isRetryable, userMessageID: parentMsg.id }
    }
    return null
  }, [sync.message, sessionID])

  // ── Keybindings ────────────────────────────────────────────────────────
  // Use event.keypress (ParsedKey) directly instead of fabricating one

  useInput((_input, _key, event) => {
    if (!event) return

    // Schema key: sidebar_toggle (was incorrectly session_sidebar_toggle)
    if (keybind.match("sidebar_toggle", event.keypress)) {
      setSidebarOpen((v) => !v)
    }

    // Schema key: display_thinking (was incorrectly session_thinking_toggle)
    if (keybind.match("display_thinking", event.keypress)) {
      setShowThinking((v) => !v)
    }

    if (keybind.match("session_new", event.keypress)) {
      route.navigate({ type: "home" })
    }

    if (keybind.match("session_list", event.keypress)) {
      dialog.push(() => <DialogSessionList />)
    }

    // Copy last assistant message to clipboard
    if (keybind.match("messages_copy", event.keypress)) {
      const text = getLastAssistantText()
      if (text) {
        void copy(text)
      }
    }

    // Retry last failed message
    if (keybind.match("session_retry", event.keypress)) {
      const retryInfo = getRetryInfo()
      if (retryInfo?.isRetryable) {
        // Find the user message text and re-submit
        const userMsg = (sync.message[sessionID] ?? []).find((m) => m.id === retryInfo.userMessageID)
        if (userMsg) {
          const parts = sync.part[userMsg.id] ?? []
          const textPart = parts.find((p) => p.type === "text" && "text" in p)
          if (textPart && "text" in textPart) {
            void session.submit(textPart.text, "prompt")
          }
        }
      }
    }
  })

  const permissionRequest = useMemo(() => {
    return (sync.permission[sessionID] ?? [])[0]
  }, [sync.permission, sessionID])

  const questionRequest = useMemo(() => {
    return (sync.question[sessionID] ?? [])[0]
  }, [sync.question, sessionID])

  // ── Action bar state ───────────────────────────────────────────────────

  const messageActions = useMemo(() => {
    const hasAssistantText = getLastAssistantText() !== null
    const retryInfo = getRetryInfo()

    return [
      {
        keybindName: "messages_copy",
        label: "copy",
        available: hasAssistantText,
      },
      {
        keybindName: "session_retry",
        label: "retry",
        available: retryInfo?.isRetryable === true,
      },
      {
        keybindName: "display_thinking",
        label: showThinking ? "hide thinking" : "show thinking",
        available: true,
      },
    ]
  }, [getLastAssistantText, getRetryInfo, showThinking])

  return (
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
        scrollable={<Messages scrollRef={scrollRef} />}
        bottom={
          <Box flexDirection="column" width="100%" flexShrink={0}>
            <MessageActionsBar actions={messageActions} />
            <PromptInput debug={false} verbose={false} isLoading={session.isLoading} />
            <Box paddingLeft={1}>
              <SessionHeader />
            </Box>
          </Box>
        }
        overlay={
          <Box flexDirection="column">
            {permissionRequest && <PermissionPrompt request={permissionRequest} />}
            {questionRequest && <QuestionPrompt request={questionRequest} />}
          </Box>
        }
      />
      <ScrollHandler scrollRef={scrollRef} />
    </SessionProvider>
  )
}
