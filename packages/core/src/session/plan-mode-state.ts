import { trace } from "@opentelemetry/api"
import { eq } from "drizzle-orm"
import { Bus } from "@/bus"
import { Database } from "@/storage/db"
import { Session } from "./index"
import type { SessionID } from "./schema"
import { SessionTable } from "./session.sql"

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

/**
 * Read PlanModeState from the session row.
 * Returns default state if the column is null.
 */
export async function getPlanModeState(sessionID: SessionID): Promise<PlanModeState> {
  return tracer.startActiveSpan("planModeState.get", async (span) => {
    try {
      const row = Database.use((db) =>
        db.select({ plan_mode: SessionTable.plan_mode }).from(SessionTable).where(eq(SessionTable.id, sessionID)).get(),
      )
      if (!row) throw new Error(`Session not found: ${sessionID}`)

      if (row.plan_mode) {
        span.setAttribute("plan_mode.active", row.plan_mode.active)
        span.setAttribute("plan_mode.turnsSincePlanReminder", row.plan_mode.turnsSincePlanReminder)
        return row.plan_mode
      }

      // Column is null — return default state via async session lookup
      const session = await Session.get(sessionID)
      const defaultState = createDefaultPlanModeState(session)
      span.setAttribute("plan_mode.active", defaultState.active)
      span.setAttribute("plan_mode.source", "default")
      return defaultState
    } catch (e) {
      span.recordException(e as Error)
      throw e
    } finally {
      span.end()
    }
  })
}

/**
 * Persist PlanModeState to the session row.
 * Emits plan.state_changed SSE event if `active` field changed.
 */
export async function setPlanModeState(
  sessionID: SessionID,
  updater: (state: PlanModeState) => PlanModeState,
): Promise<PlanModeState> {
  return tracer.startActiveSpan("planModeState.set", async (span) => {
    try {
      const current = await getPlanModeState(sessionID)
      const next = updater(current)

      span.setAttribute("plan_mode.active.before", current.active)
      span.setAttribute("plan_mode.active.after", next.active)
      span.setAttribute("plan_mode.turnsSincePlanReminder", next.turnsSincePlanReminder)

      const updatedRow = Database.use((db) =>
        db
          .update(SessionTable)
          .set({ plan_mode: next })
          .where(eq(SessionTable.id, sessionID))
          .returning({ plan_mode: SessionTable.plan_mode })
          .get(),
      )

      if (!updatedRow || !updatedRow.plan_mode) throw new Error("Failed to update plan mode state")

      if (current.active !== next.active) {
        span.addEvent("plan_mode.state_transition", {
          from: String(current.active),
          to: String(next.active),
        })
        Database.effect(() => {
          Bus.publish(Session.Event.PlanStateChanged, {
            sessionID,
            active: next.active,
            planFilePath: next.planFilePath,
            turnsSincePlanReminder: next.turnsSincePlanReminder,
          })
        })
      }

      return updatedRow.plan_mode
    } catch (e) {
      span.recordException(e as Error)
      throw e
    } finally {
      span.end()
    }
  })
}
