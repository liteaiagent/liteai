import { PermissionModeCyclable } from "@liteai/core/session/schema"
import type { Snapshot } from "@liteai/core/snapshot/index"
import type {
  Event,
  LiteaiClient,
  Message,
  Part,
  PermissionRequest,
  QuestionRequest,
  Session,
  SessionStatus,
  Todo,
  VcsInfo,
} from "@liteai/sdk"
import { Binary } from "@liteai/util/binary"
import { clearDynamicCompactTools } from "../constants/compact-allowlist"
import type { AppState } from "./app-state"
import type { AppStore } from "./app-store"

export function capPartMap(
  partMap: Readonly<Record<string, readonly Part[]>>,
): Readonly<Record<string, readonly Part[]>> {
  const keys = Object.keys(partMap)
  if (keys.length <= 500) return partMap

  const nextPart = { ...partMap }
  for (let i = 0; i < keys.length - 500; i++) {
    delete nextPart[keys[i]]
  }
  return nextPart
}

export interface EventContext {
  setState: AppStore<AppState>["setState"]
  getState: AppStore<AppState>["getState"]
  sdk: LiteaiClient
  projectID: string
  bootstrap: () => Promise<void>
  /** Called when the server publishes a session error (e.g., model not found).
   * The UI layer wires this to a toast notification. */
  onSessionError?: (sessionID: string, error: unknown) => void
}

