import fs from "node:fs/promises"
import path from "node:path"
import { Log } from "@liteai/util/log"
import { trace } from "@opentelemetry/api"
import z from "zod"
import { isRootAgent } from "../agent/context"
import ENTER_DESCRIPTION from "../bundled/prompts/tools/plan-enter.txt"
import EXIT_DESCRIPTION from "../bundled/prompts/tools/plan-exit.txt"
import { Bus } from "../bus"
import { Instance } from "../project/instance"
import { ModelID, ProviderID } from "../provider/schema"
import { Session } from "../session"
import { SessionPrompt } from "../session/engine"
import { PlanModeStateRef } from "../session/plan-mode-state"
import { MessageID, type SessionID } from "../session/schema"
import { Tool } from "./tool"

const tracer = trace.getTracer("liteai")
const log = Log.create({ service: "tool.plan" })

/**
 * Consolidates repeated plan-enter error recovery:
 * 1. Clears planSessionID from PlanModeStateRef
 * 2. Restores root session permission mode to "default"
 * 3. Optionally removes the orphaned plan subagent session
 *
 * Catches its own errors so callers can rely on it not throwing.
 */
async function recoverPlanState(
  sessionID: Parameters<typeof SessionPrompt.setPermissionMode>[0],
  ref: ReturnType<typeof PlanModeStateRef.for>,
  planSessionId?: string,
): Promise<void> {
  try {
    ref.update((s) => ({ ...s, planSessionID: undefined }))
    SessionPrompt.setPermissionMode(sessionID, "default")
    if (planSessionId) {
      await Session.remove(planSessionId as Parameters<typeof Session.remove>[0])
    }
  } catch (recoveryErr) {
    log.error("plan state recovery failed", {
      recoveryError: recoveryErr,
      sessionID,
      planSessionID: planSessionId,
    })
  }
}

/**
 * Prepares a deferred listener for `PlanApprovalResolved` that MUST be set up
 * **before** `PlanApprovalRequested` is published. This prevents a race
 * condition where a synchronous subscriber on the Requested event publishes
 * Resolved before this listener exists.
 *
 * Usage:
 * ```ts
 * const approval = preparePlanApprovalListener(sessionID)
 * Bus.publish(Session.Event.PlanApprovalRequested, { ... })
 * const result = await approval.promise
 * ```
 *
 * Rejects with a timeout error if no response is received within `timeoutMs`
 * (default: 10 minutes) to prevent leaked Bus subscriptions.
 */
function preparePlanApprovalListener(
  sessionID: SessionID,
  timeoutMs = 10 * 60 * 1000,
): { promise: Promise<{ approved: boolean; feedback?: string }> } {
  let resolve!: (value: { approved: boolean; feedback?: string }) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<{ approved: boolean; feedback?: string }>((res, rej) => {
    resolve = res
    reject = rej
  })

  const timer = setTimeout(() => {
    unsub()
    reject(new Error(`Plan approval timeout for session ${sessionID} after ${timeoutMs}ms`))
  }, timeoutMs)

  const unsub = Bus.subscribe(Session.Event.PlanApprovalResolved, (evt) => {
    if (evt.properties.sessionID === sessionID) {
      clearTimeout(timer)
      unsub()
      resolve({ approved: evt.properties.approved, feedback: evt.properties.feedback })
    }
  })

  return { promise }
}

