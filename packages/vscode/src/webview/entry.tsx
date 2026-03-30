import { DialogProvider } from "@liteai/ui/context/dialog"
import { ChatContextProvider, ChatPane, PaneProviders, type PaneRoute } from "@liteai/ui/panes"
import { createSignal, ErrorBoundary, type ParentProps } from "solid-js"
import { render } from "solid-js/web"
import { createVscodeChatController, createVscodeSessionController } from "./vscode-chat-controller"
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

/** Wrapper that shows a header bar with connection status */
function PanelLayout(props: ParentProps) {
  return (
    <div class="panel-root">
      <div class="panel-header">
        <div class="connection-status" title="LiteAI">
          <div class="status-dot status-connected" />
          <span class="status-label">LiteAI</span>
        </div>
      </div>
      <div class="panel-body">{props.children}</div>
    </div>
  )
}

function App() {
  const [route, _setRoute] = createSignal<PaneRoute>({})

  // url injected synchronously from the host via <script> tag
  const injectedUrl = (window as unknown as Record<string, unknown>).LITEAI_SERVER_URL as string | undefined
  const serverUrl = injectedUrl || DEFAULT_SERVER_URL

  log("App initializing", {
    injectedUrl,
    serverUrl,
    hasWindow: typeof window !== "undefined",
    documentReady: document.readyState,
  })

  // Create VSCode-specific controllers (Phase 1 stubs)
  const chatController = createVscodeChatController({ serverUrl })
  const sessionController = createVscodeSessionController({ serverUrl })

  return (
    <ErrorBoundary
      fallback={(err) => {
        logError("ErrorBoundary caught:", err)
        return (
          <div class="error-screen">
            <div class="error-title">LiteAI Error</div>
            <pre class="error-body">{err.stack || err.toString()}</pre>
          </div>
        )
      }}
    >
      <PaneProviders platform={vscodePlatform} route={route}>
        <DialogProvider>
          <ChatContextProvider chat={chatController} session={sessionController}>
            <PanelLayout>
              <ChatPane handler={{ submit: () => {}, abort: () => {} }} />
            </PanelLayout>
          </ChatContextProvider>
        </DialogProvider>
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
