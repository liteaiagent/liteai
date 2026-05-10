/**
 * Spawn and kill lifecycle for in-process teammates.
 *
 * `spawnInProcessTeammate()` creates the teammate context, abort controller,
 * and registers the task in AppState. It does NOT start the runner loop — the
 * caller must invoke `startInProcessTeammate()` separately to support the
 * fire-and-forget pattern.
 *
 * `killInProcessTeammate()` force-kills a teammate by aborting its controller,
 * cleaning up callbacks, and marking the task as 'killed'.
 *
 * Reference: Claude Code `utils/swarm/spawnInProcess.ts`
 */
import { Log } from "@liteai/util/log"
import type { AppState, ParentContext, TeammateAgentContext } from "../agent/context"
import { Bus } from "../bus"
import { findBuiltInAgent } from "./built-in-agents"
import { sanitizeTeamName } from "./team-helpers"
import { createTeammateContext } from "./teammate-context"
import { TeammateEvent } from "./teammate-events"
import {
  createTeammateTaskState,
  formatAgentId,
  isTeammateTask,
  type TeammateIdentity,
  type TeammateTaskState,
} from "./teammate-types"

const log = Log.create({ service: "coordinator.spawn" })

// ─── Types ───────────────────────────────────────────────────────────────────

export interface InProcessSpawnConfig {
  /** Human-readable name for the teammate */
  name: string
  /** Team this teammate belongs to */
  teamName: string
  /** Initial prompt / instructions */
  prompt: string
  /** Color for UI differentiation */
  color?: string
  /** Whether this teammate must operate in plan mode */
  planModeRequired: boolean
  /** Model override (undefined = inherit from leader) */
  model?: string
  /**
   * Built-in agent type (e.g., 'verification').
   * When set, applies the profile's tool restrictions, system prompt, and color.
   */
  agentType?: string
}

export interface InProcessSpawnOutput {
  success: boolean
  agentId: string
  taskId?: string
  abortController?: AbortController
  teammateContext?: TeammateAgentContext
  error?: string
}

// ─── Color Assignment ────────────────────────────────────────────────────────

const TEAMMATE_COLORS = ["cyan", "magenta", "yellow", "green", "red", "blue", "white"] as const

let _colorIndex = 0

/**
 * Assign a deterministic color to a teammate.
 * Cycles through the palette, skipping "blue" (reserved for leader).
 */
function assignTeammateColor(): string {
  const color = TEAMMATE_COLORS[_colorIndex % TEAMMATE_COLORS.length]
  _colorIndex++
  // Skip blue (leader color) — advance to next
  if (color === "blue") {
    const next = TEAMMATE_COLORS[_colorIndex % TEAMMATE_COLORS.length]
    _colorIndex++
    return next
  }
  return color
}

// ─── Spawn ───────────────────────────────────────────────────────────────────

/**
 * Spawn an in-process teammate.
 *
 * Creates the execution context, abort controller, and registers the task
 * in `AppState.tasks`. Does NOT start the runner loop.
 *
 * @returns Spawn result with context and abort controller if successful
 */
