import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Instance } from "../../../src/project/instance"
import { injectPlanAttachment } from "../../../src/session/engine/plan-reminder"
import type { Message } from "../../../src/session/message"
import type { PlanModeState } from "../../../src/session/plan-mode-state"
import { PLAN_REMINDER_FULL_INTERVAL } from "../../../src/session/plan-mode-state"
import { MessageID, PartID, type SessionID } from "../../../src/session/schema"

const projectRoot = path.join(__dirname, "../../..")

/**
 * Create a minimal in-memory message fixture for testing plan attachment injection.
 * No DB writes — purely in-memory structures matching the message model.
 */
function createTestMessages(overrides?: {
  userText?: string
  includeAssistant?: boolean
  sessionID?: SessionID
}): Message.WithParts[] {
  const sessionID = overrides?.sessionID ?? ("test-session" as SessionID)
  const messages: Message.WithParts[] = []

  if (overrides?.includeAssistant) {
    const assistantMsgId = MessageID.ascending()
    messages.push({
      info: {
        id: assistantMsgId,
        sessionID,
        role: "assistant",
        time: { created: Date.now() - 2000 },
        agent: "plan",
        finish: "stop",
      } as Message.Info,
      parts: [
        {
          id: PartID.ascending(),
          messageID: assistantMsgId,
          sessionID,
          type: "text",
          text: "I will create your plan.",
        } as Message.Part,
      ],
    })
  }

  const userMsgId = MessageID.ascending()
  messages.push({
    info: {
      id: userMsgId,
      sessionID,
      role: "user",
      time: { created: Date.now() },
      agent: "plan",
      model: { providerID: "test", modelID: "test-model" },
    } as Message.Info,
    parts: [
      {
        id: PartID.ascending(),
        messageID: userMsgId,
        sessionID,
        type: "text",
        text: overrides?.userText ?? "Please create a plan for the feature.",
      } as Message.Part,
    ],
  })

  return messages
}

function createPlanState(overrides?: Partial<PlanModeState>): PlanModeState {
  return {
    active: true,
    planText: undefined,
    planFilePath: path.join(os.tmpdir(), `test-plan-${crypto.randomUUID()}.md`),
    turnsSincePlanReminder: 0,
    ...overrides,
  }
}

