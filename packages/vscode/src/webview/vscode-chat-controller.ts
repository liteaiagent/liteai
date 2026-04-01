import type { Agent, LiteaiClient, Message, Part, Session, VcsInfo } from "@liteai/sdk/client"
import type {
  ChatController,
  ModelInfo,
  PermissionController,
  ProjectInfo,
  SelectionController,
  SessionController,
} from "@liteai/ui/panes"
import { createSignal } from "solid-js"
import { produce } from "solid-js/store"
import type { VscodeStore } from "./vscode-store"

const LOG_PREFIX = "[liteai-controller]"

/**
 * Simple binary search for sorted arrays with string IDs.
 */
function bsearch<T>(items: readonly T[], target: string, key: (item: T) => string): { found: boolean; index: number } {
  let lo = 0
  let hi = items.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    const cmp = key(items[mid])
    if (cmp < target) lo = mid + 1
    else if (cmp > target) hi = mid
    else return { found: true, index: mid }
  }
  return { found: false, index: lo }
}

/**
 * Live VSCode ChatController — reads data from the reactive VscodeStore.
 *
 * Phase 4: Fully functional, replaces the Phase 1 stubs.
 */
export function createVscodeChatController(opts: { store: VscodeStore; client: LiteaiClient }): ChatController {
  const { store } = opts
  const s = store.store

  // Track which sessions we've synced to avoid re-fetching
  const syncedSessions = new Set<string>()
  // Track in-flight sync requests
  const inflight = new Map<string, Promise<void>>()

  return {
    messages(sessionID: string) {
      return s.message[sessionID] ?? []
    },
    messagesReady(sessionID: string) {
      return s.message[sessionID] !== undefined
    },
    parts(messageID: string) {
      return s.part[messageID] ?? []
    },
    sessionStatus(sessionID: string) {
      return s.session_status[sessionID] ?? { type: "idle" }
    },
    agents() {
      return s.agent
    },
    session: {
      get(sessionID: string) {
        const result = bsearch(s.session, sessionID, (sess: Session) => sess.id)
        if (result.found) return s.session[result.index]
        return undefined
      },
      async sync(sessionID: string) {
        if (syncedSessions.has(sessionID)) return

        // Dedup in-flight requests
        const pending = inflight.get(sessionID)
        if (pending) return pending

        const promise = (async () => {
          try {
            const projectID = s.projectID
            if (!projectID) return

            // Fetch session metadata + messages in parallel
            const [sessionRes, messagesRes] = await Promise.all([
              opts.client.project.session.get({ sessionID, projectID }),
              opts.client.project.session.messages({ sessionID, projectID, limit: 200 }),
            ])

            const sessionData = sessionRes.data
            if (sessionData) {
              store.set(
                "session",
                produce((draft: Session[]) => {
                  const result = bsearch(draft, sessionID, (sess: Session) => sess.id)
                  if (result.found) {
                    draft[result.index] = sessionData
                  } else {
                    draft.splice(result.index, 0, sessionData)
                  }
                }),
              )
            }

            // biome-ignore lint/suspicious/noExplicitAny: SDK response shape varies
            const rawItems = (messagesRes.data ?? []) as any[]
            const items = rawItems.filter((x) => !!x?.info?.id)
            const messages: Message[] = items
              .map((x) => x.info as Message)
              .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

            store.set("message", sessionID, messages)

            for (const item of items) {
              const rawParts = (item.parts ?? []) as Part[]
              const parts: Part[] = rawParts
                .filter((p) => !!p?.id)
                .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
              store.set("part", item.info.id, parts)
            }

            syncedSessions.add(sessionID)
          } catch (err) {
            console.warn(LOG_PREFIX, `Failed to sync session ${sessionID}:`, err)
          }
        })()

        inflight.set(sessionID, promise)
        promise.finally(() => inflight.delete(sessionID))
        return promise
      },
      history: {
        more(_sessionID: string) {
          return false
        },
        loading(_sessionID: string) {
          return false
        },
        async loadMore(_sessionID: string) {
          // No-op — messages loaded in full during sync
        },
      },
    },
    config() {
      return s.config
    },
    directory() {
      return s.directory
    },
    projectID() {
      return s.projectID
    },
    sessions() {
      return s.session ?? []
    },
    project(): ProjectInfo | undefined {
      return undefined
    },
    vcs(): VcsInfo | undefined {
      return s.vcs
    },
    shareEnabled() {
      return (s.config as Record<string, unknown>)?.share !== "disabled"
    },
    commands() {
      // VSCode: no custom commands yet — will be wired when extension gains MCP support
      return []
    },
    hasPaidProviders() {
      // VSCode: assume paid until provider list is wired
      return true
    },
  }
}

