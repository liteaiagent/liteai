import { afterEach, describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { createDefaultPlanModeState, PlanModeStateRef } from "../../src/session/plan-mode-state"
import { MessageID, type SessionID } from "../../src/session/schema"
import { PlanEnterTool } from "../../src/tool/plan"
import { tmpdir } from "../fixture/fixture"

describe("PlanEnterTool", () => {
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
  async function createSessionWithRef(
    overrides?: Partial<{ planSessionID: SessionID; turnsSincePlanReminder: number }>,
  ) {
    const session = await Session.create({})
    const initial = createDefaultPlanModeState(session)
    const ref = new PlanModeStateRef(
      {
        ...initial,
        planSessionID: overrides?.planSessionID ?? initial.planSessionID,
        turnsSincePlanReminder: overrides?.turnsSincePlanReminder ?? initial.turnsSincePlanReminder,
      },
      session.id,
    )
    ref.register()
    registeredRefs.push(ref)
    return { session, ref }
  }

  /** Helper: base tool context */
  function makeToolContext(sessionID: string) {
    return {
      sessionID: sessionID as SessionID,
      messageID: MessageID.ascending(),
      callID: "test-call",
      agent: "liteai",
      abort: new AbortController().signal,
      messages: [],
      metadata: () => {},
      ask: async () => {},
    }
  }

  test("should be idempotent when already active — no subagent spawn", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { session, ref } = await createSessionWithRef({
          planSessionID: "existing-plan-session" as SessionID,
          turnsSincePlanReminder: 3,
        })

        try {
          const instance = await PlanEnterTool.init()
          const result = await instance.execute({}, makeToolContext(session.id))

          expect(result.title).toBe("Already in plan mode")
          expect(result.output).toContain("already active")

          const state = ref.get()
          expect(state.planSessionID).toBe("existing-plan-session")
          // Counter must NOT be reset — state is unchanged
          expect(state.turnsSincePlanReminder).toBe(3)
        } finally {
          await Session.remove(session.id)
        }
      },
    })
  })

  test("should take no parameters (interviewMode removed)", async () => {
    // The new PlanEnterTool.parameters should accept an empty object
    const instance = await PlanEnterTool.init()
    expect(instance.parameters).toBeDefined()

    // Verify the schema parses an empty object successfully
    const parsed = instance.parameters.safeParse({})
    expect(parsed.success).toBe(true)

    // Verify interviewMode is no longer accepted
    const withInterview = instance.parameters.safeParse({ interviewMode: true })
    // Zod strict mode would reject, but with passthrough it won't — so just check
    // that the parsed result doesn't have interviewMode as a known field
    if (withInterview.success) {
      expect(Object.keys(withInterview.data)).not.toContain("interviewMode")
    }
  })

  // NOTE: Tests for plan_enter's core functionality (subagent spawn, permission gating,
  // error recovery) require the full session engine infrastructure (runSubagent, SessionPrompt)
  // which is integration-level. Those are covered in E2E tests.
  // Unit-level tests here cover the guards and parameter validation.
})
