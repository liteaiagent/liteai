import fs from "node:fs/promises"
import path from "node:path"
import { Log } from "@liteai/util/log"
import { trace } from "@opentelemetry/api"
import { Instance } from "../../project/instance"
import type { Session } from ".."
import type { Message } from "../message"
import type { PlanModeState } from "../plan-mode-state"
import { PLAN_REMINDER_FULL_INTERVAL } from "../plan-mode-state"
import { PartID } from "../schema"

const tracer = trace.getTracer("liteai")
const log = Log.create({ service: "session.engine.plan-reminder" })

/** Maximum value for the turns-since-reminder counter to prevent unbounded growth. */
const MAX_PLAN_REMINDER_COUNTER = 100

/** Maximum plan file size (bytes) to read in full. Files exceeding this are truncated. */
const MAX_PLAN_FILE_SIZE = 100 * 1024

/**
 * Inject a plan reminder attachment into the last user message.
 *
 * During build mode (approved plan text set, plan mode exited), injects plan
 * text reminders using the full/sparse cycle (ADR-003 / FR-011 behavior).
 * When no approved plan exists, this is a no-op.
 *
 * @returns Updated messages and the mutated PlanModeState (with incremented/reset counter)
 */
export async function injectPlanAttachment(input: {
  messages: Message.WithParts[]
  planModeState: PlanModeState
  session: Session.Info
}): Promise<{
  messages: Message.WithParts[]
  updatedState: PlanModeState
}> {
  const { messages, planModeState } = input

  // ── No approved plan: no-op ──
  if (!planModeState.planText) {
    return { messages, updatedState: planModeState }
  }

  return tracer.startActiveSpan("planReminder.inject", async (span) => {
    try {
      const userMessage = messages.findLast((msg) => msg.info.role === "user")
      if (!userMessage) {
        span.setAttribute("plan_reminder.skipped", "no_user_message")
        return { messages, updatedState: planModeState }
      }

      const planFilePath = planModeState.planFilePath
      const relativePath = path.relative(Instance.worktree, planFilePath)
      const isFullReminderTurn = planModeState.turnsSincePlanReminder >= PLAN_REMINDER_FULL_INTERVAL

      span.setAttribute("plan_reminder.turn_counter", planModeState.turnsSincePlanReminder)
      span.setAttribute("plan_reminder.is_full_turn", isFullReminderTurn)

      let reminderText: string
      let updatedCounter: number

      if (isFullReminderTurn) {
        // ── T013: Full plan text injection every Nth turn (FR-005) ──
        let handle: fs.FileHandle | undefined
        try {
          handle = await fs.open(planFilePath, "r")
          const stat = await handle.stat()
          if (stat.size > MAX_PLAN_FILE_SIZE) {
            // File exceeds threshold — read only the first N bytes to avoid unbounded memory use
            const buf = Buffer.alloc(MAX_PLAN_FILE_SIZE)
            const { bytesRead } = await handle.read(buf, 0, MAX_PLAN_FILE_SIZE, 0)
            reminderText = `${buf.toString("utf-8", 0, bytesRead)}\n... [truncated]`
            updatedCounter = 0
            span.setAttribute("plan_reminder.type", "truncated")
            span.setAttribute("plan_reminder.plan_size", stat.size)
            log.info("plan file exceeds size threshold, injecting truncated content", {
              sessionID: userMessage.info.sessionID,
              planFilePath: relativePath,
              actualSize: stat.size,
              threshold: MAX_PLAN_FILE_SIZE,
            })
          } else {
            const buf = Buffer.alloc(stat.size)
            const { bytesRead } = await handle.read(buf, 0, stat.size, 0)
            const planContent = buf.toString("utf-8", 0, bytesRead)
            reminderText = planContent
            updatedCounter = 0
            span.setAttribute("plan_reminder.type", "full")
            span.setAttribute("plan_reminder.plan_size", planContent.length)
            log.info("injecting full plan text attachment", {
              sessionID: userMessage.info.sessionID,
              planFilePath: relativePath,
              planSize: planContent.length,
            })
          }
        } catch (error) {
          if (error instanceof Error && "code" in error && error.code === "ENOENT") {
            // Plan file is missing — we intentionally keep attempting full-text injection
            // on subsequent turns when the file is absent. The counter is capped to
            // prevent unbounded numeric growth while preserving the retry semantics.
            reminderText = `No plan file exists yet at ${relativePath}`
            updatedCounter = Math.min(planModeState.turnsSincePlanReminder + 1, MAX_PLAN_REMINDER_COUNTER)
            span.setAttribute("plan_reminder.type", "sparse_fallback")
            log.info("full plan text requested but file missing, falling back to sparse", {
              sessionID: userMessage.info.sessionID,
              planFilePath: relativePath,
            })
          } else {
            throw error
          }
        } finally {
          if (handle) {
            await handle.close()
          }
        }
      } else {
        // ── T012: Sparse reminder injection (FR-004) ──
        let planExists = false
        try {
          await fs.access(planFilePath, fs.constants.F_OK)
          planExists = true
        } catch {
          planExists = false
        }

        if (planExists) {
          reminderText = `Plan at ${relativePath}, staying on track?`
        } else {
          // ── T014: Plan-not-exists handling (acceptance scenario 4) ──
          reminderText = `No plan file exists yet at ${relativePath}`
        }
        updatedCounter = planModeState.turnsSincePlanReminder + 1
        span.setAttribute("plan_reminder.type", planExists ? "sparse" : "sparse_no_plan")
      }

      // ── In-memory part append — no DB writes (R-002 / C-002) ──
      const attachmentPart: Message.TextPart = {
        type: "text",
        id: PartID.ascending(),
        messageID: userMessage.info.id,
        sessionID: userMessage.info.sessionID,
        text: reminderText,
        synthetic: false, // Visible to model as user context, not hidden
      }

      // Clone the user message with the appended attachment part
      const updatedMessages = [...messages]
      const userIdx = updatedMessages.findLastIndex((m) => m.info.role === "user")
      if (userIdx !== -1) {
        updatedMessages[userIdx] = {
          ...updatedMessages[userIdx],
          parts: [...updatedMessages[userIdx].parts, attachmentPart],
        }
      }

      const updatedState: PlanModeState = {
        ...planModeState,
        turnsSincePlanReminder: updatedCounter,
      }

      span.setAttribute("plan_reminder.counter_after", updatedCounter)

      return { messages: updatedMessages, updatedState }
    } catch (e) {
      span.recordException(e as Error)
      throw e
    } finally {
      span.end()
    }
  })
}
