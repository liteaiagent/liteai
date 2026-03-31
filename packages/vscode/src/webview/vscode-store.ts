import type {
  Agent,
  Config,
  Message,
  Part,
  PermissionRequest,
  QuestionRequest,
  Session,
  SessionStatus,
  Todo,
  VcsInfo,
} from "@liteai/sdk/client"
import { batch } from "solid-js"
import { createStore, produce, reconcile, type SetStoreFunction, type Store } from "solid-js/store"

/**
 * Simple binary search for sorted arrays with string IDs.
 * Returns { found, index } where index is the insertion point if not found.
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
 * Lightweight reactive state store for the VSCode webview.
 *
 * This mirrors the subset of `global-sync` `State` that the ChatController
 * needs, without the full multi-directory LRU/caching infrastructure.
 * In VSCode, we manage a single project directory at a time.
 */
export type VscodeState = {
  /** Whether initial data has loaded. */
  ready: boolean
  /** Current project directory path. */
  directory: string
  /** Current project ID (slug). */
  projectID: string
  /** Project config. */
  config: Config
  /** List of agents. */
  agent: Agent[]
  /** Sessions for the active project. */
  session: Session[]
  /** Session status by session ID. */
  session_status: Record<string, SessionStatus>
  /** Messages by session ID. */
  message: Record<string, Message[]>
  /** Parts by message ID. */
  part: Record<string, Part[]>
  /** VCS info (branch, etc.). */
  vcs: VcsInfo | undefined
  /** Permission requests by session ID. */
  permission: Record<string, PermissionRequest[]>
  /** Question requests by session ID. */
  question: Record<string, QuestionRequest[]>
  /** Session TODO items by session ID. */
  todo: Record<string, Todo[]>
}

export type VscodeStore = {
  store: Store<VscodeState>
  set: SetStoreFunction<VscodeState>
  /** Mark the store as ready after initial data load. */
  setReady(): void
  /** Update directory/projectID. */
  setProject(directory: string, projectID: string): void
}

export function createVscodeStore(opts?: { directory?: string; projectID?: string }): VscodeStore {
  const [store, set] = createStore<VscodeState>({
    ready: false,
    directory: opts?.directory ?? "",
    projectID: opts?.projectID ?? "",
    config: {} as Config,
    agent: [],
    session: [],
    session_status: {},
    message: {},
    part: {},
    vcs: undefined,
    permission: {},
    question: {},
    todo: {},
  })

  return {
    store,
    set,
    setReady() {
      set("ready", true)
    },
    setProject(directory: string, projectID: string) {
      batch(() => {
        set("directory", directory)
        set("projectID", projectID)
      })
    },
  }
}

/**
 * Apply a single SSE event to the VSCode store.
 *
 * This is a simplified version of `applyDirectoryEvent` from global-sync,
 * tailored for the single-project VSCode context.
 */
