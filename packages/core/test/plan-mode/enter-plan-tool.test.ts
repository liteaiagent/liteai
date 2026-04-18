import { afterEach, describe, expect, test } from "bun:test"
import { Bus } from "../../src/bus"
import { Instance } from "../../src/project/instance"
import { Question } from "../../src/question"
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
  async function createSessionWithRef(overrides?: Partial<{ active: boolean; turnsSincePlanReminder: number }>) {
    const session = await Session.create({})
    const initial = createDefaultPlanModeState(session)
    const ref = new PlanModeStateRef(
      {
        ...initial,
        active: overrides?.active ?? initial.active,
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
      agent: "build",
      abort: new AbortController().signal,
      messages: [],
      metadata: () => {},
      ask: async () => {},
    }
  }

  test("should activate plan mode and emit PlanStateChanged event when user approves", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { session, ref } = await createSessionWithRef({ active: false, turnsSincePlanReminder: 3 })

        // Stub approval to "Yes"
        const originalAsk = Question.ask
        Question.ask = async () => [["Yes"]]

        let eventEmitted = false
        const eventPromise = new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error("Timeout waiting for state change event")), 2000)
          const sub = Bus.subscribe(Session.Event.PlanStateChanged, (event) => {
            const props = event.properties as { sessionID: string; active: boolean; turnsSincePlanReminder: number }
            if (props.sessionID === session.id) {
              eventEmitted = true
              expect(props.active).toBe(true)
              expect(props.turnsSincePlanReminder).toBe(0)
              sub()
              clearTimeout(timeout)
              resolve()
            }
          })
        })

        try {
          const instance = await PlanEnterTool.init()
          const executePromise = instance.execute({ interviewMode: false }, makeToolContext(session.id))
          const [result] = await Promise.all([executePromise, eventPromise])

          expect(eventEmitted).toBe(true)

          const state = ref.get()
          expect(state.active).toBe(true)
          expect(state.turnsSincePlanReminder).toBe(0)

          // No inject — the new architecture returns workflow text as output
          expect(result.inject).toBeUndefined()
          // Output contains workflow text (plan mode instructions)
          expect(result.output).toContain("Plan mode is active")
          // Plan file path is in the output (dynamic plan file info, MVP parity)
          expect(result.output).toContain("create your plan at")
        } finally {
          Question.ask = originalAsk
          await Session.remove(session.id)
        }
      },
    })
  })

  test("should throw RejectedError when user declines plan mode entry", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { session, ref } = await createSessionWithRef({ active: false })

        const originalAsk = Question.ask
        Question.ask = async () => [["No"]]

        try {
          const instance = await PlanEnterTool.init()
          await expect(instance.execute({ interviewMode: false }, makeToolContext(session.id))).rejects.toMatchObject({
            _tag: "QuestionRejectedError",
          })

          // State must NOT have changed — plan mode must remain inactive
          const state = ref.get()
          expect(state.active).toBe(false)
        } finally {
          Question.ask = originalAsk
          await Session.remove(session.id)
        }
      },
    })
  })

  test("should return interview workflow text when interviewMode is true", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { session } = await createSessionWithRef({ active: false })

        const originalAsk = Question.ask
        Question.ask = async () => [["Yes"]]

        try {
          const instance = await PlanEnterTool.init()
          const result = await instance.execute({ interviewMode: true }, makeToolContext(session.id))

          // Interview mode output must contain the iterative workflow instructions
          // (not the 5-phase subagent workflow)
          expect(result.output).toContain("Iterative Planning Workflow")
          expect(result.inject).toBeUndefined()
        } finally {
          Question.ask = originalAsk
          await Session.remove(session.id)
        }
      },
    })
  })

  test("should return 5-phase workflow text when interviewMode is false (default)", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { session } = await createSessionWithRef({ active: false })

        const originalAsk = Question.ask
        Question.ask = async () => [["Yes"]]

        try {
          const instance = await PlanEnterTool.init()
          const result = await instance.execute({ interviewMode: false }, makeToolContext(session.id))

          // 5-phase workflow output must contain Phase 1, Phase 2, etc.
          expect(result.output).toContain("Phase 1")
          expect(result.output).toContain("Phase 2")
          expect(result.inject).toBeUndefined()
        } finally {
          Question.ask = originalAsk
          await Session.remove(session.id)
        }
      },
    })
  })

  test("should be idempotent when already active — no approval prompt, no event", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { session, ref } = await createSessionWithRef({ active: true, turnsSincePlanReminder: 3 })

        let askCallCount = 0
        const originalAsk = Question.ask
        Question.ask = async () => {
          askCallCount++
          return [["Yes"]]
        }

        let eventEmittedCount = 0
        const sub = Bus.subscribe(Session.Event.PlanStateChanged, (event) => {
          const props = event.properties as { sessionID: string }
          if (props.sessionID === session.id) {
            eventEmittedCount++
          }
        })

        try {
          const instance = await PlanEnterTool.init()
          const result = await instance.execute({ interviewMode: false }, makeToolContext(session.id))

          // No approval prompt for already-active state
          expect(askCallCount).toBe(0)
          // No state change events
          expect(eventEmittedCount).toBe(0)
          expect(result.title).toBe("Already in plan mode")
          expect(result.output).toContain("already active")

          const state = ref.get()
          expect(state.active).toBe(true)
          // Counter must NOT be reset — state is unchanged
          expect(state.turnsSincePlanReminder).toBe(3)
        } finally {
          sub()
          Question.ask = originalAsk
          await Session.remove(session.id)
        }
      },
    })
  })
})
