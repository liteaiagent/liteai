import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { Bus } from "../../src/bus"
import { Instance } from "../../src/project/instance"
import type { ModelID, ProviderID } from "../../src/provider/schema"
import { Session } from "../../src/session"
import { createDefaultPlanModeState, PlanModeStateRef } from "../../src/session/plan-mode-state"
import { MessageID } from "../../src/session/schema"
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

  test("should activate plan mode and emit event when inactive, with no plan file", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { session, ref } = await createSessionWithRef({ active: false, turnsSincePlanReminder: 3 })

        const { Provider } = await import("../../src/provider/provider")
        const originalDefaultModel = Provider.defaultModel
        Provider.defaultModel = async () => ({ providerID: "test" as ProviderID, modelID: "test-model" as ModelID })

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
          const toolContext = {
            sessionID: session.id,
            messageID: MessageID.ascending(),
            callID: "test-call-1",
            agent: "build",
            abort: new AbortController().signal,
            messages: [],
            metadata: () => {},
            ask: async () => {},
          }

          const instance = await PlanEnterTool.init()
          const executePromise = instance.execute({}, toolContext)
          const [result] = await Promise.all([executePromise, eventPromise])

          expect(eventEmitted).toBe(true)

          const state = ref.get()
          expect(state.active).toBe(true)
          expect(state.turnsSincePlanReminder).toBe(0)

          expect(result.output).toContain("Create a plan at")
          expect(result.inject?.length).toBe(1)
          expect(result.inject?.[0].info.agent).toBe("plan")
          expect(result.inject?.[0].parts).toEqual([])
        } finally {
          Provider.defaultModel = originalDefaultModel
          await Session.remove(session.id)
        }
      },
    })
  })

  test("should inject existing plan text when plan file exists", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { session, ref } = await createSessionWithRef()
        const state = ref.get()
        await fs.mkdir(path.dirname(state.planFilePath), { recursive: true })
        await fs.writeFile(state.planFilePath, "Existing Plan Content", "utf-8")

        const { Provider } = await import("../../src/provider/provider")
        const originalDefaultModel = Provider.defaultModel
        Provider.defaultModel = async () => ({ providerID: "test" as ProviderID, modelID: "test-model" as ModelID })

        try {
          const toolContext = {
            sessionID: session.id,
            messageID: MessageID.ascending(),
            callID: "test-call-2",
            agent: "build",
            abort: new AbortController().signal,
            messages: [],
            metadata: () => {},
            ask: async () => {},
          }

          const instance = await PlanEnterTool.init()
          const result = await instance.execute({}, toolContext)

          expect(result.output).toContain("Review and refine the existing plan at")
          expect(result.output).toContain("Existing Plan Content")
        } finally {
          Provider.defaultModel = originalDefaultModel
          await Session.remove(session.id)
        }
      },
    })
  })

  test("should be idempotent if already active and not emit event", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { session, ref } = await createSessionWithRef({ active: true, turnsSincePlanReminder: 3 })

        const { Provider } = await import("../../src/provider/provider")
        const originalDefaultModel = Provider.defaultModel
        Provider.defaultModel = async () => ({ providerID: "test" as ProviderID, modelID: "test-model" as ModelID })

        let eventEmittedCount = 0
        const sub = Bus.subscribe(Session.Event.PlanStateChanged, (event) => {
          const props = event.properties as { sessionID: string }
          if (props.sessionID === session.id) {
            eventEmittedCount++
          }
        })

        try {
          const toolContext = {
            sessionID: session.id,
            messageID: MessageID.ascending(),
            callID: "test-call-3",
            agent: "build",
            abort: new AbortController().signal,
            messages: [],
            metadata: () => {},
            ask: async () => {},
          }

          const instance = await PlanEnterTool.init()
          const result = await instance.execute({}, toolContext)

          expect(eventEmittedCount).toBe(0)
          expect(result.title).toBe("Already in plan mode")
          expect(result.output).toContain("already in plan mode")

          const state = ref.get()
          expect(state.active).toBe(true)
          expect(state.turnsSincePlanReminder).toBe(3) // Ensure counter was NOT reset
        } finally {
          sub()
          Provider.defaultModel = originalDefaultModel
          await Session.remove(session.id)
        }
      },
    })
  })
})
