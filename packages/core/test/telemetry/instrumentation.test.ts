import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"

import {
  applyConfigToEnv,
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

  describe("isTelemetryEnabled", () => {
    beforeEach(() => {
      // Clear config before each test
      applyConfigToEnv({ telemetry: undefined } as any)
    })

    test("is enabled by default (no config set)", () => {
      expect(isTelemetryEnabled()).toBe(true)
    })

    test("is disabled when config disabled is true", () => {
      applyConfigToEnv({ telemetry: { disabled: true } } as any)
      expect(isTelemetryEnabled()).toBe(false)
    })

    test("is enabled when config disabled is false", () => {
      applyConfigToEnv({ telemetry: { disabled: false } } as any)
      expect(isTelemetryEnabled()).toBe(true)
    })
  })

  describe("applyConfigToEnv", () => {
    test("sets the internal globalTelemetryConfig state", () => {
      const mockConfig = {
        telemetry: {
          disabled: true,
          langfuse: { publicKey: "pk" },
        },
      } as any

      applyConfigToEnv(mockConfig)
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
