import { createLiteaiClient } from "@liteai/sdk/client"
import { DataProvider } from "@liteai/ui/context"
import { DialogProvider } from "@liteai/ui/context/dialog"
import { FileComponentProvider } from "@liteai/ui/context/file"
import { MarkedProvider } from "@liteai/ui/context/marked"
import { File } from "@liteai/ui/file"
import {
  ChatContextProvider,
  ChatPane,
  type ChatPromptCommands,
  PaneProviders,
  type PaneRoute,
  PromptProvider,
} from "@liteai/ui/panes"
import { createEffect, createSignal, ErrorBoundary, on, onCleanup, type ParentProps } from "solid-js"
import { render } from "solid-js/web"
import {
  createVscodeChatController,
  createVscodePermissionController,
  createVscodeSelectionController,
  createVscodeSessionController,
} from "./vscode-chat-controller"
import { vscodePlatform, vscodePlatformPostMessage } from "./vscode-platform"
import { createSseSubscription } from "./vscode-sse"
import { createVscodeStore } from "./vscode-store"
import { VscodeComposerDocks } from "./vscode-composer-docks"
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

// ─── Identifier ────────────────────────────────────────────────────────────────
// Mirrors packages/web/src/utils/id.ts — generates sortable IDs with the
// correct prefix required by the Core API (prt_, msg_, ses_, etc.).

const ID_PREFIXES = { session: "ses", message: "msg", part: "prt" } as const
type IdPrefix = keyof typeof ID_PREFIXES

let _lastTs = 0
let _counter = 0

function ascendingID(prefix: IdPrefix): string {
  const now = Date.now()
  if (now !== _lastTs) { _lastTs = now; _counter = 0 }
  _counter += 1
  let ts = BigInt(now) * BigInt(0x1000) + BigInt(_counter)
  const bytes = new Uint8Array(6)
  for (let i = 0; i < 6; i++) bytes[i] = Number((ts >> BigInt(40 - 8 * i)) & BigInt(0xff))
  const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("")
  const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
  const rnd = crypto.getRandomValues(new Uint8Array(14))
  const suffix = Array.from(rnd).map((b) => chars[b % 62]).join("")
  return `${ID_PREFIXES[prefix]}_${hex}${suffix}`
}

/** Reads injected globals from the host HTML <script> tag. */
function getInjectedConfig() {
  const w = window as unknown as Record<string, unknown>
  return {
    serverUrl: (w.LITEAI_SERVER_URL as string) || DEFAULT_SERVER_URL,
    workspaceDir: (w.LITEAI_WORKSPACE_DIR as string) || "",
  }
}

// ─── Platform keybind helper ───────────────────────────────────────────────────
// Provides human-readable keybind strings appropriate for the current platform.
// On macOS, "mod" → "⌘"; on Windows/Linux, "mod" → "Ctrl".

const IS_MAC =
  typeof navigator !== "undefined" &&
  (navigator.platform.toLowerCase().startsWith("mac") || navigator.userAgent.toLowerCase().includes("mac os"))

const MOD = IS_MAC ? "⌘" : "Ctrl"

/** Static map of keybind IDs used by ChatPromptInput tooltips to display strings. */
const KEYBIND_MAP: Record<string, string> = {
  "prompt.mode.shell": `${MOD}+Shift+X`,
  "prompt.mode.normal": `${MOD}+Shift+E`,
  "file.attach": `${MOD}+U`,
}

function resolveKeybind(id: string): string {
  return KEYBIND_MAP[id] ?? ""
}

// ─── Wrapper layout ───────────────────────────────────────────────────────────

/** Main layout wrapper */
function PanelLayout(props: ParentProps) {
  return (
    <div class="panel-root">
      <div class="panel-body">{props.children}</div>
    </div>
  )
}

