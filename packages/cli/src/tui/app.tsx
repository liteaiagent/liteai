import { AlternateScreen } from "@liteai/ink"
import type { TuiConfig } from "../cli/config/tui"
import { type Args, ArgsProvider } from "./context/args"
import { DialogProvider } from "./context/dialog"
import { ExitProvider } from "./context/exit"
import { KeybindProvider } from "./context/keybind"
import { KVProvider } from "./context/kv"
import { LocalProvider } from "./context/local"
import { RouteProvider, useRoute } from "./context/route"
import { type EventSource, SDKProvider } from "./context/sdk"
import { SessionProvider } from "./context/session"
import { SyncProvider } from "./context/sync"
import { ThemeProvider } from "./context/theme"
import { ToastProvider } from "./context/toast"
import { TuiConfigProvider } from "./context/tui-config"
import { HomeRoute } from "./routes/home"
import { SessionRoute } from "./routes/session"

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
            <KeybindProvider>
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
                    <SyncProvider>
                      <LocalProvider>
                        <DialogProvider>
                          <RouteProvider>
                            <SessionProvider>
                              <AlternateScreen>
                                <AppContent />
                              </AlternateScreen>
                            </SessionProvider>
                          </RouteProvider>
                        </DialogProvider>
                      </LocalProvider>
                    </SyncProvider>
                  </ToastProvider>
                </ArgsProvider>
              </SDKProvider>
            </KeybindProvider>
          </ThemeProvider>
        </KVProvider>
      </TuiConfigProvider>
    </ExitProvider>
  )
}
