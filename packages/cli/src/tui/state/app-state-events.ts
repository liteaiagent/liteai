import type { Snapshot } from "@liteai/core/snapshot/index"
import type {
  Event,
  LiteaiClient,
  McpStatus,
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

export interface EventContext {
  setState: AppStore<AppState>["setState"]
  getState: AppStore<AppState>["getState"]
  sdk: LiteaiClient
  projectID: string
  bootstrap: () => Promise<void>
}

export function handleAppStateEvent(event: Event, ctx: EventContext) {
  const { setState, getState, sdk, projectID, bootstrap } = ctx

  switch (event.type) {
    case "server.instance.disposed":
      void bootstrap()
      break

    case "permission.replied": {
      const sessionID = event.properties.sessionID
      const requestID = event.properties.requestID
      setState((prev) => {
        const requests = prev.permission[sessionID]
        if (!requests) return prev
        const match = Binary.search(requests as any[], requestID, (r: any) => r.id)
        if (match.found) {
          const nextReqs = [...requests]
          nextReqs.splice(match.index, 1)
          return { ...prev, permission: { ...prev.permission, [sessionID]: nextReqs } }
        }
        return prev
      })
      break
    }

    case "permission.asked": {
      const request = event.properties as unknown as PermissionRequest
      setState((prev) => {
        const requests = prev.permission[request.sessionID] || []
        const match = Binary.search(requests as any[], request.id, (r: any) => r.id)
        const nextReqs = [...requests]
        if (match.found) {
          nextReqs[match.index] = request
        } else {
          nextReqs.splice(match.index, 0, request)
        }
        return { ...prev, permission: { ...prev.permission, [request.sessionID]: nextReqs } }
      })
      break
    }

    case "question.replied":
    case "question.rejected": {
      const sessionID = event.properties.sessionID
      const requestID = event.properties.requestID
      setState((prev) => {
        const requests = prev.question[sessionID]
        if (!requests) return prev
        const match = Binary.search(requests as any[], requestID, (r: any) => r.id)
        if (match.found) {
          const nextReqs = [...requests]
          nextReqs.splice(match.index, 1)
          return { ...prev, question: { ...prev.question, [sessionID]: nextReqs } }
        }
        return prev
      })
      break
    }

    case "question.asked": {
      const request = event.properties as unknown as QuestionRequest
      setState((prev) => {
        const requests = prev.question[request.sessionID] || []
        const match = Binary.search(requests as any[], request.id, (r: any) => r.id)
        const nextReqs = [...requests]
        if (match.found) {
          nextReqs[match.index] = request
        } else {
          nextReqs.splice(match.index, 0, request)
        }
        return { ...prev, question: { ...prev.question, [request.sessionID]: nextReqs } }
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
        const match = Binary.search(prev.sessions as any[], event.properties.info.id, (s: any) => s.id)
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
        const match = Binary.search(prev.sessions as any[], info.id, (s: any) => s.id)
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

    case "message.updated": {
      const info = event.properties.info as Message
      setState((prev) => {
        const messages = prev.message[info.sessionID] || []
        const match = Binary.search(messages as any[], info.id, (m: any) => m.id)
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
        return { ...prev, message: { ...prev.message, [info.sessionID]: nextMsgs }, part: nextPart }
      })
      break
    }

    case "message.removed": {
      setState((prev) => {
        const sessionID = event.properties.sessionID
        const messageID = event.properties.messageID
        const messages = prev.message[sessionID]
        if (!messages) return prev
        const match = Binary.search(messages as any[], messageID, (m: any) => m.id)
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
        const match = Binary.search(parts as any[], p.id, (x: any) => x.id)
        const nextParts = [...parts]
        if (match.found) {
          nextParts[match.index] = p
        } else {
          nextParts.splice(match.index, 0, p)
        }
        return { ...prev, part: { ...prev.part, [p.messageID]: nextParts } }
      })
      break
    }

    case "message.part.delta": {
      const { messageID, partID, field, delta } = event.properties
      setState((prev) => {
        const parts = prev.part[messageID]
        if (!parts) return prev
        const match = Binary.search(parts as any[], partID, (p: any) => p.id)
        if (match.found) {
          const nextParts = [...parts]
          const existingPart = nextParts[match.index] as any
          nextParts[match.index] = { ...existingPart, [field]: (existingPart[field] ?? "") + delta }
          return { ...prev, part: { ...prev.part, [messageID]: nextParts } }
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
        const match = Binary.search(parts as any[], partID, (p: any) => p.id)
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
  }
}
