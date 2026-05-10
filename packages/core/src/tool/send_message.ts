import { randomUUID } from "node:crypto"
import z from "zod"
import { AgentExecutionContext, type AppState, type ParentContext } from "../agent/context"
import { resumeAgentBackground } from "../agent/resume"
import { type TeammateMessage, writeToMailbox } from "../coordinator/teammate-mailbox"
import { Tool } from "./tool"

export function queuePendingMessage(
  agentId: string,
  message: string,
  setAppState: (updater: (state: AppState) => AppState) => void,
): void {
  setAppState((state) => {
    const tasks = state.tasks || {}
    const task = tasks[agentId] || {}
    const pendingMessages = task.pendingMessages || []
    return {
      ...state,
      tasks: {
        ...tasks,
        [agentId]: {
          ...task,
          pendingMessages: [...pendingMessages, message],
        },
      },
    }
  })
}

export async function routeMessage(params: {
  recipientNameOrId: string
  message: string
  summary?: string
  sessionContext: ParentContext
  invokingRequestId?: string
  senderName?: string
}): Promise<{ success: boolean; message: string }> {
  const { recipientNameOrId, message, summary, sessionContext, invokingRequestId, senderName = "coordinator" } = params

  const appState = sessionContext.getAppState()

  // 1. Name Resolution
  let agentId = recipientNameOrId
  if (appState.agentNameRegistry?.[recipientNameOrId]) {
    agentId = appState.agentNameRegistry[recipientNameOrId]
  }

  // 2. Broadcast Routing
  if (recipientNameOrId === "*") {
    if (!appState.teamContext) {
      return { success: false, message: "Cannot broadcast: no active team found." }
    }
    const teamName = appState.teamContext.teamName
    const teammates = Object.keys(appState.teamContext.teammates || {})

    let sentCount = 0
    for (const mate of teammates) {
      if (mate !== senderName) {
        // Don't send to self
        const teammateMessage: TeammateMessage = {
          from: senderName,
          text: message,
          timestamp: new Date().toISOString(),
          read: false,
          summary,
        }
        await writeToMailbox(mate, teammateMessage, teamName)
        sentCount++
      }
    }

    return { success: true, message: `Broadcast message sent to ${sentCount} teammates.` }
  }

  // 3. Teammate Mailbox Routing
  // If the recipient is in the teamContext, route to their file-based mailbox.
  // teamContext.teammates is keyed by name (not UUID), so we must try the
  // original recipientNameOrId first, then the resolved agentId as fallback.
  const teammateKey = appState.teamContext?.teammates?.[recipientNameOrId]
    ? recipientNameOrId
    : appState.teamContext?.teammates?.[agentId]
      ? agentId
      : null

  if (teammateKey && appState.teamContext) {
    const teamName = appState.teamContext.teamName
    const teammateMessage: TeammateMessage = {
      from: senderName,
      text: message,
      timestamp: new Date().toISOString(),
      read: false,
      summary,
    }
    await writeToMailbox(teammateKey, teammateMessage, teamName)
    return {
      success: true,
      message: `Message sent to teammate ${recipientNameOrId}'s mailbox.`,
    }
  }

  // 4. Subagent State Routing
  const task = appState.tasks?.[agentId]

  if (task) {
    if (task.status === "running") {
      queuePendingMessage(agentId, message, sessionContext.setAppStateForTasks ?? sessionContext.setAppState)
      return {
        success: true,
        message: `Message queued for delivery to ${recipientNameOrId} at its next tool round.`,
      }
    } else {
      try {
        await resumeAgentBackground({
          agentId,
          prompt: message,
          sessionContext,
          invokingRequestId,
        })
        return {
          success: true,
          message: `Agent ${recipientNameOrId} was stopped (${task.status}); resumed it in the background with your message.`,
        }
      } catch (e: unknown) {
        return {
          success: false,
          message: `Agent ${recipientNameOrId} is stopped (${task.status}) and could not be resumed: ${e instanceof Error ? e.message : String(e)}`,
        }
      }
    }
  }

  // 5. Transcript Resume Fallback
  // Evicted or not in state -> Try resume from disk transcript
  try {
    await resumeAgentBackground({
      agentId,
      prompt: message,
      sessionContext,
      invokingRequestId,
    })
    return {
      success: true,
      message: `Agent ${recipientNameOrId} had no active task; resumed from transcript in the background with your message.`,
    }
  } catch (_e: unknown) {
    return {
      success: false,
      message: `Agent ${recipientNameOrId} is registered but has no transcript to resume.`,
    }
  }
}

