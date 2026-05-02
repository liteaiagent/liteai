import type { Snapshot } from "@liteai/core/snapshot/index"
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
import { Log } from "@liteai/util/log"
import { useEffect, useMemo, useRef } from "react"
import { useStore } from "zustand"
import { immer } from "zustand/middleware/immer"
import { createStore } from "zustand/vanilla"
import { clearDynamicCompactTools } from "../constants/compact-allowlist"
import { useArgs } from "./args"
import { useExit } from "./exit"
import { createSimpleContext } from "./helper"
import { useSDK } from "./sdk"

export interface SyncState {
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
  sessions: Session[]
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
  agents: {
    [agentId: string]: {
      type: string
      parentId: string
      isAsync: boolean
      activity?: string
      status: "running" | "completed" | "failed" | "killed"
      startTime: number
      duration?: number
      usage?: { totalTokens: number; toolCalls: number; duration: number }
    }
  }
}

export interface SyncActions {
  bootstrap: () => Promise<void>
  syncWorkspaces: () => Promise<void>
  session: {
    get: (sessionID: string) => Session | undefined
    status: (sessionID: string) => "idle" | "compacting" | "working"
    sync: (sessionID: string) => Promise<void>
  }
  workspace: {
    get: (workspaceID: string) => Workspace | undefined
    sync: () => Promise<void>
  }
}

export type SyncContextValue = SyncState & SyncActions & { ready: boolean }

