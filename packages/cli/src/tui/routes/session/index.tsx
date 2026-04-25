import { Box, type ScrollBoxHandle, TerminalSizeContext, useInput } from "@liteai/ink"
import { useContext, useEffect, useMemo, useRef, useState } from "react"
import { SessionLayout } from "../../components/session-layout"
import { useKeybind } from "../../context/keybind"
import { useSync } from "../../context/sync"
import { SessionProvider } from "./ctx"
import { SessionHeader } from "./header"
import { Messages } from "./messages"
import { PermissionPrompt } from "./permission"
import { QuestionPrompt } from "./question"
import { Sidebar } from "./sidebar"

export function SessionRoute({ sessionID }: { sessionID: string }) {
  const sync = useSync()
  const keybind = useKeybind()
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

  // Keybindings — use event.keypress (ParsedKey) directly instead of fabricating one
  useInput((_input, _key, event) => {
    if (!event) return
    if (keybind.match("session_sidebar_toggle", event.keypress)) {
      setSidebarOpen((v) => !v)
    }
    if (keybind.match("session_thinking_toggle", event.keypress)) {
      setShowThinking((v) => !v)
    }
  })

  const permissionRequest = useMemo(() => {
    return (sync.permission[sessionID] ?? [])[0]
  }, [sync.permission, sessionID])

  const questionRequest = useMemo(() => {
    return (sync.question[sessionID] ?? [])[0]
  }, [sync.question, sessionID])

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
      <Box flexDirection="row" width="100%" height="100%">
        <Box flexGrow={1} flexDirection="column">
          <SessionLayout
            scrollable={<Messages scrollRef={scrollRef} />}
            bottom={
              <Box paddingLeft={1}>
                <SessionHeader />
              </Box>
            }
            overlay={
              <Box flexDirection="column">
                {permissionRequest && <PermissionPrompt request={permissionRequest} />}
                {questionRequest && <QuestionPrompt request={questionRequest} />}
              </Box>
            }
          />
        </Box>
        {sidebarOpen && <Sidebar sessionID={sessionID} />}
      </Box>
    </SessionProvider>
  )
}
