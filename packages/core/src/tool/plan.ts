import fs from "node:fs/promises"
import path from "node:path"
import { trace } from "@opentelemetry/api"
import z from "zod"
import { isRootAgent } from "../agent/context"
import { Bundled } from "../bundled"
import ENTER_DESCRIPTION from "../bundled/prompts/tools/plan-enter.txt"
import EXIT_DESCRIPTION from "../bundled/prompts/tools/plan-exit.txt"
import { Bus } from "../bus"
import { Instance } from "../project/instance"
import { Question } from "../question"
import { Session } from "../session"
import { PlanModeStateRef } from "../session/plan-mode-state"
import { Filesystem } from "../util/filesystem"
import { Tool } from "./tool"

const tracer = trace.getTracer("liteai")

export const PlanExitTool = Tool.define("plan_exit", {
  description: EXIT_DESCRIPTION,
  parameters: z.object({
    plan: z.string().trim().min(1, "Plan is empty"),
  }),
  async execute(params, ctx) {
    return tracer.startActiveSpan("tool.plan_exit.execute", async (span) => {
      try {
        const state = PlanModeStateRef.for(ctx.sessionID).get()
        if (!state.active) {
          throw new Error("Cannot exit plan mode: Plan mode is not currently active.")
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
          // Rejection → revision → re-submission path (spec edge case L113):
          // PlanModeStateRef is NOT mutated — plan mode remains active so the
          // agent can revise the plan and call plan_exit again.
          // Only an explicit "Yes" is accepted — undefined, empty, or any
          // other string is treated as rejection per fail-fast protocol.
          throw new Question.RejectedError({
            reason: "User rejected the plan. Continue refining the plan and call plan_exit again when ready.",
          })
        }

        span.addEvent("tool.plan_exit.approved")

        PlanModeStateRef.for(ctx.sessionID).update((s) => ({
          ...s,
          active: false,
          turnsSincePlanReminder: 0,
          planText: params.plan,
          workflowType: undefined,
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
  parameters: z.object({
    interviewMode: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "When true, uses the iterative interview workflow (pair-planning with the user via the question tool) instead of the 5-phase subagent workflow. Use interview mode for exploratory or highly interactive planning sessions.",
      ),
  }),
  async execute(params, ctx) {
    return tracer.startActiveSpan("tool.plan_enter.execute", async (span) => {
      try {
        // Sub-agents must not be able to activate plan mode (MVP parity:
        // EnterPlanModeTool.ts:78). Plan mode is a root-level state transition.
        if (!isRootAgent()) {
          throw new Error("EnterPlanMode tool cannot be used in sub-agent contexts")
        }

        const state = PlanModeStateRef.for(ctx.sessionID).get()

        // ── Already-active guard (FR-014) ──
        // If plan mode is already active, return a no-op — do NOT mutate state
        // or emit events. This prevents re-entry amnesia.
        // Note: state.planFilePath is immutable for the session lifetime (set once
        // by Session.plan() in createDefaultPlanModeState, never overridden by
        // update() calls), so using the pre-read state here is safe — no staleness
        // risk even if other fields (active, planText) are concurrently mutated.
        if (state.active) {
          span.addEvent("tool.plan_enter.already_active")
          const relPlanPath = path.relative(Instance.worktree, state.planFilePath)
          return {
            title: "Already in plan mode",
            output: `Plan mode is already active. Continue working on the plan at ${relPlanPath}.`,
            metadata: { planFilePath: state.planFilePath, interviewMode: false },
          }
        }

        // ── User approval gate (ADR-001, FR-002) ──
        // Ask the user before mutating state — mirrors MVP shouldDefer: true
        // semantics. On decline, Question.RejectedError propagates up — the
        // tool result is treated as a rejection and plan mode is never entered.
        span.addEvent("tool.plan_enter.approval_requested")
        Bus.publish(Session.Event.PlanApprovalRequested, {
          sessionID: ctx.sessionID,
          planText: "",
          planFilePath: state.planFilePath,
        })

        const answers = await Question.ask({
          sessionID: ctx.sessionID,
          questions: [
            {
              question:
                "Approve entering plan mode? The agent will explore the codebase and design an implementation plan before writing any code.",
              header: "Plan Mode",
              custom: false,
              options: [
                {
                  label: "Yes",
                  description:
                    "Enter plan mode — the agent will design a plan for your approval before making any changes",
                },
                { label: "No", description: "Continue in build mode without entering plan mode" },
              ],
            },
          ],
          tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
        })

        const answer = answers[0]?.[0]
        if (answer !== "Yes") {
          span.addEvent("tool.plan_enter.rejected")
          throw new Question.RejectedError({
            reason: "User declined entering plan mode. Continue in build mode.",
          })
        }

        span.addEvent("tool.plan_enter.activated")
        // PlanModeStateRef.update() emits PlanStateChanged via Bus.publish
        // when the `active` field transitions. No manual Bus.publish needed here.
        PlanModeStateRef.for(ctx.sessionID).update((s) => ({
          ...s,
          active: true,
          turnsSincePlanReminder: 0,
          workflowType: params.interviewMode ? "interview" : "5phase",
        }))

        // ── Load workflow instructions (ADR-002, FR-003) ──
        // Return the 5-phase or interview workflow text as tool result output
        // so the model receives structured planning instructions in-context.
        const workflowRaw = params.interviewMode
          ? await Bundled.miscPrompt("plan-interview")
          : await Bundled.miscPrompt("plan-workflow")

        const relPlanPath = path.relative(Instance.worktree, state.planFilePath)

        // Inject dynamic plan file info (MVP parity: messages.ts:3223-3225)
        const planExists = await Filesystem.exists(state.planFilePath)
        const planFileInfo = planExists
          ? `A plan file already exists at ${relPlanPath}. You can read it and make incremental edits using the edit tool.`
          : `No plan file exists yet. You should create your plan at ${relPlanPath} using the write tool.`
        const workflowText = workflowRaw.replace("{{PLAN_FILE_INFO}}", planFileInfo)

        return {
          title: "Entering plan mode",
          output: workflowText,
          metadata: { planFilePath: state.planFilePath, interviewMode: params.interviewMode },
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