export async function spawnInProcessTeammate(
  config: InProcessSpawnConfig,
  parentContext: ParentContext,
): Promise<InProcessSpawnOutput> {
  const sanitizedName = sanitizeTeamName(config.name)
  if (sanitizedName.length === 0) {
    return {
      success: false,
      agentId: formatAgentId(config.name, config.teamName),
      error: `Teammate name "${config.name}" sanitizes to empty string — use alphanumeric characters`,
    }
  }

  const agentId = formatAgentId(sanitizedName, config.teamName)
  const taskId = `teammate-${agentId}-${Date.now().toString(36)}`

  // Resolve built-in agent profile (if agentType specified)
  const builtInProfile = config.agentType ? findBuiltInAgent(config.agentType) : undefined
  const color = config.color ?? builtInProfile?.color ?? assignTeammateColor()

  log.info("spawning in-process teammate", {
    agentId,
    taskId,
    teamName: config.teamName,
    planModeRequired: config.planModeRequired,
  })

  // Create independent abort controller — NOT linked to parent.
  // Teammates have their own lifecycle; the leader kills them explicitly.
  const abortController = new AbortController()

  // Build identity
  const identity: TeammateIdentity = {
    agentId,
    agentName: sanitizedName,
    teamName: config.teamName,
    color,
    planModeRequired: config.planModeRequired,
    parentSessionId: parentContext.sessionId,
  }

  // Create the execution context (AsyncLocalStorage-compatible)
  const teammateContext = createTeammateContext({
    agentId,
    agentName: sanitizedName,
    teamName: config.teamName,
    color,
    planModeRequired: config.planModeRequired,
    parentSessionId: parentContext.sessionId,
    abortController,
    parentContext,
  })

  // Register task state in AppState (via root store passthrough)
  const setAppState = parentContext.setAppStateForTasks ?? parentContext.setAppState
  const taskState = createTeammateTaskState(identity, config.prompt, config.model)
  taskState.abortController = abortController

  setAppState((state: AppState) => ({
    ...state,
    tasks: {
      ...state.tasks,
      [taskId]: taskState,
    },
    // Also register in teamContext.teammates for coordinator visibility
    teamContext: state.teamContext
      ? {
          ...state.teamContext,
          teammates: {
            ...state.teamContext.teammates,
            [agentId]: {
              name: sanitizedName,
              agentType: config.agentType ?? "teammate",
              color,
              spawnedAt: Date.now(),
              cwd: teammateContext.cwd,
            },
          },
        }
      : state.teamContext,
  }))

  // Publish spawn event for SSE consumers
  void Bus.publish(TeammateEvent.Spawned, {
    teamName: config.teamName,
    agentId,
    agentName: sanitizedName,
    color,
    taskId,
    parentSessionId: parentContext.sessionId,
  })

  log.info("teammate spawned successfully", { agentId, taskId })

  return {
    success: true,
    agentId,
    taskId,
    abortController,
    teammateContext,
  }
}

// ─── Kill ────────────────────────────────────────────────────────────────────

/**
 * Force-kill an in-process teammate.
 *
 * 1. Aborts the lifecycle AbortController
 * 2. Fires any idle callbacks (to unblock waiters)
 * 3. Marks the task as 'killed' in AppState
 * 4. Removes from teamContext.teammates
 * 5. Publishes TeammateEvent.Killed
 *
 * @returns `true` if the teammate was found and killed, `false` otherwise
 */
export function killInProcessTeammate(
  taskId: string,
  setAppState: (updater: (state: AppState) => AppState) => void,
): boolean {
  let killed = false
  let identity: TeammateIdentity | undefined

  setAppState((state: AppState) => {
    const task = state.tasks?.[taskId]
    if (!task || !isTeammateTask(task)) {
      return state
    }

    killed = true
    identity = task.identity

    // Abort the teammate's lifecycle
    if (task.abortController && !task.abortController.signal.aborted) {
      try {
        task.abortController.abort("teammate killed")
      } catch {
        // Swallowed — same Bun quirk as session/engine/loop.ts safeAbort()
      }
    }

    // Also abort current work if active
    if (task.currentWorkAbortController && !task.currentWorkAbortController.signal.aborted) {
      try {
        task.currentWorkAbortController.abort("teammate killed")
      } catch {
        // Swallowed
      }
    }

    // Fire idle callbacks to unblock any waiters
    if (task.onIdleCallbacks) {
      for (const cb of task.onIdleCallbacks) {
        try {
          cb()
        } catch {
          // Swallowed — callbacks are best-effort
        }
      }
    }

    // Clean up the unregister callback
    if (task.unregisterCleanup) {
      try {
        task.unregisterCleanup()
      } catch {
        // Swallowed
      }
    }

    // Update task state
    const updatedTask: TeammateTaskState = {
      ...task,
      status: "killed",
      isIdle: false,
      endTime: Date.now(),
      abortController: undefined,
      currentWorkAbortController: undefined,
      onIdleCallbacks: undefined,
      unregisterCleanup: undefined,
    }

    // Remove from teamContext.teammates
    const teammates = { ...state.teamContext?.teammates }
    delete teammates[task.identity.agentId]

    return {
      ...state,
      tasks: {
        ...state.tasks,
        [taskId]: updatedTask,
      },
      teamContext: state.teamContext
        ? {
            ...state.teamContext,
            teammates,
          }
        : state.teamContext,
    }
  })

  if (killed && identity) {
    log.info("teammate killed", { taskId, agentId: identity.agentId })

    void Bus.publish(TeammateEvent.Killed, {
      teamName: identity.teamName,
      agentId: identity.agentId,
      reason: "force killed",
    })
  }

  return killed
}
