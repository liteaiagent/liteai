import { AlternateScreen, Box, type Color, Text, useInput } from "@liteai/ink"
import { useEffect, useMemo, useSyncExternalStore } from "react"
import type { TuiConfig } from "../cli/config/tui"
import { GlobalExitHandler, useExitState } from "./components/global-exit-handler"
import { Logo } from "./components/logo"
import { PromptInput } from "./components/prompt/prompt-input"
import { Tips } from "./components/tips"
import { type Args, ArgsProvider } from "./context/args"
import { ExitProvider } from "./context/exit"
import { KVProvider } from "./context/kv"
import { LocalProvider } from "./context/local"
import { ModalPaneProvider } from "./context/modal-pane"
import { PromptRefProvider } from "./context/prompt"
import { RouteProvider, useRoute } from "./context/route"
import { type EventSource, SDKProvider } from "./context/sdk"
import { SessionProvider } from "./context/session"
import { ThemeProvider, useTheme } from "./context/theme"
import { ToastProvider, useToast } from "./context/toast"
import { TuiConfigProvider } from "./context/tui-config"
import { useIdleWindowTitle } from "./hooks/use-window-title"
import { KeybindingSetup } from "./keybindings/keybinding-setup"
import { SessionRoute } from "./routes/session"
import { useAppState } from "./state"
import { AppStateProvider } from "./state/app-state-context"
import { SessionTabStore } from "./state/session-tab-store"

export type AppProps = {
  url: string
  args: Args
  config: TuiConfig.Info
  directory?: string
  projectID?: string
  fetch?: typeof fetch
  headers?: RequestInit["headers"]
  events?: EventSource
}

/**
 * BlankSession — renders when no session exists yet (boot or after /clear).
 *
 * Shows a prompt input area with a logo and tips. When the user submits,
 * SessionProvider.ensureSession() creates a session and navigates to it,
 * which causes AppContent to render the full SessionRoute.
 */
function BlankSession() {
  const { theme } = useTheme()
  const exitState = useExitState()
  const directory = useAppState((s) => s.path.directory)
  const mcp = useAppState((s) => s.mcp)

  const folderName = useMemo(() => {
    const dir = directory || process.cwd()
    const parts = dir.replace(/\\/g, "/").split("/")
    return parts[parts.length - 1] || dir
  }, [directory])
  useIdleWindowTitle(folderName)

  const connectedMcpCount = useMemo(() => {
    return Object.values(mcp).filter((x) => x.status === "connected").length
  }, [mcp])

  const mcpError = useMemo(() => {
    return Object.values(mcp).some((x) => x.status === "failed")
  }, [mcp])

  return (
    <ModalPaneProvider>
      <Box flexDirection="column" height="100%" paddingX={2}>
        <Box flexGrow={1} flexDirection="column" alignItems="center" justifyContent="center">
          <Logo />
          <Box height={1} />
          <Box width="100%" maxWidth={80}>
            <PromptInput debug={false} verbose={false} isLoading={false} />
          </Box>
          <Box height={2} />
          <Tips />
        </Box>

        <Box
          flexDirection="row"
          justifyContent="space-between"
          paddingY={1}
          borderStyle="single"
          borderTop
          borderBottom={false}
          borderLeft={false}
          borderRight={false}
          borderColor={theme.backgroundElement as Color}
        >
          {exitState.pending ? (
            <Text dim italic>
              Press {exitState.keyName} again to exit
            </Text>
          ) : (
            <Box gap={2}>
              <Text color={theme.textMuted as Color}>{directory}</Text>
              {connectedMcpCount > 0 && (
                <Text color={theme.text as Color}>
                  <Text color={(mcpError ? theme.error : theme.success) as Color}>⊙ </Text>
                  {connectedMcpCount} MCP
                </Text>
              )}
            </Box>
          )}
        </Box>
      </Box>
    </ModalPaneProvider>
  )
}

function AppContent() {
  const route = useRoute()
  const toast = useToast()
  const { tabs, activeTabId } = useSyncExternalStore(SessionTabStore.subscribe, SessionTabStore.getSnapshot)

  useEffect(() => {
    if (route.data.sessionID) {
      const added = SessionTabStore.addTab(route.data.sessionID)
      if (!added) {
        toast.show({
          variant: "error",
          message: "Maximum tabs reached. Close a tab first (Ctrl+W).",
        })
      }
    }
  }, [route.data, toast])

  useInput((input, key) => {
    if (key.ctrl && input === "w") {
      SessionTabStore.closeActiveTab()
      const state = SessionTabStore.getSnapshot()
      if (state.activeTabId) {
        route.navigate({ type: "session", sessionID: state.activeTabId })
      } else {
        // Last tab closed — navigate to blank session (lazy creation on next submit)
        route.navigate({ type: "session" })
      }
      return
    }

    if (key.meta && input >= "1" && input <= "9") {
      const idx = parseInt(input, 10) - 1
      if (idx >= 0 && idx < tabs.length) {
        const targetId = tabs[idx]
        SessionTabStore.setActiveTab(targetId)
        route.navigate({ type: "session", sessionID: targetId })
      }
    }
  })

  // No session ID yet — show prompt with logo (session created lazily on first submit)
  if (!route.data.sessionID) {
    return <BlankSession />
  }

  return (
    <>
      {tabs.map((id) => (
        <Box key={id} display={id === activeTabId ? "flex" : "none"} width="100%" height="100%" flexDirection="column">
          <ModalPaneProvider>
            <SessionRoute sessionID={id} />
          </ModalPaneProvider>
        </Box>
      ))}
    </>
  )
}

export function App(props: AppProps) {
  return (
    <ExitProvider>
      <TuiConfigProvider config={props.config}>
        <KVProvider>
          <ThemeProvider mode="dark">
            <ToastProvider>
              <KeybindingSetup>
                <GlobalExitHandler>
                  <SDKProvider
                    url={props.url}
                    directory={props.directory}
                    projectID={props.projectID}
                    fetch={props.fetch}
                    headers={props.headers}
                    events={props.events}
                  >
                    <ArgsProvider {...props.args}>
                      <AppStateProvider>
                        <LocalProvider>
                          <RouteProvider>
                            <PromptRefProvider>
                              <SessionProvider>
                                <AlternateScreen>
                                  <AppContent />
                                </AlternateScreen>
                              </SessionProvider>
                            </PromptRefProvider>
                          </RouteProvider>
                        </LocalProvider>
                      </AppStateProvider>
                    </ArgsProvider>
                  </SDKProvider>
                </GlobalExitHandler>
              </KeybindingSetup>
            </ToastProvider>
          </ThemeProvider>
        </KVProvider>
      </TuiConfigProvider>
    </ExitProvider>
  )
}
