import { describe, expect, test } from "bun:test"
import { LoopDetectionService, LoopType } from "../../../src/session/engine/loop-detection"
import type { EngineEvent } from "../../../src/session/events"

// ─── Helpers ────────────────────────────────────────────────────────────────

function repeatBlock(seed: string, chars: number): string {
  let result = ""
  while (result.length < chars) {
    result += seed
  }
  return result.slice(0, chars)
}

function reasoningDelta(text: string): EngineEvent.Any {
  return { type: "delta", part: "reasoning", id: "r1", text }
}

function textDelta(text: string): EngineEvent.Any {
  return { type: "delta", part: "text", id: "t1", text }
}

function toolCall(toolName: string, input: unknown): EngineEvent.Any {
  return { type: "call", kind: "tool", id: `call-${toolName}-${Math.random()}`, toolName, input }
}

/** Feed reasoning text through the service in streaming-sized chunks */
function feedReasoning(service: LoopDetectionService, text: string, chunkSize = 20) {
  for (let i = 0; i < text.length; i += chunkSize) {
    const result = service.check(reasoningDelta(text.slice(i, i + chunkSize)))
    if (result.count > 0) return result
  }
  return { count: 0 }
}

/** Feed text output through the service in streaming-sized chunks */
function feedText(service: LoopDetectionService, text: string, chunkSize = 20) {
  for (let i = 0; i < text.length; i += chunkSize) {
    const result = service.check(textDelta(text.slice(i, i + chunkSize)))
    if (result.count > 0) return result
  }
  return { count: 0 }
}

