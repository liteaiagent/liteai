import { describe, expect, test } from "bun:test"
import type { ExitSummaryData } from "../../src/tui/util/exit-summary"
import { formatDuration, formatExitSummary } from "../../src/tui/util/exit-summary"

describe("formatDuration", () => {
  test("returns 0s for zero or negative", () => {
    expect(formatDuration(0)).toBe("0s")
    expect(formatDuration(-100)).toBe("0s")
  })

  test("returns milliseconds for sub-second", () => {
    expect(formatDuration(500)).toBe("500ms")
    expect(formatDuration(50)).toBe("50ms")
  })

  test("returns seconds with one decimal for < 60s", () => {
    expect(formatDuration(1500)).toBe("1.5s")
    expect(formatDuration(30000)).toBe("30.0s")
  })

  test("formats minutes and seconds", () => {
    expect(formatDuration(90_000)).toBe("1m 30s")
    expect(formatDuration(120_000)).toBe("2m")
    expect(formatDuration(65_000)).toBe("1m 5s")
  })

  test("formats hours, minutes, seconds", () => {
    expect(formatDuration(3_661_000)).toBe("1h 1m 1s")
    expect(formatDuration(7_200_000)).toBe("2h")
    expect(formatDuration(3_660_000)).toBe("1h 1m")
  })
})

describe("formatExitSummary", () => {
  const base: ExitSummaryData = {
    modelID: "gemini/gemini-2.5-pro",
    turnCount: 5,
    toolCalls: { total: 10, success: 8, failed: 2 },
    contextUtilization: 0.45,
    totalCost: 0.042,
    durationMs: 202_000,
    sessionID: "abc-123",
  }

  test("returns empty string for empty sessions", () => {
    const empty: ExitSummaryData = {
      turnCount: 0,
      toolCalls: { total: 0, success: 0, failed: 0 },
      contextUtilization: 0,
      totalCost: null,
      durationMs: 0,
    }
    expect(formatExitSummary(empty)).toBe("")
  })

  test("includes model ID when provided", () => {
    const summary = formatExitSummary(base)
    expect(summary).toContain("gemini/gemini-2.5-pro")
  })

  test("includes turn count", () => {
    const summary = formatExitSummary(base)
    expect(summary).toContain("Messages:     5")
  })

  test("includes tool call breakdown", () => {
    const summary = formatExitSummary(base)
    expect(summary).toContain("Tool Calls:")
    expect(summary).toContain("10")
  })

  test("includes context utilization percentage", () => {
    const summary = formatExitSummary(base)
    expect(summary).toContain("45%")
  })

  test("includes cost when non-null and positive", () => {
    const summary = formatExitSummary(base)
    expect(summary).toContain("$0.042")
  })

  test("omits cost when null", () => {
    const summary = formatExitSummary({ ...base, totalCost: null })
    expect(summary).not.toContain("Cost:")
  })

  test("omits cost when zero", () => {
    const summary = formatExitSummary({ ...base, totalCost: 0 })
    expect(summary).not.toContain("Cost:")
  })

  test("includes formatted duration", () => {
    const summary = formatExitSummary(base)
    expect(summary).toContain("3m 22s")
  })

  test("includes resume command with session ID", () => {
    const summary = formatExitSummary(base)
    expect(summary).toContain("liteai --resume abc-123")
  })

  test("omits resume when no session ID", () => {
    const summary = formatExitSummary({ ...base, sessionID: undefined })
    expect(summary).not.toContain("resume")
  })

  test("uses ASCII box chars when LITEAI_ASCII=1", () => {
    const prev = process.env.LITEAI_ASCII
    try {
      process.env.LITEAI_ASCII = "1"
      const summary = formatExitSummary(base)
      expect(summary).toContain("+")
      expect(summary).toContain("|")
      expect(summary).not.toContain("┌")
      expect(summary).not.toContain("│")
    } finally {
      if (prev === undefined) delete process.env.LITEAI_ASCII
      else process.env.LITEAI_ASCII = prev
    }
  })

  test("handles zero tool calls gracefully", () => {
    const data: ExitSummaryData = {
      ...base,
      toolCalls: { total: 0, success: 0, failed: 0 },
    }
    const summary = formatExitSummary(data)
    expect(summary).not.toContain("Tool Calls:")
  })

  test("shows resume hint for session-only data", () => {
    const data: ExitSummaryData = {
      turnCount: 0,
      toolCalls: { total: 0, success: 0, failed: 0 },
      contextUtilization: 0,
      totalCost: null,
      durationMs: 0,
      sessionID: "my-session",
    }
    const summary = formatExitSummary(data)
    expect(summary).toContain("liteai --resume my-session")
  })
})