export function applyEvent(
  store: Store<VscodeState>,
  set: SetStoreFunction<VscodeState>,
  event: { type: string; properties?: unknown },
) {
  switch (event.type) {
    case "session.created": {
      const info = (event.properties as { info: Session }).info
      const result = bsearch(store.session, info.id, (s: Session) => s.id)
      if (result.found) {
        set("session", result.index, reconcile(info))
      } else {
        set(
          "session",
          produce((draft: Session[]) => {
            draft.splice(result.index, 0, info)
          }),
        )
      }
      break
    }
    case "session.updated": {
      const info = (event.properties as { info: Session }).info
      const result = bsearch(store.session, info.id, (s: Session) => s.id)
      if (info.time.archived) {
        if (result.found) {
          set(
            "session",
            produce((draft: Session[]) => {
              draft.splice(result.index, 1)
            }),
          )
        }
        break
      }
      if (result.found) {
        set("session", result.index, reconcile(info))
      } else {
        set(
          "session",
          produce((draft: Session[]) => {
            draft.splice(result.index, 0, info)
          }),
        )
      }
      break
    }
    case "session.deleted": {
      const info = (event.properties as { info: Session }).info
      const result = bsearch(store.session, info.id, (s: Session) => s.id)
      if (result.found) {
        set(
          "session",
          produce((draft: Session[]) => {
            draft.splice(result.index, 1)
          }),
        )
      }
      break
    }
    case "session.status": {
      const props = event.properties as { sessionID: string; status: SessionStatus }
      set("session_status", props.sessionID, reconcile(props.status))
      break
    }
    case "message.updated": {
      const info = (event.properties as { info: Message }).info
      const messages = store.message[info.sessionID]
      if (!messages) {
        set("message", info.sessionID, [info])
        break
      }
      const result = bsearch(messages, info.id, (m: Message) => m.id)
      if (result.found) {
        set("message", info.sessionID, result.index, reconcile(info))
      } else {
        set(
          "message",
          info.sessionID,
          produce((draft: Message[]) => {
            draft.splice(result.index, 0, info)
          }),
        )
      }
      break
    }
    case "message.removed": {
      const props = event.properties as { sessionID: string; messageID: string }
      set(
        produce((draft: VscodeState) => {
          const messages = draft.message[props.sessionID]
          if (messages) {
            const result = bsearch(messages, props.messageID, (m: Message) => m.id)
            if (result.found) messages.splice(result.index, 1)
          }
          delete draft.part[props.messageID]
        }),
      )
      break
    }
    case "message.part.updated": {
      const part = (event.properties as { part: Part }).part
      const parts = store.part[part.messageID]
      if (!parts) {
        set("part", part.messageID, [part])
        break
      }
      const result = bsearch(parts, part.id, (p: Part) => p.id)
      if (result.found) {
        set("part", part.messageID, result.index, reconcile(part))
      } else {
        set(
          "part",
          part.messageID,
          produce((draft: Part[]) => {
            draft.splice(result.index, 0, part)
          }),
        )
      }
      break
    }
    case "message.part.removed": {
      const props = event.properties as { messageID: string; partID: string }
      const parts = store.part[props.messageID]
      if (!parts) break
      const result = bsearch(parts, props.partID, (p: Part) => p.id)
      if (result.found) {
        set(
          produce((draft: VscodeState) => {
            const list = draft.part[props.messageID]
            if (!list) return
            const next = bsearch(list, props.partID, (p: Part) => p.id)
            if (!next.found) return
            list.splice(next.index, 1)
            if (list.length === 0) delete draft.part[props.messageID]
          }),
        )
      }
      break
    }
    case "message.part.delta": {
      const props = event.properties as { messageID: string; partID: string; field: string; delta: string }
      const parts = store.part[props.messageID]
      if (!parts) break
      const result = bsearch(parts, props.partID, (p: Part) => p.id)
      if (!result.found) break
      set(
        "part",
        props.messageID,
        produce((draft: Part[]) => {
          const part = draft[result.index]
          const field = props.field as keyof typeof part
          const existing = part[field] as string | undefined
          ;(part[field] as string) = (existing ?? "") + props.delta
        }),
      )
      break
    }
    case "vcs.branch.updated": {
      const props = event.properties as { branch: string }
      set("vcs", { branch: props.branch })
      break
    }
    case "permission.asked": {
      const permission = event.properties as PermissionRequest
      const permissions = store.permission[permission.sessionID]
      if (!permissions) {
        set("permission", permission.sessionID, [permission])
        break
      }
      const result = bsearch(permissions, permission.id, (p: PermissionRequest) => p.id)
      if (result.found) {
        set("permission", permission.sessionID, result.index, reconcile(permission))
      } else {
        set(
          "permission",
          permission.sessionID,
          produce((draft: PermissionRequest[]) => {
            draft.splice(result.index, 0, permission)
          }),
        )
      }
      break
    }
    case "permission.replied": {
      const props = event.properties as { sessionID: string; requestID: string }
      const permissions = store.permission[props.sessionID]
      if (!permissions) break
      const result = bsearch(permissions, props.requestID, (p: PermissionRequest) => p.id)
      if (result.found) {
        set(
          "permission",
          props.sessionID,
          produce((draft: PermissionRequest[]) => {
            draft.splice(result.index, 1)
          }),
        )
      }
      break
    }
    case "todo.updated": {
      const props = event.properties as { sessionID: string; todos: Todo[] }
      set("todo", props.sessionID, reconcile(props.todos, { key: "id" }))
      break
    }
    case "question.asked": {
      const question = event.properties as QuestionRequest
      const questions = store.question[question.sessionID]
      if (!questions) {
        set("question", question.sessionID, [question])
        break
      }
      const result = bsearch(questions, question.id, (q: QuestionRequest) => q.id)
      if (result.found) {
        set("question", question.sessionID, result.index, reconcile(question))
      } else {
        set(
          "question",
          question.sessionID,
          produce((draft: QuestionRequest[]) => {
            draft.splice(result.index, 0, question)
          }),
        )
      }
      break
    }
    case "question.replied":
    case "question.rejected": {
      const props = event.properties as { sessionID: string; requestID: string }
      const questions = store.question[props.sessionID]
      if (!questions) break
      const result = bsearch(questions, props.requestID, (q: QuestionRequest) => q.id)
      if (result.found) {
        set(
          "question",
          props.sessionID,
          produce((draft: QuestionRequest[]) => {
            draft.splice(result.index, 1)
          }),
        )
      }
      break
    }
  }
}