/**
 * Live VSCode SessionController — calls Core API via SDK client.
 */
export function createVscodeSessionController(opts: { store: VscodeStore; client: LiteaiClient }): SessionController {
  const { store } = opts
  const s = store.store

  return {
    async rename(sessionID: string, title: string) {
      try {
        await opts.client.project.session.update({
          sessionID,
          title,
          projectID: s.projectID,
        })
        store.set(
          "session",
          produce((draft: Session[]) => {
            const result = bsearch(draft, sessionID, (sess: Session) => sess.id)
            if (result.found) (draft[result.index] as Session).title = title
          }),
        )
      } catch (err) {
        console.error(LOG_PREFIX, "Failed to rename session:", err)
      }
    },

    async archive(sessionID: string) {
      try {
        await opts.client.project.session.update({
          sessionID,
          time: { archived: Date.now() },
          projectID: s.projectID,
        })
        store.set(
          "session",
          produce((draft: Session[]) => {
            const result = bsearch(draft, sessionID, (sess: Session) => sess.id)
            if (result.found) draft.splice(result.index, 1)
          }),
        )
      } catch (err) {
        console.error(LOG_PREFIX, "Failed to archive session:", err)
      }
    },

    async delete(sessionID: string): Promise<boolean> {
      try {
        const result = await opts.client.project.session
          .delete({ sessionID, projectID: s.projectID })
          .then((x) => x.data)
          .catch(() => false)

        if (!result) return false

        store.set(
          "session",
          produce((draft: Session[]) => {
            const removed = new Set<string>([sessionID])
            for (const item of draft) {
              if (item.parentID && removed.has(item.parentID)) {
                removed.add(item.id)
              }
            }

            let write = 0
            for (let read = 0; read < draft.length; read++) {
              if (!removed.has(draft[read].id)) {
                draft[write++] = draft[read]
              }
            }
            draft.length = write
          }),
        )

        return true
      } catch (err) {
        console.error(LOG_PREFIX, "Failed to delete session:", err)
        return false
      }
    },

    async share(sessionID: string) {
      try {
        await opts.client.project.session.share({
          sessionID,
          projectID: s.projectID,
        })
      } catch (err) {
        console.error(LOG_PREFIX, "Failed to share session:", err)
      }
    },

    async unshare(sessionID: string) {
      try {
        await opts.client.project.session.unshare({
          sessionID,
          projectID: s.projectID,
        })
      } catch (err) {
        console.error(LOG_PREFIX, "Failed to unshare session:", err)
      }
    },
  }
}

/**
 * Provider model info as returned by `/provider` endpoint.
 */
type ProviderModelDef = {
  id: string
  name: string
  family?: string
  release_date: string
  attachment: boolean
  cost?: { input: number; output: number }
  variants?: Record<string, Record<string, unknown>>
}

/**
 * Provider definition as returned by `/provider` endpoint.
 */
type ProviderDef = {
  id: string
  name: string
  models: Record<string, ProviderModelDef>
}

/**
 * Live VSCode SelectionController — manages model/agent selection state locally.
 *
 * Models and agents are fetched from Core via the SDK client.
 */
