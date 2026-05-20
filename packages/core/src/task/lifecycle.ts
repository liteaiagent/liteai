import { Log } from "@liteai/util/log"
import type { SessionID } from "@/session/schema"
import type { AgentTaskRegistry } from "./registry"
import type { TaskID } from "./task"
import { isTerminalStatus } from "./task"

const log = Log.create({ service: "agent-task-lifecycle" })

/**
 * Options for launching an async agent lifecycle.
 */
export interface AsyncAgentLifecycleOpts {
  /** The task ID registered in the AgentTaskRegistry. */
  taskId: TaskID
  /** The session ID created for the subagent. */
  sessionId: SessionID
  /** The agent task registry (instance-scoped). */
  registry: AgentTaskRegistry
  /** The function that runs the subagent. Returns a SessionResult-like object. */
  runSubagent: () => Promise<{
    status: "ok" | "error" | "aborted"
    message?: { parts: Array<{ type?: string; text?: string }> }
    error?: unknown
  }>
}

/**
 * The detached-promise background agent driver.
 *
 * This function:
 * 1. Transitions task status to "running"
 * 2. Calls runSubagent() (with independent AbortController — NOT linked to parent)
 * 3. On success: transitions to "completed" with result text
 * 4. On error: transitions to "failed" with error message
 * 5. On abort: transitions to "killed" with partial result
 *
 * CRITICAL: Status transition MUST happen BEFORE the notification drain cycle.
 * This is naturally ordered since this function runs in a detached promise and
 * CorrectionInjector runs in the parent's event loop between turns.
 *
 * Modeled after Claude Code's runAsyncAgentLifecycle() at agentToolUtils.ts L508-L686.
 */
export async function runAsyncAgentLifecycle(opts: AsyncAgentLifecycleOpts): Promise<void> {
  const { taskId, sessionId, registry } = opts

  log.info("async agent lifecycle starting", { taskId, sessionId })

  // 1. Transition to "running"
  try {
    registry.start(taskId)
  } catch (e) {
    log.error("async agent lifecycle: failed to start task", {
      taskId,
      error: e instanceof Error ? e.message : String(e),
    })
    return
  }

  // 2. Run the subagent
  try {
    const result = await opts.runSubagent()

    // 3a. Success → "completed"
    if (result.status === "ok" && result.message) {
      const resultText =
        (result.message.parts.findLast((x) => x.type === "text") as { text?: string } | undefined)?.text ?? ""

      // Status transition BEFORE notification drain (R-007)
      registry.complete(taskId, resultText)

      log.info("async agent lifecycle completed", {
        taskId,
        sessionId,
        resultLength: resultText.length,
      })
      return
    }

    // 3b. Aborted → handle based on current task status
    if (result.status === "aborted") {
      const task = registry.get(taskId)
      if (task && !isTerminalStatus(task.status)) {
        // Task is still pending/running — the abort was triggered but task_stop
        // hasn't transitioned status yet. Transition to "failed" with partial result.
        const partialResult = result.message?.parts.findLast((x) => x.type === "text") as { text?: string } | undefined
        try {
          registry.fail(taskId, partialResult?.text ?? "(aborted — no result)")
        } catch (_error: unknown) {
          // Task may have been concurrently killed between our check and the fail() call
          log.warn("async agent lifecycle: task transitioned during abort handling", { taskId })
        }
      } else {
        // Task is already in a terminal state (killed via task_stop or killAll) — no-op
        log.info("async agent lifecycle: task already terminal on abort", { taskId, status: task?.status })
      }
      log.info("async agent lifecycle aborted", { taskId, sessionId })
      return
    }

    // 3c. Error → "failed"
    if (result.status === "error") {
      const errorMsg = result.error instanceof Error ? result.error.message : String(result.error ?? "Unknown error")
      registry.fail(taskId, `Subagent execution failed: ${errorMsg}`)
      log.warn("async agent lifecycle failed", { taskId, sessionId, error: errorMsg })
      return
    }

    // Unexpected status
    registry.fail(taskId, `Unexpected subagent result status: ${result.status}`)
  } catch (e) {
    // Handle DOMException AbortError from abort signal
    if (e instanceof DOMException && e.name === "AbortError") {
      const task = registry.get(taskId)
      if (task && task.status === "running") {
        // Abort was triggered, but task_stop may have already transitioned status
        registry.fail(taskId, "Subagent execution was aborted")
      }
      log.info("async agent lifecycle caught abort", { taskId, sessionId })
      return
    }

    // Genuine error
    const errorMsg = e instanceof Error ? e.message : String(e)
    try {
      registry.fail(taskId, `Subagent execution threw: ${errorMsg}`)
    } catch {
      // Task may already be in a terminal state (e.g., killed via task_stop)
      log.warn("async agent lifecycle: task already terminal, cannot fail", { taskId })
    }
    log.error("async agent lifecycle threw", { taskId, sessionId, error: errorMsg })
  }
}
