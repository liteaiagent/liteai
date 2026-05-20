import z from "zod"
import type { TaskID } from "@/task/task"
import { isTerminalStatus } from "@/task/task"
import { AgentExecutionContext } from "../agent/context"
import { SessionPrompt } from "../session/engine"
import { Tool } from "./tool"

const parameters = z.object({
  task_id: z.string().describe("The ID of the background agent task to query"),
})

export const AgentGetTool = Tool.define("agent_get", {
  description: `Query the status, progress, and result of a background agent by its task ID.
- Takes a task_id parameter to identify the agent task
- Returns the current status, progress metrics, and result (if completed)
- Use this to check on background agents you launched with run_in_background`,
  parameters,
  async execute(params, _ctx) {
    const agentCtx = AgentExecutionContext.getStore()
    if (!agentCtx) {
      return {
        title: "No agent context",
        metadata: { success: false } as Record<string, unknown>,
        output: "No agent execution context found. Cannot query agents outside of an agent context.",
      }
    }
    if (agentCtx.type === "teammate") {
      return {
        title: "Permission denied",
        metadata: { success: false } as Record<string, unknown>,
        output: "Teammates cannot query agents. Only the primary agent can manage agent lifecycle.",
      }
    }

    const rawId = params.task_id.trim()
    if (rawId.length === 0) {
      return {
        title: "Invalid input",
        metadata: { success: false } as Record<string, unknown>,
        output: "task_id is required and must not be empty.",
      }
    }

    const registry = SessionPrompt.agentTaskRegistry()
    const task = registry.get(rawId as TaskID)

    if (!task) {
      return {
        title: "Agent not found",
        metadata: { success: false } as Record<string, unknown>,
        output: `No background agent found with task ID: ${rawId}`,
      }
    }

    // Ownership check: callers can only query tasks from their own session.
    // Uses the same parent session resolution as agent_stop for consistency.
    const callerSessionId =
      agentCtx.type === "root"
        ? agentCtx.sessionId
        : agentCtx.type === "subagent"
          ? agentCtx.parentSessionId
          : undefined
    if (!callerSessionId) {
      return {
        title: "Context error",
        metadata: { success: false } as Record<string, unknown>,
        output: `Cannot resolve caller session for agent context type: ${agentCtx.type}`,
      }
    }
    if (task.parentSessionId !== callerSessionId) {
      return {
        title: "Agent not found",
        metadata: { success: false } as Record<string, unknown>,
        output: `No background agent found with task ID: ${rawId}`,
      }
    }

    const lines: string[] = [
      `Task: ${task.taskId}`,
      `Agent: ${task.agentName}`,
      `Status: ${task.status}`,
      `Description: ${task.description}`,
    ]

    if (isTerminalStatus(task.status) && task.completedAt) {
      const durationSec = Math.round((task.completedAt - task.createdAt) / 1000)
      lines.push(`Duration: ${durationSec}s`)
    }

    // Progress info for running tasks
    if (task.status === "running") {
      const agoSec = Math.round((Date.now() - task.progress.lastActivity) / 1000)
      lines.push(
        "Progress:",
        `  Tool uses: ${task.progress.toolUseCount}`,
        `  Tokens: ${task.progress.tokenCount}`,
        `  Last activity: ${agoSec}s ago`,
      )
    }

    // Result for completed tasks
    if (task.status === "completed" && task.result) {
      lines.push("", "<task-result>", task.result, "</task-result>")
    }

    // Error for failed tasks
    if (task.status === "failed" && task.error) {
      lines.push(`Error: ${task.error}`)
    }

    // Partial result for killed tasks
    if (task.status === "killed" && task.result) {
      lines.push("", "<partial-result>", task.result, "</partial-result>")
    }

    return {
      title: `Agent ${rawId} status`,
      metadata: { success: true, task_id: rawId, status: task.status } as Record<string, unknown>,
      output: lines.join("\n"),
    }
  },
})
