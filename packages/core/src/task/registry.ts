import { Log } from "@liteai/util/log"
import type { SessionID } from "@/session/schema"
import {
  type AgentTaskInfo,
  type AgentTaskState,
  InvalidTaskTransitionError,
  isTerminalStatus,
  type TaskID,
  TaskLimitExceededError,
  TaskNotFoundError,
  toAgentTaskInfo,
} from "./task"

const log = Log.create({ service: "agent-task-registry" })

// ---------------------------------------------------------------------------
// Registration options
// ---------------------------------------------------------------------------

export interface RegisterOpts {
  taskId: TaskID
  sessionId: SessionID
  parentSessionId: SessionID
  agentName: string
  description: string
  abortController: AbortController
}

// ---------------------------------------------------------------------------
// AgentTaskRegistry — instance-scoped in-memory registry
//
// Unlike BackgroundTaskRegistry (session-scoped, ChildProcess lifecycle),
// this registry is instance-scoped because background agents can outlive
// their parent session's current loop iteration. The parentSessionId field
// enables filtering notifications per parent.
// ---------------------------------------------------------------------------

export class AgentTaskRegistry {
  private readonly _tasks = new Map<TaskID, AgentTaskState>()
  private readonly _maxConcurrentTasks: number

  constructor(maxConcurrentTasks = 10) {
    this._maxConcurrentTasks = maxConcurrentTasks
  }

  /**
   * Create and register a new task (status: "pending").
   * Throws TaskLimitExceededError if active tasks (pending + running) >= maxConcurrentTasks.
   */
  register(opts: RegisterOpts): AgentTaskState {
    const active = this._activeCount()
    if (active >= this._maxConcurrentTasks) {
      throw new TaskLimitExceededError(this._maxConcurrentTasks, active)
    }

    const task: AgentTaskState = {
      type: "agent_task",
      taskId: opts.taskId,
      sessionId: opts.sessionId,
      parentSessionId: opts.parentSessionId,
      agentName: opts.agentName,
      description: opts.description,
      status: "pending",
      progress: {
        toolUseCount: 0,
        tokenCount: 0,
        lastActivity: Date.now(),
      },
      abortController: opts.abortController,
      createdAt: Date.now(),
      notified: false,
    }

    this._tasks.set(opts.taskId, task)

    log.info("registered agent task", {
      taskId: opts.taskId,
      sessionId: opts.sessionId,
      parentSessionId: opts.parentSessionId,
      agentName: opts.agentName,
    })

    return task
  }

  /**
   * Transition task to "running".
   * Only valid from "pending" state.
   */
  start(taskId: TaskID): void {
    const task = this._requireTask(taskId)
    if (task.status !== "pending") {
      throw new InvalidTaskTransitionError(taskId, task.status, "running")
    }
    task.status = "running"
    task.progress.lastActivity = Date.now()
    log.info("agent task started", { taskId })
  }

  /**
   * Transition task to "completed" with result text.
   * Only valid from "running" state.
   */
  complete(taskId: TaskID, result: string): void {
    const task = this._requireTask(taskId)
    if (task.status !== "running") {
      throw new InvalidTaskTransitionError(taskId, task.status, "completed")
    }
    task.status = "completed"
    task.result = result
    task.completedAt = Date.now()
    task.progress.lastActivity = Date.now()
    log.info("agent task completed", { taskId, resultLength: result.length })
  }

  /**
   * Transition task to "failed" with error message.
   * Only valid from "running" state.
   */
  fail(taskId: TaskID, error: string): void {
    const task = this._requireTask(taskId)
    if (task.status !== "running") {
      throw new InvalidTaskTransitionError(taskId, task.status, "failed")
    }
    task.status = "failed"
    task.error = error
    task.completedAt = Date.now()
    task.progress.lastActivity = Date.now()
    log.warn("agent task failed", { taskId, error })
  }

  /**
   * Abort and transition task to "killed".
   * Only valid from "running" or "pending" state.
   * Triggers the task's independent AbortController.
   */
  kill(taskId: TaskID): void {
    const task = this._requireTask(taskId)
    if (isTerminalStatus(task.status)) {
      throw new InvalidTaskTransitionError(taskId, task.status, "killed")
    }
    // Abort first, then transition — the lifecycle driver catches the abort
    // and any partial result is captured before the status change.
    task.abortController.abort("Task killed via task_stop")
    task.status = "killed"
    task.completedAt = Date.now()
    task.progress.lastActivity = Date.now()
    log.info("agent task killed", { taskId })
  }

  /**
   * Look up task by ID. Returns undefined if not found.
   */
  get(taskId: TaskID): AgentTaskState | undefined {
    return this._tasks.get(taskId)
  }

  /**
   * Look up task by session ID. Returns undefined if not found.
   */
  getBySession(sessionId: SessionID): AgentTaskState | undefined {
    for (const task of this._tasks.values()) {
      if (task.sessionId === sessionId) return task
    }
    return undefined
  }

  /**
   * List tasks, optionally filtered by parent session ID.
   * Returns serializable AgentTaskInfo snapshots.
   */
  list(filter?: { parentSessionId?: SessionID }): AgentTaskInfo[] {
    const tasks = Array.from(this._tasks.values())
    const filtered = filter?.parentSessionId ? tasks.filter((t) => t.parentSessionId === filter.parentSessionId) : tasks
    return filtered.map(toAgentTaskInfo)
  }

  /**
   * Get completed tasks not yet notified for a specific parent.
   * Used by CorrectionInjector to drain agent task notifications.
   */
  getUnnotifiedCompletedTasks(parentSessionId: SessionID): AgentTaskInfo[] {
    const results: AgentTaskInfo[] = []
    for (const task of this._tasks.values()) {
      if (task.parentSessionId === parentSessionId && isTerminalStatus(task.status) && !task.notified) {
        results.push(toAgentTaskInfo(task))
      }
    }
    return results
  }

  /**
   * Mark a task as notification-delivered. Idempotent.
   * Called after CorrectionInjector successfully persists the notification message.
   */
  markNotified(taskId: TaskID): void {
    const task = this._tasks.get(taskId)
    if (task) {
      task.notified = true
    }
  }

  /**
   * Count of currently running tasks.
   */
  runningCount(): number {
    let count = 0
    for (const task of this._tasks.values()) {
      if (task.status === "running") count++
    }
    return count
  }

  /**
   * Abort all running tasks. Used on instance shutdown.
   * Does NOT remove tasks from the registry — just triggers abort.
   */
  killAll(): void {
    let killed = 0
    for (const task of this._tasks.values()) {
      if (!isTerminalStatus(task.status)) {
        task.abortController.abort("Instance shutdown — killAll")
        task.status = "killed"
        task.completedAt = Date.now()
        task.progress.lastActivity = Date.now()
        killed++
      }
    }
    if (killed > 0) {
      log.info("killed all running agent tasks", { count: killed })
    }
  }

  /**
   * Total number of tracked tasks (all statuses).
   */
  get size(): number {
    return this._tasks.size
  }

  // ─── Internal Helpers ───────────────────────────────────────────────

  /** Count of pending + running tasks (used for concurrency limit). */
  private _activeCount(): number {
    let count = 0
    for (const task of this._tasks.values()) {
      if (task.status === "pending" || task.status === "running") count++
    }
    return count
  }

  private _requireTask(taskId: TaskID): AgentTaskState {
    const task = this._tasks.get(taskId)
    if (!task) {
      throw new TaskNotFoundError(taskId)
    }
    return task
  }
}
