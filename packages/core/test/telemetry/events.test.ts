import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import { logs } from "@opentelemetry/api-logs"
import {
  clearEventTrackingState,
  logOTelEvent,
  logSystemPromptIfNeeded,
  logToolSchemaIfNeeded,
  shortHash,
  truncateContent,
} from "../../src/telemetry/events"
import * as instrumentation from "../../src/telemetry/instrumentation"

describe("events", () => {
  beforeEach(() => {
    clearEventTrackingState()
    spyOn(instrumentation, "isTelemetryEnabled").mockReturnValue(true)
  })

  afterEach(() => {
    mock.restore()
  })

  test("truncateContent correctly truncates massive content", () => {
    const baseContent = "a".repeat(70 * 1024)
    const result = truncateContent(baseContent)

    expect(result.truncated).toBe(true)
    expect(result.content.length).toBeLessThan(70 * 1024)
    expect(result.content).toMatch(/TRUNCATED/)
  })

  test("truncateContent ignores standard content", () => {
    const baseContent = "Short payload"
    const result = truncateContent(baseContent)

    expect(result.truncated).toBe(false)
    expect(result.content).toBe(baseContent)
  })

  test("shortHash yields deterministic result", () => {
    const h1 = shortHash("test data")
    const h2 = shortHash("test data")
    const h3 = shortHash("test data 2")

    expect(h1).toBe(h2)
    expect(h1).not.toBe(h3)
    expect(h1.length).toBe(12)
  })

  test("deduplicates system prompt and tool schema via OpenTelemetry Logger", () => {
    let emitCount = 0
    spyOn(logs, "getLogger").mockReturnValue({
      emit: () => {
        emitCount++
      },
      // biome-ignore lint/suspicious/noExplicitAny: Mocking OpenTelemetry Logger
    } as any)

    // System Prompt
    logSystemPromptIfNeeded("prompt 1")
    expect(emitCount).toBe(1)
    logSystemPromptIfNeeded("prompt 1")
    expect(emitCount).toBe(1) // dedup
    logSystemPromptIfNeeded("prompt 2")
    expect(emitCount).toBe(2)

    // Tool Schema
    const schema1 = '{"prop":1}'
    const schema2 = '{"prop":2}'

    logToolSchemaIfNeeded("test-tool", schema1)
    expect(emitCount).toBe(3)
    logToolSchemaIfNeeded("test-tool", schema1)
    expect(emitCount).toBe(3) // dedup
    logToolSchemaIfNeeded("test-tool", schema2)
    expect(emitCount).toBe(4)
  })

  test("telemetry disabled silences all events", () => {
    spyOn(instrumentation, "isTelemetryEnabled").mockReturnValue(false)

    let emitCount = 0
    spyOn(logs, "getLogger").mockReturnValue({
      emit: () => {
        emitCount++
      },
      // biome-ignore lint/suspicious/noExplicitAny: Mocking OpenTelemetry Logger
    } as any)

    logSystemPromptIfNeeded("prompt 1")
    logToolSchemaIfNeeded("test-tool", '{"prop":1}')
    logOTelEvent("custom_event", { foo: "bar" })

    expect(emitCount).toBe(0)
  })
})
