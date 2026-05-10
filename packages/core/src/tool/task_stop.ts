import z from "zod"
import { AgentExecutionContext, type AppState } from "../agent/context"
import { SessionPrompt } from "../session/engine"
import { SessionID } from "../session/schema"
import { Tool } from "./tool"

const parameters = z.object({
  task_id: z.string().describe("The ID of the background task to stop"),
})

export const TaskStopTool = Tool.define("task_stop", {
  description: `Stop a running background task by its ID.
- Takes a task_id parameter identifying the task to stop
- Returns a success or failure status
- Use this tool when you need to terminate a long-running task`,
  parameters,
  // _ctx is required by the Tool.execute signature but unused here
  async execute(params, _ctx) {
    const agentCtx = AgentExecutionContext.getStore()
    if (!agentCtx) throw new Error("No agent context found")
    if (agentCtx.type === "teammate") throw new Error("Teammates cannot stop tasks")

    // H-1: Input validation — reject empty task_id
    const rawId = params.task_id.trim()
    if (rawId.length === 0) {
      throw new Error("task_id is required and must not be empty")
    }

    // H-3: Validate task_id format before casting to SessionID
    const parseResult = SessionID.zod.safeParse(rawId)
    if (!parseResult.success) {
      throw new Error(`Invalid task_id format: "${rawId}" is not a valid session ID`)
    }
    const taskSessionId = parseResult.data

    const getAppState = agentCtx.getAppState
    const setAppState = agentCtx.setAppStateForTasks ?? agentCtx.setAppState

    const appState = getAppState()
    const task = appState.tasks?.[rawId]

    if (!task) {
      return {
        title: "Task not found",
        metadata: { success: false } as Record<string, unknown>,
        output: `No task found with ID: ${rawId}`,
      }
    }

    if (task.status !== "running") {
      return {
        title: "Task not running",
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
      metadata: { success: true, task_id: rawId } as Record<string, unknown>,
      output: `Successfully stopped task: ${rawId}`,
    }
  },
})
