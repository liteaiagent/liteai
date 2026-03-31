import { createLiteaiClient } from "@liteai/sdk/client"
import { DialogProvider } from "@liteai/ui/context/dialog"
import { ChatContextProvider, ChatPane, PaneProviders, type PaneRoute, PromptProvider } from "@liteai/ui/panes"
import { createEffect, createSignal, ErrorBoundary, on, onCleanup, type ParentProps } from "solid-js"
import { render } from "solid-js/web"
import {
  createVscodeChatController,
  createVscodeSelectionController,
  createVscodeSessionController,
} from "./vscode-chat-controller"
import { vscodePlatform } from "./vscode-platform"
import { createSseSubscription } from "./vscode-sse"
import { createVscodeStore } from "./vscode-store"
import "./vscode.css"
import "@liteai/ui/styles/tailwind"

const DEFAULT_SERVER_URL = "http://127.0.0.1:9000"
const LOG_PREFIX = "[liteai-webview]"

function log(...args: unknown[]) {
  console.log(LOG_PREFIX, ...args)
}

function logError(...args: unknown[]) {
  console.error(LOG_PREFIX, ...args)
}

/** Reads injected globals from the host HTML <script> tag. */
function getInjectedConfig() {
  const w = window as unknown as Record<string, unknown>
  return {
    serverUrl: (w.LITEAI_SERVER_URL as string) || DEFAULT_SERVER_URL,
    workspaceDir: (w.LITEAI_WORKSPACE_DIR as string) || "",
  }
}

/** Wrapper that shows a header bar with connection status */
function PanelLayout(props: ParentProps<{ connected: boolean }>) {
  return (
    <div class="panel-root">
      <div class="panel-header">
        <div class="connection-status" title="LiteAI">
          <div class={`status-dot ${props.connected ? "status-connected" : "status-disconnected"}`} />
          <span class="status-label">LiteAI</span>
        </div>
      </div>
      <div class="panel-body">{props.children}</div>
    </div>
  )
}

