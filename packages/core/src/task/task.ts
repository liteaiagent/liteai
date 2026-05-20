import { Schema } from "effect"
import z from "zod"
import { Identifier } from "@/id/id"
import type { SessionID } from "@/session/schema"
import { withStatics } from "@/util/schema"

// ---------------------------------------------------------------------------
// TaskID — branded identifier for agent tasks
// Format: task_<ULID> (ascending, globally unique, sortable)
// Follows the same pattern as SessionID in session/schema.ts
// ---------------------------------------------------------------------------

export const TaskID = Schema.String.pipe(
  Schema.brand("TaskID"),
  withStatics((s) => ({
    make: (id: string) => s.makeUnsafe(id),
    ascending: (id?: string) => s.makeUnsafe(Identifier.ascending("task", id)),
    zod: Identifier.schema("task").pipe(z.custom<Schema.Schema.Type<typeof s>>()),
  })),
)

export type TaskID = Schema.Schema.Type<typeof TaskID>

// ---------------------------------------------------------------------------
// TaskStatus — lifecycle states for an agent task
//
// State machine:
//   [*] → pending: register()
//   pending → running: lifecycle starts
//   running → completed: subagent finishes successfully
//   running → failed: subagent throws or returns error
//   running → killed: explicit cancellation via task_stop
// ---------------------------------------------------------------------------

export type TaskStatus = "pending" | "running" | "completed" | "failed" | "killed"

const TERMINAL_STATUSES: ReadonlySet<TaskStatus> = new Set(["completed", "failed", "killed"])

/**
 * Guard: returns true for terminal states (completed, failed, killed).
 * Used to prevent double-transitions and reject operations on finished tasks.
 */
export function isTerminalStatus(status: TaskStatus): boolean {
  return TERMINAL_STATUSES.has(status)
}

// ---------------------------------------------------------------------------
// TaskProgress — progress tracking for a running agent task
// ---------------------------------------------------------------------------

export interface TaskProgress {
  /** Number of tool calls made by the subagent. */
  toolUseCount: number
  /** Total tokens consumed. */
  tokenCount: number
  /** Timestamp of last progress update (ms since epoch). */
  lastActivity: number
}

// ---------------------------------------------------------------------------
// AgentTaskState — full state record for a background agent task
//
// Stored in AgentTaskRegistry and mirrored to AppState.tasks.
// The `abortController` field is not serializable — use toInfo() for
// API responses and AppState mirroring.
// ---------------------------------------------------------------------------

export interface AgentTaskState {
  /** Discriminator for AppState.tasks union. */
  readonly type: "agent_task"
  /** Unique task identifier. */
  readonly taskId: TaskID
  /** Session created for the subagent. */
  readonly sessionId: SessionID
  /** Session of the parent that spawned this task. */
  readonly parentSessionId: SessionID
  /** Agent type name (e.g., "explore", "liteai"). */
  readonly agentName: string
  /** Short task description from AgentTool params. */
  readonly description: string
  /** Current lifecycle state. */
  status: TaskStatus
  /** Mutable progress tracking. */
  progress: TaskProgress
  /** Independent abort controller (not linked to parent). */
  readonly abortController: AbortController
  /** Final result text (set on completion). */
  result?: string
  /** Error message (set on failure). */
  error?: string
  /** Registration timestamp (ms since epoch). */
  readonly createdAt: number
  /** Terminal state timestamp. */
  completedAt?: number
  /** Whether the notification has been delivered to the parent. */
  notified: boolean
}

// ---------------------------------------------------------------------------
// AgentTaskInfo — serializable snapshot of AgentTaskState
//
// Same fields as AgentTaskState minus `abortController`.
// Used for API responses, AppState mirroring, and notification formatting.
// ---------------------------------------------------------------------------

export interface AgentTaskInfo {
  readonly type: "agent_task"
  readonly taskId: TaskID
  readonly sessionId: SessionID
  readonly parentSessionId: SessionID
  readonly agentName: string
  readonly description: string
  readonly status: TaskStatus
  readonly progress: TaskProgress
  readonly result?: string
  readonly error?: string
  readonly createdAt: number
  readonly completedAt?: number
  readonly notified: boolean
}

/**
 * Convert an AgentTaskState to a serializable AgentTaskInfo snapshot.
 * Strips the non-serializable `abortController` field.
 */
export function toAgentTaskInfo(state: AgentTaskState): AgentTaskInfo {
  return {
    type: state.type,
    taskId: state.taskId,
    sessionId: state.sessionId,
    parentSessionId: state.parentSessionId,
    agentName: state.agentName,
    description: state.description,
    status: state.status,
    progress: { ...state.progress },
    result: state.result,
    error: state.error,
    createdAt: state.createdAt,
    completedAt: state.completedAt,
    notified: state.notified,
  }
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class InvalidTaskTransitionError extends Error {
  constructor(
    public readonly taskId: TaskID,
    public readonly from: TaskStatus,
    public readonly to: TaskStatus,
  ) {
    super(`Invalid task transition for ${taskId}: ${from} → ${to}`)
    this.name = "InvalidTaskTransitionError"
  }
}

export class TaskLimitExceededError extends Error {
  constructor(
    public readonly limit: number,
    public readonly running: number,
  ) {
    super(`Task concurrency limit exceeded: ${running}/${limit} tasks running`)
    this.name = "TaskLimitExceededError"
  }
}

export class TaskNotFoundError extends Error {
  constructor(public readonly taskId: string) {
    super(`No task found with ID: ${taskId}`)
    this.name = "TaskNotFoundError"
  }
}
