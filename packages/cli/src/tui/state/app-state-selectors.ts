import type { AppState } from "./app-state"
import { EMPTY_DIFFS, EMPTY_MESSAGES, EMPTY_PARTS, EMPTY_PERMISSIONS, EMPTY_QUESTIONS, EMPTY_TODOS } from "./app-state"

/**
 * Selector factories for useAppState.
 * These return selector functions that can be passed to useAppState(selector).
 *
 * Example:
 *   const messages = useAppState(selectMessages(sessionID))
 */

export function selectMessages(sessionID: string) {
  return (s: AppState) => s.message[sessionID] ?? EMPTY_MESSAGES
}

export function selectParts(messageID: string) {
  return (s: AppState) => s.part[messageID] ?? EMPTY_PARTS
}

export function selectPermissions(sessionID: string) {
  return (s: AppState) => s.permission[sessionID] ?? EMPTY_PERMISSIONS
}

export function selectQuestions(sessionID: string) {
  return (s: AppState) => s.question[sessionID] ?? EMPTY_QUESTIONS
}

export function selectTodos(sessionID: string) {
  return (s: AppState) => s.todo[sessionID] ?? EMPTY_TODOS
}

export function selectSessionDiff(sessionID: string) {
  return (s: AppState) => s.session_diff[sessionID] ?? EMPTY_DIFFS
}

export function selectSessionStatus(sessionID: string) {
  return (s: AppState) => s.session_status[sessionID]
}

export function selectIsWorking(sessionID?: string) {
  return (s: AppState) => {
    if (!sessionID) return false
    const session = s.sessions.find((x) => x.id === sessionID)
    if (session?.time.compacting) return true

    const messages = s.message[sessionID]
    if (!messages || messages.length === 0) return false

    const last = messages[messages.length - 1]
    if (last.role === "user") return true
    return !last.time.completed
  }
}

export function selectSession(sessionID: string) {
  return (s: AppState) => s.sessions.find((x) => x.id === sessionID)
}

export function selectWorkspace(workspaceID: string) {
  return (s: AppState) => s.workspaceList.find((w) => w.id === workspaceID)
}

export function selectSessions() {
  return (s: AppState) => s.sessions
}

export function selectProviders() {
  return (s: AppState) => s.provider
}

export function selectMcpConfig() {
  return (s: AppState) => s.config?.mcpServers ?? ({} as NonNullable<typeof s.config.mcpServers>)
}
