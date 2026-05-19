import { afterEach, describe, expect, test } from "bun:test"
import path from "node:path"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import {
  createDefaultPlanModeState,
  PLAN_REMINDER_FULL_INTERVAL,
  PlanModeStateRef,
} from "../../src/session/plan-mode-state"

const projectRoot = path.join(__dirname, "../..")

describe("PlanModeState CRUD (T047)", () => {
  // Ensure refs are cleaned up after each test to prevent leaking into other tests
  const registeredRefs: PlanModeStateRef[] = []
  afterEach(() => {
    for (const ref of registeredRefs) {
      try {
        ref.deregister()
      } catch {
        // Already deregistered — safe to ignore
      }
    }
    registeredRefs.length = 0
  })

  /** Helper: create a session and register a PlanModeStateRef for it */
  async function createSessionWithRef() {
    const session = await Session.create({})
    const ref = new PlanModeStateRef(createDefaultPlanModeState(session), session.id)
    ref.register()
    registeredRefs.push(ref)
    return { session, ref }
  }

  test("createDefaultPlanModeState returns inactive state with correct defaults", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})
        const state = createDefaultPlanModeState(session)

        expect(state.planSessionID).toBeUndefined()
        expect(state.planText).toBeUndefined()
        expect(state.planFilePath).toBe(Session.plan(session))
        expect(state.turnsSincePlanReminder).toBe(0)

        await Session.remove(session.id)
      },
    })
  })

  test("PlanModeStateRef.get returns initial state after registration", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const { session, ref } = await createSessionWithRef()

        const state = ref.get()
        expect(state.planSessionID).toBeUndefined()
        expect(state.turnsSincePlanReminder).toBe(0)

        await Session.remove(session.id)
      },
    })
  })

  test("PlanModeStateRef.for throws for non-existent session", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        expect(() =>
          PlanModeStateRef.for("non-existent-session" as Parameters<typeof PlanModeStateRef.for>[0]),
        ).toThrow("not registered")
      },
    })
  })

  test("PlanModeStateRef.update persists changes and returns updated state", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const { session, ref } = await createSessionWithRef()

        const updated = ref.update((state) => ({
          ...state,
          planSessionID: "test-plan-session" as Parameters<typeof PlanModeStateRef.for>[0],
          turnsSincePlanReminder: 3,
        }))

        expect(updated.planSessionID).toBe("test-plan-session")
        expect(updated.turnsSincePlanReminder).toBe(3)

        // Verify persistence: re-read from ref
        const reRead = ref.get()
        expect(reRead.planSessionID).toBe("test-plan-session")
        expect(reRead.turnsSincePlanReminder).toBe(3)

        await Session.remove(session.id)
      },
    })
  })

  test("PlanModeStateRef.update round-trips planText correctly", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const { session, ref } = await createSessionWithRef()
        const planContent = "# Implementation Plan\n\n## Phase 1\n- Step A\n- Step B"

        ref.update((state) => ({
          ...state,
          planSessionID: "test-plan-session" as Parameters<typeof PlanModeStateRef.for>[0],
          planText: planContent,
        }))

        const reRead = ref.get()
        expect(reRead.planText).toBe(planContent)

        await Session.remove(session.id)
      },
    })
  })

  test("PLAN_REMINDER_FULL_INTERVAL is 5", () => {
    expect(PLAN_REMINDER_FULL_INTERVAL).toBe(5)
  })
})