function App() {
  const [route, setRoute] = createSignal<PaneRoute>({})
  const [connected, setConnected] = createSignal(false)

  // Recent files pushed from the extension host via postMessage
  const [recentFiles, setRecentFiles] = createSignal<string[]>([])

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

  // ─── Recent files from extension host ────────────────────────────────────
  // The WebviewBridge sends { type: "recent-files", files: [...] } on init
  // and whenever visible editors change.
  const handleWindowMessage = (event: MessageEvent) => {
    const msg = event.data as Record<string, unknown>
    if (msg?.type === "recent-files" && Array.isArray(msg.files)) {
      setRecentFiles(msg.files as string[])
    } else if (msg?.type === "new-session") {
      setRoute({ projectID: store.store.projectID })
    }
  }
  window.addEventListener("message", handleWindowMessage)

  onCleanup(() => {
    cleanupSse?.()
    window.removeEventListener("message", handleWindowMessage)
  })

  // ─── Controllers ───────────────────────────────────────────────────────────
  const chatController = createVscodeChatController({ store, client })
  const sessionController = createVscodeSessionController({ store, client })
  const selectionController = createVscodeSelectionController({ store, client })
  const permissionController = createVscodePermissionController()

  // ─── Submit / Abort Handler ────────────────────────────────────────────────
  const handler = {
    async submit(_event: Event) {
      const projectID = store.store.projectID
      log("submit() called — projectID:", projectID || "(empty)")

      if (!projectID) {
        logError("Cannot submit: no project ID in store")
        return
      }

      const model = selectionController.model.current()
      const agent = selectionController.agent.current()
      log("submit() — model:", model?.id, "provider:", model?.provider?.id, "agent:", agent?.name)

      if (!model || !agent) {
        logError("Cannot submit: no model or agent selected", { model, agent })
        return
      }

      const sessionID = route()?.sessionID
      log("submit() — existing sessionID:", sessionID || "(none)")

      // The ChatPromptInput reads from usePrompt() and builds the prompt text.
      // The handler.submit is called after the prompt has been validated as non-empty.
      // We extract the text from the DOM because usePrompt() state is internal.
      const promptEl = document.querySelector('[role="textbox"][contenteditable]') as HTMLElement | null
      const text = promptEl?.innerText?.trim() ?? ""
      log("submit() — extracted text:", JSON.stringify(text))
      if (!text) {
        logError("submit() — text is empty, aborting")
        return
      }

      let targetSessionID = sessionID

      // Create a new session if we don't have one
      if (!targetSessionID) {
        try {
          log("submit() — creating new session for projectID:", projectID)
          const createRes = await client.project.session.create({ projectID })
          log("submit() — session.create raw response:", {
            data: createRes.data,
            error: createRes.error,
            response: createRes.response?.status,
          })
          const created = createRes.data
          if (!created?.id) {
            logError("Failed to create session: no data returned. Full response:", {
              data: createRes.data,
              error: createRes.error,
              status: createRes.response?.status,
            })
            return
          }
          targetSessionID = created.id
          setRoute({ sessionID: targetSessionID, projectID })
          log("Created new session:", targetSessionID)
        } catch (err) {
          logError("Failed to create session (exception):", err)
          return
        }
      }

      // Submit the prompt — mirrors web's sendFollowupDraft pattern
      try {
        const messageID = ascendingID("message")
        const partID = ascendingID("part")
        log("submit() — calling promptAsync on session:", targetSessionID, "text:", JSON.stringify(text))
        const promptRes = await client.project.session.promptAsync({
          sessionID: targetSessionID,
          projectID,
          agent: agent.name,
          model: {
            providerID: model.provider.id,
            modelID: model.id,
          },
          messageID,
          parts: [
            {
              id: partID,
              type: "text" as const,
              text,
            },
          ],
          variant: selectionController.model.variant.current(),
        })
        log("submit() — promptAsync response:", {
          data: promptRes.data,
          error: promptRes.error,
          status: promptRes.response?.status,
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

  // ─── File Search ───────────────────────────────────────────────────────────
  // Sends a `search-files` postMessage to the extension host's WebviewBridge,
  // which runs `vscode.workspace.findFiles()` and returns matching file paths.
  const searchFiles = async (query: string): Promise<string[]> => {
    return new Promise((resolve) => {
      const id = `sf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

      const handleResponse = (event: MessageEvent) => {
        const msg = event.data as Record<string, unknown>
        if (msg?.type === "search-files-response" && msg.id === id) {
          window.removeEventListener("message", handleResponse)
          resolve(Array.isArray(msg.files) ? (msg.files as string[]) : [])
        }
      }

      window.addEventListener("message", handleResponse)

      // Timeout safety — return empty array if extension host does not respond
      const timeout = setTimeout(() => {
        window.removeEventListener("message", handleResponse)
        resolve([])
      }, 3000)

      try {
        vscodePlatformPostMessage({ type: "search-files", id, query })
      } catch {
        clearTimeout(timeout)
        window.removeEventListener("message", handleResponse)
        resolve([])
      }
    })
  }

  // ─── Commands ─────────────────────────────────────────────────────────────
  // Minimal command registry for VS Code. No external command palette is wired
  // yet — this stub allows command registration and keybind display to work
  // without throwing. Lays the foundation for future MCP command support.

  type CommandCb = () => ChatPromptCommands["options"]
  const commandEntries: Array<{ key: string | undefined; cb: CommandCb }> = []
  const [commandOptions, setCommandOptions] = createSignal<ChatPromptCommands["options"]>([])

  const refreshCommandOptions = () => {
    const allOptions: ChatPromptCommands["options"] = []
    for (const entry of commandEntries) {
      allOptions.push(...entry.cb())
    }
    setCommandOptions(allOptions)
  }

  const commands: ChatPromptCommands = {
    register(
      keyOrCb: string | CommandCb,
      cb?: CommandCb,
    ) {
      if (typeof keyOrCb === "function") {
        commandEntries.push({ key: undefined, cb: keyOrCb })
      } else if (cb) {
        commandEntries.push({ key: keyOrCb, cb })
      }
      refreshCommandOptions()
    },

    keybind(id: string): string {
      return resolveKeybind(id)
    },

    trigger(id: string, source?: string): void {
      // Invoke matching command option's onSelect
      const option = commandOptions().find((o) => o.id === id)
      option?.onSelect?.(source)
    },

    get options() {
      return commandOptions()
    },
  }

  // ─── Model management callbacks ────────────────────────────────────────────
  // These notify the extension host to open VS Code settings panels.

  const onManageModels = () => {
    vscodePlatformPostMessage({ type: "vscode-command", command: "manageModels" })
  }

  const onConnectProvider = () => {
    vscodePlatformPostMessage({ type: "vscode-command", command: "connectProvider" })
  }

  // ─── shouldQueue ──────────────────────────────────────────────────────────
  // Return true while the session is actively running so the UI shows a
  // "queue" affordance instead of immediately submitting.

  const shouldQueue = (): boolean => {
    const id = route()?.sessionID
    if (!id) return false
    return chatController.sessionStatus(id).type !== "idle"
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
        <MarkedProvider>
          <FileComponentProvider component={File}>
            <DataProvider
              data={{
                session: store.store.session,
                session_status: store.store.session_status,
                session_diff: {},
                message: store.store.message,
                part: store.store.part,
              }}
              directory={store.store.directory}
              onNavigateToSession={(sessionID: string) => {
                setRoute({ sessionID, projectID: store.store.projectID })
              }}
              onSessionHref={(sessionID: string) => sessionID}
            >
              <DialogProvider>
                <PromptProvider>
                  <ChatContextProvider
                    chat={chatController}
                    session={sessionController}
                    selection={selectionController}
                    permission={permissionController}
                  >
                    <PanelLayout>
                      <ChatPane
                        handler={handler}
                        onNavigateSession={(_projectID, sessionID) => {
                          setRoute({ sessionID, projectID: store.store.projectID })
                        }}
                        searchFiles={searchFiles}
                        recentFiles={recentFiles}
                        keybind={resolveKeybind}
                        commands={commands}
                        onManageModels={onManageModels}
                        onConnectProvider={onConnectProvider}
                        shouldQueue={shouldQueue}
                        onAbort={handler.abort}
                        promptDocks={
                          <VscodeComposerDocks
                            store={store}
                            client={client}
                            projectID={store.store.projectID}
                            sessionID={route()?.sessionID}
                          />
                        }
                      />
                    </PanelLayout>
                  </ChatContextProvider>
                </PromptProvider>
              </DialogProvider>
            </DataProvider>
          </FileComponentProvider>
        </MarkedProvider>
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