export const PlanExitTool = Tool.define("plan_exit", {
  description: EXIT_DESCRIPTION,
  parameters: z.object({
    plan: z.string().trim().min(1, "Plan is empty"),
  }),
  async execute(params, ctx) {
    return tracer.startActiveSpan("tool.plan_exit.execute", async (span) => {
      try {
        const state = PlanModeStateRef.for(ctx.sessionID).get()

        // Guard: must be in plan mode (planSessionID set) or have plan text from subagent
        if (state.planSessionID === undefined && state.planText === undefined) {
          throw new Error(
            "Cannot exit plan mode: Plan mode is not currently active. " +
              "Call plan_enter first to spawn a plan subagent.",
          )
        }

        const planFilePath = state.planFilePath
        const planDir = path.dirname(planFilePath)

        span.addEvent("tool.plan_exit.write_plan")
        try {
          await fs.mkdir(planDir, { recursive: true })
          await fs.writeFile(planFilePath, params.plan, "utf-8")
        } catch (e) {
          throw new Error(
            `Failed to write plan to disk at ${planFilePath}: ${e instanceof Error ? e.message : String(e)}`,
          )
        }

        span.addEvent("tool.plan_exit.approval_requested")

        // Read rootSessionID from execution context (set by plan_enter via bubble mode).
        // The approval event must target the root session so the CLI shows the dialog
        // in the user's visible session, not in the invisible subagent session.
        const { AgentExecutionContext } = await import("../agent/context")
        const execCtx = AgentExecutionContext.getStore()
        const appState = execCtx?.type === "root" || execCtx?.type === "subagent" ? execCtx.getAppState() : undefined
        const rootSessionID = (appState?.rootSessionID as string | undefined) ?? ctx.sessionID

        // CRITICAL: Subscribe to PlanApprovalResolved BEFORE publishing
        // PlanApprovalRequested. A synchronous subscriber on the Requested
        // event (e.g. CLI auto-approve) may publish Resolved in the same
        // tick. If we subscribed after, we'd miss it and hang forever.
        const approval = preparePlanApprovalListener(rootSessionID as typeof ctx.sessionID)

        Bus.publish(Session.Event.PlanApprovalRequested, {
          sessionID: rootSessionID as typeof ctx.sessionID,
          planText: params.plan,
          planFilePath,
        })

        const resolution = await approval.promise

        const relPlanPath = path.relative(Instance.worktree, planFilePath)

        if (!resolution.approved) {
          span.addEvent("tool.plan_exit.rejected")
          // Rejection → revision → re-submission path:
          // PlanModeStateRef is NOT mutated — plan mode remains active so the
          // agent can revise the plan and call plan_exit again.
          // Permission mode stays "plan" — root session remains read-only.
          throw new Error(
            resolution.feedback
              ? `User rejected the plan: ${resolution.feedback}. Continue refining the plan and call plan_exit again when ready.`
              : "User rejected the plan. Continue refining the plan and call plan_exit again when ready.",
          )
        }

        span.addEvent("tool.plan_exit.approved")

        // Restore write permissions — the core lifecycle gate
        SessionPrompt.setPermissionMode(ctx.sessionID, "default")

        // Clear plan session state and store the approved plan text
        PlanModeStateRef.for(ctx.sessionID).update((s) => ({
          ...s,
          planSessionID: undefined,
          turnsSincePlanReminder: 0,
          planText: params.plan,
        }))

        return {
          title: "Plan approved",
          output: `User has approved your plan. You can now start coding. Start with updating your todo list if applicable.\n\nYour plan has been saved to: ${relPlanPath}\nYou can refer back to it if needed during implementation.\n\n## Approved Plan:\n${params.plan}`,
          metadata: { planFilePath, approved: true },
        }
      } catch (e) {
        span.recordException(e as Error)
        throw e
      } finally {
        span.end()
      }
    })
  },
})

