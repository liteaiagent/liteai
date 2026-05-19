import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { injectPlanAttachment } from "../../src/session/engine/plan-reminder"
import type { Message } from "../../src/session/message"
import type { PlanModeState } from "../../src/session/plan-mode-state"
import { createDefaultPlanModeState, PLAN_REMINDER_FULL_INTERVAL } from "../../src/session/plan-mode-state"
import type { SessionID } from "../../src/session/schema"
import { MessageID, PartID } from "../../src/session/schema"
import { tmpdir } from "../fixture/fixture"

function createUserMessage(session: Session.Info, text = "hello"): Message.WithParts {
  const msgId = MessageID.ascending()
  return {
    info: {
      id: msgId,
      sessionID: session.id,
      role: "user",
      time: { created: Date.now() },
      agent: "liteai",
      model: { providerID: "test", modelID: "test-model" },
    } as Message.User,
    parts: [
      {
        type: "text",
        id: PartID.ascending(),
        messageID: msgId,
        sessionID: session.id,
        text,
      } as Message.TextPart,
    ],
  }
}

/** Helper: build-phase state (planSessionID=undefined, planText set) */
function buildPhaseState(session: Session.Info, overrides?: Partial<PlanModeState>): PlanModeState {
  return {
    ...createDefaultPlanModeState(session),
    planSessionID: undefined,
    planText: "Approved plan content",
    turnsSincePlanReminder: 0,
    ...overrides,
  }
}

describe("injectPlanAttachment", () => {
  test("injects sparse active reminder when plan mode is active and counter < INTERVAL (MVP pattern)", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        // planSessionID set means we're in plan phase
        const state: PlanModeState = {
          ...createDefaultPlanModeState(session),
          planSessionID: "test-plan-session" as SessionID,
          planText: "Some plan",
          planFilePath: path.join(tmp.path, "plan.md"),
          turnsSincePlanReminder: 0,
        }
        const messages = [createUserMessage(session)]

        const result = await injectPlanAttachment({
          messages,
          planModeState: state,
          session,
        })

        // One attachment appended to user message
        expect(result.messages.length).toBe(1)
        const updatedParts = result.messages[0].parts
        expect(updatedParts.length).toBe(2)

        const reminder = updatedParts[1] as Message.TextPart
        expect(reminder.type).toBe("text")
        expect(reminder.text).toContain("PLAN MODE ACTIVE")
        expect(reminder.synthetic).toBe(true)

        // Counter incremented
        expect(result.updatedState.turnsSincePlanReminder).toBe(1)

        await Session.remove(session.id)
      },
    })
  })

  test("no-op when no plan has been approved (planText falsy)", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        // planSessionID=undefined and no planText — no approved plan yet
        const state = createDefaultPlanModeState(session) // planSessionID: undefined, planText: undefined
        const messages = [createUserMessage(session)]

        const result = await injectPlanAttachment({
          messages,
          planModeState: state,
          session,
        })

        // Messages unchanged (same reference)
        expect(result.messages).toBe(messages)
        // State unchanged (same reference)
        expect(result.updatedState).toBe(state)

        await Session.remove(session.id)
      },
    })
  })

  test("injects sparse reminder in build phase when counter < INTERVAL (FR-011)", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const state = buildPhaseState(session, { turnsSincePlanReminder: 2 })

        // Create the plan file
        await fs.mkdir(path.dirname(state.planFilePath), { recursive: true })
        await fs.writeFile(state.planFilePath, "Dummy plan", "utf-8")

        const messages = [createUserMessage(session)]

        const result = await injectPlanAttachment({
          messages,
          planModeState: state,
          session,
        })

        // One attachment appended to user message
        expect(result.messages.length).toBe(1)
        const updatedParts = result.messages[0].parts
        expect(updatedParts.length).toBe(2) // original text + reminder

        const reminder = updatedParts[1] as Message.TextPart
        expect(reminder.type).toBe("text")
        expect(reminder.text).toContain("staying on track")

        // Counter incremented by 1
        expect(result.updatedState.turnsSincePlanReminder).toBe(3)

        await Session.remove(session.id)
      },
    })
  })

  test("injects full plan text in build phase when counter >= INTERVAL (FR-011)", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const state = buildPhaseState(session, { turnsSincePlanReminder: PLAN_REMINDER_FULL_INTERVAL })

        // Create the plan file
        await fs.mkdir(path.dirname(state.planFilePath), { recursive: true })
        await fs.writeFile(state.planFilePath, "Step 1: Do the thing\nStep 2: Verify", "utf-8")

        const messages = [createUserMessage(session)]

        const result = await injectPlanAttachment({
          messages,
          planModeState: state,
          session,
        })

        const updatedParts = result.messages[0].parts
        expect(updatedParts.length).toBe(2)

        const reminder = updatedParts[1] as Message.TextPart
        expect(reminder.text).toContain("Step 1: Do the thing")
        expect(reminder.text).toContain("Step 2: Verify")

        // Counter reset to 0
        expect(result.updatedState.turnsSincePlanReminder).toBe(0)

        await Session.remove(session.id)
      },
    })
  })

  test("falls back to sparse when plan file does not exist on full turn", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const state = buildPhaseState(session, { turnsSincePlanReminder: PLAN_REMINDER_FULL_INTERVAL })

        // No plan file created on disk
        const messages = [createUserMessage(session)]

        const result = await injectPlanAttachment({
          messages,
          planModeState: state,
          session,
        })

        const updatedParts = result.messages[0].parts
        expect(updatedParts.length).toBe(2)

        const reminder = updatedParts[1] as Message.TextPart
        expect(reminder.text).toContain("No plan file exists yet")

        // Counter incremented (not reset) — plan file absent
        expect(result.updatedState.turnsSincePlanReminder).toBe(PLAN_REMINDER_FULL_INTERVAL + 1)

        await Session.remove(session.id)
      },
    })
  })

  test("exactly one attachment per user message in build phase (SC-005)", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const state = buildPhaseState(session, { turnsSincePlanReminder: 0 })
        const messages = [createUserMessage(session)]

        const result = await injectPlanAttachment({
          messages,
          planModeState: state,
          session,
        })

        // Exactly 1 part appended (original + 1 attachment = 2 total)
        expect(result.messages[0].parts.length).toBe(2)

        // Run again with updated state — should not double-append
        const result2 = await injectPlanAttachment({
          messages: [createUserMessage(session)],
          planModeState: result.updatedState,
          session,
        })
        expect(result2.messages[0].parts.length).toBe(2)

        await Session.remove(session.id)
      },
    })
  })

  test("does not modify original messages array (immutability)", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const state = buildPhaseState(session, { turnsSincePlanReminder: 0 })
        const originalMessage = createUserMessage(session)
        const originalPartsLength = originalMessage.parts.length
        const messages = [originalMessage]

        await injectPlanAttachment({
          messages,
          planModeState: state,
          session,
        })

        // Original message parts should NOT be mutated
        expect(originalMessage.parts.length).toBe(originalPartsLength)

        await Session.remove(session.id)
      },
    })
  })

  test("no-op when no user messages exist", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const state = buildPhaseState(session, { turnsSincePlanReminder: 2 })

        const result = await injectPlanAttachment({
          messages: [],
          planModeState: state,
          session,
        })

        expect(result.messages.length).toBe(0)
        // Counter should NOT increment when there's no user message
        expect(result.updatedState.turnsSincePlanReminder).toBe(2)

        await Session.remove(session.id)
      },
    })
  })
})
