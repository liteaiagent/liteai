import type {
  Config,
  LiteaiClient,
  PermissionRequest,
  Project,
  ProviderAuthResponse,
  ProviderListResponse,
  QuestionRequest,
  Todo,
} from "@liteai/sdk/client"
import { getFilename } from "@liteai/util/path"
import { retry } from "@liteai/util/retry"
import { batch } from "solid-js"
import { reconcile, type SetStoreFunction, type Store } from "solid-js/store"
import { showToast } from "../../../components/toast"
import { formatServerError } from "../server-errors"
import type { PathState, State, VcsCache } from "./types"
import { cmp, normalizeProviderList } from "./utils"

type GlobalStore = {
  ready: boolean
  path: PathState
  project: Project[]
  session_todo: {
    [sessionID: string]: Todo[]
  }
  provider: ProviderListResponse
  provider_auth: ProviderAuthResponse
  config: Config
  reload: undefined | "pending" | "complete"
}

export async function bootstrapGlobal(input: {
  globalSDK: LiteaiClient
  connectErrorTitle: string
  connectErrorDescription: string
  requestFailedTitle: string
  translate: (key: string, vars?: Record<string, string | number>) => string
  formatMoreCount: (count: number) => string
  setGlobalStore: SetStoreFunction<GlobalStore>
}) {
  const health = await input.globalSDK
    .health()
    .then((x) => x.data)
    .catch(() => undefined)
  if (!health?.healthy) {
    showToast({
      variant: "error",
      title: input.connectErrorTitle,
      description: input.connectErrorDescription,
    })
    input.setGlobalStore("ready", true)
    return
  }

  const tasks = [
    retry(() =>
      input.globalSDK.config.get().then((x) => {
        if (x.data) input.setGlobalStore("config", x.data)
      }),
    ),
    retry(() =>
      input.globalSDK.project.list().then((x) => {
        const projects = (x.data ?? [])
          .filter((p) => !!p?.id)
          .filter((p) => !!p.worktree && !p.worktree.includes("liteai-test"))
          .slice()
          .sort((a, b) => cmp(a.id, b.id))
        console.debug("[bootstrap] projects from db", {
          count: projects.length,
          archived: projects.filter((p) => p.time?.archived).length,
        })
        input.setGlobalStore("project", projects)
      }),
    ),
    retry(() =>
      input.globalSDK.provider.list().then((x) => {
        if (x.data) input.setGlobalStore("provider", normalizeProviderList(x.data))
      }),
    ),
    retry(() =>
      input.globalSDK.provider.auth().then((x) => {
        input.setGlobalStore("provider_auth", x.data ?? {})
      }),
    ),
    retry(() =>
      input.globalSDK.path().then((x) => {
        if (x.data)
          input.setGlobalStore("path", {
            home: x.data.home,
            state: x.data.state,
            config: x.data.config,
            worktree: "",
            directory: "",
          })
      }),
    ),
  ]

  const results = await Promise.allSettled(tasks)
  const errors = results.filter((r): r is PromiseRejectedResult => r.status === "rejected").map((r) => r.reason)
  if (errors.length) {
    const message = formatServerError(errors[0], input.translate)
    const more = errors.length > 1 ? input.formatMoreCount(errors.length - 1) : ""
    showToast({
      variant: "error",
      title: input.requestFailedTitle,
      description: message + more,
    })
  }
  input.setGlobalStore("ready", true)
}

function groupBySession<T extends { id: string; sessionID: string }>(input: T[]) {
  return input.reduce<Record<string, T[]>>((acc, item) => {
    if (!item?.id || !item.sessionID) return acc
    const list = acc[item.sessionID]
    if (list) list.push(item)
    if (!list) acc[item.sessionID] = [item]
    return acc
  }, {})
}

