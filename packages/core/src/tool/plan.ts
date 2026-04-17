import fs from "node:fs/promises"
import path from "node:path"
import { trace } from "@opentelemetry/api"
import z from "zod"
import { isRootAgent } from "../agent/context"
import { Bundled } from "../bundled"
import EXIT_DESCRIPTION from "../bundled/prompts/tools/plan-exit.txt"
import { Bus } from "../bus"
import { Instance } from "../project/instance"
import { Question } from "../question"
import { Session } from "../session"
import { PlanModeStateRef } from "../session/plan-mode-state"
import { Filesystem } from "../util/filesystem"
import { Tool } from "./tool"

const tracer = trace.getTracer("liteai")

// ── Tool description: ported from MVP prompt.ts (external variant) ──
const ENTER_DESCRIPTION = `Use this tool proactively when you're about to start a non-trivial implementation task. Getting user sign-off on your approach before writing code prevents wasted effort and ensures alignment. This tool transitions you into plan mode where you can explore the codebase and design an implementation approach for user approval.

## When to Use This Tool

**Prefer using plan_enter** for implementation tasks unless they're simple. Use it when ANY of these conditions apply:

1. **New Feature Implementation**: Adding meaningful new functionality
   - Example: "Add a logout button" - where should it go? What should happen on click?
   - Example: "Add form validation" - what rules? What error messages?

2. **Multiple Valid Approaches**: The task can be solved in several different ways
   - Example: "Add caching to the API" - could use Redis, in-memory, file-based, etc.
   - Example: "Improve performance" - many optimization strategies possible

3. **Code Modifications**: Changes that affect existing behavior or structure
   - Example: "Update the login flow" - what exactly should change?
   - Example: "Refactor this component" - what's the target architecture?

4. **Architectural Decisions**: The task requires choosing between patterns or technologies
   - Example: "Add real-time updates" - WebSockets vs SSE vs polling
   - Example: "Implement state management" - Redux vs Context vs custom solution

5. **Multi-File Changes**: The task will likely touch more than 2-3 files
   - Example: "Refactor the authentication system"
   - Example: "Add a new API endpoint with tests"

6. **Unclear Requirements**: You need to explore before understanding the full scope
   - Example: "Make the app faster" - need to profile and identify bottlenecks
   - Example: "Fix the bug in checkout" - need to investigate root cause

7. **User Preferences Matter**: The implementation could reasonably go multiple ways
   - If you would use the question tool to clarify the approach, use plan_enter instead
   - Plan mode lets you explore first, then present options with context

## When NOT to Use This Tool

Only skip plan_enter for simple tasks:
- Single-line or few-line fixes (typos, obvious bugs, small tweaks)
- Adding a single function with clear requirements
- Tasks where the user has given very specific, detailed instructions
- Pure research/exploration tasks (use the task tool with explore agent instead)

## What Happens in Plan Mode

In plan mode, you'll:
1. Thoroughly explore the codebase using glob, grep, read, and bash (read-only) tools
2. Understand existing patterns and architecture
3. Design an implementation approach
4. Present your plan to the user for approval
5. Use the question tool if you need to clarify approaches
6. Exit plan mode with plan_exit when ready to implement

## Examples

### GOOD - Use plan_enter:
User: "Add user authentication to the app"
- Requires architectural decisions (session vs JWT, where to store tokens, middleware structure)

User: "Optimize the database queries"
- Multiple approaches possible, need to profile first, significant impact

User: "Implement dark mode"
- Architectural decision on theme system, affects many components

User: "Add a delete button to the user profile"
- Seems simple but involves: where to place it, confirmation dialog, API call, error handling, state updates

User: "Update the error handling in the API"
- Affects multiple files, user should approve the approach

### BAD - Don't use plan_enter:
User: "Fix the typo in the README"
- Straightforward, no planning needed

User: "Add a console.log to debug this function"
- Simple, obvious implementation

User: "What files handle routing?"
- Research task, not implementation planning

## Important Notes

- This tool REQUIRES user approval - they must consent to entering plan mode
- If unsure whether to use it, err on the side of planning - it's better to get alignment upfront than to redo work
- Users appreciate being consulted before significant changes are made to their codebase`

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
        if (answer === "No") {
          span.addEvent("tool.plan_exit.rejected")
          // Rejection → revision → re-submission path (spec edge case L113):
          // PlanModeStateRef is NOT mutated — plan mode remains active so the
          // agent can revise the plan and call plan_exit again.
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
            metadata: { planFilePath: state.planFilePath, interviewMode: false as boolean | undefined },
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
        if (answer === "No") {
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
          metadata: { planFilePath: state.planFilePath, interviewMode: params.interviewMode as boolean | undefined },
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
