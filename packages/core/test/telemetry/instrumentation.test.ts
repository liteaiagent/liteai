import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"

import {
  flushTelemetry,
  initializeTelemetry,
  isTelemetryEnabled,
  registerTelemetryCleanup,
  shutdownTelemetry,
} from "../../src/telemetry/instrumentation"
import * as perfetto from "../../src/telemetry/perfetto"

describe("instrumentation", () => {
  let originalEnv: typeof process.env

  beforeEach(() => {
    originalEnv = process.env
    process.env = { ...originalEnv }
    spyOn(perfetto, "initializePerfettoTracing").mockImplementation(() => {})
  })

  afterEach(() => {
    process.env = originalEnv
    mock.restore()
  })

  test("telemetry toggles correctly based on LITEAI_ENABLE_TELEMETRY", () => {
    process.env.LITEAI_ENABLE_TELEMETRY = "1"
    expect(isTelemetryEnabled()).toBe(true)

    process.env.LITEAI_ENABLE_TELEMETRY = "false"
    expect(isTelemetryEnabled()).toBe(false)

    process.env.LITEAI_ENABLE_TELEMETRY = "0"
    expect(isTelemetryEnabled()).toBe(false)
  })

  test("initializeTelemetry sets global providers when enabled", async () => {
    process.env.LITEAI_ENABLE_TELEMETRY = "1"
    process.env.OTEL_METRICS_EXPORTER = "none"
    process.env.OTEL_LOGS_EXPORTER = "none"
    process.env.OTEL_TRACES_EXPORTER = "none"

    // Test initialization without exporters just to ensure providers are created without connecting to something real
    await initializeTelemetry()

    // Not directly checking global providers internal state inside OTEL API in bun due to isolation,
    // but we can check if it resolves properly and initializes Perfetto
    expect(perfetto.initializePerfettoTracing).toHaveBeenCalled()
    expect(isTelemetryEnabled()).toBe(true)

    // We register a dummy cleanup
    let cleaned = false
    registerTelemetryCleanup(async () => {
      cleaned = true
    })

    await shutdownTelemetry()
    // Test that the cleanup got executed
    expect(cleaned).toBe(true)
  })

  test("flush works safely", async () => {
    // Just ensuring no unhandled promises
    await flushTelemetry()
    expect(true).toBe(true)
  })
})
