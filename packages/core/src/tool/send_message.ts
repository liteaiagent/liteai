import z from "zod"
import { AgentExecutionContext, type AppState, type ParentContext } from "../agent/context"
import { resumeAgentBackground } from "../agent/resume"
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
  sessionContext: ParentContext
  invokingRequestId?: string
}): Promise<{ success: boolean; message: string }> {
  const { recipientNameOrId, message, sessionContext, invokingRequestId } = params

  const appState = sessionContext.getAppState()

  // 1. Name Resolution
  let agentId = recipientNameOrId
  if (appState.agentNameRegistry?.[recipientNameOrId]) {
    agentId = appState.agentNameRegistry[recipientNameOrId]
  }

  // 2. Routing based on state
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

export const SendMessageTool = Tool.define("send_message", {
  description:
    "Send a message to a background agent. Users can re-engage with previously completed or interrupted background agents. If the agent is running, the message will be queued. If stopped or evicted, the agent will resume processing your prompt.",
  parameters: z.object({
    to: z.string().describe("The name or ID of the background agent to receive the message"),
    message: z.string().describe("The message content"),
  }),
  async execute(params, ctx) {
    const agentCtx = AgentExecutionContext.getStore()
    if (!agentCtx) throw new Error("No agent context found")
    if (agentCtx.type === "teammate") throw new Error("Teammates do not support sending messages yet")

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

    const { target, text } = { target: params.to, text: params.message }

    const res = await routeMessage({
      recipientNameOrId: target,
      message: text,
      sessionContext: parentContext,
      invokingRequestId: ctx.messageID,
    })

    return {
      title: `Sent message to ${target}`,
      metadata: { success: res.success },
      output: res.message,
    }
  },
})