describe("injectPlanAttachment (T048)", () => {
  // ── T015: No-op when plan mode is inactive ──
  describe("inactive plan mode", () => {
    test("returns messages unchanged when planModeState.active is false", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          const messages = createTestMessages()
          const state = createPlanState({ active: false })
          const result = await injectPlanAttachment({
            messages,
            planModeState: state,
            session: {} as Parameters<typeof injectPlanAttachment>[0]["session"], // unused when inactive
          })

          expect(result.messages).toBe(messages) // same reference — no copy
          expect(result.updatedState).toBe(state) // same reference — no mutation
        },
      })
    })
  })

  // ── T012: Sparse reminder injection ──
  describe("sparse reminder", () => {
    test("appends sparse reminder when counter < PLAN_REMINDER_FULL_INTERVAL", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          const planPath = path.join(os.tmpdir(), `test-plan-${crypto.randomUUID()}.md`)
          await fs.mkdir(path.dirname(planPath), { recursive: true })
          await fs.writeFile(planPath, "# My Plan\n\nStep 1")

          try {
            const messages = createTestMessages()
            const state = createPlanState({ turnsSincePlanReminder: 2, planFilePath: planPath })
            const result = await injectPlanAttachment({
              messages,
              planModeState: state,
              session: {} as Parameters<typeof injectPlanAttachment>[0]["session"],
            })

            // Should have appended a part to the last user message
            const lastUser = result.messages.findLast((m) => m.info.role === "user")
            expect(lastUser).toBeDefined()
            expect(lastUser?.parts.length).toBe(2) // original + attachment

            const attachment = lastUser?.parts[1]
            expect(attachment?.type).toBe("text")
            expect((attachment as { text?: string }).text).toContain("staying on track")
            expect((attachment as { synthetic?: boolean }).synthetic).toBe(false) // visible to model

            // Counter should be incremented
            expect(result.updatedState.turnsSincePlanReminder).toBe(3)
          } finally {
            await fs.rm(planPath, { force: true })
          }
        },
      })
    })

    test("sparse reminder reports 'No plan file' when plan does not exist", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          const nonExistentPath = path.join(os.tmpdir(), `no-such-plan-${crypto.randomUUID()}.md`)
          const messages = createTestMessages()
          const state = createPlanState({ turnsSincePlanReminder: 1, planFilePath: nonExistentPath })
          const result = await injectPlanAttachment({
            messages,
            planModeState: state,
            session: {} as Parameters<typeof injectPlanAttachment>[0]["session"],
          })

          const lastUser = result.messages.findLast((m) => m.info.role === "user")
          const attachment = lastUser?.parts[1]
          expect((attachment as { text?: string }).text).toContain("No plan file exists yet")
          expect(result.updatedState.turnsSincePlanReminder).toBe(2)
        },
      })
    })
  })

  // ── T013: Full plan text injection ──
  describe("full plan text injection", () => {
    test("injects full plan text when counter >= PLAN_REMINDER_FULL_INTERVAL", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          const planPath = path.join(os.tmpdir(), `test-plan-${crypto.randomUUID()}.md`)
          const planContent = "# Detailed Plan\n\n## Phase 1\n- Task A\n- Task B\n\n## Phase 2\n- Task C"
          await fs.mkdir(path.dirname(planPath), { recursive: true })
          await fs.writeFile(planPath, planContent)

          try {
            const messages = createTestMessages()
            const state = createPlanState({
              turnsSincePlanReminder: PLAN_REMINDER_FULL_INTERVAL,
              planFilePath: planPath,
            })
            const result = await injectPlanAttachment({
              messages,
              planModeState: state,
              session: {} as Parameters<typeof injectPlanAttachment>[0]["session"],
            })

            const lastUser = result.messages.findLast((m) => m.info.role === "user")
            const attachment = lastUser?.parts[1]
            expect((attachment as { text?: string }).text).toBe(planContent) // full plan content
            expect((attachment as { synthetic?: boolean }).synthetic).toBe(false)

            // Counter should be RESET to 0
            expect(result.updatedState.turnsSincePlanReminder).toBe(0)
          } finally {
            await fs.rm(planPath, { force: true })
          }
        },
      })
    })

    test("falls back to sparse when full reminder requested but plan file missing", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          const nonExistentPath = path.join(os.tmpdir(), `no-such-plan-${crypto.randomUUID()}.md`)
          const messages = createTestMessages()
          const state = createPlanState({
            turnsSincePlanReminder: PLAN_REMINDER_FULL_INTERVAL,
            planFilePath: nonExistentPath,
          })
          const result = await injectPlanAttachment({
            messages,
            planModeState: state,
            session: {} as Parameters<typeof injectPlanAttachment>[0]["session"],
          })

          const lastUser = result.messages.findLast((m) => m.info.role === "user")
          const attachment = lastUser?.parts[1]
          expect((attachment as { text?: string }).text).toContain("No plan file exists yet")

          // Counter should NOT be reset (fallback to sparse path increments)
          expect(result.updatedState.turnsSincePlanReminder).toBe(PLAN_REMINDER_FULL_INTERVAL + 1)
        },
      })
    })
  })

  // ── Zero DB writes invariant ──
  describe("zero DB writes", () => {
    test("does not modify original messages array (immutable)", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          const messages = createTestMessages()
          const originalLength = messages[0].parts.length
          const state = createPlanState({
            turnsSincePlanReminder: 0,
            planFilePath: path.join(os.tmpdir(), `no-plan-${crypto.randomUUID()}.md`),
          })
          const result = await injectPlanAttachment({
            messages,
            planModeState: state,
            session: {} as Parameters<typeof injectPlanAttachment>[0]["session"],
          })

          // Original messages should be untouched (new array returned)
          expect(messages[0].parts.length).toBe(originalLength)
          // Result should have the additional part
          expect(result.messages !== messages).toBe(true)
        },
      })
    })
  })

  // ── No user message edge case ──
  describe("edge cases", () => {
    test("returns unchanged when no user message exists", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          const messages: Message.WithParts[] = [
            {
              info: {
                id: MessageID.ascending(),
                sessionID: "test" as SessionID,
                role: "assistant",
                time: { created: Date.now() },
                agent: "plan",
                finish: "stop",
              } as Message.Info,
              parts: [],
            },
          ]
          const state = createPlanState({ turnsSincePlanReminder: 0 })
          const result = await injectPlanAttachment({
            messages,
            planModeState: state,
            session: {} as Parameters<typeof injectPlanAttachment>[0]["session"],
          })

          expect(result.messages).toBe(messages)
          expect(result.updatedState).toBe(state)
        },
      })
    })
  })
})