export const { use: useSync, provider: SyncProvider } = createSimpleContext({
  name: "Sync",
  init: () => {
    const sdk = useSDK()
    const exit = useExit()
    const args = useArgs()
    const fullSyncedSessionsRef = useRef(new Set<string>())

    const store = useMemo(() => {
      return createStore<SyncState>()(
        immer(() => ({
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
          sessions: [],
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
          agents: {},
        })),
      )
    }, [])

    // Subscribe to store updates to trigger re-renders
    const state = useStore(store)

    const syncWorkspaces = async () => {
      const result = await sdk.client.project.experimental.workspace.list({ projectID: sdk.projectID }).catch((err) => {
        Log.Default.error("[tui:sync] Failed to list workspaces", { error: err })
        return undefined
      })
      if (!result?.data) return
      store.setState((state) => {
        state.workspaceList = result.data as Workspace[]
      })
    }

    const bootstrap = async () => {
      Log.Default.info("[tui:sync] bootstrapping")
      const start = Date.now() - 30 * 24 * 60 * 60 * 1000
      const sessionListPromise = sdk.client.project.session
        .list({ projectID: sdk.projectID, start: start })
        .then((x) => (x.data ?? []).toSorted((a, b) => a.id.localeCompare(b.id)))

      const providerListPromise = sdk.client.provider.list({ throwOnError: true })
      const agentsPromise = sdk.client.project.agent.list({ projectID: sdk.projectID }, { throwOnError: true })
      const configPromise = sdk.client.project.config.get({ projectID: sdk.projectID }, { throwOnError: true })

      const blockingRequests: Promise<unknown>[] = [
        providerListPromise,
        agentsPromise,
        configPromise,
        ...(args.continue ? [sessionListPromise] : []),
      ]

      try {
        await Promise.all(blockingRequests)
        const [providerList, agents, config, sessions] = await Promise.all([
          providerListPromise.then((x) => x.data ?? { all: [], default: {}, connected: [] }),
          agentsPromise.then((x) => x.data ?? []),
          configPromise.then((x) => x.data ?? {}),
          args.continue ? sessionListPromise : Promise.resolve(undefined),
        ])

        store.setState((state) => {
          state.provider = providerList.all
          state.provider_default = providerList.default
          state.provider_next = providerList
          state.agent = agents
          state.config = config
          if (sessions !== undefined) state.sessions = sessions as Session[]
          if (state.status !== "complete") state.status = "partial"
        })

        // non-blocking requests
        Promise.all([
          ...(args.continue
            ? []
            : [
                sessionListPromise.then((s) =>
                  store.setState((state) => {
                    state.sessions = s as Session[]
                  }),
                ),
              ]),
          sdk.client.project.command.list({ projectID: sdk.projectID }).then((x) =>
            store.setState((state) => {
              state.command = x.data ?? []
            }),
          ),
          sdk.client.project.lsp.status({ projectID: sdk.projectID }).then((x) =>
            store.setState((state) => {
              state.lsp = x.data ?? []
            }),
          ),
          sdk.client.project.mcp.status({ projectID: sdk.projectID }).then((x) =>
            store.setState((state) => {
              state.mcp = x.data ?? {}
            }),
          ),
          sdk.client.project.mcp.resource.list({ projectID: sdk.projectID }).then((x) =>
            store.setState((state) => {
              state.mcp_resource = x.data ?? {}
            }),
          ),
          sdk.client.project.formatter.status({ projectID: sdk.projectID }).then((x) =>
            store.setState((state) => {
              state.formatter = x.data ?? []
            }),
          ),
          sdk.client.project.session.status({ projectID: sdk.projectID }).then((x) =>
            store.setState((state) => {
              state.session_status = x.data ?? {}
            }),
          ),
          sdk.client.provider.auth().then((x) =>
            store.setState((state) => {
              state.provider_auth = x.data ?? {}
            }),
          ),
          sdk.client.project.vcs({ projectID: sdk.projectID }).then((x) =>
            store.setState((state) => {
              state.vcs = x.data
            }),
          ),
          sdk.client.project.instance.info({ projectID: sdk.projectID }).then((x) =>
            store.setState((state) => {
              state.path = x.data
                ? { home: "", state: "", config: "", worktree: x.data.worktree, directory: x.data.directory }
                : { home: "", state: "", config: "", worktree: "", directory: "" }
            }),
          ),
          syncWorkspaces(),
        ]).then(() => {
          store.setState((state) => {
            state.status = "complete"
          })
        })
      } catch (e) {
        Log.Default.error("tui bootstrap failed", {
          error: e instanceof Error ? e.message : String(e),
          name: e instanceof Error ? e.name : undefined,
          stack: e instanceof Error ? e.stack : undefined,
        })
        await exit(e)
      }
    }

    useEffect(() => {
      bootstrap()

      const unsub = sdk.event.on(
        () => true,
        (event: import("@liteai/sdk").Event) => {
          switch (event.type) {
            case "server.instance.disposed":
              bootstrap()
              break
            case "permission.replied": {
              const sessionID = event.properties.sessionID
              const requestID = event.properties.requestID
              store.setState((state) => {
                const requests = state.permission[sessionID]
                if (!requests) return
                const match = Binary.search(requests, requestID, (r) => r.id)
                if (match.found) {
                  requests.splice(match.index, 1)
                }
              })
              break
            }
            case "permission.asked": {
              const request = event.properties
              store.setState((state) => {
                const requests = state.permission[request.sessionID]
                if (!requests) {
                  state.permission[request.sessionID] = [request as PermissionRequest]
                  return
                }
                const match = Binary.search(requests, request.id, (r) => r.id)
                if (match.found) {
                  requests[match.index] = request as PermissionRequest
                } else {
                  requests.splice(match.index, 0, request as PermissionRequest)
                }
              })
              break
            }
            case "question.replied":
            case "question.rejected": {
              const sessionID = event.properties.sessionID
              const requestID = event.properties.requestID
              store.setState((state) => {
                const requests = state.question[sessionID]
                if (!requests) return
                const match = Binary.search(requests, requestID, (r) => r.id)
                if (match.found) {
                  requests.splice(match.index, 1)
                }
              })
              break
            }
            case "question.asked": {
              const request = event.properties
              store.setState((state) => {
                const requests = state.question[request.sessionID]
                if (!requests) {
                  state.question[request.sessionID] = [request as QuestionRequest]
                  return
                }
                const match = Binary.search(requests, request.id, (r) => r.id)
                if (match.found) {
                  requests[match.index] = request as QuestionRequest
                } else {
                  requests.splice(match.index, 0, request as QuestionRequest)
                }
              })
              break
            }
            case "todo.updated":
              store.setState((state) => {
                state.todo[event.properties.sessionID] = event.properties.todos as Todo[]
              })
              break
            case "session.diff":
              store.setState((state) => {
                state.session_diff[event.properties.sessionID] = event.properties.diff as Snapshot.FileDiff[]
              })
              break
            case "session.deleted": {
              store.setState((state) => {
                const result = Binary.search(state.sessions, event.properties.info.id, (s) => s.id)
                if (result.found) {
                  state.sessions.splice(result.index, 1)
                }
              })
              break
            }
            case "session.updated": {
              store.setState((state) => {
                const result = Binary.search(state.sessions, event.properties.info.id, (s) => s.id)
                if (result.found) {
                  state.sessions[result.index] = event.properties.info as Session
                } else {
                  state.sessions.splice(result.index, 0, event.properties.info as Session)
                }
              })
              break
            }
            case "session.status": {
              store.setState((state) => {
                state.session_status[event.properties.sessionID] = event.properties.status as SessionStatus
              })
              break
            }
            case "message.updated": {
              const info = event.properties.info as Message
              store.setState((state) => {
                const messages = state.message[info.sessionID]
                if (!messages) {
                  state.message[info.sessionID] = [info]
                  return
                }
                const result = Binary.search(messages, info.id, (m) => m.id)
                if (result.found) {
                  messages[result.index] = info
                } else {
                  messages.splice(result.index, 0, info)
                }

                if (messages.length > 100) {
                  const oldest = messages.shift()
                  if (oldest) {
                    delete state.part[oldest.id]
                  }
                }
              })
              break
            }
            case "message.removed": {
              store.setState((state) => {
                const messages = state.message[event.properties.sessionID]
                if (!messages) return
                const result = Binary.search(messages, event.properties.messageID, (m) => m.id)
                if (result.found) {
                  messages.splice(result.index, 1)
                }
              })
              break
            }
            case "message.part.updated": {
              const p = event.properties.part as Part
              store.setState((state) => {
                const parts = state.part[p.messageID]
                if (!parts) {
                  state.part[p.messageID] = [p]
                  return
                }
                const result = Binary.search(parts, p.id, (x) => x.id)
                if (result.found) {
                  parts[result.index] = p
                } else {
                  parts.splice(result.index, 0, p)
                }
              })
              break
            }
            case "message.part.delta": {
              const { messageID, partID, field, delta } = event.properties
              store.setState((state) => {
                const parts = state.part[messageID]
                if (!parts) return
                const result = Binary.search(parts, partID, (p) => p.id)
                if (result.found) {
                  const part = parts[result.index] as unknown as Record<string, string | undefined>
                  part[field] = (part[field] ?? "") + delta
                }
              })
              break
            }
            case "message.part.removed": {
              store.setState((state) => {
                const parts = state.part[event.properties.messageID]
                if (!parts) return
                const result = Binary.search(parts, event.properties.partID, (p) => p.id)
                if (result.found) {
                  parts.splice(result.index, 1)
                }
              })
              break
            }
            case "lsp.updated": {
              sdk.client.project.lsp.status({ projectID: sdk.projectID }).then((x) =>
                store.setState((state) => {
                  state.lsp = x.data ?? []
                }),
              )
              break
            }
            case "mcp.tools.changed": {
              // Re-fetch MCP status to detect connect/disconnect state changes.
              // When a server disconnects, unregister its tools from the dynamic compact allowlist.
              sdk.client.project.mcp.status({ projectID: sdk.projectID }).then((x) => {
                const newStatus = x.data ?? {}
                const oldStatus = store.getState().mcp
                // Detect servers that were previously connected but are no longer
                for (const [serverName, status] of Object.entries(oldStatus)) {
                  if (status.status === "connected" && newStatus[serverName]?.status !== "connected") {
                    // Server disconnected — unregister its tools from compact allowlist.
                    // We don't know individual tool names here, so clear all dynamic tools
                    // and let connected servers re-register on next tools sync.
                    clearDynamicCompactTools()
                  }
                }
                store.setState((state) => {
                  state.mcp = newStatus
                })
              })
              // TODO: When the MCP tools API starts returning tool annotations
              // (per MCP 2025-03-26 spec `annotations.compactEligible`), fetch the
              // tools list here and call registerCompactTool() for qualifying tools.
              // Currently the API returns `{ [server: string]: string[] }` — just
              // tool names without metadata, so annotation-based registration is
              // deferred until the backend surfaces that data.
              break
            }
            case "vcs.branch.updated": {
              store.setState((state) => {
                state.vcs = { ...state.vcs, branch: event.properties.branch } as VcsInfo
              })
              break
            }
            case "agent.spawned": {
              const { agentId, agentType, parentId, isAsync } = event.properties
              store.setState((state) => {
                state.agents[agentId] = {
                  type: agentType,
                  parentId,
                  isAsync,
                  status: "running",
                  startTime: Date.now(),
                }
              })
              break
            }
            case "agent.progress": {
              const { agentId, activity } = event.properties
              store.setState((state) => {
                if (state.agents[agentId]) {
                  state.agents[agentId].activity = activity
                }
              })
              break
            }
            case "agent.completed": {
              const { agentId, status, duration, usage } = event.properties
              store.setState((state) => {
                if (state.agents[agentId]) {
                  state.agents[agentId].status = status
                  state.agents[agentId].duration = duration
                  state.agents[agentId].usage = usage
                }
              })
              break
            }
          }
        },
      )

      return unsub
    }, [sdk, store, args.continue])

    const syncSession = async (sessionID: string) => {
      if (fullSyncedSessionsRef.current.has(sessionID)) return
      try {
        const [session, messages, todo, diff] = await Promise.all([
          sdk.client.project.session.get({ projectID: sdk.projectID, sessionID }, { throwOnError: true }),
          sdk.client.project.session.messages({ projectID: sdk.projectID, sessionID, limit: 100 }),
          sdk.client.project.session.todo({ projectID: sdk.projectID, sessionID }),
          sdk.client.project.session.diff({ projectID: sdk.projectID, sessionID }),
        ])

        const msgs = messages.data ?? []
        store.setState((state) => {
          const match = Binary.search(state.sessions, sessionID, (s) => s.id)
          const data = session.data as Session
          if (data) {
            if (match.found) state.sessions[match.index] = data
            else state.sessions.splice(match.index, 0, data)
          }
          state.todo[sessionID] = (todo.data as Todo[]) ?? []
          state.message[sessionID] = msgs.map((x) => x.info as Message)
          for (const message of msgs) {
            state.part[message.info.id] = message.parts as Part[]
          }
          state.session_diff[sessionID] = (diff.data as Snapshot.FileDiff[]) ?? []
        })
        fullSyncedSessionsRef.current.add(sessionID)
      } catch (e) {
        Log.Default.error("[tui:sync] session.sync failed", { sessionID, error: e })
      }
    }

    const value = useMemo<SyncContextValue>(() => {
      return {
        ...state,
        ready: state.status !== "loading",
        bootstrap,
        syncWorkspaces,
        session: {
          get(sessionID: string) {
            const match = Binary.search(state.sessions, sessionID, (s) => s.id)
            if (match.found) return state.sessions[match.index]
            return undefined
          },
          status(sessionID: string) {
            const session = this.get(sessionID)
            if (!session) return "idle"
            if (session.time.compacting) return "compacting"
            const messages = state.message[sessionID] ?? []
            const last = messages.at(-1)
            if (!last) return "idle"
            if (last.role === "user") return "working"
            return last.time.completed ? "idle" : "working"
          },
          sync: syncSession,
        },
        workspace: {
          get(workspaceID: string) {
            return state.workspaceList.find((w) => w.id === workspaceID)
          },
          sync: syncWorkspaces,
        },
      }
    }, [state, sdk, bootstrap, syncWorkspaces, syncSession])

    return value
  },
})
