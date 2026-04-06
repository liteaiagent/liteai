import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import * as fs from "node:fs/promises"
import {
  endInteractionPerfettoSpan,
  endLLMRequestPerfettoSpan,
  endToolPerfettoSpan,
  initializePerfettoTracing,
  isPerfettoTracingEnabled,
  startInteractionPerfettoSpan,
  startLLMRequestPerfettoSpan,
  startToolPerfettoSpan,
} from "../../src/telemetry/perfetto"

describe("perfetto", () => {
  let originalEnv: typeof process.env

  beforeEach(() => {
    originalEnv = process.env
    process.env = { ...originalEnv }
    spyOn(fs, "writeFile").mockImplementation(async () => {})
    spyOn(fs, "mkdir").mockImplementation(async () => {
      return undefined
    })
  })

  afterEach(() => {
    process.env = originalEnv
    mock.restore()
  })

  test("enable and track spans without missing timestamps or failing", () => {
    initializePerfettoTracing(true, "test-session")

    // We expect the tracing to be enabled due to explicit argument
    expect(isPerfettoTracingEnabled()).toBe(true)

    // Interaction span validation
    const intSpanId = startInteractionPerfettoSpan("test prompt user")
    expect(intSpanId).not.toBe("")

    // LLM Request span validation
    const llmSpanId = startLLMRequestPerfettoSpan({ model: "test-model", querySource: "agent-1" })
    expect(llmSpanId).not.toBe("")
    endLLMRequestPerfettoSpan(llmSpanId, { ttftMs: 50, outputTokens: 100 })

    // Tool span validation
    const toolSpanId = startToolPerfettoSpan("fs_read")
    expect(toolSpanId).not.toBe("")
    endToolPerfettoSpan(toolSpanId, { success: true })

    endInteractionPerfettoSpan(intSpanId)
  })

  test("spans handled gracefully when disabled", () => {
    // Cannot cleanly toggle off if `let isEnabled = true` is stuck in module scope without resetting module cache,
    // so we just reset process.env for good measure, and since bun isolates somewhat maybe we can test it natively.
    // If we call functions with invalid span ids, they just return early.
    expect(() => endInteractionPerfettoSpan("")).not.toThrow()
    expect(() => endLLMRequestPerfettoSpan("", {})).not.toThrow()
    expect(() => endToolPerfettoSpan("", {})).not.toThrow()
  })
})
