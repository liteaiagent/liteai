import type { Snapshot } from "@liteai/core/snapshot/index"
import type { LiteaiClient, Message, Part, Session, Todo, Workspace } from "@liteai/sdk"
import { Binary } from "@liteai/util/binary"
import { Log } from "@liteai/util/log"
import type { AppState } from "./app-state"
import { capPartMap } from "./app-state-events"
import type { AppStore } from "./app-store"

export interface ActionContext {
  setState: AppStore<AppState>["setState"]
  getState: AppStore<AppState>["getState"]
  sdk: LiteaiClient
  projectID: string
  exit: (reason?: unknown) => Promise<void>
  args: { continue?: boolean }
}

export async function syncWorkspacesAction(ctx: ActionContext) {
  const { sdk, projectID, setState } = ctx
  const result = await sdk.project.experimental.workspace.list({ projectID }).catch((err) => {
    Log.Default.error("[tui:sync] Failed to list workspaces", { error: err })
    return undefined
  })
  if (!result?.data) return
  setState((state) => ({ ...state, workspaceList: result.data as Workspace[] }))
}

export async function bootstrapAction(ctx: ActionContext) {
  const { sdk, projectID, setState, exit, args } = ctx
  Log.Default.info("[tui:sync] bootstrapping")

  const start = Date.now() - 30 * 24 * 60 * 60 * 1000
  const sessionListPromise = sdk.project.session
    .list({ projectID, start })
    .then((x) => (x.data ?? []).toSorted((a, b) => a.id.localeCompare(b.id)))

  const providerListPromise = sdk.provider.list({ throwOnError: true })
  const agentsPromise = sdk.project.agent.list({ projectID }, { throwOnError: true })
  const configPromise = sdk.project.config.get({ projectID }, { throwOnError: true })

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

    setState((state) => ({
      ...state,
      provider: providerList.all,
      provider_default: providerList.default,
      provider_next: providerList,
      agent: agents,
      config,
      ...(sessions !== undefined ? { sessions: sessions as Session[] } : {}),
      status: state.status !== "complete" ? "partial" : state.status,
    }))

    // non-blocking requests
    Promise.all([
      ...(args.continue
        ? []
        : [sessionListPromise.then((s) => setState((state) => ({ ...state, sessions: s as Session[] })))]),
      sdk.project.command.list({ projectID }).then((x) => setState((state) => ({ ...state, command: x.data ?? [] }))),
      sdk.project.lsp.status({ projectID }).then((x) => setState((state) => ({ ...state, lsp: x.data ?? [] }))),
      sdk.project.mcp.status({ projectID }).then((x) => setState((state) => ({ ...state, mcp: x.data ?? {} }))),
      sdk.project.mcp.resource
        .list({ projectID })
        .then((x) => setState((state) => ({ ...state, mcp_resource: x.data ?? {} }))),
      sdk.project.formatter
        .status({ projectID })
        .then((x) => setState((state) => ({ ...state, formatter: x.data ?? [] }))),
      sdk.project.session
        .status({ projectID })
        .then((x) => setState((state) => ({ ...state, session_status: x.data ?? {} }))),
      sdk.provider.auth().then((x) => setState((state) => ({ ...state, provider_auth: x.data ?? {} }))),
      sdk.project.vcs({ projectID }).then((x) => setState((state) => ({ ...state, vcs: x.data }))),
      sdk.project.instance.info({ projectID }).then((x) =>
        setState((state) => ({
          ...state,
          path: x.data
            ? { home: "", state: "", config: "", worktree: x.data.worktree, directory: x.data.directory }
            : { home: "", state: "", config: "", worktree: "", directory: "" },
        })),
      ),
      syncWorkspacesAction(ctx),
    ]).then(() => {
      setState((state) => ({ ...state, status: "complete" }))
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

export async function syncSessionAction(
  ctx: ActionContext,
  sessionID: string,
  fullSyncedSessionsRef: { current: Set<string> },
) {
  if (fullSyncedSessionsRef.current.has(sessionID)) return

  const { sdk, projectID, setState } = ctx
  try {
    const [session, messages, todo, diff] = await Promise.all([
      sdk.project.session.get({ projectID, sessionID }, { throwOnError: true }),
      sdk.project.session.messages({ projectID, sessionID, limit: 100 }),
      sdk.project.session.todo({ projectID, sessionID }),
      sdk.project.session.diff({ projectID, sessionID }),
    ])

    const msgs = messages.data ?? []

    setState((state) => {
      const match = Binary.search(state.sessions as Session[], sessionID, (s: Session) => s.id)
      const data = session.data as Session
      const nextSessions = [...state.sessions]
      if (data) {
        if (match.found) nextSessions[match.index] = data
        else nextSessions.splice(match.index, 0, data)
      }

      const newParts = { ...state.part }
      for (const message of msgs) {
        newParts[message.info.id] = message.parts as Part[]
      }

      return {
        ...state,
        sessions: nextSessions,
        todo: { ...state.todo, [sessionID]: (todo.data as Todo[]) ?? [] },
        message: { ...state.message, [sessionID]: msgs.map((x) => x.info as Message) },
        part: capPartMap(newParts),
        session_diff: { ...state.session_diff, [sessionID]: (diff.data as Snapshot.FileDiff[]) ?? [] },
      }
    })

    fullSyncedSessionsRef.current.add(sessionID)
  } catch (e) {
    Log.Default.error("[tui:sync] session.sync failed", { sessionID, error: e })
  }
}

export function cleanupSessionAction(
  ctx: ActionContext,
  sessionID: string,
  fullSyncedSessionsRef: { current: Set<string> },
) {
  fullSyncedSessionsRef.current.delete(sessionID)
  ctx.setState((state) => {
    const { [sessionID]: _diff, ...restDiff } = state.session_diff
    const { [sessionID]: _todo, ...restTodo } = state.todo
    const messages = state.message[sessionID] || []
    const nextParts = { ...state.part }
    for (const msg of messages) {
      delete nextParts[msg.id]
    }
    const { [sessionID]: _msg, ...restMessage } = state.message
    return {
      ...state,
      session_diff: restDiff,
      todo: restTodo,
      message: restMessage,
      part: nextParts,
    }
  })
}
