import type { Snapshot } from "@liteai/core/snapshot/index"
import { Log } from "@liteai/core/util/log"
import type {
  Agent,
  Command,
  Config,
  FormatterStatus,
  LspStatus,
  McpResource,
  McpStatus,
  Message,
  Part,
  PermissionRequest,
  ProviderAuthMethod,
  ProviderListResponse,
  QuestionRequest,
  Session,
  SessionStatus,
  Todo,
  VcsInfo,
  Workspace,
} from "@liteai/sdk"
import { Binary } from "@liteai/util/binary"
import { useSDK } from "@tui/context/sdk"
import { batch, onMount } from "solid-js"
import { createStore, produce, reconcile } from "solid-js/store"
import { useArgs } from "./args"
import { useExit } from "./exit"
import { createSimpleContext } from "./helper"

export const { use: useSync, provider: SyncProvider } = createSimpleContext({
  name: "Sync",
  init: () => {
    const [store, setStore] = createStore<{
      status: "loading" | "partial" | "complete"
      provider: ProviderListResponse["all"]
      provider_default: Record<string, string>
      provider_next: ProviderListResponse
      provider_auth: Record<string, ProviderAuthMethod[]>
      agent: Agent[]
      command: Command[]
      permission: {
        [sessionID: string]: PermissionRequest[]
      }
      question: {
        [sessionID: string]: QuestionRequest[]
      }
      config: Config
      session: Session[]
      session_status: {
        [sessionID: string]: SessionStatus
      }
      session_diff: {
        [sessionID: string]: Snapshot.FileDiff[]
      }
      todo: {
        [sessionID: string]: Todo[]
      }
      message: {
        [sessionID: string]: Message[]
      }
      part: {
        [messageID: string]: Part[]
      }
      lsp: LspStatus[]
      mcp: {
        [key: string]: McpStatus
      }
      mcp_resource: {
        [key: string]: McpResource
      }
      formatter: FormatterStatus[]
      vcs: VcsInfo | undefined
      path: { home: string; state: string; config: string; worktree: string; directory: string }
      workspaceList: Workspace[]
    }>({
      provider_next: {
        all: [],
        default: {},
        connected: [],
      },
      provider_auth: {},
      config: {},
      status: "loading",
      agent: [],
      permission: {},
      question: {},
      command: [],
      provider: [],
      provider_default: {},
      session: [],
      session_status: {},
      session_diff: {},
      todo: {},
      message: {},
      part: {},
      lsp: [],
      mcp: {},
      mcp_resource: {},
      formatter: [],
      vcs: undefined,
      path: { home: "", state: "", config: "", worktree: "", directory: "" },
      workspaceList: [],
    })

    const sdk = useSDK()

    async function syncWorkspaces() {
      const result = await sdk.client.project.experimental.workspace
        .list({ projectID: sdk.projectID })
        .catch(() => undefined)
      if (!result?.data) return
      setStore("workspaceList", reconcile(result.data))
    }

    sdk.event.listen((e) => {
      const event = e.details
      switch (event.type) {
        case "server.instance.disposed":
          bootstrap()
          break
        case "permission.replied": {
          const requests = store.permission[event.properties.sessionID]
          if (!requests) break
          const match = Binary.search(requests, event.properties.requestID, (r) => r.id)
          if (!match.found) break
          setStore(
            "permission",
            event.properties.sessionID,
            produce((draft) => {
              draft.splice(match.index, 1)
            }),
          )
          break
        }

        case "permission.asked": {
          const request = event.properties
          const requests = store.permission[request.sessionID]
          if (!requests) {
            setStore("permission", request.sessionID, [request])
            break
          }
          const match = Binary.search(requests, request.id, (r) => r.id)
          if (match.found) {
            setStore("permission", request.sessionID, match.index, reconcile(request))
            break
          }
          setStore(
            "permission",
            request.sessionID,
            produce((draft) => {
              draft.splice(match.index, 0, request)
            }),
          )
          break
        }

        case "question.replied":
        case "question.rejected": {
          const requests = store.question[event.properties.sessionID]
          if (!requests) break
          const match = Binary.search(requests, event.properties.requestID, (r) => r.id)
          if (!match.found) break
          setStore(
            "question",
            event.properties.sessionID,
            produce((draft) => {
              draft.splice(match.index, 1)
            }),
          )
          break
        }

        case "question.asked": {
          const request = event.properties
          const requests = store.question[request.sessionID]
          if (!requests) {
            setStore("question", request.sessionID, [request])
            break
          }
          const match = Binary.search(requests, request.id, (r) => r.id)
          if (match.found) {
            setStore("question", request.sessionID, match.index, reconcile(request))
            break
          }
          setStore(
            "question",
            request.sessionID,
            produce((draft) => {
              draft.splice(match.index, 0, request)
            }),
          )
          break
        }

        case "todo.updated":
          setStore("todo", event.properties.sessionID, event.properties.todos)
          break

        case "session.diff":
          setStore("session_diff", event.properties.sessionID, event.properties.diff)
          break

        case "session.deleted": {
          const result = Binary.search(store.session, event.properties.info.id, (s) => s.id)
          if (result.found) {
            setStore(
              "session",
              produce((draft) => {
                draft.splice(result.index, 1)
              }),
            )
          }
          break
        }
        case "session.updated": {
          const result = Binary.search(store.session, event.properties.info.id, (s) => s.id)
          if (result.found) {
            setStore("session", result.index, reconcile(event.properties.info))
            break
          }
          setStore(
            "session",
            produce((draft) => {
              draft.splice(result.index, 0, event.properties.info)
            }),
          )
          break
        }

        case "session.status": {
          setStore("session_status", event.properties.sessionID, event.properties.status)
          break
        }

        case "message.updated": {
          const messages = store.message[event.properties.info.sessionID]
          if (!messages) {
            setStore("message", event.properties.info.sessionID, [event.properties.info])
            break
          }
          const result = Binary.search(messages, event.properties.info.id, (m) => m.id)
          if (result.found) {
            setStore("message", event.properties.info.sessionID, result.index, reconcile(event.properties.info))
            break
          }
          setStore(
            "message",
            event.properties.info.sessionID,
            produce((draft) => {
              draft.splice(result.index, 0, event.properties.info)
            }),
          )
          const updated = store.message[event.properties.info.sessionID]
          if (updated.length > 100) {
            const oldest = updated[0]
            batch(() => {
              setStore(
                "message",
                event.properties.info.sessionID,
                produce((draft) => {
                  draft.shift()
                }),
              )
              setStore(
                "part",
                produce((draft) => {
                  delete draft[oldest.id]
                }),
              )
            })
          }
          break
        }
        case "message.removed": {
          const messages = store.message[event.properties.sessionID]
          const result = Binary.search(messages, event.properties.messageID, (m) => m.id)
          if (result.found) {
            setStore(
              "message",
              event.properties.sessionID,
              produce((draft) => {
                draft.splice(result.index, 1)
              }),
            )
          }
          break
        }
        case "message.part.updated": {
          const p = event.properties.part
          Log.Default.info("[tui:sync] message.part.updated", {
            id: p.id,
            type: p.type,
            messageID: p.messageID,
            text: p.type === "text" ? (p as { text?: string }).text?.slice(0, 80) : undefined,
            state: p.type === "tool" ? (p as { state?: { status?: string } }).state?.status : undefined,
          })
          const parts = store.part[p.messageID]
          if (!parts) {
            setStore("part", p.messageID, [p])
            break
          }
          const result = Binary.search(parts, p.id, (x) => x.id)
          if (result.found) {
            setStore("part", p.messageID, result.index, reconcile(p))
            break
          }
          setStore(
            "part",
            p.messageID,
            produce((draft) => {
              draft.splice(result.index, 0, p)
            }),
          )
          break
        }

        case "message.part.delta": {
          const { messageID, partID, field, delta } = event.properties
          Log.Default.info("[tui:sync] message.part.delta", {
            messageID,
            partID,
            field,
            deltaLen: delta?.length,
            delta: delta?.slice(0, 40),
          })
          const parts = store.part[messageID]
          if (!parts) {
            Log.Default.warn("[tui:sync] message.part.delta: no parts array for messageID", { messageID })
            break
          }
          const result = Binary.search(parts, partID, (p) => p.id)
          if (!result.found) {
            Log.Default.warn("[tui:sync] message.part.delta: partID not found", {
              partID,
              available: parts.map((x) => x.id),
            })
            break
          }
          setStore(
            "part",
            messageID,
            produce((draft) => {
              const part = draft[result.index]
              const f = field as keyof typeof part
              const existing = part[f] as string | undefined
              ;(part[f] as string) = (existing ?? "") + delta
            }),
          )
          break
        }

        case "message.part.removed": {
          const parts = store.part[event.properties.messageID]
          const result = Binary.search(parts, event.properties.partID, (p) => p.id)
          if (result.found)
            setStore(
              "part",
              event.properties.messageID,
              produce((draft) => {
                draft.splice(result.index, 1)
              }),
            )
          break
        }

        case "lsp.updated": {
          sdk.client.project.lsp.status({ projectID: sdk.projectID }).then((x) => setStore("lsp", x.data ?? []))
          break
        }

        case "vcs.branch.updated": {
          setStore("vcs", { branch: event.properties.branch })
          break
        }
      }
    })

    const exit = useExit()
    const args = useArgs()

    async function bootstrap() {
      console.log("bootstrapping")
      const start = Date.now() - 30 * 24 * 60 * 60 * 1000
      const sessionListPromise = sdk.client.project.session
        .list({ projectID: sdk.projectID, start: start })
        .then((x) => (x.data ?? []).toSorted((a, b) => a.id.localeCompare(b.id)))

      // blocking - include session.list when continuing a session
      const providerListPromise = sdk.client.provider.list({ throwOnError: true })
      const agentsPromise = sdk.client.project.agent.list({ projectID: sdk.projectID }, { throwOnError: true })
      const configPromise = sdk.client.project.config.get({ projectID: sdk.projectID }, { throwOnError: true })
      const blockingRequests: Promise<unknown>[] = [
        providerListPromise,
        agentsPromise,
        configPromise,
        ...(args.continue ? [sessionListPromise] : []),
      ]

      await Promise.all(blockingRequests)
        .then(() => {
          const providerListResponse = providerListPromise.then(
            (x) => x.data ?? { all: [], default: {}, connected: [] },
          )
          const agentsResponse = agentsPromise.then((x) => x.data ?? [])
          const configResponse = configPromise.then((x) => x.data ?? {})
          const sessionListResponse = args.continue ? sessionListPromise : undefined

          return Promise.all([
            providerListResponse,
            agentsResponse,
            configResponse,
            ...(sessionListResponse ? [sessionListResponse] : []),
          ]).then((responses) => {
            const providerList = responses[0]
            const agents = responses[1]
            const config = responses[2]
            const sessions = responses[3]

            batch(() => {
              setStore("provider", reconcile(providerList.all))
              setStore("provider_default", reconcile(providerList.default))
              setStore("provider_next", reconcile(providerList))
              setStore("agent", reconcile(agents))
              setStore("config", reconcile(config))
              if (sessions !== undefined) setStore("session", reconcile(sessions))
            })
          })
        })
        .then(() => {
          if (store.status !== "complete") setStore("status", "partial")
          // non-blocking
          Promise.all([
            ...(args.continue ? [] : [sessionListPromise.then((sessions) => setStore("session", reconcile(sessions)))]),
            sdk.client.project.command
              .list({ projectID: sdk.projectID })
              .then((x) => setStore("command", reconcile(x.data ?? []))),
            sdk.client.project.lsp
              .status({ projectID: sdk.projectID })
              .then((x) => setStore("lsp", reconcile(x.data ?? []))),
            sdk.client.project.mcp
              .status({ projectID: sdk.projectID })
              .then((x) => setStore("mcp", reconcile(x.data ?? {}))),
            sdk.client.project.experimental.resource
              .list({ projectID: sdk.projectID })
              .then((x) => setStore("mcp_resource", reconcile(x.data ?? {}))),
            sdk.client.project.formatter
              .status({ projectID: sdk.projectID })
              .then((x) => setStore("formatter", reconcile(x.data ?? []))),
            sdk.client.project.session.status({ projectID: sdk.projectID }).then((x) => {
              setStore("session_status", reconcile(x.data ?? {}))
            }),
            sdk.client.provider.auth().then((x) => setStore("provider_auth", reconcile(x.data ?? {}))),
            sdk.client.project.vcs({ projectID: sdk.projectID }).then((x) => setStore("vcs", reconcile(x.data))),
            sdk.client.project.instance
              .info({ projectID: sdk.projectID })
              .then((x) =>
                setStore(
                  "path",
                  reconcile(
                    x.data
                      ? { home: "", state: "", config: "", worktree: x.data.worktree, directory: x.data.directory }
                      : { home: "", state: "", config: "", worktree: "", directory: "" },
                  ),
                ),
              ),
            syncWorkspaces(),
          ]).then(() => {
            setStore("status", "complete")
          })
        })
        .catch(async (e) => {
          Log.Default.error("tui bootstrap failed", {
            error: e instanceof Error ? e.message : String(e),
            name: e instanceof Error ? e.name : undefined,
            stack: e instanceof Error ? e.stack : undefined,
          })
          await exit(e)
        })
    }

    onMount(() => {
      bootstrap()
    })

    const fullSyncedSessions = new Set<string>()
    const result = {
      data: store,
      set: setStore,
      get status() {
        return store.status
      },
      get ready() {
        return store.status !== "loading"
      },
      session: {
        get(sessionID: string) {
          const match = Binary.search(store.session, sessionID, (s) => s.id)
          if (match.found) return store.session[match.index]
          return undefined
        },
        status(sessionID: string) {
          const session = result.session.get(sessionID)
          if (!session) return "idle"
          if (session.time.compacting) return "compacting"
          const messages = store.message[sessionID] ?? []
          const last = messages.at(-1)
          if (!last) return "idle"
          if (last.role === "user") return "working"
          return last.time.completed ? "idle" : "working"
        },
        async sync(sessionID: string) {
          if (fullSyncedSessions.has(sessionID)) return
          const [session, messages, todo, diff] = await Promise.all([
            sdk.client.project.session.get({ projectID: sdk.projectID, sessionID }, { throwOnError: true }),
            sdk.client.project.session.messages({ projectID: sdk.projectID, sessionID, limit: 100 }),
            sdk.client.project.session.todo({ projectID: sdk.projectID, sessionID }),
            sdk.client.project.session.diff({ projectID: sdk.projectID, sessionID }),
          ])
          const msgs = messages.data ?? []
          Log.Default.info("[tui:sync] session.sync loaded messages", {
            sessionID,
            count: msgs.length,
            messages: msgs.map((x) => ({
              id: x.info.id,
              role: x.info.role,
              parts: x.parts.map((p) => ({
                id: p.id,
                type: p.type,
                text: p.type === "text" ? (p as { text?: string }).text?.slice(0, 60) : undefined,
              })),
            })),
          })
          setStore(
            produce((draft) => {
              const match = Binary.search(draft.session, sessionID, (s) => s.id)
              const data = session.data
              if (data) {
                if (match.found) draft.session[match.index] = data
                if (!match.found) draft.session.splice(match.index, 0, data)
              }
              draft.todo[sessionID] = todo.data ?? []
              draft.message[sessionID] = msgs.map((x) => x.info)
              for (const message of msgs) {
                draft.part[message.info.id] = message.parts
              }
              draft.session_diff[sessionID] = diff.data ?? []
            }),
          )
          fullSyncedSessions.add(sessionID)
        },
      },
      workspace: {
        get(workspaceID: string) {
          return store.workspaceList.find((workspace) => workspace.id === workspaceID)
        },
        sync: syncWorkspaces,
      },
      bootstrap,
    }
    return result
  },
})
