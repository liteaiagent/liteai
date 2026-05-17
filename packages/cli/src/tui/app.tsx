import { AlternateScreen, Box, useInput } from "@liteai/ink"
import { useCallback, useEffect, useSyncExternalStore } from "react"
import type { TuiConfig } from "../cli/config/tui"
import { GlobalExitHandler } from "./components/global-exit-handler"
import { clear as clearMessageQueue, getSnapshot as getQueueSnapshot } from "./stores/message-queue-store"
import { type Args, ArgsProvider } from "./context/args"
import { ExitProvider } from "./context/exit"
import { KVProvider } from "./context/kv"
import { LocalProvider } from "./context/local"
import { ModalPaneProvider } from "./context/modal-pane"
import { PromptRefProvider } from "./context/prompt"
import { RouteProvider, useRoute } from "./context/route"
import { type EventSource, SDKProvider } from "./context/sdk"
import { SessionProvider } from "./context/session"
import { ThemeProvider } from "./context/theme"
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
 * AppContent — renders the active session(s) or the boot state.
 *
 * Both the boot state (no session yet) and the active session state render through
 * the same `SessionRoute` component. The distinction is structural:
 * - No session: single `SessionRoute` with no sessionID, wrapped in its own `ModalPaneProvider`
 * - Active session(s): tab set of `SessionRoute` instances, each with its own `ModalPaneProvider`
 *
 * The remaining `if (!route.data.sessionID)` branch governs tab-wrapping only,
 * not which component renders.
 */
function AppContent() {
  const route = useRoute()
  const toast = useToast()
  const directory = useAppState((s) => s.path.directory)
  const { tabs, activeTabId } = useSyncExternalStore(SessionTabStore.subscribe, SessionTabStore.getSnapshot)

  // Update terminal title with folder name during boot (no active session yet)
  useIdleWindowTitle(
    (() => {
      const dir = directory || process.cwd()
      const parts = dir.replace(/\\/g, "/").split("/")
      return parts[parts.length - 1] || dir
    })(),
  )

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
        // Last tab closed — navigate to boot state (lazy session creation on next submit)
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

  // Boot state: no session yet — single SessionRoute with undefined sessionID.
  // SessionRoute renders Logo + Tips when messages.length === 0.
  if (!route.data.sessionID) {
    return (
      <ModalPaneProvider>
        <SessionRoute />
      </ModalPaneProvider>
    )
  }

  // Active session(s): tab set — each tab has its own isolated ModalPaneProvider.
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
  // ── Ctrl+C queue intercept ──────────────────────────────────────────────
  // When Ctrl+C fires and messages are queued, clear the queue and consume
  // the keypress — preventing the double-press exit flow from triggering.
  // This makes the "Ctrl+C to clear" label in QueuedMessageDisplay truthful.
  const handleInterrupt = useCallback((): boolean => {
    const queued = getQueueSnapshot()
    if (queued.length > 0) {
      clearMessageQueue()
      return true // consumed — do not enter double-press exit flow
    }
    return false // not consumed — fall through to double-press exit
  }, [])

  return (
    <ExitProvider>
      <TuiConfigProvider config={props.config}>
        <KVProvider>
          <ThemeProvider mode="dark">
            <ToastProvider>
              <KeybindingSetup>
                <GlobalExitHandler onInterrupt={handleInterrupt}>
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
