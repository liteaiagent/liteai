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
import type { ModelID, ProviderID } from "../provider/schema"
import { Question } from "../question"
import { Session } from "../session"
import { SessionPrompt } from "../session/engine"
import { PlanModeStateRef } from "../session/plan-mode-state"
import { MessageID } from "../session/schema"
import { Tool } from "./tool"

const tracer = trace.getTracer("liteai")
const log = Log.create({ service: "tool.plan" })

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
        Bus.publish(Session.Event.PlanApprovalRequested, {
          sessionID: ctx.sessionID,
          planText: params.plan,
          planFilePath,
        })

        const relPlanPath = path.relative(Instance.worktree, planFilePath)
        const answers = await Question.ask({
          sessionID: ctx.sessionID,
          questions: [
            {
              question: `Plan at ${relPlanPath} is complete. Exit plan mode and start implementing?`,
              header: "Plan Approval",
              custom: false,
              options: [
                { label: "Yes", description: "Approve plan and start implementing" },
                { label: "No", description: "Continue refining the plan" },
              ],
            },
          ],
          tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
        })

        const answer = answers[0]?.[0]
        if (answer !== "Yes") {
          span.addEvent("tool.plan_exit.rejected")
          // Rejection → revision → re-submission path:
          // PlanModeStateRef is NOT mutated — plan mode remains active so the
          // agent can revise the plan and call plan_exit again.
          // Permission mode stays "plan" — root session remains read-only.
          throw new Question.RejectedError({
            reason: "User rejected the plan. Continue refining the plan and call plan_exit again when ready.",
          })
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
          SessionPrompt.setPermissionMode(ctx.sessionID, "default")
          throw new Error(`Failed to create plan subagent session: ${e instanceof Error ? e.message : String(e)}`)
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

        // Determine model from parent context
        let model: { modelID: ModelID; providerID: ProviderID } | undefined
        const parentAssistant = ctx.messages.findLast((m) => m.info.id === ctx.messageID)
        if (parentAssistant && parentAssistant.info.role === "assistant") {
          model = {
            modelID: parentAssistant.info.modelID,
            providerID: parentAssistant.info.providerID,
          }
        }

        if (!model) {
          // Recovery: restore permissions if we can't determine the model
          ref.update((s) => ({ ...s, planSessionID: undefined }))
          SessionPrompt.setPermissionMode(ctx.sessionID, "default")
          throw new Error("Could not determine parent model for plan subagent")
        }

        span.addEvent("tool.plan_enter.spawning_subagent", {
          planSessionID: planSession.id,
          planFilePath: state.planFilePath,
        })

        const messageID = MessageID.ascending()
        const promptParts = await SessionPrompt.resolvePromptParts(planPrompt)

        let result: Awaited<ReturnType<typeof SessionPrompt.runSubagent>>
        try {
          result = await SessionPrompt.runSubagent({
            messageID,
            sessionID: planSession.id,
            model: {
              modelID: model.modelID,
              providerID: model.providerID,
            },
            agent: "plan",
            parts: promptParts,
          })
        } catch (e) {
          // Error recovery: restore permission mode and clear plan session on failure
          log.error("plan subagent failed", { error: e, sessionID: ctx.sessionID, planSessionID: planSession.id })
          ref.update((s) => ({ ...s, planSessionID: undefined }))
          SessionPrompt.setPermissionMode(ctx.sessionID, "default")
          throw new Error(`Plan subagent failed: ${e instanceof Error ? e.message : String(e)}`)
        }

        // Handle subagent error/abort results
        if (result.status === "error") {
          const errorMsg = result.error instanceof Error ? result.error.message : String(result.error)
          log.error("plan subagent returned error", { error: errorMsg, sessionID: ctx.sessionID })
          ref.update((s) => ({ ...s, planSessionID: undefined }))
          SessionPrompt.setPermissionMode(ctx.sessionID, "default")
          throw new Error(`Plan subagent failed: ${errorMsg}`)
        }

        if (result.status === "aborted") {
          log.warn("plan subagent was aborted", { sessionID: ctx.sessionID })
          ref.update((s) => ({ ...s, planSessionID: undefined }))
          SessionPrompt.setPermissionMode(ctx.sessionID, "default")
          throw new Error("Plan subagent was aborted")
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
