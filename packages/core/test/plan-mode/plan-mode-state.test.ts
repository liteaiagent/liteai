import { describe, expect, test } from "bun:test"
import { Bus } from "../../src/bus"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import {
  createDefaultPlanModeState,
  getPlanModeState,
  PLAN_REMINDER_FULL_INTERVAL,
  setPlanModeState,
} from "../../src/session/plan-mode-state"
import type { SessionID } from "../../src/session/schema"
import { tmpdir } from "../fixture/fixture"

describe("PlanModeState (T047)", () => {
  test("createDefaultPlanModeState returns correct defaults", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const state = createDefaultPlanModeState(session)

        expect(state.active).toBe(false)
        expect(state.planText).toBeUndefined()
        expect(state.turnsSincePlanReminder).toBe(0)
        expect(state.planFilePath).toContain(session.slug)

        await Session.remove(session.id)
      },
    })
  })

  test("getPlanModeState returns default when column is null", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const state = await getPlanModeState(session.id)

        expect(state.active).toBe(false)
        expect(state.planText).toBeUndefined()
        expect(state.turnsSincePlanReminder).toBe(0)

        await Session.remove(session.id)
      },
    })
  })

  test("setPlanModeState persists and returns updated state", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})

        const result = await setPlanModeState(session.id, (s) => ({
          ...s,
          active: true,
          planText: "Test Plan",
          turnsSincePlanReminder: 3,
        }))

        expect(result.active).toBe(true)
        expect(result.planText).toBe("Test Plan")
        expect(result.turnsSincePlanReminder).toBe(3)

        // Verify persistence via re-read
        const reRead = await getPlanModeState(session.id)
        expect(reRead.active).toBe(true)
        expect(reRead.planText).toBe("Test Plan")
        expect(reRead.turnsSincePlanReminder).toBe(3)

        await Session.remove(session.id)
      },
    })
  })

  test("turnsSincePlanReminder increments monotonically across calls (SC-010)", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        await setPlanModeState(session.id, (s) => ({ ...s, active: true }))

        for (let i = 1; i <= 6; i++) {
          await setPlanModeState(session.id, (s) => ({
            ...s,
            turnsSincePlanReminder: s.turnsSincePlanReminder + 1,
          }))
          const state = await getPlanModeState(session.id)
          expect(state.turnsSincePlanReminder).toBe(i)
        }

        await Session.remove(session.id)
      },
    })
  })

  test("PLAN_REMINDER_FULL_INTERVAL is 5", () => {
    expect(PLAN_REMINDER_FULL_INTERVAL).toBe(5)
  })

  test("setPlanModeState emits PlanStateChanged on active transition", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})

        const eventPromise = new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error("Timeout waiting for PlanStateChanged")), 2000)
          const sub = Bus.subscribe(Session.Event.PlanStateChanged, (event) => {
            const props = event.properties as { sessionID: string; active: boolean }
            if (props.sessionID === session.id) {
              expect(props.active).toBe(true)
              sub()
              clearTimeout(timeout)
              resolve()
            }
          })
        })

        const setPromise = setPlanModeState(session.id, (s) => ({ ...s, active: true }))
        await Promise.all([setPromise, eventPromise])

        await Session.remove(session.id)
      },
    })
  })

  test("setPlanModeState does NOT emit PlanStateChanged when active is unchanged", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        // Pre-set to active
        await setPlanModeState(session.id, (s) => ({ ...s, active: true }))

        let emitCount = 0
        const sub = Bus.subscribe(Session.Event.PlanStateChanged, (event) => {
          const props = event.properties as { sessionID: string }
          if (props.sessionID === session.id) {
            emitCount++
          }
        })

        // Update counter only — active stays true
        await setPlanModeState(session.id, (s) => ({
          ...s,
          turnsSincePlanReminder: s.turnsSincePlanReminder + 1,
        }))

        // Allow any deferred effects to flush
        await new Promise((r) => setTimeout(r, 50))

        expect(emitCount).toBe(0)
        sub()

        await Session.remove(session.id)
      },
    })
  })

  test("getPlanModeState throws for non-existent session", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await expect(getPlanModeState("non-existent-session-id" as SessionID)).rejects.toThrow()
      },
    })
  })
})
