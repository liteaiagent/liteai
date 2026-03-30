import { ChatPane, PaneProviders, type PaneRoute, ServerConnection, SDKProvider, SyncProvider } from "@liteai/ui/panes"
import { createSignal, ErrorBoundary } from "solid-js"
import { render } from "solid-js/web"
import { vscodePlatform } from "./vscode-platform"
import "./vscode.css"
import "@liteai/ui/styles"

function App() {
  const [route, setRoute] = createSignal<PaneRoute>({})
  
  // url injected synchronously from the host via <script> tag
  const injectedUrl = (window as any).LITEAI_SERVER_URL
  const serverUrl = injectedUrl || "http://127.0.0.1:0" // safe dummy URL for disconnected state

  return (
    <ErrorBoundary fallback={(err) => <div class="bg-red-950 text-red-400 p-6 h-screen font-mono text-sm whitespace-pre-wrap overflow-auto">Fatal Crash:\n\n{err.stack || err.toString()}</div>}>
      <PaneProviders 
        platform={vscodePlatform} 
        route={route} 
        server={ServerConnection.Key.make(serverUrl)}
        servers={[{ type: "http", http: { url: serverUrl } }]}
      >
        <SDKProvider projectID={() => route()?.projectID || ""} directory={() => route()?.projectID || ""}>
          <SyncProvider>
            <div class="h-screen w-full bg-app text-app overscroll-none">
              <ChatPane handler={{ submit: () => {}, abort: () => {} }} />
            </div>
          </SyncProvider>
        </SDKProvider>
      </PaneProviders>
    </ErrorBoundary>
  )
}

const root = document.getElementById("root")
if (root) {
  render(() => <App />, root)
}
