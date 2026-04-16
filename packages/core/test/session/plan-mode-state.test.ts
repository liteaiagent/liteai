import { afterEach, describe, expect, test } from "bun:test"
import path from "node:path"
import { Bus } from "../../src/bus"
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

        expect(state.active).toBe(false)
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
        expect(state.active).toBe(false)
        expect(state.turnsSincePlanReminder).toBe(0)
        expect(state.planFilePath).toBe(Session.plan(session))

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
          active: true,
          turnsSincePlanReminder: 3,
        }))

        expect(updated.active).toBe(true)
        expect(updated.turnsSincePlanReminder).toBe(3)

        // Verify persistence: re-read from ref
        const reRead = ref.get()
        expect(reRead.active).toBe(true)
        expect(reRead.turnsSincePlanReminder).toBe(3)

        await Session.remove(session.id)
      },
    })
  })

  test("PlanModeStateRef.update emits PlanStateChanged when active field changes", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const { session, ref } = await createSessionWithRef()
        let eventReceived = false
        let eventPayload: Record<string, unknown> | undefined

        const unsub = Bus.subscribe(Session.Event.PlanStateChanged, (event) => {
          eventReceived = true
          eventPayload = event.properties as Record<string, unknown>
        })

        // Activate plan mode — event fires synchronously via Bus.publish
        ref.update((state) => ({
          ...state,
          active: true,
        }))

        unsub()

        expect(eventReceived).toBe(true)
        expect(eventPayload?.sessionID).toBe(session.id)
        expect(eventPayload?.active).toBe(true)

        await Session.remove(session.id)
      },
    })
  })

  test("PlanModeStateRef.update does NOT emit event when active field is unchanged", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const { session, ref } = await createSessionWithRef()
        let eventCount = 0

        const unsub = Bus.subscribe(Session.Event.PlanStateChanged, () => {
          eventCount++
        })

        // Set active false → false (no change from default)
        ref.update((state) => ({
          ...state,
          turnsSincePlanReminder: 1,
        }))

        unsub()

        expect(eventCount).toBe(0)

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
          active: true,
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
