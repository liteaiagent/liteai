/**
 * Core runner loop for in-process teammates.
 *
 * The teammate runner wraps `SessionPrompt.runSubagent()` — the same function
 * the task tool uses — inside a persistent idle loop with mailbox polling.
 *
 * Lifecycle: prompt → runSubagent → idle → poll mailbox → next prompt → ...
 *
 * Reference: Claude Code `utils/swarm/inProcessRunner.ts`
 */
import { Log } from "@liteai/util/log"
import type { AppState, TeammateAgentContext } from "../agent/context"
import { runWithAgentContext } from "../agent/context"
import { Bus } from "../bus"
import type { ModelID, ProviderID } from "../provider/schema"
import { Session } from "../session"
import { SessionPrompt } from "../session/engine"
import { MessageID, SessionID } from "../session/schema"
import { createIdleNotification, isShutdownRequest } from "./swarm-messages"
import { readTeamFile, type TeamFile } from "./team-helpers"
import { runWithTeammateContext } from "./teammate-context"
import { TeammateEvent } from "./teammate-events"
import { formatTeammateMessages, markMessagesAsRead, readUnreadMessages, writeToMailbox } from "./teammate-mailbox"
import { TEAMMATE_SYSTEM_PROMPT_ADDENDUM } from "./teammate-prompt-addendum"
import type { TeammateIdentity, TeammateTaskState } from "./teammate-types"
import { isTeammateTask, TEAMMATE_POLL_INTERVAL_MS } from "./teammate-types"

const log = Log.create({ service: "coordinator.runner" })

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TeammateRunnerConfig {
  identity: TeammateIdentity
  taskId: string
  prompt: string
  teammateContext: TeammateAgentContext
  abortController: AbortController
  model?: { providerID: string; modelID: string }
  /** Agent definition name (defaults to system default) */
  agentName?: string
}

export interface TeammateRunnerResult {
  success: boolean
  error?: string
}

type WaitResult =
  | { type: "new_message"; text: string; from: string }
  | { type: "shutdown_request"; reason?: string }
  | { type: "task_claimed"; prompt: string; taskId: string }
  | { type: "aborted" }

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Fire-and-forget entry point: starts the runner loop in the background.
 *
 * Logs completion/failure — does NOT throw.
 */
export function startInProcessTeammate(config: TeammateRunnerConfig): void {
  // Fire-and-forget with error logging
  runInProcessTeammate(config).catch((error: unknown) => {
    log.error("teammate runner crashed unexpectedly", {
      agentId: config.identity.agentId,
      teamName: config.identity.teamName,
      error: error instanceof Error ? error.message : String(error),
    })

    // Mark the task as failed
    config.teammateContext.setAppStateForTasks((state: AppState) => {
      const task = state.tasks?.[config.taskId]
      if (!task || !isTeammateTask(task)) return state
      return {
        ...state,
        tasks: {
          ...state.tasks,
          [config.taskId]: {
            ...task,
            status: "failed",
            isIdle: false,
            error: error instanceof Error ? error.message : String(error),
            endTime: Date.now(),
          } satisfies TeammateTaskState,
        },
      }
    })
  })
}

/**
 * Main runner loop for an in-process teammate.
 *
 * Each iteration:
 * 1. Creates a child session
 * 2. Calls `SessionPrompt.runSubagent()` with the current prompt
 * 3. Marks idle and sends notification to leader
 * 4. Polls mailbox for next work (message, shutdown, task claim)
 * 5. Loops back to (1) with the new prompt
 *
 * Exits when:
 * - Abort signal fires (force kill)
 * - Shutdown request is processed and model agrees
 * - Unrecoverable error
 */
