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
    // Clear all telemetry env vars for a clean slate each test
    delete process.env.LITEAI_TELEMETRY_DISABLED
    delete process.env.LITEAI_ENABLE_TELEMETRY
    spyOn(perfetto, "initializePerfettoTracing").mockImplementation(() => {})
  })

  afterEach(() => {
    process.env = originalEnv
    mock.restore()
  })

  describe("isTelemetryEnabled (opt-out model)", () => {
    test("is enabled by default (no env vars set)", () => {
      expect(isTelemetryEnabled()).toBe(true)
    })

    test("LITEAI_TELEMETRY_DISABLED=1 disables telemetry", () => {
      process.env.LITEAI_TELEMETRY_DISABLED = "1"
      expect(isTelemetryEnabled()).toBe(false)
    })

    test("LITEAI_TELEMETRY_DISABLED=true disables telemetry", () => {
      process.env.LITEAI_TELEMETRY_DISABLED = "true"
      expect(isTelemetryEnabled()).toBe(false)
    })

    test("LITEAI_TELEMETRY_DISABLED=0 does not disable telemetry", () => {
      process.env.LITEAI_TELEMETRY_DISABLED = "0"
      expect(isTelemetryEnabled()).toBe(true)
    })

    test("legacy LITEAI_ENABLE_TELEMETRY=0 disables telemetry (backward compat)", () => {
      process.env.LITEAI_ENABLE_TELEMETRY = "0"
      expect(isTelemetryEnabled()).toBe(false)
    })

    test("legacy LITEAI_ENABLE_TELEMETRY=false disables telemetry (backward compat)", () => {
      process.env.LITEAI_ENABLE_TELEMETRY = "false"
      expect(isTelemetryEnabled()).toBe(false)
    })

    test("legacy LITEAI_ENABLE_TELEMETRY=1 does not override enabled default", () => {
      process.env.LITEAI_ENABLE_TELEMETRY = "1"
      expect(isTelemetryEnabled()).toBe(true)
    })

    test("LITEAI_TELEMETRY_DISABLED takes precedence over legacy opt-in var", () => {
      process.env.LITEAI_TELEMETRY_DISABLED = "1"
      process.env.LITEAI_ENABLE_TELEMETRY = "1"
      expect(isTelemetryEnabled()).toBe(false)
    })
  })

  test("initializeTelemetry initializes Perfetto and providers", async () => {
    process.env.OTEL_METRICS_EXPORTER = "none"
    process.env.OTEL_LOGS_EXPORTER = "none"
    process.env.OTEL_TRACES_EXPORTER = "none"

    await initializeTelemetry()

    expect(perfetto.initializePerfettoTracing).toHaveBeenCalled()
    expect(isTelemetryEnabled()).toBe(true)

    // Cleanup handler registration works
    let cleaned = false
    registerTelemetryCleanup(async () => {
      cleaned = true
    })

    await shutdownTelemetry()
    expect(cleaned).toBe(true)
  })

  test("flush works safely", async () => {
    await flushTelemetry()
    expect(true).toBe(true)
  })
})
