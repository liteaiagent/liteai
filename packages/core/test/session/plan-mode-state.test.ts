import { describe, expect, test } from "bun:test"
import path from "node:path"
import { Bus } from "../../src/bus"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import {
  createDefaultPlanModeState,
  getPlanModeState,
  PLAN_REMINDER_FULL_INTERVAL,
  setPlanModeState,
} from "../../src/session/plan-mode-state"

const projectRoot = path.join(__dirname, "../..")

describe("PlanModeState CRUD (T047)", () => {
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

  test("getPlanModeState returns default when plan_mode column is null", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})
        const state = await getPlanModeState(session.id)

        expect(state.active).toBe(false)
        expect(state.turnsSincePlanReminder).toBe(0)
        expect(state.planFilePath).toBe(Session.plan(session))

        await Session.remove(session.id)
      },
    })
  })

  test("getPlanModeState throws for non-existent session", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        await expect(
          getPlanModeState("non-existent-session" as unknown as Parameters<typeof getPlanModeState>[0]),
        ).rejects.toThrow("Session not found")
      },
    })
  })

  test("setPlanModeState persists changes and returns updated state", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})

        const updated = await setPlanModeState(session.id, (state) => ({
          ...state,
          active: true,
          turnsSincePlanReminder: 3,
        }))

        expect(updated.active).toBe(true)
        expect(updated.turnsSincePlanReminder).toBe(3)

        // Verify persistence: re-read from DB
        const reRead = await getPlanModeState(session.id)
        expect(reRead.active).toBe(true)
        expect(reRead.turnsSincePlanReminder).toBe(3)

        await Session.remove(session.id)
      },
    })
  })

  test("setPlanModeState emits PlanStateChanged when active field changes", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})
        let eventReceived = false
        let eventPayload: Record<string, unknown> | undefined

        const unsub = Bus.subscribe(Session.Event.PlanStateChanged, (event) => {
          eventReceived = true
          eventPayload = event.properties as Record<string, unknown>
        })

        // Wait for event via deterministic subscription rather than blind sleep
        const eventPromise = new Promise<Record<string, unknown>>((resolve, reject) => {
          const timeout = setTimeout(() => {
            unsub()
            reject(new Error("Timed out waiting for PlanStateChanged event"))
          }, 5000)
          // Re-subscribe to capture the payload
          const innerUnsub = Bus.subscribe(Session.Event.PlanStateChanged, (event) => {
            clearTimeout(timeout)
            innerUnsub()
            eventReceived = true
            eventPayload = event.properties as Record<string, unknown>
            resolve(eventPayload)
          })
        })

        // Activate plan mode
        await setPlanModeState(session.id, (state) => ({
          ...state,
          active: true,
        }))

        await eventPromise

        unsub()

        expect(eventReceived).toBe(true)
        expect(eventPayload?.sessionID).toBe(session.id)
        expect(eventPayload?.active).toBe(true)

        await Session.remove(session.id)
      },
    })
  })

  test("setPlanModeState does NOT emit event when active field is unchanged", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})
        let eventCount = 0

        const unsub = Bus.subscribe(Session.Event.PlanStateChanged, () => {
          eventCount++
        })

        // Wait deterministically to verify no event fires
        const noEventPromise = new Promise<void>((resolve) => {
          // Give a short window for any spurious event to arrive
          const timeout = setTimeout(() => {
            resolve()
          }, 200)
          const innerUnsub = Bus.subscribe(Session.Event.PlanStateChanged, () => {
            clearTimeout(timeout)
            eventCount++
            innerUnsub()
            resolve()
          })
        })

        // Set active false → false (no change from default)
        await setPlanModeState(session.id, (state) => ({
          ...state,
          turnsSincePlanReminder: 1,
        }))

        await noEventPromise

        unsub()

        expect(eventCount).toBe(0)

        await Session.remove(session.id)
      },
    })
  })

  test("setPlanModeState round-trips planText correctly", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})
        const planContent = "# Implementation Plan\n\n## Phase 1\n- Step A\n- Step B"

        await setPlanModeState(session.id, (state) => ({
          ...state,
          active: true,
          planText: planContent,
        }))

        const reRead = await getPlanModeState(session.id)
        expect(reRead.planText).toBe(planContent)

        await Session.remove(session.id)
      },
    })
  })

  test("PLAN_REMINDER_FULL_INTERVAL is 5", () => {
    expect(PLAN_REMINDER_FULL_INTERVAL).toBe(5)
  })
})