export async function runInProcessTeammate(config: TeammateRunnerConfig): Promise<TeammateRunnerResult> {
  const { identity, taskId, abortController, teammateContext } = config
  const abort = abortController.signal
  let currentPrompt = config.prompt
  let iteration = 0

  log.info("teammate runner starting", {
    agentId: identity.agentId,
    teamName: identity.teamName,
    taskId,
  })

  // Wrap entire execution in teammate + agent context for ALS isolation
  return runWithTeammateContext(teammateContext, async () => {
    return runWithAgentContext(teammateContext, async () => {
      try {
        while (!abort.aborted) {
          iteration++

          log.info("teammate iteration start", {
            agentId: identity.agentId,
            iteration,
            promptLength: currentPrompt.length,
          })

          // Publish active event
          void Bus.publish(TeammateEvent.Active, {
            teamName: identity.teamName,
            agentId: identity.agentId,
            prompt: currentPrompt.slice(0, 200),
          })

          // Update task state: running
          updateTaskState(config, (task) => ({
            ...task,
            status: "running",
            isIdle: false,
          }))

          // ── Execute prompt via runSubagent ──
          const runResult = await executeTeammatePrompt(config, currentPrompt, iteration)

          if (abort.aborted) break

          if (!runResult.success) {
            log.warn("teammate iteration failed", {
              agentId: identity.agentId,
              iteration,
              error: runResult.error,
            })
          }

          // ── Mark idle ──
          log.info("teammate marking idle", {
            agentId: identity.agentId,
            iteration,
          })

          updateTaskState(config, (task) => ({
            ...task,
            status: "idle",
            isIdle: true,
          }))

          // Publish idle event
          void Bus.publish(TeammateEvent.Idle, {
            teamName: identity.teamName,
            agentId: identity.agentId,
            reason: runResult.success ? "available" : "failed",
            summary: runResult.error,
          })

          // Send idle notification to leader's mailbox
          await sendIdleNotification(identity)

          // Fire any idle callbacks (used by waiters)
          fireIdleCallbacks(config)

          // ── Wait for next prompt ──
          const waitResult = await waitForNextPromptOrShutdown(config)

          switch (waitResult.type) {
            case "new_message": {
              // Format the message as teammate-message XML for the next prompt
              currentPrompt = `<teammate-message from="${waitResult.from}">\n${waitResult.text}\n</teammate-message>`
              break
            }
            case "shutdown_request": {
              // Pass shutdown request to model for decision
              const reason = waitResult.reason ?? "Team lead requested shutdown"
              currentPrompt = [
                "<shutdown-request>",
                `The team lead has requested you shut down. Reason: ${reason}`,
                "",
                "If you have completed your work or can safely stop, call the yield_turn tool with a summary of what you accomplished.",
                "If you still have critical work in progress, continue working.",
                "</shutdown-request>",
              ].join("\n")

              // Mark shutdown as requested
              updateTaskState(config, (task) => ({
                ...task,
                shutdownRequested: true,
              }))
              break
            }
            case "task_claimed": {
              currentPrompt = waitResult.prompt
              break
            }
            case "aborted": {
              log.info("teammate received abort during wait", { agentId: identity.agentId })
              break
            }
          }
        }

        // Clean exit
        const finalStatus = abort.aborted ? "killed" : "completed"
        updateTaskState(config, (task) => ({
          ...task,
          status: finalStatus,
          isIdle: false,
          endTime: Date.now(),
        }))

        log.info("teammate runner exiting", {
          agentId: identity.agentId,
          status: finalStatus,
          iterations: iteration,
        })

        return { success: true }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        log.error("teammate runner error", {
          agentId: identity.agentId,
          error: message,
          iteration,
        })

        updateTaskState(config, (task) => ({
          ...task,
          status: "failed",
          isIdle: false,
          error: message,
          endTime: Date.now(),
        }))

        return { success: false, error: message }
      }
    })
  })
}

// ─── Internal: Execute Prompt ────────────────────────────────────────────────

