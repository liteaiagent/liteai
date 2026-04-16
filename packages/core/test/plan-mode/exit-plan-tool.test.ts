import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import { Bus } from "../../src/bus"
import { Instance } from "../../src/project/instance"
import type { ModelID, ProviderID } from "../../src/provider/schema"
import { Question } from "../../src/question"
import { Session } from "../../src/session"
import { getPlanModeState, setPlanModeState } from "../../src/session/plan-mode-state"
import { MessageID } from "../../src/session/schema"
import { PlanExitTool } from "../../src/tool/plan"
import { tmpdir } from "../fixture/fixture"

describe("PlanExitTool", () => {
  test("should throw an error if plan is empty", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        await setPlanModeState(session.id, (s) => ({ ...s, active: true }))

        const toolContext = {
          sessionID: session.id,
          messageID: MessageID.ascending(),
          callID: "test-call-1",
          agent: "plan",
          abort: new AbortController().signal,
          messages: [],
          metadata: () => {},
          ask: async () => {},
        }
        const instance = await PlanExitTool.init()
        await expect(instance.execute({ plan: "   " }, toolContext)).rejects.toThrow("Plan is empty")
        await Session.remove(session.id)
      },
    })
  })

  test("should throw an error if not in plan mode", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        // explicitly inactive
        await setPlanModeState(session.id, (s) => ({ ...s, active: false }))

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
        const instance = await PlanExitTool.init()
        await expect(instance.execute({ plan: "Test plan" }, toolContext)).rejects.toThrow("not currently active")
        await Session.remove(session.id)
      },
    })
  })

  test("should write to disk, request approval, and transition on Yes", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        await setPlanModeState(session.id, (s) => ({ ...s, active: true }))

        // Add a stub provider return to avoid "no model available" in getLastModel
        const { Provider } = await import("../../src/provider/provider")
        const originalDefaultModel = Provider.defaultModel
        Provider.defaultModel = async () => ({ providerID: "test" as ProviderID, modelID: "test-model" as ModelID })

        let approvalRequested = false
        const eventPromise = new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error("Timeout waiting for approval request event")), 2000)
          const sub = Bus.subscribe(Session.Event.PlanApprovalRequested, (event) => {
            const props = event.properties as { sessionID: string; planText: string; planFilePath: string }
            if (props.sessionID === session.id) {
              approvalRequested = true
              expect(props.planText).toBe("My awesome plan")
              sub()
              clearTimeout(timeout)
              resolve()
            }
          })
        })

        const originalAsk = Question.ask
        Question.ask = async () => [["Yes"]]

        try {
          const toolContext = {
            sessionID: session.id,
            messageID: MessageID.ascending(),
            callID: "test-call-3",
            agent: "plan",
            abort: new AbortController().signal,
            messages: [],
            metadata: () => {},
            ask: async () => {},
          }

          const instance = await PlanExitTool.init()
          const executePromise = instance.execute({ plan: "My awesome plan" }, toolContext)
          const [result] = await Promise.all([executePromise, eventPromise])

          expect(approvalRequested).toBe(true)

          const state = await getPlanModeState(session.id)
          expect(state.active).toBe(false)
          expect(state.planText).toBe("My awesome plan")
          expect(state.turnsSincePlanReminder).toBe(0)

          expect(result.metadata.approved).toBe(true)
          expect(result.output).toContain("My awesome plan")
          expect(result.inject?.length).toBe(1)
          expect(result.inject?.[0].info.agent).toBe("build")
          expect(result.inject?.[0].parts).toEqual([])

          const writtenPlan = await fs.readFile(state.planFilePath, "utf-8")
          expect(writtenPlan).toBe("My awesome plan")
        } finally {
          Question.ask = originalAsk
          Provider.defaultModel = originalDefaultModel
          await Session.remove(session.id)
        }
      },
    })
  })

  test("should throw RejectedError on No", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        await setPlanModeState(session.id, (s) => ({ ...s, active: true }))

        const originalAsk = Question.ask
        Question.ask = async () => [["No"]]

        try {
          const toolContext = {
            sessionID: session.id,
            messageID: MessageID.ascending(),
            callID: "test-call-4",
            agent: "plan",
            abort: new AbortController().signal,
            messages: [],
            metadata: () => {},
            ask: async () => {},
          }

          const instance = await PlanExitTool.init()
          const act = () => instance.execute({ plan: "My awesome plan" }, toolContext)

          let caught = false
          try {
            await act()
          } catch (e: unknown) {
            caught = true
            const err = e as Error & { _tag: string }
            expect(err.message).toContain("User rejected switching to build agent")
            expect(err._tag).toBe("QuestionRejectedError")
          }
          expect(caught).toBe(true)

          const state = await getPlanModeState(session.id)
          expect(state.active).toBe(true)
        } finally {
          Question.ask = originalAsk
          await Session.remove(session.id)
        }
      },
    })
  })
})
