import { trace } from "@opentelemetry/api"
import { Bus } from "@/bus"
import { Session } from "./index"
import type { SessionID } from "./schema"

const tracer = trace.getTracer("liteai")

export interface PlanModeState {
  /** Whether plan mode is currently active */
  active: boolean
  /** Last-known plan text (set by ExitPlanModeTool) */
  planText: string | undefined
  /** Deterministic per-session plan file path */
  planFilePath: string
  /** Turns since last full plan reminder injection. Resets at 5. */
  turnsSincePlanReminder: number
}

/** Full plan text injection interval — resets at this value (FR-005). */
export const PLAN_REMINDER_FULL_INTERVAL = 5

/**
 * Create a default PlanModeState for a session.
 * Used on session creation and when the `plan_mode` column is null.
 */
export function createDefaultPlanModeState(session: Session.Info): PlanModeState {
  return {
    active: false,
    planText: undefined,
    planFilePath: Session.plan(session),
    turnsSincePlanReminder: 0,
  }
}

// ─── Session-scoped In-Memory State Registry ─────────────────────────────────
//
// Each active session owns a PlanModeStateRef that holds the mutable plan mode
// state in memory. The ref is registered when the session loop starts and
// deregistered on cleanup. All reads and writes are synchronous memory
// operations — zero database overhead on the hot path.
//
// The registry is intentionally module-scoped (like `_state` in loop.ts)
// because the root agent has no AsyncLocalStorage context.

const registry = new Map<SessionID, PlanModeStateRef>()

/**
 * Session-scoped, in-memory plan mode state container.
 *
 * Replaces the previous database-backed `getPlanModeState`/`setPlanModeState`
 * with synchronous memory access. Event emission (`PlanStateChanged`) is
 * handled inline on `active` transitions via `Bus.publish`.
 *
 * Lifecycle:
 *   - Created by `runSessionInner` in loop.ts
 *   - Registered via `PlanModeStateRef.register()`
 *   - Deregistered via `PlanModeStateRef.deregister()` on session cleanup
 *
 * Access:
 *   - `PlanModeStateRef.for(sessionID)` — returns the ref or throws (fail-fast)
 */
export class PlanModeStateRef {
  private _state: PlanModeState

  constructor(
    initial: PlanModeState,
    private sessionID: SessionID,
  ) {
    this._state = initial
  }

  /** Synchronous read — zero DB overhead. */
  get(): PlanModeState {
    return this._state
  }

  /**
   * Mutate the plan mode state synchronously.
   * Emits `PlanStateChanged` via `Bus.publish` when the `active` field transitions.
   */
  update(fn: (s: PlanModeState) => PlanModeState): PlanModeState {
    return tracer.startActiveSpan("planModeState.update", (span) => {
      try {
        const prev = this._state
        this._state = fn(prev)

        span.setAttribute("plan_mode.active.before", prev.active)
        span.setAttribute("plan_mode.active.after", this._state.active)
        span.setAttribute("plan_mode.turnsSincePlanReminder", this._state.turnsSincePlanReminder)

        if (prev.active !== this._state.active) {
          span.addEvent("plan_mode.state_transition", {
            from: String(prev.active),
            to: String(this._state.active),
          })
          Bus.publish(Session.Event.PlanStateChanged, {
            sessionID: this.sessionID,
            active: this._state.active,
            planFilePath: this._state.planFilePath,
            turnsSincePlanReminder: this._state.turnsSincePlanReminder,
          })
        }

        return this._state
      } finally {
        span.end()
      }
    })
  }

  // ── Registry API ──

  /**
   * Register this ref for the session. Called at session loop start.
   * Throws if a ref is already registered (indicates lifecycle bug).
   */
  register(): void {
    if (registry.has(this.sessionID)) {
      throw new Error(
        `PlanModeStateRef already registered for session ${this.sessionID}. ` +
          "This indicates a session lifecycle bug — deregister before re-registering.",
      )
    }
    registry.set(this.sessionID, this)
  }

  /**
   * Deregister this ref for the session. Called at session loop cleanup.
   */
  deregister(): void {
    registry.delete(this.sessionID)
  }

  /**
   * Look up the ref for a session. Throws if not registered (fail-fast).
   * Use this from tool execute() functions and queryLoop.
   */
  static for(sessionID: SessionID): PlanModeStateRef {
    const ref = registry.get(sessionID)
    if (!ref) {
      throw new Error(
        `PlanModeStateRef not registered for session ${sessionID}. ` +
          "This indicates the session loop has not started or has already been cleaned up.",
      )
    }
    return ref
  }

  /**
   * Check if a ref is registered for a session. Non-throwing.
   * Useful for optional access paths (e.g., session resume checks).
   */
  static has(sessionID: SessionID): boolean {
    return registry.has(sessionID)
  }
}