async function executeTeammatePrompt(
  config: TeammateRunnerConfig,
  prompt: string,
  _iteration: number,
): Promise<{ success: boolean; error?: string; sessionId?: string }> {
  const { identity, abortController } = config

  try {
    // Create a child session for this iteration
    const session = await Session.create({
      parentID: SessionID.make(identity.parentSessionId),
      title: `${identity.agentName}: ${prompt.slice(0, 50)}${prompt.length > 50 ? "..." : ""}`,
    })

    // Track the current child session
    updateTaskState(config, (task) => ({
      ...task,
      currentSessionId: session.id,
    }))

    // Build the full prompt with teammate system addendum
    const fullPrompt = `${TEAMMATE_SYSTEM_PROMPT_ADDENDUM}\n\n${prompt}`

    // Resolve prompt parts
    const parts = await SessionPrompt.resolvePromptParts(fullPrompt)

    // Create a per-turn abort controller
    const turnAbort = new AbortController()
    updateTaskState(config, (task) => ({
      ...task,
      currentWorkAbortController: turnAbort,
    }))

    // Link parent abort to turn abort
    const onAbort = () => {
      if (!turnAbort.signal.aborted) {
        try {
          turnAbort.abort("parent aborted")
        } catch {
          // Swallowed
        }
      }
    }
    abortController.signal.addEventListener("abort", onAbort, { once: true })

    // Wire session cancellation
    const sessionCancel = () => SessionPrompt.cancel(session.id)
    turnAbort.signal.addEventListener("abort", sessionCancel, { once: true })

    try {
      // Use runSubagent — same as the task tool
      const result = await SessionPrompt.runSubagent({
        messageID: MessageID.ascending(),
        sessionID: session.id,
        model: config.model
          ? {
              modelID: config.model.modelID as ModelID,
              providerID: config.model.providerID as ProviderID,
            }
          : undefined,
        parts,
      })

      if (result.status === "error") {
        const errorMsg = result.error instanceof Error ? result.error.message : String(result.error)
        return { success: false, error: errorMsg, sessionId: session.id }
      }

      if (result.status === "aborted") {
        return { success: false, error: "aborted", sessionId: session.id }
      }

      return { success: true, sessionId: session.id }
    } finally {
      abortController.signal.removeEventListener("abort", onAbort)
      turnAbort.signal.removeEventListener("abort", sessionCancel)

      // Clear per-turn abort controller
      updateTaskState(config, (task) => ({
        ...task,
        currentWorkAbortController: undefined,
      }))
    }
  } catch (error: unknown) {
    // Handle abort errors gracefully
    if (error instanceof DOMException && error.name === "AbortError") {
      return { success: false, error: "aborted" }
    }
    const message = error instanceof Error ? error.message : String(error)
    return { success: false, error: message }
  }
}

// ─── Internal: Wait for Next Work ────────────────────────────────────────────

/**
 * Polls the mailbox and task list at 500ms intervals until new work arrives.
 *
 * Priority order:
 * 1. Abort signal (immediate exit)
 * 2. Shutdown requests in mailbox
 * 3. Leader/peer messages in mailbox
 * 4. Pending user messages in AppState
 * 5. Unclaimed tasks in team task list
 */
async function waitForNextPromptOrShutdown(config: TeammateRunnerConfig): Promise<WaitResult> {
  const { identity, abortController, taskId, teammateContext } = config
  const abort = abortController.signal

  while (!abort.aborted) {
    // ── Check mailbox for messages ──
    try {
      const unread = await readUnreadMessages(identity.agentName, identity.teamName)
      if (unread.length > 0) {
        // Check for shutdown requests first (highest priority)
        for (const msg of unread) {
          if (isShutdownRequest(msg.text)) {
            await markMessagesAsRead(identity.agentName, identity.teamName)
            let reason: string | undefined
            try {
              const parsed = JSON.parse(msg.text)
              reason = parsed.reason
            } catch {
              // Not JSON — use as-is
            }
            return { type: "shutdown_request", reason }
          }
        }

        // Regular message — take the first unread non-protocol message
        const regularMessages = unread.filter((m) => !isShutdownRequest(m.text))
        if (regularMessages.length > 0) {
          await markMessagesAsRead(identity.agentName, identity.teamName)
          // If multiple messages, concatenate them
          if (regularMessages.length === 1) {
            return {
              type: "new_message",
              text: regularMessages[0].text,
              from: regularMessages[0].from,
            }
          }
          // Multiple messages: format as XML block
          return {
            type: "new_message",
            text: formatTeammateMessages(regularMessages),
            from: "multiple",
          }
        }
      }
    } catch (error: unknown) {
      // Mailbox read failures are non-fatal — log and retry
      log.warn("failed to read mailbox during poll", {
        agentId: identity.agentId,
        error: error instanceof Error ? error.message : String(error),
      })
    }

    // ── Check pending user messages in AppState ──
    const appState = teammateContext.getAppState()
    const task = appState.tasks?.[taskId]
    if (task && isTeammateTask(task) && task.pendingUserMessages.length > 0) {
      const messages = [...task.pendingUserMessages]

      // Clear pending messages
      updateTaskState(config, (t) => ({
        ...t,
        pendingUserMessages: [],
      }))

      return {
        type: "new_message",
        text: messages.join("\n\n"),
        from: "user",
      }
    }

    // ── Check team task list for unclaimed tasks ──
    const claimedTask = await tryClaimNextTask(config)
    if (claimedTask) {
      return {
        type: "task_claimed",
        prompt: claimedTask.prompt,
        taskId: claimedTask.taskId,
      }
    }

    // ── Wait before next poll ──
    await sleep(TEAMMATE_POLL_INTERVAL_MS, abort)
  }

  return { type: "aborted" }
}

