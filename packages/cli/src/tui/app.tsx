import { AlternateScreen, Box, useInput } from "@liteai/ink"
import { useEffect, useSyncExternalStore } from "react"
import type { TuiConfig } from "../cli/config/tui"
import { GlobalExitHandler } from "./components/global-exit-handler"
import { type Args, ArgsProvider } from "./context/args"
import { DialogProvider } from "./context/dialog"
import { ExitProvider } from "./context/exit"
import { KVProvider } from "./context/kv"
import { LocalProvider } from "./context/local"
import { PromptRefProvider } from "./context/prompt"
import { RouteProvider, useRoute } from "./context/route"
import { type EventSource, SDKProvider } from "./context/sdk"
import { SessionProvider } from "./context/session"
import { ThemeProvider } from "./context/theme"
import { ToastProvider, useToast } from "./context/toast"
import { TuiConfigProvider } from "./context/tui-config"
import { KeybindingSetup } from "./keybindings/keybinding-setup"
import { HomeRoute } from "./routes/home"
import { SessionRoute } from "./routes/session"
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

function AppContent() {
  const route = useRoute()
  const toast = useToast()
  const { tabs, activeTabId } = useSyncExternalStore(SessionTabStore.subscribe, SessionTabStore.getSnapshot)

  useEffect(() => {
    if (route.data.type === "session") {
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
        route.navigate({ type: "home" })
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

  if (route.data.type === "home") {
    return <HomeRoute workspaceID={route.data.workspaceID ?? "default"} />
  }

  return (
    <>
      {tabs.map((id) => (
        <Box key={id} display={id === activeTabId ? "flex" : "none"} width="100%" height="100%" flexDirection="column">
          <SessionRoute sessionID={id} />
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
                    <ToastProvider>
                      <AppStateProvider>
                        <LocalProvider>
                          <RouteProvider>
                            <DialogProvider>
                              <PromptRefProvider>
                                <SessionProvider>
                                  <AlternateScreen>
                                    <AppContent />
                                  </AlternateScreen>
                                </SessionProvider>
                              </PromptRefProvider>
                            </DialogProvider>
                          </RouteProvider>
                        </LocalProvider>
                      </AppStateProvider>
                    </ToastProvider>
                  </ArgsProvider>
                </SDKProvider>
              </GlobalExitHandler>
            </KeybindingSetup>
          </ThemeProvider>
        </KVProvider>
      </TuiConfigProvider>
    </ExitProvider>
  )
}
