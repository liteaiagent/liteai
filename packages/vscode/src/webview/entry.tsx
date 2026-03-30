import { ChatPane, PaneProviders, type PaneRoute, ServerConnection, useServer } from "@liteai/ui/panes"
import { createSignal, ErrorBoundary, type ParentProps, Show } from "solid-js"
import { render } from "solid-js/web"
import { vscodePlatform } from "./vscode-platform"
import "./vscode.css"
import "@liteai/ui/styles"

const DEFAULT_SERVER_URL = "http://127.0.0.1:9000"
const LOG_PREFIX = "[liteai-webview]"

function log(...args: unknown[]) {
  console.log(LOG_PREFIX, ...args)
}

function logError(...args: unknown[]) {
  console.error(LOG_PREFIX, ...args)
}

/** Connection status dot shown in the panel header */
function ConnectionStatus() {
  const server = useServer()

  return (
    <div class="connection-status" title={`Server: ${server.name || server.key}`}>
      <div
        classList={{
          "status-dot": true,
          "status-connected": server.healthy() === true,
          "status-disconnected": server.healthy() === false,
          "status-unknown": server.healthy() === undefined,
        }}
      />
      <span class="status-label">
        {server.healthy() === true ? "Connected" : server.healthy() === false ? "Disconnected" : "Connecting..."}
      </span>
    </div>
  )
}

/** Wrapper that shows a header bar with connection status */
function PanelLayout(props: ParentProps) {
  return (
    <div class="panel-root">
      <div class="panel-header">
        <ConnectionStatus />
      </div>
      <div class="panel-body">
        {props.children}
      </div>
    </div>
  )
}

function App() {
  const [route, _setRoute] = createSignal<PaneRoute>({})
  
  // url injected synchronously from the host via <script> tag
  const injectedUrl = (window as any).LITEAI_SERVER_URL
  const serverUrl = injectedUrl || DEFAULT_SERVER_URL

  log("App initializing", {
    injectedUrl,
    serverUrl,
    hasWindow: typeof window !== "undefined",
    documentReady: document.readyState,
  })

  return (
    <ErrorBoundary fallback={(err) => {
      logError("ErrorBoundary caught:", err)
      return (
        <div class="error-screen">
          <div class="error-title">LiteAI Error</div>
          <pre class="error-body">{err.stack || err.toString()}</pre>
        </div>
      )
    }}>
      <PaneProviders 
        platform={vscodePlatform} 
        route={route} 
        server={ServerConnection.Key.make(serverUrl)}
        servers={[{ type: "http", http: { url: serverUrl } }]}
      >
        <PanelLayout>
          <ChatPane handler={{ submit: () => {}, abort: () => {} }} />
        </PanelLayout>
      </PaneProviders>
    </ErrorBoundary>
  )
}

log("Module loaded, mounting app")
const root = document.getElementById("root")
if (root) {
  log("Root element found, rendering")
  render(() => <App />, root)
  log("render() called")
} else {
  logError("Root element #root not found!")
}