export function createVscodeSelectionController(opts: {
  store: VscodeStore
  client: LiteaiClient
}): SelectionController {
  const { store } = opts
  const s = store.store

  // Local selection state
  const [selectedAgentName, setSelectedAgentName] = createSignal<string | undefined>(undefined)
  const [selectedModelKey, setSelectedModelKey] = createSignal<{ providerID: string; modelID: string } | undefined>(
    undefined,
  )
  const [selectedVariant, setSelectedVariant] = createSignal<string | undefined>(undefined)

  // Provider/model data fetched from Core
  const [providerList, setProviderList] = createSignal<ProviderDef[]>([])
  const [connectedIds, setConnectedIds] = createSignal<Set<string>>(new Set())
  const [providersFetched, setProvidersFetched] = createSignal(false)

  // Fetch providers on demand
  const fetchProviders = async () => {
    if (providersFetched()) return
    try {
      const res = await opts.client.provider.list()
      const data = res.data
      if (data) {
        const allProviders = (data.all ?? []) as ProviderDef[]
        const connected = new Set<string>(data.connected ?? [])
        setProviderList(allProviders)
        setConnectedIds(connected)

        // Auto-select first connected model if none selected
        if (!selectedModelKey()) {
          for (const provider of allProviders) {
            if (!connected.has(provider.id)) continue
            const firstModel = Object.values(provider.models)[0]
            if (firstModel) {
              setSelectedModelKey({ providerID: provider.id, modelID: firstModel.id })
              break
            }
          }
        }
      }
      setProvidersFetched(true)
    } catch (err) {
      console.warn(LOG_PREFIX, "Failed to fetch providers:", err)
    }
  }

  void fetchProviders()

  const agentList = () => s.agent.filter((a: Agent) => a.mode !== "subagent" && !a.hidden)

  const currentAgent = () => {
    const name = selectedAgentName()
    const agents = agentList()
    if (agents.length === 0) return undefined
    return agents.find((a: Agent) => a.name === name) ?? agents[0]
  }

  const modelList = (): ModelInfo[] => {
    const result: ModelInfo[] = []
    const connected = connectedIds()
    for (const provider of providerList()) {
      if (!connected.has(provider.id)) continue
      for (const model of Object.values(provider.models)) {
        result.push({
          id: model.id,
          name: model.name,
          family: model.family,
          release_date: model.release_date ?? "",
          latest: false,
          variants: model.variants,
          cost: model.cost,
          provider: { id: provider.id, name: provider.name },
        })
      }
    }
    return result
  }

  const currentModel = (): ModelInfo | undefined => {
    const key = selectedModelKey()
    const models = modelList()
    if (!key) return models[0]
    return models.find((m) => m.provider.id === key.providerID && m.id === key.modelID) ?? models[0]
  }

  return {
    agent: {
      current() {
        return currentAgent()
      },
      list() {
        return agentList()
      },
      set(name: string | undefined) {
        setSelectedAgentName(name)
      },
    },
    model: {
      current() {
        return currentModel()
      },
      list() {
        return modelList()
      },
      visible(_key) {
        return true
      },
      set(key, _options) {
        if (key) {
          setSelectedModelKey({ providerID: key.providerID, modelID: key.modelID })
        } else {
          setSelectedModelKey(undefined)
        }
      },
      variant: {
        current() {
          return selectedVariant()
        },
        list() {
          const model = currentModel()
          if (!model?.variants) return []
          return Object.keys(model.variants)
        },
        set(value) {
          setSelectedVariant(value)
        },
      },
    },
  }
}

/**
 * VSCode PermissionController — manages auto-accept (YOLO) mode for sessions.
 *
 * State is stored locally in a reactive signal. The string "global" key is
 * used when no sessionID is provided, allowing a session-agnostic toggle.
 * Note: state is not persisted across webview reloads — this matches the web
 * behavior where YOLO mode is tied to the directory permission layer.
 */
export function createVscodePermissionController(): PermissionController {
  // Set of session IDs (or "global") that have auto-accept enabled
  const [autoAcceptKeys, setAutoAcceptKeys] = createSignal<Set<string>>(new Set(), { equals: false })

  const resolveKey = (sessionID: string | undefined) => sessionID ?? "global"

  return {
    isAutoAccepting(sessionID: string | undefined): boolean {
      return autoAcceptKeys().has(resolveKey(sessionID))
    },

    toggle(sessionID: string | undefined): void {
      const key = resolveKey(sessionID)
      setAutoAcceptKeys((prev) => {
        const next = new Set(prev)
        if (next.has(key)) {
          next.delete(key)
        } else {
          next.add(key)
        }
        return next
      })
    },
  }
}
