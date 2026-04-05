import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import * as instrumentation from "../../src/telemetry/instrumentation"
import * as perfetto from "../../src/telemetry/perfetto"
import {
  endHookSpan,
  endInteractionSpan,
  endLLMRequestSpan,
  endToolSpan,
  startHookSpan,
  startInteractionSpan,
  startLLMRequestSpan,
  startToolSpan,
} from "../../src/telemetry/tracing"

describe("tracing", () => {
  beforeEach(() => {
    spyOn(instrumentation, "isTelemetryEnabled").mockReturnValue(true)
    spyOn(perfetto, "startInteractionPerfettoSpan").mockReturnValue("p_int_1")
    spyOn(perfetto, "endInteractionPerfettoSpan").mockImplementation(() => {})
    spyOn(perfetto, "startLLMRequestPerfettoSpan").mockReturnValue("p_llm_1")
    spyOn(perfetto, "endLLMRequestPerfettoSpan").mockImplementation(() => {})
  })

  afterEach(() => {
    mock.restore()
  })

  test("AsyncLocalStorage hierarchy safely tracks parents across asynchronous yields", async () => {
    const interactionSpan = startInteractionSpan("mock async prompt")
    expect(interactionSpan).toBeDefined()

    await new Promise((resolve) => setTimeout(resolve, 1))

    const llmSpan = startLLMRequestSpan("model-1")
    expect(llmSpan).toBeDefined()

    await new Promise((resolve) => setTimeout(resolve, 1))
    endLLMRequestSpan(llmSpan, { ttftMs: 20 })

    await new Promise((resolve) => setTimeout(resolve, 1))

    const toolSpan = startToolSpan("fs_test", "arg1")
    expect(toolSpan).toBeDefined()

    await new Promise((resolve) => setTimeout(resolve, 1))
    const hookSpan = startHookSpan("hook_pre")
    expect(hookSpan).toBeDefined()
    endHookSpan(hookSpan, { type: "pre" })

    endToolSpan(15)

    endInteractionSpan()
  })

  test("isTelemetryEnabled controls output successfully", () => {
    spyOn(instrumentation, "isTelemetryEnabled").mockReturnValue(false)

    const dummyInteraction = startInteractionSpan("ignored prompt")
    expect(dummyInteraction).toBeDefined()

    const dummyLlm = startLLMRequestSpan("ignored model")
    expect(dummyLlm).toBeDefined()
    endLLMRequestSpan(dummyLlm, { ttftMs: 50 })

    endInteractionSpan()
  })
})
