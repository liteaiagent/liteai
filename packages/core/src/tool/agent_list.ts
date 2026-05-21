import z from "zod"
import type { SessionID } from "@/session/schema"
import type { AgentTaskInfo } from "@/task/task"
import { AgentExecutionContext } from "../agent/context"
import { SessionPrompt } from "../session/engine"
import { Tool } from "./tool"

const parameters = z.object({
  status_filter: z
    .enum(["all", "running", "completed", "failed", "killed"])
    .describe("Filter agents by status. Defaults to 'all'.")
    .optional(),
})

export const AgentListTool = Tool.define("agent_list", {
  description: `List all background agents and their current statuses.
- Optionally filter by status (running, completed, failed, killed)
- Returns a formatted table of agents with their ID, type, status, description, and duration
- Use this to see all background agents you have launched`,
  parameters,
  async execute(params, _ctx) {
    const agentCtx = AgentExecutionContext.getStore()
    if (!agentCtx) {
      return {
        title: "No agent context",
        metadata: { success: false } as Record<string, unknown>,
        output: "No agent execution context found. Cannot list agents outside of an agent context.",
      }
    }

    const registry = SessionPrompt.agentTaskRegistry()

    // Get the parent session ID to filter tasks for this session
    const parentSessionId =
      agentCtx.type === "root"
        ? (agentCtx.sessionId as unknown as SessionID)
        : agentCtx.type === "subagent"
          ? (agentCtx.parentSessionId as unknown as SessionID)
          : undefined

    const allTasks = parentSessionId ? registry.list({ parentSessionId }) : registry.list()

    // Apply status filter
    const statusFilter = params.status_filter ?? "all"
    const tasks = statusFilter === "all" ? allTasks : allTasks.filter((t) => t.status === statusFilter)

    if (tasks.length === 0) {
      const filterMsg = statusFilter !== "all" ? ` with status '${statusFilter}'` : ""
      return {
        title: "No agents",
        metadata: { success: true, count: 0 } as Record<string, unknown>,
        output: `No background agents found${filterMsg}.`,
      }
    }

    // Build formatted table
    const lines: string[] = ["Background Agents:", ""]
    lines.push("| ID | Agent | Status | Description | Duration |")
    lines.push("|----|-------|--------|-------------|----------|")

    for (const task of tasks) {
      const duration = getDurationString(task)
      // Truncate task ID for readability
      const shortId = task.taskId.length > 16 ? `${task.taskId.slice(0, 16)}...` : task.taskId
      // Sanitize fields to prevent pipe chars and newlines from breaking the markdown table
      const sanitize = (s: string) =>
        s
          .replace(/\\/g, "\\\\")
          .replace(/\|/g, "\\|")
          .replace(/[\r\n]+/g, " ")
      lines.push(
        `| ${shortId} | ${sanitize(task.agentName)} | ${task.status} | ${sanitize(task.description)} | ${duration} |`,
      )
    }

    // Summary line
    const statusCounts = getStatusCounts(tasks)
    const summaryParts: string[] = []
    for (const [status, count] of Object.entries(statusCounts)) {
      if (count > 0) summaryParts.push(`${count} ${status}`)
    }
    lines.push("")
    lines.push(`Total: ${tasks.length} agent${tasks.length !== 1 ? "s" : ""} (${summaryParts.join(", ")})`)

    return {
      title: `${tasks.length} background agents`,
      metadata: { success: true, count: tasks.length } as Record<string, unknown>,
      output: lines.join("\n"),
    }
  },
})

function getDurationString(task: AgentTaskInfo): string {
  if (task.completedAt) {
    return `${Math.round((task.completedAt - task.createdAt) / 1000)}s`
  }
  if (task.status === "running") {
    return `${Math.round((Date.now() - task.createdAt) / 1000)}s`
  }
  return "N/A"
}

function getStatusCounts(tasks: AgentTaskInfo[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const task of tasks) {
    counts[task.status] = (counts[task.status] ?? 0) + 1
  }
  return counts
}