function App() {
  const [route, setRoute] = createSignal<PaneRoute>({})
  const [connected, setConnected] = createSignal(false)

  const config = getInjectedConfig()
  const { serverUrl, workspaceDir } = config

  log("App initializing", { serverUrl, workspaceDir })

  // ─── SDK Client ────────────────────────────────────────────────────────────
  // Create an SDK client that routes all HTTP through the vscodePlatform.fetch
  // proxy, which sends postMessage to the Extension Host → Core HTTP API.
  const client = createLiteaiClient({
    baseUrl: serverUrl,
    fetch: vscodePlatform.fetch,
    throwOnError: false,
  })

  // ─── Store ─────────────────────────────────────────────────────────────────
  // Project ID is discovered during bootstrap via the API, not computed
  // upfront. toProjectID() requires a populated registry which is web-only.
  const store = createVscodeStore({
    directory: workspaceDir,
    projectID: "",
  })

  // ─── Bootstrap ─────────────────────────────────────────────────────────────
  const [bootstrapped, setBootstrapped] = createSignal(false)

  async function bootstrap() {
    try {
      log("Bootstrapping...")

      // Discover the project via API. If a workspace dir was injected,
      // find the matching project; otherwise use the first available one.
      const listRes = await client.project.list()
      const projects = listRes.data ?? []
      let projectID = ""

      if (projects.length > 0) {
        // Try to match by workspace directory first
        const match = workspaceDir ? projects.find((p) => p.worktree === workspaceDir) : undefined
        const chosen = match ?? projects[0]
        projectID = chosen.id
        store.setProject(chosen.worktree, chosen.id)
        log("Using project:", { id: chosen.id, worktree: chosen.worktree, matched: !!match })
      } else {
        log("No projects found — UI will mount in empty state")
      }

      // Load initial data
      if (projectID) {
        const [agentRes, sessionsRes, vcsRes] = await Promise.all([
          client.project.agent.list({ projectID }).catch(() => ({ data: undefined })),
          client.project.session.list({ projectID }).catch(() => ({ data: undefined })),
          client.project.vcs({ projectID }).catch(() => ({ data: undefined })),
        ])

        if (agentRes.data) {
          const agents = (agentRes.data as Array<{ name: string }>).filter((a) => !!a?.name)
          store.set("agent", agents as typeof store.store.agent)
        }

        if (sessionsRes.data) {
          const sessions = (sessionsRes.data as Array<{ id: string; time?: { archived?: number } }>)
            .filter((s) => !!s?.id && !s.time?.archived)
            .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
          store.set("session", sessions as typeof store.store.session)
        }

        if (vcsRes.data) store.set("vcs", vcsRes.data)

        store.setReady()
        setConnected(true)
        log("Bootstrap complete", {
          agents: store.store.agent.length,
          sessions: store.store.session.length,
        })
      } else {
        store.setReady()
      }
    } catch (err) {
      logError("Bootstrap failed:", err)
      store.setReady()
    } finally {
      setBootstrapped(true)
    }
  }

  void bootstrap()

  // ─── SSE Event Subscription ────────────────────────────────────────────────
  let cleanupSse: (() => void) | undefined

  createEffect(
    on(
      () => [store.store.projectID, bootstrapped()] as const,
      ([projectID, ready]) => {
        cleanupSse?.()
        cleanupSse = undefined

        if (!projectID || !ready || !vscodePlatform.fetch) return

        cleanupSse = createSseSubscription({
          fetch: vscodePlatform.fetch,
          serverUrl,
          projectID,
          store: store.store,
          set: store.set,
        })
        log("SSE subscription started for project:", projectID)
      },
    ),
  )

  onCleanup(() => {
    cleanupSse?.()
  })

  // ─── Controllers ───────────────────────────────────────────────────────────
  const chatController = createVscodeChatController({ store, client })
  const sessionController = createVscodeSessionController({ store, client })
  const selectionController = createVscodeSelectionController({ store, client })

  // ─── Submit / Abort Handler ────────────────────────────────────────────────
  const handler = {
    async submit(_event: Event) {
      const projectID = store.store.projectID
      if (!projectID) {
        logError("Cannot submit: no project")
        return
      }

      const model = selectionController.model.current()
      const agent = selectionController.agent.current()
      if (!model || !agent) {
        logError("Cannot submit: no model or agent selected")
        return
      }

      const sessionID = route()?.sessionID

      // The ChatPromptInput reads from usePrompt() and builds the prompt text.
      // The handler.submit is called after the prompt has been validated as non-empty.
      // We extract the text from the DOM because usePrompt() state is internal.
      const promptEl = document.querySelector('[role="textbox"][contenteditable]') as HTMLElement | null
      const text = promptEl?.innerText?.trim() ?? ""
      if (!text) return

      let targetSessionID = sessionID

      // Create a new session if we don't have one
      if (!targetSessionID) {
        try {
          const createRes = await client.project.session.create({ projectID })
          const created = createRes.data
          if (!created?.id) {
            logError("Failed to create session: no data returned")
            return
          }
          targetSessionID = created.id
          setRoute({ sessionID: targetSessionID, projectID })
          log("Created new session:", targetSessionID)
        } catch (err) {
          logError("Failed to create session:", err)
          return
        }
      }

      // Submit the prompt
      try {
        const partId = `part_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
        await client.project.session.promptAsync({
          sessionID: targetSessionID,
          projectID,
          agent: agent.name,
          model: {
            providerID: model.provider.id,
            modelID: model.id,
          },
          parts: [
            {
              type: "text" as const,
              id: partId,
              text,
            },
          ],
          variant: selectionController.model.variant.current(),
        })
        log("Prompt submitted to session:", targetSessionID)
      } catch (err) {
        logError("Failed to submit prompt:", err)
      }
    },

    abort() {
      const sessionID = route()?.sessionID
      const projectID = store.store.projectID
      if (!sessionID || !projectID) return

      void client.project.session.abort({ sessionID, projectID }).catch((err: unknown) => {
        logError("Failed to abort session:", err)
      })
    },
  }

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
          <PromptProvider>
            <ChatContextProvider chat={chatController} session={sessionController} selection={selectionController}>
              <PanelLayout connected={connected()}>
                <ChatPane
                  handler={handler}
                  onNavigateSession={(_projectID, sessionID) => {
                    setRoute({ sessionID, projectID: store.store.projectID })
                  }}
                />
              </PanelLayout>
            </ChatContextProvider>
          </PromptProvider>
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
