import type { ChildProcess } from "node:child_process"
import { randomBytes } from "node:crypto"
import { Shell } from "@/shell/shell"
import { Log } from "@/util/log"

const log = Log.create({ service: "background-task" })

// ---------------------------------------------------------------------------
// ID generation — cmd_<8 random hex chars>
// ---------------------------------------------------------------------------

function generateCommandId(): string {
  return `cmd_${randomBytes(4).toString("hex")}`
}

// ---------------------------------------------------------------------------
// RingBuffer — 100KB total: 20KB head + 80KB tail
// ---------------------------------------------------------------------------

const HEAD_LIMIT = 20 * 1024
const TAIL_LIMIT = 80 * 1024

/**
 * A fixed-capacity ring buffer that retains the first HEAD_LIMIT bytes
 * and the last TAIL_LIMIT bytes of output. Middle content is dropped
 * with a truncation marker.
 */
export class OutputBuffer {
  private _head = ""
  private _tail = ""
  private _headFull = false
  private _totalBytes = 0
  private _droppedBytes = 0

  get totalBytes(): number {
    return this._totalBytes
  }

  append(chunk: string): void {
    this._totalBytes += chunk.length

    if (!this._headFull) {
      const headRemaining = HEAD_LIMIT - this._head.length
      if (chunk.length <= headRemaining) {
        this._head += chunk
        return
      }
      // Fill head, overflow goes to tail
      this._head += chunk.slice(0, headRemaining)
      this._headFull = true
      chunk = chunk.slice(headRemaining)
    }

    // Append to tail, trimming from front if over budget
    this._tail += chunk
    if (this._tail.length > TAIL_LIMIT) {
      const excess = this._tail.length - TAIL_LIMIT
      this._droppedBytes += excess
      this._tail = this._tail.slice(excess)
    }
  }

  /**
   * Return the buffered output, inserting a truncation marker if
   * content was dropped between head and tail.
   */
  toString(): string {
    if (!this._headFull) return this._head
    if (this._droppedBytes > 0) {
      return `${this._head}\n\n... [${this._droppedBytes} bytes truncated] ...\n\n${this._tail}`
    }
    return `${this._head}${this._tail}`
  }

  /**
   * Get a window of output by character count.
   * Returns the last `charCount` characters from the buffer,
   * unless the total is smaller.
   */
  getChars(charCount: number): string {
    const full = this.toString()
    if (full.length <= charCount) return full
    return `... [output truncated, showing last ${charCount} chars] ...\n${full.slice(-charCount)}`
  }
}

// ---------------------------------------------------------------------------
// BackgroundTask — a single tracked process
// ---------------------------------------------------------------------------

export type TaskStatus = "running" | "done" | "error"

export interface BackgroundTaskInfo {
  id: string
  command: string
  description: string
  status: TaskStatus
  exitCode: number | null
  startedAt: number
  completedAt: number | null
  output: OutputBuffer
}

/**
 * A background task wrapping a spawned ChildProcess.
 *
 * Callers can:
 * - Stream output via the OutputBuffer
 * - Wait for completion with an efficient sleep pattern (no polling)
 * - Write to stdin or terminate the process
 */
export class BackgroundTask {
  public readonly id: string
  public readonly command: string
  public readonly description: string
  public readonly output = new OutputBuffer()
  public readonly startedAt: number

  private _status: TaskStatus = "running"
  private _exitCode: number | null = null
  private _completedAt: number | null = null
  private _proc: ChildProcess
  private _exited = false

  /** Resolvers waiting for the process to finish. */
  private _waiters: Array<() => void> = []

  constructor(proc: ChildProcess, opts: { command: string; description: string }) {
    this.id = generateCommandId()
    this.command = opts.command
    this.description = opts.description
    this.startedAt = Date.now()
    this._proc = proc

    // Wire up stdout/stderr → OutputBuffer
    proc.stdout?.on("data", (chunk: Buffer) => {
      this.output.append(chunk.toString())
    })
    proc.stderr?.on("data", (chunk: Buffer) => {
      this.output.append(chunk.toString())
    })

    // Handle process exit
    proc.once("exit", (code) => {
      this._exited = true
      this._exitCode = code ?? 1
      this._status = code === 0 ? "done" : "error"
      this._completedAt = Date.now()
      this._resolveWaiters()
    })

    proc.once("error", (err) => {
      this._exited = true
      this._exitCode = 1
      this._status = "error"
      this._completedAt = Date.now()
      this.output.append(`\nProcess error: ${err.message}\n`)
      this._resolveWaiters()
    })
  }

