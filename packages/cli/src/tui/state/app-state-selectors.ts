import type { Snapshot } from "@liteai/core/snapshot/index"
import type {
  Message,
  Part,
  PermissionRequest,
  QuestionRequest,
  Session,
  SessionStatus,
  Todo,
  Workspace,
} from "@liteai/sdk"
import type { AppState } from "./app-state"
import { EMPTY_DIFFS, EMPTY_MESSAGES, EMPTY_PARTS, EMPTY_PERMISSIONS, EMPTY_QUESTIONS, EMPTY_TODOS } from "./app-state"

/**
 * Selector factories for useAppState.
 * These return memoized selector functions to prevent unnecessary re-renders.
 */

function getOrSet<K, V>(map: Map<K, V>, key: K, factory: () => V): V {
  let value = map.get(key)
  if (!value) {
    value = factory()
    map.set(key, value)
  }
  return value
}

const messagesCache = new Map<string, (s: AppState) => readonly Message[]>()
export function selectMessages(sessionID: string | undefined) {
  if (!sessionID) return () => EMPTY_MESSAGES
  return getOrSet(messagesCache, sessionID, () => (s: AppState) => s.message[sessionID] ?? EMPTY_MESSAGES)
}

const partsCache = new Map<string, (s: AppState) => readonly Part[]>()
export function selectParts(messageID: string) {
  return getOrSet(partsCache, messageID, () => (s: AppState) => s.part[messageID] ?? EMPTY_PARTS)
}

const permissionsCache = new Map<string, (s: AppState) => readonly PermissionRequest[]>()
export function selectPermissions(sessionID: string | undefined) {
  if (!sessionID) return () => EMPTY_PERMISSIONS
  return getOrSet(permissionsCache, sessionID, () => (s: AppState) => s.permission[sessionID] ?? EMPTY_PERMISSIONS)
}

const questionsCache = new Map<string, (s: AppState) => readonly QuestionRequest[]>()
export function selectQuestions(sessionID: string | undefined) {
  if (!sessionID) return () => EMPTY_QUESTIONS
  return getOrSet(questionsCache, sessionID, () => (s: AppState) => s.question[sessionID] ?? EMPTY_QUESTIONS)
}

const todosCache = new Map<string, (s: AppState) => readonly Todo[]>()
export function selectTodos(sessionID: string) {
  return getOrSet(todosCache, sessionID, () => (s: AppState) => s.todo[sessionID] ?? EMPTY_TODOS)
}

const diffsCache = new Map<string, (s: AppState) => readonly Snapshot.FileDiff[]>()
export function selectSessionDiff(sessionID: string | undefined) {
  if (!sessionID) return () => EMPTY_DIFFS
  return getOrSet(diffsCache, sessionID, () => (s: AppState) => s.session_diff[sessionID] ?? EMPTY_DIFFS)
}

const sessionStatusCache = new Map<string, (s: AppState) => SessionStatus | undefined>()
export function selectSessionStatus(sessionID: string | undefined) {
  if (!sessionID) return () => undefined
  return getOrSet(sessionStatusCache, sessionID, () => (s: AppState) => s.session_status[sessionID])
}

const isWorkingCache = new Map<string | undefined, (s: AppState) => boolean>()
export function selectIsWorking(sessionID?: string) {
  return getOrSet(isWorkingCache, sessionID, () => (s: AppState) => {
    if (!sessionID) return false

    // Server-authoritative: if the server explicitly reports idle, trust it.
    // This handles the case where the engine crashed before creating an
    // assistant message — messages still show "user last" but the server
    // has already cleaned up and published session.status = idle.
    const serverStatus = s.session_status[sessionID]
    if (serverStatus?.type === "idle") return false

    const session = s.sessions.find((x) => x.id === sessionID)
    if (session?.time.compacting) return true

    const messages = s.message[sessionID]
    if (!messages || messages.length === 0) return false

    const last = messages[messages.length - 1]
    if (last.role === "user") return true
    return !last.time.completed
  })
}

const sessionCache = new Map<string, (s: AppState) => Session | undefined>()
export function selectSession(sessionID: string) {
  return getOrSet(sessionCache, sessionID, () => (s: AppState) => s.sessions.find((x) => x.id === sessionID))
}

const workspaceCache = new Map<string, (s: AppState) => Workspace | undefined>()
export function selectWorkspace(workspaceID: string) {
  return getOrSet(workspaceCache, workspaceID, () => (s: AppState) => s.workspaceList.find((w) => w.id === workspaceID))
}

const selectSessionsFn = (s: AppState) => s.sessions
export function selectSessions() {
  return selectSessionsFn
}

const selectProvidersFn = (s: AppState) => s.provider
export function selectProviders() {
  return selectProvidersFn
}

const selectMcpConfigFn = (s: AppState) => s.config?.mcpServers ?? ({} as NonNullable<typeof s.config.mcpServers>)
export function selectMcpConfig() {
  return selectMcpConfigFn
}
