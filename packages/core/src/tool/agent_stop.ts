import z from "zod"
import type { TaskID } from "@/task/task"
import { isTerminalStatus } from "@/task/task"
import { AgentExecutionContext, type AppState } from "../agent/context"
import { SessionPrompt } from "../session/engine"
import { SessionID } from "../session/schema"
import { Tool } from "./tool"

const parameters = z.object({
  task_id: z.string().describe("The ID of the background agent or task to stop"),
})

export const AgentStopTool = Tool.define("agent_stop", {
  description: `Stop a running background agent or task by its ID.
- Takes a task_id parameter identifying the agent/task to stop
- Works with both agent task IDs (from run_in_background) and session IDs (from legacy tasks)
- Returns a success or failure status
- Use this tool when you need to terminate a long-running agent`,
  parameters,
  // _ctx is required by the Tool.execute signature but unused here
  async execute(params, _ctx) {
    const agentCtx = AgentExecutionContext.getStore()
    if (!agentCtx) {
      return {
        title: "No agent context",
        metadata: { success: false } as Record<string, unknown>,
        output: "No agent execution context found. Cannot stop agents outside of an agent context.",
      }
    }
    if (agentCtx.type === "teammate") {
      return {
        title: "Permission denied",
        metadata: { success: false } as Record<string, unknown>,
        output: "Teammates cannot stop agents. Only the primary agent can manage agent lifecycle.",
      }
    }

    // H-1: Input validation — reject empty task_id
    const rawId = params.task_id.trim()
    if (rawId.length === 0) {
      return {
        title: "Invalid input",
        metadata: { success: false } as Record<string, unknown>,
        output: "task_id is required and must not be empty.",
      }
    }

    // ── Try AgentTaskRegistry first (new async dispatch path) ──
    // Agent task IDs have the "tsk_" prefix from TaskID.ascending()
    const agentRegistry = SessionPrompt.agentTaskRegistry()
    const agentTask = agentRegistry.get(rawId as TaskID)

    if (agentTask) {
      // Ownership check: callers can only stop tasks spawned by their own session.
      // Uses the same parent session resolution as agent_list for consistency.
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
      if (agentTask.parentSessionId !== callerSessionId) {
        return {
          title: "Permission denied",
          metadata: { success: false } as Record<string, unknown>,
          output: `Cannot stop agent ${rawId}: it belongs to a different session.`,
        }
      }

      if (isTerminalStatus(agentTask.status)) {
        return {
          title: "Agent not running",
          metadata: { success: false } as Record<string, unknown>,
          output: `Agent ${rawId} is not running (status: ${agentTask.status})`,
        }
      }

      // Kill the agent task via the registry (triggers independent AbortController)
      agentRegistry.kill(rawId as TaskID)

      return {
        title: `Stopped agent ${rawId}`,
        metadata: { success: true, task_id: rawId, task_type: "agent_task" } as Record<string, unknown>,
        output: `Successfully stopped background agent: ${rawId} (${agentTask.agentName}: ${agentTask.description})`,
      }
    }

    // ── Fall back to AppState-based tasks (legacy session-scoped path) ──
    // H-3: Validate task_id format before casting to SessionID
    const parseResult = SessionID.zod.safeParse(rawId)
    if (!parseResult.success) {
      return {
        title: "Not found",
        metadata: { success: false } as Record<string, unknown>,
        output: `No agent or task found with ID: ${rawId}`,
      }
    }
    const taskSessionId = parseResult.data

    const getAppState = agentCtx.getAppState
    const setAppState = agentCtx.setAppStateForTasks ?? agentCtx.setAppState

    const appState = getAppState()
    const task = appState.tasks?.[rawId]

    if (!task) {
      return {
        title: "Not found",
        metadata: { success: false } as Record<string, unknown>,
        output: `No agent or task found with ID: ${rawId}`,
      }
    }

    if (task.status !== "running") {
      return {
        title: "Not running",
        metadata: { success: false } as Record<string, unknown>,
        output: `Task ${rawId} is not running (status: ${task.status})`,
      }
    }

    // Cancel the task's session execution — uses validated SessionID
    SessionPrompt.cancel(taskSessionId)

    // Update task status in root AppState
    setAppState((state: AppState) => ({
      ...state,
      tasks: {
        ...state.tasks,
        [rawId]: {
          ...state.tasks?.[rawId],
          status: "stopped",
        },
      },
    }))

    return {
      title: `Stopped task ${rawId}`,
      metadata: { success: true, task_id: rawId, task_type: "legacy_task" } as Record<string, unknown>,
      output: `Successfully stopped task: ${rawId}`,
    }
  },
})
