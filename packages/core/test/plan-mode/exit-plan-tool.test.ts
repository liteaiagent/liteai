import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import { Bus } from "../../src/bus"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { createDefaultPlanModeState, PlanModeStateRef } from "../../src/session/plan-mode-state"
import { MessageID, type SessionID } from "../../src/session/schema"
import { PlanExitTool } from "../../src/tool/plan"
import { tmpdir } from "../fixture/fixture"

describe("PlanExitTool", () => {
  // Ensure refs are cleaned up after each test
  const registeredRefs: PlanModeStateRef[] = []
  afterEach(() => {
    for (const ref of registeredRefs) {
      try {
        ref.deregister()
      } catch {
        // Already deregistered
      }
    }
    registeredRefs.length = 0
  })

  /** Helper: create session + register a PlanModeStateRef */
  async function createSessionWithRef(overrides?: Partial<{ planSessionID: SessionID }>) {
    const session = await Session.create({})
    const initial = createDefaultPlanModeState(session)
    const ref = new PlanModeStateRef(
      { ...initial, planSessionID: overrides?.planSessionID ?? initial.planSessionID },
      session.id,
    )
    ref.register()
    registeredRefs.push(ref)
    return { session, ref }
  }

  /** Helper: base tool context */
  function makeToolContext(sessionID: string, agent = "plan") {
    return {
      sessionID: sessionID as SessionID,
      messageID: MessageID.ascending(),
      callID: "test-call",
      agent,
      abort: new AbortController().signal,
      messages: [],
      metadata: () => {},
      ask: async () => {},
    }
  }

  test("should throw an error if plan is empty", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { session } = await createSessionWithRef({ planSessionID: "test-plan" as SessionID })
        const instance = await PlanExitTool.init()
        await expect(instance.execute({ plan: "   " }, makeToolContext(session.id))).rejects.toThrow("Plan is empty")
        await Session.remove(session.id)
      },
    })
  })

  test("should throw an error if not in plan mode", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { session } = await createSessionWithRef()
        const instance = await PlanExitTool.init()
        await expect(instance.execute({ plan: "Test plan" }, makeToolContext(session.id))).rejects.toThrow(
          "not currently active",
        )
        await Session.remove(session.id)
      },
    })
  })

  test("should write to disk, request approval, and return plan-in-context output on approval", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { session, ref } = await createSessionWithRef({ planSessionID: "test-plan" as SessionID })

        // Listen for the approval request and auto-approve via Bus event.
        // plan_exit now uses waitForPlanApproval (Bus-based), NOT Question.ask.
        let approvalRequested = false
        const sub = Bus.subscribe(Session.Event.PlanApprovalRequested, (event) => {
          const props = event.properties as { sessionID: string; planText: string; planFilePath: string }
          if (props.sessionID === session.id) {
            approvalRequested = true
            expect(props.planText).toBe("My awesome plan")
            // Simulate CLI resolving the approval
            Bus.publish(Session.Event.PlanApprovalResolved, {
              sessionID: session.id,
              approved: true,
            })
          }
        })

        try {
          const instance = await PlanExitTool.init()
          const result = await instance.execute({ plan: "My awesome plan" }, makeToolContext(session.id))

          expect(approvalRequested).toBe(true)

          const state = ref.get()
          expect(state.planSessionID).toBeUndefined()
          expect(state.planText).toBe("My awesome plan")
          expect(state.turnsSincePlanReminder).toBe(0)

          expect(result.metadata.approved).toBe(true)

          // Plan text is returned as output (plan-in-context), NOT via inject
          expect(result.output).toContain("My awesome plan")
          expect(result.output).toContain("Approved Plan")
          // No inject — legacy persona-swap mechanism must be removed
          expect(result.inject).toBeUndefined()

          const writtenPlan = await fs.readFile(state.planFilePath, "utf-8")
          expect(writtenPlan).toBe("My awesome plan")
        } finally {
          sub()
          await Session.remove(session.id)
        }
      },
    })
  })

  test("should throw error on rejection — plan mode remains active (revision path)", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { session, ref } = await createSessionWithRef({ planSessionID: "test-plan" as SessionID })

        // Listen for the approval request and auto-reject via Bus event.
        const sub = Bus.subscribe(Session.Event.PlanApprovalRequested, (event) => {
          const props = event.properties as { sessionID: string }
          if (props.sessionID === session.id) {
            Bus.publish(Session.Event.PlanApprovalResolved, {
              sessionID: session.id,
              approved: false,
              feedback: "Needs more detail on error handling",
            })
          }
        })

        try {
          const instance = await PlanExitTool.init()

          let caught = false
          try {
            await instance.execute({ plan: "My awesome plan" }, makeToolContext(session.id))
          } catch (e: unknown) {
            caught = true
            const err = e as Error
            // Rejection message must guide the agent to revise and re-submit
            expect(err.message).toContain("rejected")
            expect(err.message).toContain("Needs more detail on error handling")
          }
          expect(caught).toBe(true)

          // Plan mode MUST remain active — rejection → revision → re-submission path
          const state = ref.get()
          expect(state.planSessionID).toBe("test-plan")
          // planText must NOT be set on rejection
          expect(state.planText).toBeUndefined()
        } finally {
          sub()
          await Session.remove(session.id)
        }
      },
    })
  })

  test("should throw error on rejection without feedback", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { session, ref } = await createSessionWithRef({ planSessionID: "test-plan" as SessionID })

        const sub = Bus.subscribe(Session.Event.PlanApprovalRequested, (event) => {
          const props = event.properties as { sessionID: string }
          if (props.sessionID === session.id) {
            Bus.publish(Session.Event.PlanApprovalResolved, {
              sessionID: session.id,
              approved: false,
            })
          }
        })

        try {
          const instance = await PlanExitTool.init()
          await expect(instance.execute({ plan: "Test plan" }, makeToolContext(session.id))).rejects.toThrow("rejected")

          // Plan mode stays active for revision
          const state = ref.get()
          expect(state.planSessionID).toBe("test-plan")
        } finally {
          sub()
          await Session.remove(session.id)
        }
      },
    })
  })
})
