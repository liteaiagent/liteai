import { AlternateScreen } from "@liteai/ink"
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
import { ToastProvider } from "./context/toast"
import { TuiConfigProvider } from "./context/tui-config"
import { KeybindingSetup } from "./keybindings/keybinding-setup"
import { HomeRoute } from "./routes/home"
import { SessionRoute } from "./routes/session"
import { AppStateProvider } from "./state/app-state-context"

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

  switch (route.data.type) {
    case "home":
      return <HomeRoute workspaceID={route.data.workspaceID ?? "default"} />
    case "session":
      return <SessionRoute sessionID={route.data.sessionID} />
    default:
      return null
  }
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