// ─── Internal: Task Claiming ─────────────────────────────────────────────────

/**
 * Check the team task list for unclaimed tasks and claim one if available.
 *
 * A "task" in this context is a pending item in the team file's task list,
 * NOT an AppState.tasks entry. This matches Claude Code's pattern where
 * the coordinator assigns tasks via the team file.
 */
async function tryClaimNextTask(config: TeammateRunnerConfig): Promise<{ prompt: string; taskId: string } | null> {
  const { identity } = config

  try {
    const teamFile = await readTeamFile(identity.teamName)
    if (!teamFile) return null

    // Look for unclaimed tasks assigned to this agent or unassigned
    const tasks = (teamFile as TeamFile & { tasks?: TeamTask[] }).tasks
    if (!tasks || tasks.length === 0) return null

    for (const task of tasks) {
      if (task.status === "pending" && (!task.assignee || task.assignee === identity.agentName)) {
        // Claim by updating status — note: this is not atomic with other teammates.
        // A proper implementation would use file locking, but for Phase 3 this is
        // sufficient since task collisions are rare and the prompt is idempotent.
        task.status = "claimed"
        task.assignee = identity.agentName
        task.claimedAt = Date.now()

        log.info("teammate claimed task", {
          agentId: identity.agentId,
          taskId: task.id,
          description: task.description?.slice(0, 100),
        })

        return {
          prompt: task.prompt ?? task.description ?? "",
          taskId: task.id,
        }
      }
    }
  } catch (error: unknown) {
    log.warn("failed to check team task list", {
      agentId: identity.agentId,
      error: error instanceof Error ? error.message : String(error),
    })
  }

  return null
}

/** Team task file entry (extension to TeamFile) */
interface TeamTask {
  id: string
  description?: string
  prompt?: string
  status: "pending" | "claimed" | "completed"
  assignee?: string
  claimedAt?: number
}

// ─── Internal: Helpers ───────────────────────────────────────────────────────

/**
 * Send an idle notification to the leader's mailbox.
 */
async function sendIdleNotification(identity: TeammateIdentity): Promise<void> {
  const notification = createIdleNotification(identity.agentId, "available")

  try {
    await writeToMailbox(
      "team-lead",
      {
        from: identity.agentName,
        text: JSON.stringify(notification),
        timestamp: new Date().toISOString(),
        read: false,
      },
      identity.teamName,
    )
  } catch (error: unknown) {
    // Non-fatal — leader will see the teammate's idle status via AppState
    log.warn("failed to send idle notification", {
      agentId: identity.agentId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Atomically update the teammate's task state in AppState.
 */
function updateTaskState(config: TeammateRunnerConfig, updater: (task: TeammateTaskState) => TeammateTaskState): void {
  config.teammateContext.setAppStateForTasks((state: AppState) => {
    const task = state.tasks?.[config.taskId]
    if (!task || !isTeammateTask(task)) return state

    return {
      ...state,
      tasks: {
        ...state.tasks,
        [config.taskId]: updater(task),
      },
    }
  })
}

/**
 * Fire all registered idle callbacks on the task.
 */
function fireIdleCallbacks(config: TeammateRunnerConfig): void {
  const state = config.teammateContext.getAppState()
  const task = state.tasks?.[config.taskId]
  if (!task || !isTeammateTask(task) || !task.onIdleCallbacks) return

  for (const cb of task.onIdleCallbacks) {
    try {
      cb()
    } catch {
      // Swallowed — callbacks are best-effort
    }
  }
}

/**
 * Abort-aware sleep.
 */
function sleep(ms: number, abort: AbortSignal): Promise<void> {
  if (abort.aborted) return Promise.resolve()
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms)
    const onAbort = () => {
      clearTimeout(timer)
      resolve()
    }
    abort.addEventListener("abort", onAbort, { once: true })
  })
}
