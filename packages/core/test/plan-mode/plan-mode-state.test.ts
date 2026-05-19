import { afterEach, describe, expect, test } from "bun:test"
import { Bus } from "../../src/bus"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import {
  createDefaultPlanModeState,
  PLAN_REMINDER_FULL_INTERVAL,
  PlanModeStateRef,
} from "../../src/session/plan-mode-state"
import type { SessionID } from "../../src/session/schema"
import { tmpdir } from "../fixture/fixture"

describe("PlanModeState (T047)", () => {
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

  test("createDefaultPlanModeState returns correct defaults", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const state = createDefaultPlanModeState(session)

        expect(state.planSessionID).toBeUndefined()
        expect(state.planText).toBeUndefined()
        expect(state.turnsSincePlanReminder).toBe(0)
        expect(state.planFilePath).toContain(session.slug)

        await Session.remove(session.id)
      },
    })
  })

  test("PlanModeStateRef.get returns initial state after registration", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { session, ref } = await createSessionWithRef()

        const state = ref.get()
        expect(state.planSessionID).toBeUndefined()
        expect(state.planText).toBeUndefined()
        expect(state.turnsSincePlanReminder).toBe(0)

        await Session.remove(session.id)
      },
    })
  })

  test("PlanModeStateRef.for throws for unregistered session (fail-fast)", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        expect(() => PlanModeStateRef.for("non-existent-session-id" as SessionID)).toThrow(
          "PlanModeStateRef not registered",
        )
      },
    })
  })

  test("PlanModeStateRef.update persists changes in-memory and returns updated state", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { session, ref } = await createSessionWithRef()

        const result = ref.update((s) => ({
          ...s,
          planSessionID: "test-plan-session" as SessionID,
          planText: "Test Plan",
          turnsSincePlanReminder: 3,
        }))

        expect(result.planSessionID).toBe("test-plan-session")
        expect(result.planText).toBe("Test Plan")
        expect(result.turnsSincePlanReminder).toBe(3)

        // Verify in-memory persistence via re-read
        const reRead = ref.get()
        expect(reRead.planSessionID).toBe("test-plan-session")
        expect(reRead.planText).toBe("Test Plan")
        expect(reRead.turnsSincePlanReminder).toBe(3)

        // Verify accessible via static lookup
        const lookedUp = PlanModeStateRef.for(session.id)
        expect(lookedUp.get().planSessionID).toBe("test-plan-session")

        await Session.remove(session.id)
      },
    })
  })

  test("turnsSincePlanReminder increments monotonically across calls (SC-010)", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { session, ref } = await createSessionWithRef()
        ref.update((s) => ({ ...s, planSessionID: "test-session" as SessionID }))

        for (let i = 1; i <= 6; i++) {
          ref.update((s) => ({
            ...s,
            turnsSincePlanReminder: s.turnsSincePlanReminder + 1,
          }))
          const state = ref.get()
          expect(state.turnsSincePlanReminder).toBe(i)
        }

        await Session.remove(session.id)
      },
    })
  })

  test("PLAN_REMINDER_FULL_INTERVAL is 5", () => {
    expect(PLAN_REMINDER_FULL_INTERVAL).toBe(5)
  })

  test("PlanModeStateRef.update emits PlanStateChanged on planSessionID transition", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { session, ref } = await createSessionWithRef()

        let eventReceived = false
        let eventPayload: Record<string, unknown> | undefined

        const unsub = Bus.subscribe(Session.Event.PlanStateChanged, (event) => {
          const props = event.properties as { sessionID: string; active: boolean; planSessionID?: string }
          if (props.sessionID === session.id) {
            eventReceived = true
            eventPayload = event.properties as Record<string, unknown>
          }
        })

        // Activate plan mode — should emit event synchronously
        ref.update((s) => ({ ...s, planSessionID: "plan-child-session" as SessionID }))

        unsub()

        expect(eventReceived).toBe(true)
        expect(eventPayload?.sessionID).toBe(session.id)
        expect(eventPayload?.active).toBe(true)
        expect(eventPayload?.planSessionID).toBe("plan-child-session")

        await Session.remove(session.id)
      },
    })
  })

  test("PlanModeStateRef.update does NOT emit PlanStateChanged when planSessionID is unchanged", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { session, ref } = await createSessionWithRef()

        let emitCount = 0
        const sub = Bus.subscribe(Session.Event.PlanStateChanged, (event) => {
          const props = event.properties as { sessionID: string }
          if (props.sessionID === session.id) {
            emitCount++
          }
        })

        // Update counter only — planSessionID stays undefined (default)
        ref.update((s) => ({
          ...s,
          turnsSincePlanReminder: s.turnsSincePlanReminder + 1,
        }))

        expect(emitCount).toBe(0)
        sub()

        await Session.remove(session.id)
      },
    })
  })

  test("PlanModeStateRef.update round-trips planText correctly", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { session, ref } = await createSessionWithRef()
        const planContent = "# Implementation Plan\n\n## Phase 1\n- Step A\n- Step B"

        ref.update((s) => ({
          ...s,
          planSessionID: "test-session" as SessionID,
          planText: planContent,
        }))

        const reRead = ref.get()
        expect(reRead.planText).toBe(planContent)

        await Session.remove(session.id)
      },
    })
  })

  test("PlanModeStateRef.register throws on double registration", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { session, ref: _existingRef } = await createSessionWithRef()

        const duplicate = new PlanModeStateRef(createDefaultPlanModeState(session), session.id)
        expect(() => duplicate.register()).toThrow("already registered")

        await Session.remove(session.id)
      },
    })
  })

  test("PlanModeStateRef.deregister makes .for() throw again", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const ref = new PlanModeStateRef(createDefaultPlanModeState(session), session.id)
        ref.register()
        // Don't push to registeredRefs — we deregister manually here

        expect(PlanModeStateRef.has(session.id)).toBe(true)

        ref.deregister()

        expect(PlanModeStateRef.has(session.id)).toBe(false)
        expect(() => PlanModeStateRef.for(session.id)).toThrow("not registered")

        await Session.remove(session.id)
      },
    })
  })
})
