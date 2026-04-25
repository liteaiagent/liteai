import { KeybindProvider } from "./context/keybind"
import { LocalProvider } from "./context/local"
import { RouteProvider, useRoute } from "./context/route"
import { type EventSource, SDKProvider } from "./context/sdk"
import { SyncProvider } from "./context/sync"
import { ThemeProvider } from "./context/theme"
import { HomeRoute } from "./routes/home"
import { SessionRoute } from "./routes/session"

export type AppProps = {
  url: string
  args: Record<string, unknown>
  config: Record<string, unknown>
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
          <SyncProvider>
            <LocalProvider>
              <RouteProvider>
                <AppContent />
              </RouteProvider>
            </LocalProvider>
          </SyncProvider>
        </SDKProvider>
      </KeybindProvider>
    </ThemeProvider>
  )
}
