import { Box, useInput } from "@liteai/ink"
import { useEffect, useMemo, useRef, useState } from "react"
import { SessionLayout } from "../../components/session-layout"
import { useKeybind } from "../../context/keybind"
import { useSDK } from "../../context/sdk"
import { useSync } from "../../context/sync"
import { SessionProvider } from "./ctx"
import { SessionHeader } from "./header"
import { Messages } from "./messages"
import { PermissionPrompt } from "./permission"
import { QuestionPrompt } from "./question"
import { Sidebar } from "./sidebar"
import type { CustomSpeedScroll } from "./utils"

export function SessionRoute({ sessionID }: { sessionID: string }) {
  const sdk = useSDK()
  const sync = useSync()
  const keybind = useKeybind()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [showThinking, setShowThinking] = useState(true)
  const [showTimestamps, setShowTimestamps] = useState(false)
  const [showDetails, setShowDetails] = useState(true)
  const [showGenericToolOutput, setShowGenericToolOutput] = useState(false)

  const scrollRef = useRef<CustomSpeedScroll>(null)

  // Sync session on mount
  useEffect(() => {
    sync.session.sync(sessionID)
  }, [sessionID, sync.session])

  // Keybindings
  const config = sync.config // or useTuiConfig if available
  useInput((input, key) => {
    const k = { ...key, kind: "char", name: input, sequence: input, option: false, super: false } as any
    if (keybind.match("session_sidebar_toggle", k)) {
      setSidebarOpen((v) => !v)
    }
    if (keybind.match("session_thinking_toggle", k)) {
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
        width: 0,
        conceal: () => false,
        showThinking: () => showThinking,
        showTimestamps: () => showTimestamps,
        showDetails: () => showDetails,
        showGenericToolOutput: () => showGenericToolOutput,
        diffWrapMode: () => "none",
        sync,
        tui: config as any,
      }}
    >
      <Box flexDirection="row" width="100%" height="100%">
        <Box flexGrow={1} flexDirection="column">
          <SessionLayout
            scrollable={<Messages scrollRef={scrollRef} />}
            bottom={
              <Box paddingLeft={1}>
                <SessionHeader sessionID={sessionID} />
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
