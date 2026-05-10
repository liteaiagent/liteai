/**
 * Core type definitions for in-process teammates.
 *
 * Defines the identity, task state, and utility types used throughout
 * the teammate runner, spawn, and event subsystems.
 *
 * Reference: Claude Code `tasks/InProcessTeammateTask/types.ts`
 */

// ─── Identity ────────────────────────────────────────────────────────────────

/** Plain data object stored in AppState — no runtime references. */
export interface TeammateIdentity {
  /** Composite ID: `agentName@teamName` */
  readonly agentId: string
  /** Human-readable name (e.g., "researcher") */
  readonly agentName: string
  /** Team this teammate belongs to */
  readonly teamName: string
  /** Assigned color for UI differentiation */
  readonly color?: string
  /** Whether this teammate must operate in plan mode */
  readonly planModeRequired: boolean
  /** Session ID of the leader that spawned this teammate */
  readonly parentSessionId: string
}

// ─── Task State ──────────────────────────────────────────────────────────────

export type TeammateStatus = "running" | "idle" | "completed" | "failed" | "killed"

/**
 * Discriminated task state for in-process teammates, stored in `AppState.tasks`.
 *
 * Contains both serializable identity data and runtime-only references
 * (AbortController, callbacks) that are used by the runner loop.
 *
 * **Runtime-only fields** (AbortController, callbacks, etc.) are NOT persisted.
 * They exist only while the teammate is alive in-process.
 */
export interface TeammateTaskState {
  readonly type: "in_process_teammate"
  readonly identity: TeammateIdentity
  status: TeammateStatus
  /** Initial prompt that started this teammate */
  readonly prompt: string
  /** Model override for this teammate (undefined = inherit from leader) */
  readonly model?: string

  // ── Runtime-only lifecycle references ──

  /** Lifecycle AbortController — aborting this kills the teammate entirely */
  abortController?: AbortController
  /** Per-turn AbortController — aborting this stops current work, returns to idle */
  currentWorkAbortController?: AbortController
  /** Cleanup deregistration callback */
  unregisterCleanup?: () => void

  // ── State flags ──

  awaitingPlanApproval: boolean
  /** Permission mode inherited from leader (Phase 4 will enrich this) */
  permissionMode: string
  isIdle: boolean
  shutdownRequested: boolean

  // ── Message tracking ──

  /**
   * Capped UI mirror of recent messages.
   * Full transcript lives in child sessions created by `runSubagent()`.
   */
  messages?: TeammateUIMessage[]
  /** Messages queued from external sources (API, UI) before the teammate polls */
  pendingUserMessages: string[]

  // ── Error & progress ──

  error?: string
  lastReportedToolCount: number
  lastReportedTokenCount: number

  // ── Runtime callbacks ──

  /** Functions to invoke when teammate transitions to idle. Used by the runner. */
  onIdleCallbacks?: Array<() => void>

  // ── Session tracking ──

  /** Child session ID for the current `runSubagent()` iteration */
  currentSessionId?: string

  // ── Timestamps ──

  readonly startTime: number
  endTime?: number
}

/** Simplified message type for the capped UI mirror. */
export interface TeammateUIMessage {
  readonly from: string
  readonly text: string
  readonly timestamp: string
  readonly isProtocol?: boolean
}

// ─── Constants ───────────────────────────────────────────────────────────────

/**
 * Maximum number of messages retained in the UI mirror.
 * Matches Claude Code's BQ analysis cap for optimal UI performance.
 */
export const TEAMMATE_MESSAGES_UI_CAP = 50

/** Default polling interval for mailbox checks (ms). */
export const TEAMMATE_POLL_INTERVAL_MS = 500

// ─── Utilities ───────────────────────────────────────────────────────────────

/**
 * Append an item to a capped array, evicting the oldest when at capacity.
 *
 * Returns a new array — does NOT mutate the input.
 */
export function appendCappedMessage<T>(prev: readonly T[] | undefined, item: T, cap = TEAMMATE_MESSAGES_UI_CAP): T[] {
  const existing = prev ?? []
  if (existing.length >= cap) {
    return [...existing.slice(existing.length - cap + 1), item]
  }
  return [...existing, item]
}

/**
 * Type guard: is this task entry a `TeammateTaskState`?
 */
export function isTeammateTask(task: unknown): task is TeammateTaskState {
  return (
    typeof task === "object" &&
    task !== null &&
    "type" in task &&
    (task as { type: string }).type === "in_process_teammate"
  )
}

/**
 * Format a composite agent ID from name and team: `agentName@teamName`.
 *
 * Matches Claude Code's `formatAgentId()` convention.
 */
export function formatAgentId(name: string, teamName: string): string {
  return `${name}@${teamName}`
}

/**
 * Parse a composite agent ID back into its components.
 * Returns `null` if the format is invalid.
 */
export function parseAgentId(agentId: string): { agentName: string; teamName: string } | null {
  const atIndex = agentId.indexOf("@")
  if (atIndex <= 0 || atIndex === agentId.length - 1) return null
  return {
    agentName: agentId.slice(0, atIndex),
    teamName: agentId.slice(atIndex + 1),
  }
}

/**
 * Create a fresh `TeammateTaskState` with sensible defaults.
 */
export function createTeammateTaskState(identity: TeammateIdentity, prompt: string, model?: string): TeammateTaskState {
  return {
    type: "in_process_teammate",
    identity,
    status: "running",
    prompt,
    model,
    awaitingPlanApproval: false,
    permissionMode: "default",
    isIdle: false,
    shutdownRequested: false,
    pendingUserMessages: [],
    lastReportedToolCount: 0,
    lastReportedTokenCount: 0,
    startTime: Date.now(),
  }
}
