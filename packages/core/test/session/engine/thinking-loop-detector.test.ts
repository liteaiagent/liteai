import { describe, expect, test } from "bun:test"
import { ThinkingLoopDetector } from "../../../src/session/engine/thinking-loop-detector"

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Generate a deterministic repeated block of exactly `chars` characters */
function repeatBlock(seed: string, chars: number): string {
  let result = ""
  while (result.length < chars) {
    result += seed
  }
  return result.slice(0, chars)
}

/** Feed a string through the detector in small deltas (simulating streaming) */
function feedStreaming(detector: ThinkingLoopDetector, text: string, chunkSize = 15) {
  for (let i = 0; i < text.length; i += chunkSize) {
    const result = detector.addReasoningDelta(text.slice(i, i + chunkSize))
    if (result.detected) return result
  }
  return { detected: false as const }
}

describe("ThinkingLoopDetector", () => {
  // ── Detection Tests ─────────────────────────────────────────────────────

  test("detects repeated 100-char blocks at threshold 5", () => {
    const detector = new ThinkingLoopDetector()
    // A 100-char block repeated 5 times = 500 chars
    const block = repeatBlock("I'm going to run the command now. Let me execute the tool. ", 100)
    const text = block.repeat(6)

    const result = feedStreaming(detector, text)
    expect(result.detected).toBe(true)
    if (result.detected) {
      expect(result.chunkCount).toBeGreaterThanOrEqual(5)
      expect(result.detail).toContain("repeated")
    }
  })

  test("detects loop when fed as many small deltas", () => {
    const detector = new ThinkingLoopDetector()
    const block = repeatBlock("Verifying the execution plan. Now I'll proceed with the next step. ", 100)

    // Feed 6 repetitions character-by-character
    for (let rep = 0; rep < 6; rep++) {
      for (let i = 0; i < block.length; i++) {
        const result = detector.addReasoningDelta(block[i])
        if (result.detected) {
          expect(result.detail).toContain("repeated")
          return
        }
      }
    }
    // Should have detected by now
    expect(true).toBe(false) // fail if we get here
  })

  // ── No False Positive Tests ─────────────────────────────────────────────

  test("does not detect loop for varied content", () => {
    const detector = new ThinkingLoopDetector()
    // Each paragraph is unique
    const paragraphs = Array.from({ length: 10 }, (_, i) =>
      repeatBlock(`Paragraph ${i}: unique content with different words and ideas number ${i * 37}. `, 100),
    )
    const text = paragraphs.join("")

    const result = feedStreaming(detector, text)
    expect(result.detected).toBe(false)
  })

  test("does not detect loop for content under threshold", () => {
    const detector = new ThinkingLoopDetector()
    // Only 4 repetitions (threshold is 5)
    const block = repeatBlock("This is a repeated block of text that might look suspicious. ", 100)
    const text = block.repeat(4)

    const result = feedStreaming(detector, text)
    expect(result.detected).toBe(false)
  })

  test("does not false-positive on short similar prefixes", () => {
    const detector = new ThinkingLoopDetector()
    // Similar starts but different endings (none should form identical 100-char chunks)
    const blocks = Array.from(
      { length: 10 },
      (_, i) =>
        `Step ${i + 1}: I'm analyzing the problem. ` +
        `The specific detail for iteration ${i} is ${Math.random().toString(36).slice(2, 20)}. ` +
        `Continuing with unique reasoning path ${i * 13}... `,
    )
    const text = blocks.join("")

    const result = feedStreaming(detector, text)
    expect(result.detected).toBe(false)
  })

  // ── Buffer Truncation Tests ─────────────────────────────────────────────

  test("buffer truncation preserves detection across boundary", () => {
    const detector = new ThinkingLoopDetector()

    // Feed a large amount of unique content to trigger truncation
    const unique = Array.from({ length: 120 }, (_, i) =>
      repeatBlock(`Unique paragraph number ${i} with distinct content ${i * 7}. `, 100),
    ).join("")
    feedStreaming(detector, unique)

    // Now feed repeated content — should still detect despite truncation
    const block = repeatBlock("After truncation this block repeats over and over again. ", 100)
    const result = feedStreaming(detector, block.repeat(6))
    expect(result.detected).toBe(true)
  })

  // ── Reset Tests ─────────────────────────────────────────────────────────

  test("reset clears all state", () => {
    const detector = new ThinkingLoopDetector()
    const block = repeatBlock("Repetitive thinking content for testing reset behavior. ", 100)

    // Feed 3 repetitions
    feedStreaming(detector, block.repeat(3))
    expect(detector.getStats().totalChunks).toBeGreaterThan(0)

    // Reset
    detector.reset()
    const stats = detector.getStats()
    expect(stats.bufferLength).toBe(0)
    expect(stats.uniqueHashes).toBe(0)
    expect(stats.totalChunks).toBe(0)
    expect(stats.detected).toBe(false)
  })

  test("reset allows re-detection after clearing", () => {
    const detector = new ThinkingLoopDetector()
    const block = repeatBlock("First loop content that will be detected and then reset. ", 100)

    // Detect first loop
    const result1 = feedStreaming(detector, block.repeat(6))
    expect(result1.detected).toBe(true)

    // Reset and feed new different repeated content
    detector.reset()
    const block2 = repeatBlock("Second different loop content post-reset should also detect. ", 100)
    const result2 = feedStreaming(detector, block2.repeat(6))
    expect(result2.detected).toBe(true)
  })

  // ── Stats Tests ─────────────────────────────────────────────────────────

  test("getStats returns accurate buffer state", () => {
    const detector = new ThinkingLoopDetector()

    const initial = detector.getStats()
    expect(initial.bufferLength).toBe(0)
    expect(initial.uniqueHashes).toBe(0)
    expect(initial.detected).toBe(false)

    // Feed 250 chars = 2 full chunks + 50 leftover
    detector.addReasoningDelta("x".repeat(250))
    const after = detector.getStats()
    expect(after.bufferLength).toBe(50)
    expect(after.totalChunks).toBe(2)
    // Both chunks are identical ("xxxx...x") so only 1 unique hash
    expect(after.uniqueHashes).toBe(1)
  })

  // ── Idempotency After Detection ─────────────────────────────────────────

  test("returns detected=true on subsequent calls after detection", () => {
    const detector = new ThinkingLoopDetector()
    const block = repeatBlock("Looping content that triggers detection on the fifth repeat. ", 100)

    feedStreaming(detector, block.repeat(6))

    // Subsequent calls should still report detected
    const result = detector.addReasoningDelta("more text")
    expect(result.detected).toBe(true)
  })

  // ── Edge Cases ──────────────────────────────────────────────────────────

  test("handles empty string input gracefully", () => {
    const detector = new ThinkingLoopDetector()
    const result = detector.addReasoningDelta("")
    expect(result.detected).toBe(false)
    expect(detector.getStats().bufferLength).toBe(0)
  })

  test("handles input shorter than chunk size", () => {
    const detector = new ThinkingLoopDetector()
    const result = detector.addReasoningDelta("short")
    expect(result.detected).toBe(false)
    expect(detector.getStats().bufferLength).toBe(5)
  })

  test("handles exact chunk boundary input", () => {
    const detector = new ThinkingLoopDetector()
    const result = detector.addReasoningDelta("x".repeat(100))
    expect(result.detected).toBe(false)
    expect(detector.getStats().bufferLength).toBe(0) // fully consumed
    expect(detector.getStats().totalChunks).toBe(1)
  })
})