describe("LoopDetectionService", () => {
  // ── Thinking Loop Detection ─────────────────────────────────────────────

  describe("thinking loop detection", () => {
    test("detects repeated reasoning deltas", () => {
      const service = new LoopDetectionService("test-session")
      const block = repeatBlock("I'm verifying the execution plan. Let me proceed with the next step. ", 100)
      const result = feedReasoning(service, block.repeat(6))
      expect(result.count).toBeGreaterThan(0)
      expect(result.type).toBe(LoopType.THINKING_LOOP)
    })

    test("does not detect loop for varied reasoning", () => {
      const service = new LoopDetectionService("test-session")
      const varied = Array.from(
        { length: 10 },
        (_, i) => `Step ${i}: analyzing unique aspect number ${i * 37} of the problem with detail ${i * 13}. `,
      ).join("")
      const result = feedReasoning(service, varied)
      expect(result.count).toBe(0)
    })
  })

  // ── Tool Call Loop Detection ────────────────────────────────────────────

  describe("tool call loop detection", () => {
    test("detects 5 consecutive identical tool calls", () => {
      const service = new LoopDetectionService("test-session")
      const input = { file: "test.ts", content: "hello" }

      let detected = false
      for (let i = 0; i < 6; i++) {
        const result = service.check(toolCall("write_file", input))
        if (result.count > 0) {
          detected = true
          expect(result.type).toBe(LoopType.TOOL_CALL_LOOP)
          expect(result.detail).toContain("write_file")
          break
        }
      }
      expect(detected).toBe(true)
    })

    test("does not detect when tool names differ", () => {
      const service = new LoopDetectionService("test-session")
      const tools = ["read", "grep", "edit", "read", "grep", "edit"]
      for (const tool of tools) {
        const result = service.check(toolCall(tool, { arg: "value" }))
        expect(result.count).toBe(0)
      }
    })

    test("does not detect when inputs differ", () => {
      const service = new LoopDetectionService("test-session")
      for (let i = 0; i < 10; i++) {
        const result = service.check(toolCall("read", { file: `file-${i}.ts` }))
        expect(result.count).toBe(0)
      }
    })

    test("resets consecutive count when different tool is called", () => {
      const service = new LoopDetectionService("test-session")
      const input = { file: "test.ts" }

      // 3 identical calls
      for (let i = 0; i < 3; i++) {
        service.check(toolCall("read", input))
      }
      // Different tool breaks the streak
      service.check(toolCall("grep", { pattern: "foo" }))
      // 3 more identical calls (total 4, still under threshold of 5)
      for (let i = 0; i < 3; i++) {
        const result = service.check(toolCall("read", input))
        expect(result.count).toBe(0)
      }
    })
  })

  // ── Content Chanting Detection ──────────────────────────────────────────

  describe("content chanting detection", () => {
    test("detects repeated text output (50-char chunks, threshold 10)", () => {
      const service = new LoopDetectionService("test-session")
      // A 50-char block repeated 12 times = 600 chars
      const block = repeatBlock("This is chanting output repeating the same thing. ", 50)
      const result = feedText(service, block.repeat(12))
      expect(result.count).toBeGreaterThan(0)
      expect(result.type).toBe(LoopType.CONTENT_CHANTING)
    })

    test("does not detect for varied text output", () => {
      const service = new LoopDetectionService("test-session")
      const varied = Array.from(
        { length: 20 },
        (_, i) => `Line ${i}: unique output with distinct content ${i * 41}. `,
      ).join("")
      const result = feedText(service, varied)
      expect(result.count).toBe(0)
    })
  })

  // ── Event Routing ─────────────────────────────────────────────────────

  describe("event routing", () => {
    test("routes reasoning delta to thinking detector", () => {
      const service = new LoopDetectionService("test-session")
      const block = repeatBlock("Thinking about the same plan over and over and over. ", 100)
      for (let rep = 0; rep < 6; rep++) {
        for (let i = 0; i < block.length; i += 50) {
          const result = service.check(reasoningDelta(block.slice(i, i + 50)))
          if (result.count > 0) {
            expect(result.type).toBe(LoopType.THINKING_LOOP)
            return
          }
        }
      }
      expect(true).toBe(false) // should have detected
    })

    test("ignores non-delta, non-call events", () => {
      const service = new LoopDetectionService("test-session")
      const events: EngineEvent.Any[] = [
        { type: "start", kind: "session" },
        { type: "start", kind: "reasoning", id: "r1" },
        { type: "end", kind: "reasoning", id: "r1" },
        { type: "start", kind: "text", id: "t1" },
        { type: "end", kind: "text", id: "t1" },
        { type: "finish" },
      ]
      for (const event of events) {
        const result = service.check(event)
        expect(result.count).toBe(0)
      }
    })
  })

  // ── Turn Boundary ─────────────────────────────────────────────────────

  describe("turn boundary", () => {
    test("turnStarted resets per-turn state", () => {
      const service = new LoopDetectionService("test-session")
      const block = repeatBlock("Repeated block that will be cleared on turn boundary. ", 100)

      // Feed 3 repetitions (under threshold)
      feedReasoning(service, block.repeat(3))

      // Reset on turn boundary
      service.turnStarted()

      // Feed 4 more (would be 7 total without reset, but now only 4 — under threshold)
      const result = feedReasoning(service, block.repeat(4))
      expect(result.count).toBe(0)
    })

    test("turnStarted preserves detection count for escalation", () => {
      const service = new LoopDetectionService("test-session")
      const block = repeatBlock("First loop content causing initial detection in this test. ", 100)

      // Trigger first detection
      feedReasoning(service, block.repeat(6))
      expect(service.getDetectionCount()).toBe(1)

      // Reset on turn boundary
      service.turnStarted()
      expect(service.getDetectionCount()).toBe(1) // preserved across turns
    })
  })

  // ── Clear Detection ───────────────────────────────────────────────────

  describe("clearDetection", () => {
    test("suppresses detection for recovery turn", () => {
      const service = new LoopDetectionService("test-session")
      service.clearDetection()

      const block = repeatBlock("Should be suppressed during recovery turn to allow retry. ", 100)
      const result = feedReasoning(service, block.repeat(6))
      expect(result.count).toBe(0)
    })

    test("re-arms after turnStarted", () => {
      const service = new LoopDetectionService("test-session")
      service.clearDetection()
      service.turnStarted() // clears the suppression

      const block = repeatBlock("Should detect again after turn boundary re-arms detection. ", 100)
      const result = feedReasoning(service, block.repeat(6))
      expect(result.count).toBeGreaterThan(0)
    })
  })

  // ── Full Reset ────────────────────────────────────────────────────────

  describe("full reset", () => {
    test("resets all state including detection count", () => {
      const service = new LoopDetectionService("test-session")
      const block = repeatBlock("Loop content that triggers detection before full reset. ", 100)

      // Trigger detection
      feedReasoning(service, block.repeat(6))
      expect(service.getDetectionCount()).toBe(1)

      // Full reset
      service.reset()
      expect(service.getDetectionCount()).toBe(0)
    })
  })

  // ── Detection Count / Escalation ──────────────────────────────────────

  describe("detection count escalation", () => {
    test("increments count on each detection", () => {
      const service = new LoopDetectionService("test-session")

      // First detection
      const block1 = repeatBlock("First loop pattern that will be detected by the detector. ", 100)
      feedReasoning(service, block1.repeat(6))
      expect(service.getDetectionCount()).toBe(1)

      // Reset turn and trigger second detection
      service.turnStarted()
      const block2 = repeatBlock("Second distinct loop pattern for second detection counter. ", 100)
      feedReasoning(service, block2.repeat(6))
      expect(service.getDetectionCount()).toBe(2)
    })
  })
})
