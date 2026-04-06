import { describe, expect, test } from "bun:test"
import type { Provider } from "../../../src/provider/provider"
import { ProviderID } from "../../../src/provider/schema"
import { Message } from "../../../src/session/message"
import { MessageID, PartID, SessionID } from "../../../src/session/schema"
import {
  applyToolResultBudget,
  createAutocompactState,
  executePipeline,
  shouldAutocompact,
  snipCompact,
} from "../../../src/session/engine/pipeline"

function createMessage(
  role: "user" | "assistant",
  parts: Message.Part[],
  error?: NonNullable<Message.Assistant["error"]>,
): Message.WithParts {
  const info = {
    id: MessageID.ascending(),
    sessionID: SessionID.make("test"),
    role,
    time: { created: Date.now() },
    model: { providerID: ProviderID.make("test"), modelID: "test" },
    ...(role === "assistant" ? { error, summary: false } : { agent: "test" }),
  } as Message.Info

  return { info, parts }
}

function createTextPart(text: string): Message.TextPart {
  return {
    id: PartID.ascending(),
    messageID: MessageID.ascending(),
    sessionID: SessionID.make("test"),
    type: "text",
    text,
    time: { start: Date.now(), end: Date.now() },
  }
}

function createToolPart(output: string, status: "completed" | "running" | "error" = "completed"): Message.ToolPart {
  let state: Message.ToolPart["state"]
  if (status === "completed") {
    state = {
      status: "completed",
      input: {},
      output,
      title: "",
      metadata: {},
      time: { start: Date.now(), end: Date.now() },
    }
  } else if (status === "error") {
    state = { status: "error", input: {}, error: output, time: { start: Date.now(), end: Date.now() } }
  } else {
    state = { status: "running", input: {}, time: { start: Date.now() } }
  }

  return {
    id: PartID.ascending(),
    messageID: MessageID.ascending(),
    sessionID: SessionID.make("test"),
    callID: "test-call-id",
    type: "tool",
    tool: "test-tool",
    state,
  }
}

function getCompletedState(part: Message.Part) {
  if (part.type !== "tool" || part.state.status !== "completed") {
    throw new Error("Expected completed tool part")
  }
  return part.state
}

describe("Pre-Processing Context Pipeline", () => {
  describe("applyToolResultBudget", () => {
    test("clears largest tool outputs when turn exceeds 200K chars", () => {
      // 5 parts, total 300K chars in one turn
      const msg = createMessage("user", [
        createToolPart("a".repeat(100_000)), // 100K
        createToolPart("b".repeat(80_000)), // 80K
        createToolPart("c".repeat(50_000)), // 50K
        createToolPart("d".repeat(40_000)), // 40K
        createToolPart("e".repeat(30_000)), // 30K
      ])

      const result = applyToolResultBudget([msg])
      const parts = result[0].parts as Message.ToolPart[]

      // The algorithm sorts by size descending and removes until remaining <= 200,000.
      // Total = 300K
      // Removes 100K part -> remaining 200K (meets budget)
      expect(parts[0].state).toMatchObject({ output: "[Old tool result content cleared]" })
      expect(getCompletedState(parts[0]).time.compacted).toBeDefined()

      // The rest should be untouched
      expect(getCompletedState(parts[1]).output).toBe("b".repeat(80_000))
      expect(getCompletedState(parts[2]).output).toBe("c".repeat(50_000))
      expect(getCompletedState(parts[3]).output).toBe("d".repeat(40_000))
      expect(getCompletedState(parts[4]).output).toBe("e".repeat(30_000))

      // No mutation of original
      expect(getCompletedState(msg.parts[0]).output).toBe("a".repeat(100_000))
    })

    test("does not clear outputs if under budget", () => {
      const msg = createMessage("user", [createToolPart("a".repeat(100_000)), createToolPart("b".repeat(90_000))])
      const result = applyToolResultBudget([msg])
      expect(result).toEqual([msg]) // Strict equality -> no cloning happened
    })

    test("handles multiple turns separately", () => {
      // Two turns separated by assistant. Each turn is 150K -> total 300K,
      // but each turn individually is under the 200K budget.
      const msgs = [
        createMessage("user", [createToolPart("a".repeat(150_000))]),
        createMessage("assistant", [createTextPart("I did a thing")]),
        createMessage("user", [createToolPart("b".repeat(150_000))]),
      ]

      const result = applyToolResultBudget(msgs)
      expect(result).toEqual(msgs) // Strict equality
    })
  })

  describe("snipCompact", () => {
    test("removes aborted assistant message with no useful content", () => {
      const msgs = [
        createMessage("user", [createTextPart("do stuff")]),
        createMessage("assistant", [], new Message.AbortedError({ message: "aborted" }).toObject()),
      ]

      const result = snipCompact(msgs)
      expect(result).toHaveLength(1)
      expect(result[0].info.role).toBe("user")
    })

    test("keeps aborted assistant message if it contains text output", () => {
      const msgs = [
        createMessage("user", [createTextPart("do stuff")]),
        createMessage(
          "assistant",
          [createTextPart("Here is partial useful text before aborting")],
          new Message.AbortedError({ message: "aborted" }).toObject(),
        ),
      ]

      const result = snipCompact(msgs)
      expect(result).toHaveLength(2)
    })
  })

  describe("shouldAutocompact", () => {
    const mockModel = {
      limit: { input: 200_000, context: 200_000 },
    } as unknown as Provider.Model

    test("returns true when token estimate approaches limit", () => {
      // Token estimate: string length / 4.
      // To hit ~167,000 threshold (200k - 20k - 13k) we need ~668,000 chars
      const msgs = [createMessage("user", [createTextPart("a".repeat(700_000))])]
      const state = createAutocompactState()
      expect(shouldAutocompact(msgs, mockModel, state)).toBe(true)
    })

    test("returns false when comfortably under limit", () => {
      const msgs = [createMessage("user", [createTextPart("a".repeat(10_000))])]
      const state = createAutocompactState()
      expect(shouldAutocompact(msgs, mockModel, state)).toBe(false)
    })

    test("trips circuit breaker after consecutive failures", () => {
      const msgs = [createMessage("user", [createTextPart("a".repeat(700_000))])]
      const state = createAutocompactState()

      state.consecutiveFailures = 3
      expect(shouldAutocompact(msgs, mockModel, state)).toBe(false) // Blocks compaction
    })
  })

  describe("executePipeline", () => {
    test("runs budget and snip stages in sequence", () => {
      const msgs = [
        createMessage("user", [createToolPart("a".repeat(250_000))]),
        createMessage("assistant", [], new Message.AbortedError({ message: "aborted" }).toObject()),
      ]

      const result = executePipeline(msgs)

      expect(result).toHaveLength(1) // Snip removed the aborted message

      const parts = result[0].parts as Message.ToolPart[]
      expect(parts[0].state).toMatchObject({ output: "[Old tool result content cleared]" })
    })
  })
})