export const PlanEnterTool = Tool.define("plan_enter", {
  description: ENTER_DESCRIPTION,
  parameters: z.object({}),
  async execute(_params, ctx) {
    return tracer.startActiveSpan("tool.plan_enter.execute", async (span) => {
      try {
        // Sub-agents must not be able to activate plan mode.
        // Plan mode is a root-level state transition.
        if (!isRootAgent()) {
          throw new Error("EnterPlanMode tool cannot be used in sub-agent contexts")
        }

        const ref = PlanModeStateRef.for(ctx.sessionID)
        const state = ref.get()

        // ── Already-active guard ──
        // If plan mode is already active (planSessionID set), return a no-op.
        // This prevents re-entry and duplicate subagent spawns.
        if (state.planSessionID !== undefined) {
          span.addEvent("tool.plan_enter.already_active")
          const relPlanPath = path.relative(Instance.worktree, state.planFilePath)
          return {
            title: "Already in plan mode",
            output: `Plan mode is already active (plan session: ${state.planSessionID}). Continue working on the plan at ${relPlanPath}.`,
            metadata: { planFilePath: state.planFilePath, planSessionID: state.planSessionID },
          }
        }

        // ── Gate root session to read-only ──
        span.addEvent("tool.plan_enter.setting_plan_permission")
        SessionPrompt.setPermissionMode(ctx.sessionID, "plan")

        // ── Spawn blocking plan subagent ──
        let planSession: Session.Info
        try {
          planSession = await Session.create({
            parentID: ctx.sessionID,
            title: "Plan subagent",
          })
        } catch (e) {
          // Recovery: restore permissions if session creation fails
          log.error("failed to create plan subagent session", { error: e, sessionID: ctx.sessionID })
          const originalError = new Error(
            `Failed to create plan subagent session: ${e instanceof Error ? e.message : String(e)}`,
          )
          await recoverPlanState(ctx.sessionID, ref)
          throw originalError
        }

        // Track the plan session in state
        ref.update((s) => ({
          ...s,
          planSessionID: planSession.id,
        }))

        const relPlanPath = path.relative(Instance.worktree, state.planFilePath)
        const planPrompt = [
          "You are a plan subagent. Your task is to explore the codebase, understand the architecture,",
          "and create a detailed implementation plan.",
          "",
          `Write your final plan to: ${relPlanPath}`,
          `Absolute path: ${state.planFilePath}`,
          "",
          "Instructions:",
          "1. Use read, glob, grep, and bash (read-only) tools to explore the codebase",
          "2. Understand existing patterns and architecture",
          "3. Design a clear, step-by-step implementation plan",
          `4. Write the plan to ${relPlanPath} using the write tool`,
          "5. Return the FULL plan text as your final response",
          "",
          "Context from the root agent:",
          ctx.extra?.planContext ?? "No additional context provided.",
        ].join("\n")

        // Determine model from parent context (mirrors agent.ts pattern)
        let model: { modelID: ModelID; providerID: ProviderID } | undefined
        const parentAssistant = ctx.messages.findLast((m) => m.info.id === ctx.messageID)
        if (parentAssistant && parentAssistant.info.role === "assistant") {
          model = {
            modelID: parentAssistant.info.modelID,
            providerID: parentAssistant.info.providerID,
          }
        } else if (ctx.extra?.model && typeof ctx.extra.model === "object") {
          // Fallback: ctx.extra.model is set by the streaming loop before tool
          // execution — use it when the assistant message isn't committed yet.
          const m = ctx.extra.model as { api?: { id?: unknown }; id?: unknown; providerID?: unknown }
          const modelIdStr = m.api?.id || m.id
          if (typeof modelIdStr !== "string" || !modelIdStr || typeof m.providerID !== "string" || !m.providerID) {
            const originalError = new Error(
              "Could not determine parent model for plan subagent: invalid ctx.extra.model",
            )
            await recoverPlanState(ctx.sessionID, ref, planSession.id)
            throw originalError
          }
          model = {
            modelID: ModelID.make(modelIdStr),
            providerID: ProviderID.make(m.providerID),
          }
        }

        if (!model) {
          const originalError = new Error("Could not determine parent model for plan subagent")
          await recoverPlanState(ctx.sessionID, ref, planSession.id)
          throw originalError
        }

        span.addEvent("tool.plan_enter.spawning_subagent", {
          planSessionID: planSession.id,
          planFilePath: state.planFilePath,
        })

        const messageID = MessageID.ascending()
        const promptParts = await SessionPrompt.resolvePromptParts(planPrompt)

        let result: Awaited<ReturnType<typeof SessionPrompt.runSubagent>>
        try {
          // Start the subagent promise — this synchronously calls start()
          // which creates the session state entry with appState: {}.
          const subagentPromise = SessionPrompt.runSubagent({
            messageID,
            sessionID: planSession.id,
            model: {
              modelID: model.modelID,
              providerID: model.providerID,
            },
            agent: "plan",
            parts: promptParts,
          })

          // Set bubble mode and rootSessionID on the plan subagent session BEFORE
          // the session inner loop starts. This is race-free because start() is
          // synchronous and JS doesn't yield until the first await inside runSubagent.
          SessionPrompt.patchSessionAppState(planSession.id, {
            permissionMode: "bubble",
            rootSessionID: ctx.sessionID,
          })

          result = await subagentPromise
        } catch (e) {
          // Error recovery: restore permission mode, clear plan session, and remove orphaned session
          log.error("plan subagent failed", { error: e, sessionID: ctx.sessionID, planSessionID: planSession.id })
          const originalError = new Error(`Plan subagent failed: ${e instanceof Error ? e.message : String(e)}`)
          await recoverPlanState(ctx.sessionID, ref, planSession.id)
          throw originalError
        }

        // Handle subagent error/abort results
        if (result.status === "error") {
          const errorMsg = result.error instanceof Error ? result.error.message : String(result.error)
          log.error("plan subagent returned error", { error: errorMsg, sessionID: ctx.sessionID })
          const originalError = new Error(`Plan subagent failed: ${errorMsg}`)
          await recoverPlanState(ctx.sessionID, ref, planSession.id)
          throw originalError
        }

        if (result.status === "aborted") {
          log.warn("plan subagent was aborted", { sessionID: ctx.sessionID })
          const originalError = new Error("Plan subagent was aborted")
          await recoverPlanState(ctx.sessionID, ref, planSession.id)
          throw originalError
        }

        // ── Extract plan text from subagent result ──
        const completedMessage = result.message
        const planText =
          (completedMessage?.parts.findLast((x: { type?: string }) => x.type === "text") as { text?: string })?.text ??
          ""

        // Store the plan text in state
        ref.update((s) => ({
          ...s,
          planText: planText || undefined,
        }))

        span.addEvent("tool.plan_enter.subagent_completed", {
          planSessionID: planSession.id,
          planTextLength: planText.length,
        })

        return {
          title: "Plan completed",
          output: planText || "Plan subagent completed but returned no plan text. Check the plan file.",
          metadata: {
            planFilePath: state.planFilePath,
            planSessionID: planSession.id,
          },
        }
      } catch (e) {
        span.recordException(e as Error)
        throw e
      } finally {
        span.end()
      }
    })
  },
})