export async function bootstrapDirectory(input: {
  directory: string
  projectID: string
  sdk: LiteaiClient
  store: Store<State>
  setStore: SetStoreFunction<State>
  vcsCache: VcsCache
  loadSessions: (directory: string) => Promise<void> | void
  translate: (key: string, vars?: Record<string, string | number>) => string
}) {
  if (input.store.status !== "complete") input.setStore("status", "loading")

  try {
    const projRes = await retry(() =>
      input.sdk.project.current({ projectID: input.projectID }).catch((e: unknown) => {
        const err = e as { name?: string; response?: { status?: number } } | null | undefined
        if (err?.name === "NotFoundError" || err?.response?.status === 404) return { data: null }
        throw e
      }),
    )
    if (!projRes.data) {
      input.setStore("status", "partial")
      return
    }
    input.setStore("project", projRes.data.id)

    const blockingRequests = {
      provider: () =>
        input.sdk.provider.list().then((x) => {
          if (x.data) input.setStore("provider", normalizeProviderList(x.data))
        }),
      agent: () =>
        input.sdk.project.agent.list({ projectID: input.projectID }).then((x) => input.setStore("agent", x.data ?? [])),
      config: () =>
        input.sdk.project.config.get({ projectID: input.projectID }).then((x) => {
          if (x.data) input.setStore("config", x.data)
        }),
    }

    await Promise.all(Object.values(blockingRequests).map((p) => retry(p)))
  } catch (err) {
    console.error("Failed to bootstrap instance", err)
    const project = getFilename(input.directory)
    showToast({
      variant: "error",
      title: input.translate("toast.project.reloadFailed.title", { project }),
      description: formatServerError(err, input.translate),
    })
    input.setStore("status", "partial")
    return
  }

  if (input.store.status !== "complete") input.setStore("status", "partial")

  Promise.all([
    input.sdk.project.instance.info({ projectID: input.projectID }).then((x) => {
      if (x.data)
        input.setStore("path", {
          home: "",
          state: "",
          config: "",
          worktree: x.data.worktree,
          directory: x.data.directory,
        })
    }),
    input.sdk.project.command.list({ projectID: input.projectID }).then((x) => input.setStore("command", x.data ?? [])),
    input.sdk.project.session.status({ projectID: input.projectID }).then((x) => {
      if (x.data) input.setStore("session_status", x.data)
    }),
    input.loadSessions(input.directory),
    input.sdk.project.mcp.status({ projectID: input.projectID }).then((x) => {
      if (x.data) input.setStore("mcp", x.data)
    }),
    input.sdk.project.lsp.status({ projectID: input.projectID }).then((x) => {
      if (x.data) input.setStore("lsp", x.data)
    }),
    input.sdk.project.vcs({ projectID: input.projectID }).then((x) => {
      const next = x.data ?? input.store.vcs
      input.setStore("vcs", next)
      if (next?.branch) input.vcsCache.setStore("value", next)
    }),
    input.sdk.project.permission.list({ projectID: input.projectID }).then((x) => {
      const grouped = groupBySession(
        (x.data ?? []).filter((perm): perm is PermissionRequest => !!perm?.id && !!perm.sessionID),
      )
      batch(() => {
        for (const sessionID of Object.keys(input.store.permission)) {
          if (grouped[sessionID]) continue
          input.setStore("permission", sessionID, [])
        }
        for (const [sessionID, permissions] of Object.entries(grouped)) {
          input.setStore(
            "permission",
            sessionID,
            reconcile(
              permissions.filter((p) => !!p?.id).sort((a, b) => cmp(a.id, b.id)),
              { key: "id" },
            ),
          )
        }
      })
    }),
    input.sdk.project.question.list({ projectID: input.projectID }).then((x) => {
      const grouped = groupBySession((x.data ?? []).filter((q): q is QuestionRequest => !!q?.id && !!q.sessionID))
      batch(() => {
        for (const sessionID of Object.keys(input.store.question)) {
          if (grouped[sessionID]) continue
          input.setStore("question", sessionID, [])
        }
        for (const [sessionID, questions] of Object.entries(grouped)) {
          input.setStore(
            "question",
            sessionID,
            reconcile(
              questions.filter((q) => !!q?.id).sort((a, b) => cmp(a.id, b.id)),
              { key: "id" },
            ),
          )
        }
      })
    }),
  ]).then(() => {
    input.setStore("status", "complete")
  })
}