  get status(): TaskStatus {
    return this._status
  }

  get exitCode(): number | null {
    return this._exitCode
  }

  get completedAt(): number | null {
    return this._completedAt
  }

  /** Info snapshot for serialization. */
  get info(): BackgroundTaskInfo {
    return {
      id: this.id,
      command: this.command,
      description: this.description,
      status: this._status,
      exitCode: this._exitCode,
      startedAt: this.startedAt,
      completedAt: this._completedAt,
      output: this.output,
    }
  }

  /**
   * Wait for the process to complete, with a maximum timeout.
   * Returns immediately if the process has already exited.
   * This is an efficient sleep — no polling loop.
   */
  waitForCompletion(timeoutMs: number): Promise<void> {
    if (this._status !== "running") return Promise.resolve()

    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        // Remove this waiter and resolve on timeout
        const idx = this._waiters.indexOf(resolve)
        if (idx !== -1) this._waiters.splice(idx, 1)
        resolve()
      }, timeoutMs)
      // Don't keep the event loop alive just for this timer
      timer.unref()

      this._waiters.push(() => {
        clearTimeout(timer)
        resolve()
      })
    })
  }

  /**
   * Write to the process's stdin.
   * Throws if stdin is not available or writing fails.
   */
  writeStdin(input: string): void {
    if (!this._proc.stdin) {
      throw new Error(
        `Cannot write to stdin of task ${this.id}: stdin is not available (process was spawned without stdin pipe)`,
      )
    }
    if (this._status !== "running") {
      throw new Error(`Cannot write to stdin of task ${this.id}: process has already exited`)
    }
    this._proc.stdin.write(input)
  }

  /**
   * Terminate the process tree.
   */
  async terminate(): Promise<void> {
    if (this._status !== "running") return
    log.info("Terminating background task", { id: this.id, command: this.command })
    await Shell.killTree(this._proc, { exited: () => this._exited })
  }

  private _resolveWaiters(): void {
    const waiters = this._waiters.splice(0)
    for (const resolve of waiters) resolve()
  }
}

// ---------------------------------------------------------------------------
// BackgroundTaskRegistry — session-scoped in-memory registry
// ---------------------------------------------------------------------------

/**
 * Session-scoped registry of background tasks.
 * Tasks do not survive session boundaries — `disposeAll()` is called
 * on session teardown.
 */
export class BackgroundTaskRegistry {
  private _tasks = new Map<string, BackgroundTask>()
  private _notifiedTaskIds = new Set<string>()

  /**
   * Register a spawned process as a background task with output tracking.
   * Returns the BackgroundTask handle (use `.id` for the command ID).
   */
  register(proc: ChildProcess, opts: { command: string; description: string }): BackgroundTask {
    const task = new BackgroundTask(proc, opts)
    this._tasks.set(task.id, task)
    log.info("Registered background task", {
      id: task.id,
      command: task.command,
    })
    return task
  }

  /**
   * Look up a task by ID. Returns undefined if not found.
   */
  get(id: string): BackgroundTask | undefined {
    return this._tasks.get(id)
  }

  /**
   * Mark a task as notification-delivered. Idempotent — safe to call multiple times.
   * Called by the engine after successfully injecting a task_notification user message.
   */
  markNotified(id: string): void {
    this._notifiedTaskIds.add(id)
  }

  /**
   * Returns all tasks that have completed (status done/error) but have NOT yet
   * been notified via markNotified(). Used by the inter-turn injection logic.
   * Safe to call repeatedly — markNotified() prevents re-delivery.
   */
  getUnnotifiedCompletedTasks(): BackgroundTask[] {
    return Array.from(this._tasks.values()).filter((t) => t.status !== "running" && !this._notifiedTaskIds.has(t.id))
  }

  /**
   * List all tracked tasks and their current status.
   */
  list(): BackgroundTaskInfo[] {
    return Array.from(this._tasks.values()).map((t) => t.info)
  }

  /**
   * Terminate all running tasks and clear the registry.
   * Called on session dispose — tasks don't survive session boundaries.
   */
  async disposeAll(): Promise<void> {
    const tasks = Array.from(this._tasks.values())
    log.info("Disposing all background tasks", { count: tasks.length })

    await Promise.allSettled(tasks.filter((t) => t.status === "running").map((t) => t.terminate()))

    this._tasks.clear()
    this._notifiedTaskIds.clear()
  }

  get size(): number {
    return this._tasks.size
  }
}