// Structured Protocol Messages Schema
const StructuredMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("shutdown_request"),
    reason: z.string().optional(),
  }),
  z.object({
    type: z.literal("shutdown_response"),
    request_id: z.string(),
    approve: z.boolean(),
    reason: z.string().optional(),
  }),
  z.object({
    type: z.literal("plan_approval_response"),
    request_id: z.string(),
    approve: z.boolean(),
    feedback: z.string().optional(),
  }),
])

const parameters = z.object({
  to: z
    .string()
    .min(1, "Recipient name is required")
    .describe("Recipient: teammate name, or '*' for broadcast to all teammates"),
  summary: z.string().optional().describe("A 5-10 word summary shown as preview in the UI"),
  message: z.union([z.string(), StructuredMessageSchema]).describe("The message content or structured payload"),
})

export const SendMessageTool = Tool.define("send_message", {
  description:
    "Send a message to a background agent or teammate. For background agents, queued if running, resumes if stopped. For teammates, delivers to their mailbox. Supports broadcast using to='*'.",
  parameters,
  async execute(params, ctx) {
    const agentCtx = AgentExecutionContext.getStore()
    if (!agentCtx) throw new Error("No agent context found")

    // In Phase 2/3, teammates will be able to send messages, but for now we restrict to coordinator.
    if (agentCtx.type === "teammate") throw new Error("Teammates do not support sending messages yet")

    const senderName = "coordinator"

    const parentContext: ParentContext = {
      sessionId: agentCtx.type === "subagent" ? agentCtx.parentSessionId : ctx.sessionID,
      abortController: agentCtx.abortController,
      readFileState: agentCtx.readFileState,
      contentReplacementState: agentCtx.contentReplacementState,
      getAppState: agentCtx.getAppState,
      setAppState: agentCtx.setAppState,
      setAppStateForTasks: agentCtx.setAppStateForTasks,
      cwd: agentCtx.cwd,
    }

    const { to: target, message, summary } = params

    // Handle string messages
    if (typeof message === "string") {
      const res = await routeMessage({
        recipientNameOrId: target,
        message,
        summary,
        sessionContext: parentContext,
        invokingRequestId: ctx.messageID,
        senderName,
      })

      return {
        title: target === "*" ? "Broadcast message" : `Sent message to ${target}`,
        metadata: { success: res.success },
        output: res.message,
      }
    }

    // Handle structured protocol messages
    if (target === "*") {
      throw new Error("Structured protocol messages cannot be broadcast.")
    }

    let payloadString = ""
    let outputMessage = ""

    switch (message.type) {
      case "shutdown_request":
        // Wrap with a generated request_id so the teammate can respond to it
        payloadString = JSON.stringify({
          type: "shutdown_request",
          request_id: randomUUID(),
          reason: message.reason,
        })
        outputMessage = `Sent shutdown request to ${target}.`
        break

      case "shutdown_response":
        payloadString = JSON.stringify({
          type: message.approve ? "shutdown_approved" : "shutdown_rejected",
          request_id: message.request_id,
          reason: message.reason,
        })
        outputMessage = `Sent shutdown response to ${target}.`
        break

      case "plan_approval_response":
        payloadString = JSON.stringify(message)
        outputMessage = `Sent plan approval response to ${target}.`
        break
    }

    const res = await routeMessage({
      recipientNameOrId: target,
      message: payloadString,
      summary: summary ?? `Protocol message: ${message.type}`,
      sessionContext: parentContext,
      invokingRequestId: ctx.messageID,
      senderName,
    })

    return {
      title: `Sent ${message.type} to ${target}`,
      metadata: { success: res.success },
      output: res.success ? outputMessage : res.message,
    }
  },
})