export function handleAppStateEvent(event: Event, ctx: EventContext) {
  const { setState, getState, sdk, projectID, bootstrap, onSessionError } = ctx

  switch (event.type) {
    case "server.instance.disposed":
      void bootstrap()
      break

    case "permission.replied": {
      const requestID = event.properties.requestID
      setState((prev) => {
        let foundSessionID: string | undefined
        let foundIndex = -1
        let foundRequests: readonly PermissionRequest[] | undefined

        for (const [sid, requests] of Object.entries(prev.permission)) {
          if (!requests) continue
          const match = Binary.search(requests as PermissionRequest[], requestID, (r: PermissionRequest) => r.id)
          if (match.found) {
            foundSessionID = sid
            foundIndex = match.index
            foundRequests = requests
            break
          }
        }

        if (foundSessionID && foundRequests) {
          const nextReqs = [...foundRequests]
          nextReqs.splice(foundIndex, 1)
          return { ...prev, permission: { ...prev.permission, [foundSessionID]: nextReqs } }
        }
        return prev
      })
      break
    }

    case "permission.asked": {
      const request = event.properties as unknown as PermissionRequest
      // Bubble mode: use rootSessionID (if set by a subagent) so the prompt
      // appears in the root session's UI instead of the child session's.
      const displaySessionID =
        (request as PermissionRequest & { rootSessionID?: string }).rootSessionID ?? request.sessionID
      setState((prev) => {
        const requests = prev.permission[displaySessionID] || []
        const match = Binary.search(requests as PermissionRequest[], request.id, (r: PermissionRequest) => r.id)
        const nextReqs = [...requests]
        if (match.found) {
          nextReqs[match.index] = request
        } else {
          nextReqs.splice(match.index, 0, request)
        }
        return { ...prev, permission: { ...prev.permission, [displaySessionID]: nextReqs } }
      })
      break
    }

    case "question.replied":
    case "question.rejected": {
      const requestID = event.properties.requestID
      setState((prev) => {
        let foundSessionID: string | undefined
        let foundIndex = -1
        let foundRequests: readonly QuestionRequest[] | undefined

        for (const [sid, requests] of Object.entries(prev.question)) {
          if (!requests) continue
          const match = Binary.search(requests as QuestionRequest[], requestID, (r: QuestionRequest) => r.id)
          if (match.found) {
            foundSessionID = sid
            foundIndex = match.index
            foundRequests = requests
            break
          }
        }

        if (foundSessionID && foundRequests) {
          const nextReqs = [...foundRequests]
          nextReqs.splice(foundIndex, 1)
          return { ...prev, question: { ...prev.question, [foundSessionID]: nextReqs } }
        }
        return prev
      })
      break
    }

    case "question.asked": {
      const request = event.properties as unknown as QuestionRequest
      // Bubble mode: use rootSessionID (if set by a subagent) so the question
      // appears in the root session's UI instead of the child session's.
      const displaySessionID =
        (request as QuestionRequest & { rootSessionID?: string }).rootSessionID ?? request.sessionID
      setState((prev) => {
        const requests = prev.question[displaySessionID] || []
        const match = Binary.search(requests as QuestionRequest[], request.id, (r: QuestionRequest) => r.id)
        const nextReqs = [...requests]
        if (match.found) {
          nextReqs[match.index] = request
        } else {
          nextReqs.splice(match.index, 0, request)
        }
        return { ...prev, question: { ...prev.question, [displaySessionID]: nextReqs } }
      })
      break
    }

    case "todo.updated": {
      setState((prev) => ({
        ...prev,
        todo: { ...prev.todo, [event.properties.sessionID]: event.properties.todos as Todo[] },
      }))
      break
    }

    case "session.diff": {
      setState((prev) => ({
        ...prev,
        session_diff: {
          ...prev.session_diff,
          [event.properties.sessionID]: event.properties.diff as Snapshot.FileDiff[],
        },
      }))
      break
    }

    case "session.deleted": {
      setState((prev) => {
        const match = Binary.search(prev.sessions as Session[], event.properties.info.id, (s: Session) => s.id)
        if (match.found) {
          const nextSessions = [...prev.sessions]
          nextSessions.splice(match.index, 1)
          return { ...prev, sessions: nextSessions }
        }
        return prev
      })
      break
    }

    case "session.updated": {
      setState((prev) => {
        const info = event.properties.info as Session
        const match = Binary.search(prev.sessions as Session[], info.id, (s: Session) => s.id)
        const nextSessions = [...prev.sessions]
        if (match.found) {
          nextSessions[match.index] = info
        } else {
          nextSessions.splice(match.index, 0, info)
        }
        return { ...prev, sessions: nextSessions }
      })
      break
    }

    case "session.status": {
      setState((prev) => ({
        ...prev,
        session_status: {
          ...prev.session_status,
          [event.properties.sessionID]: event.properties.status as SessionStatus,
        },
      }))
      break
    }

    case "session.error": {
      const sessionID = event.properties.sessionID as string
      const error = event.properties.error as { name?: string; message?: string } | undefined

      // If the last message is an incomplete assistant, attach the error and
      // mark it completed so selectIsWorking transitions to false.
      // Additionally, explicitly set session_status to idle.
      setState((prev) => {
        const nextStatus = {
          ...prev.session_status,
          [sessionID]: { type: "idle" } as SessionStatus,
        }

        const messages = prev.message[sessionID]
        if (!messages || messages.length === 0) {
          return { ...prev, session_status: nextStatus }
        }

        const last = messages[messages.length - 1]
        if (last.role === "assistant" && !last.time.completed) {
          const nextMsgs = [...messages]
          nextMsgs[messages.length - 1] = {
            ...last,
            error: {
              name: "UnknownError" as const,
              data: { message: error?.message ?? "Session failed" },
            },
            time: { ...last.time, completed: Date.now() },
          }
          return { ...prev, session_status: nextStatus, message: { ...prev.message, [sessionID]: nextMsgs } }
        }

        return { ...prev, session_status: nextStatus }
      })

      // Surface the error to the user via toast
      onSessionError?.(sessionID, error)
      break
    }

    case "message.updated": {
      const info = event.properties.info as Message
      setState((prev) => {
        const messages = prev.message[info.sessionID] || []
        const match = Binary.search(messages as Message[], info.id, (m: Message) => m.id)
        const nextMsgs = [...messages]
        if (match.found) {
          nextMsgs[match.index] = info
        } else {
          nextMsgs.splice(match.index, 0, info)
        }

        let nextPart = prev.part
        if (nextMsgs.length > 100) {
          const oldest = nextMsgs.shift()
          if (oldest && nextPart[oldest.id]) {
            const { [oldest.id]: _, ...restParts } = nextPart
            nextPart = restParts
          }
        }
        return { ...prev, message: { ...prev.message, [info.sessionID]: nextMsgs }, part: capPartMap(nextPart) }
      })
      break
    }

    case "message.removed": {
      setState((prev) => {
        const sessionID = event.properties.sessionID
        const messageID = event.properties.messageID
        const messages = prev.message[sessionID]
        if (!messages) return prev
        const match = Binary.search(messages as Message[], messageID, (m: Message) => m.id)
        if (match.found) {
          const nextMsgs = [...messages]
          nextMsgs.splice(match.index, 1)
          return { ...prev, message: { ...prev.message, [sessionID]: nextMsgs } }
        }
        return prev
      })
      break
    }

    case "message.part.updated": {
      const p = event.properties.part as Part
      setState((prev) => {
        const parts = prev.part[p.messageID] || []
        const match = Binary.search(parts as Part[], p.id, (x: Part) => x.id)
        const nextParts = [...parts]
        if (match.found) {
          nextParts[match.index] = p
        } else {
          nextParts.splice(match.index, 0, p)
        }
        return { ...prev, part: capPartMap({ ...prev.part, [p.messageID]: nextParts }) }
      })
      break
    }

    case "message.part.delta": {
      const { messageID, partID, field, delta } = event.properties
      setState((prev) => {
        const parts = prev.part[messageID]
        if (!parts) return prev
        const match = Binary.search(parts as Part[], partID, (p: Part) => p.id)
        if (match.found) {
          const nextParts = [...parts]
          const existingPart = nextParts[match.index] as Record<string, unknown>
          nextParts[match.index] = {
            ...existingPart,
            [field]: ((existingPart[field] as string | undefined) ?? "") + delta,
          } as unknown as Part
          return { ...prev, part: capPartMap({ ...prev.part, [messageID]: nextParts }) }
        }
        return prev
      })
      break
    }

    case "message.part.removed": {
      setState((prev) => {
        const messageID = event.properties.messageID
        const partID = event.properties.partID
        const parts = prev.part[messageID]
        if (!parts) return prev
        const match = Binary.search(parts as Part[], partID, (p: Part) => p.id)
        if (match.found) {
          const nextParts = [...parts]
          nextParts.splice(match.index, 1)
          return { ...prev, part: { ...prev.part, [messageID]: nextParts } }
        }
        return prev
      })
      break
    }

    case "lsp.updated": {
      void sdk.project.lsp.status({ projectID }).then((x) => {
        setState((prev) => ({ ...prev, lsp: x.data ?? [] }))
      })
      break
    }

    case "mcp.tools.changed": {
      void sdk.project.mcp.status({ projectID }).then((x) => {
        const newStatus = x.data ?? {}
        const oldStatus = getState().mcp
        for (const [serverName, status] of Object.entries(oldStatus)) {
          if (status.status === "connected" && newStatus[serverName]?.status !== "connected") {
            clearDynamicCompactTools()
          }
        }
        setState((prev) => ({ ...prev, mcp: newStatus }))
      })
      break
    }

    case "vcs.branch.updated": {
      setState((prev) => ({
        ...prev,
        vcs: { ...prev.vcs, branch: event.properties.branch } as VcsInfo,
      }))
      break
    }

    case "agent.spawned": {
      const { agentId, agentType, parentId, isAsync } = event.properties
      setState((prev) => ({
        ...prev,
        agents: {
          ...prev.agents,
          [agentId]: {
            type: agentType,
            parentId,
            isAsync,
            status: "running",
            startTime: Date.now(),
          },
        },
      }))
      break
    }

    case "agent.progress": {
      const { agentId, activity } = event.properties
      setState((prev) => {
        const agent = prev.agents[agentId]
        if (!agent) return prev
        return {
          ...prev,
          agents: {
            ...prev.agents,
            [agentId]: { ...agent, activity },
          },
        }
      })
      break
    }

    case "agent.completed": {
      const { agentId, status, duration, usage } = event.properties
      setState((prev) => {
        const agent = prev.agents[agentId]
        if (!agent) return prev
        return {
          ...prev,
          agents: {
            ...prev.agents,
            [agentId]: { ...agent, status, duration, usage },
          },
        }
      })

      // Schedule eviction for completed agents after 5 minutes
      setTimeout(
        () => {
          setState((prev) => {
            const { [agentId]: _, ...rest } = prev.agents
            return { ...prev, agents: rest }
          })
        },
        5 * 60 * 1000,
      )
      break
    }

    case "plan.approval_requested": {
      const sessionID = event.properties.sessionID as string
      setState((prev) => ({
        ...prev,
        planApproval: {
          sessionID,
          planText: event.properties.planText as string,
          planFilePath: event.properties.planFilePath as string,
        },
      }))
      break
    }

    case "permission_mode.changed": {
      const sessionID = event.properties.sessionID as string
      const permissionMode = event.properties.permissionMode as string

      if (!(PermissionModeCyclable.options as readonly string[]).includes(permissionMode)) {
        console.warn(
          `[TUI] Received agent-only or unknown permission mode '${permissionMode}' for session ${sessionID}`,
        )
      }

      setState((prev) => ({
        ...prev,
        permissionMode: {
          ...prev.permissionMode,
          [sessionID]: permissionMode,
        },
      }))
      break
    }
  }
}
