import fs from "node:fs/promises"
import path from "node:path"
import { trace } from "@opentelemetry/api"
import z from "zod"
import { isRootAgent } from "../agent/context"
import EXIT_DESCRIPTION from "../bundled/prompts/tools/plan-exit.txt"
import { Bus } from "../bus"
import { Instance } from "../project/instance"
import { Provider } from "../provider/provider"
import { Question } from "../question"
import { Session } from "../session"
import { Message } from "../session/message"
import { getPlanModeState, setPlanModeState } from "../session/plan-mode-state"
import { MessageID, type SessionID } from "../session/schema"
import { Tool } from "./tool"

const tracer = trace.getTracer("liteai")
async function getLastModel(sessionID: SessionID) {
  for await (const item of Message.stream(sessionID)) {
    if (item.info.role === "user" && item.info.model) return item.info.model
  }
  const result = await Provider.defaultModel()
  if (!result) throw new Error("no model available: connect a provider first")
  return result
}

export const PlanExitTool = Tool.define("plan_exit", {
  description: EXIT_DESCRIPTION,
  parameters: z.object({
    plan: z.string().trim().min(1, "Plan is empty"),
  }),
  async execute(params, ctx) {
    return tracer.startActiveSpan("tool.plan_exit.execute", async (span) => {
      try {
        const state = await getPlanModeState(ctx.sessionID)
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
              question: `Plan at ${relPlanPath} is complete. Would you like to switch to the build agent and start implementing?`,
              header: "Build Agent",
              custom: false,
              options: [
                { label: "Yes", description: "Switch to build agent and start implementing the plan" },
                { label: "No", description: "Stay with plan agent to continue refining the plan" },
              ],
            },
          ],
          tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
        })

        const answer = answers[0]?.[0]
        if (answer === "No") {
          span.addEvent("tool.plan_exit.rejected")
          throw new Question.RejectedError({
            reason: "User rejected switching to build agent. Continue refining the plan.",
          })
        }

        span.addEvent("tool.plan_exit.approved")

        await setPlanModeState(ctx.sessionID, (s) => ({
          ...s,
          active: false,
          turnsSincePlanReminder: 0,
          planText: params.plan,
        }))

        const model = await getLastModel(ctx.sessionID)
        const userMsg: Message.User = {
          id: MessageID.ascending(),
          sessionID: ctx.sessionID,
          role: "user",
          time: {
            created: Date.now(),
          },
          agent: "build",
          model,
        }

        return {
          title: "Switching to build agent",
          output: `Plan approved and saved to ${relPlanPath}. Switch context to build agent to begin implementation.\n\nPlan:\n${params.plan}`,
          metadata: { planFilePath, approved: true },
          inject: [{ info: userMsg, parts: [] }],
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

const ENTER_DESCRIPTION = `Switch to the plan agent to conduct research and write an implementation plan. 
Use this when you are asked to implement a new feature, do a large refactor, or when significant technical decisions need to be made before writing code.
The plan agent will research the codebase, define step-by-step instructions in a plan file, and then transition back to you.`

export const PlanEnterTool = Tool.define("plan_enter", {
  description: ENTER_DESCRIPTION,
  parameters: z.object({}),
  async execute(_params, ctx) {
    return tracer.startActiveSpan("tool.plan_enter.execute", async (span) => {
      try {
        // Sub-agents must not be able to activate plan mode (MVP parity:
        // EnterPlanModeTool.ts:78). Plan mode is a root-level state transition.
        if (!isRootAgent()) {
          throw new Error("EnterPlanMode tool cannot be used in sub-agent contexts")
        }

        const state = await getPlanModeState(ctx.sessionID)
        const relPlanPath = path.relative(Instance.worktree, state.planFilePath)
        const model = await getLastModel(ctx.sessionID)

        const userMsg: Message.User = {
          id: MessageID.ascending(),
          sessionID: ctx.sessionID,
          role: "user",
          time: { created: Date.now() },
          agent: "plan",
          model,
        }

        if (state.active) {
          span.addEvent("tool.plan_enter.idempotent")
          return {
            title: "Already in plan mode",
            output: `You are already in plan mode. Continue working on the plan at ${relPlanPath}.`,
            metadata: { planFilePath: state.planFilePath },
            inject: [{ info: userMsg, parts: [] }],
          }
        }

        span.addEvent("tool.plan_enter.activated")
        // setPlanModeState auto-emits PlanStateChanged via Database.effect
        // when the `active` field transitions (plan-mode-state.ts:99-111).
        // No manual Bus.publish needed here — that would cause double emission.
        await setPlanModeState(ctx.sessionID, (s) => ({
          ...s,
          active: true,
          turnsSincePlanReminder: 0,
        }))

        let fileExists = false
        try {
          await fs.access(state.planFilePath)
          fileExists = true
        } catch {
          // File does not exist
        }

        let outputContent = ""
        if (fileExists) {
          span.addEvent("tool.plan_enter.read_plan")
          try {
            const content = await fs.readFile(state.planFilePath, "utf-8")
            outputContent = `Review and refine the existing plan at ${relPlanPath}\n\n${content}`
          } catch (e) {
            span.recordException(e as Error)
            outputContent = `Failed to read existing plan at ${relPlanPath}: ${e instanceof Error ? e.message : String(e)}`
          }
        } else {
          span.addEvent("tool.plan_enter.no_plan")
          outputContent = `Create a plan at ${relPlanPath} using the file write tool.`
        }

        return {
          title: "Switching to plan agent",
          output: `Switched to plan mode.\n\n${outputContent}`,
          metadata: { planFilePath: state.planFilePath },
          inject: [{ info: userMsg, parts: [] }],
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
