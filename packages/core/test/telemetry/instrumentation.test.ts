import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"

// Mock the config loader to prevent filesystem I/O from getGlobal() during
// initializeTelemetry. The real loader reads/writes config files and creates
// directories, which is both slow and non-deterministic in a test environment.
mock.module("../../src/config/loader", () => ({
  getGlobal: async () => ({}),
}))

// Mock @langfuse/otel to prevent LangfuseSpanProcessor from opening network
// connections. The production code has hardcoded fallback Langfuse keys, so
// the Langfuse branch always executes regardless of OTEL_TRACES_EXPORTER.
mock.module("@langfuse/otel", () => ({
  LangfuseSpanProcessor: class MockLangfuseSpanProcessor {
    constructor() {}
    onStart() {}
    onEnd() {}
    shutdown() {
      return Promise.resolve()
    }
    forceFlush() {
      return Promise.resolve()
    }
  },
}))

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
    // Clear Langfuse env vars to avoid any env-based initialization paths
    delete process.env.LANGFUSE_PUBLIC_KEY
    delete process.env.LANGFUSE_SECRET_KEY
    delete process.env.LANGFUSE_BASE_URL
    spyOn(perfetto, "initializePerfettoTracing").mockImplementation(() => {})
  })

  afterEach(() => {
    process.env = originalEnv
    mock.restore()
  })

  describe("isTelemetryEnabled", () => {
    beforeEach(() => {
      // Clear config before each test
      applyConfigToEnv({ telemetry: undefined } as unknown as Parameters<typeof applyConfigToEnv>[0])
    })

    test("is enabled by default (no config set)", () => {
      expect(isTelemetryEnabled()).toBe(true)
    })

    test("is disabled when config disabled is true", () => {
      applyConfigToEnv({ telemetry: { disabled: true } } as unknown as Parameters<typeof applyConfigToEnv>[0])
      expect(isTelemetryEnabled()).toBe(false)
    })

    test("is enabled when config disabled is false", () => {
      applyConfigToEnv({ telemetry: { disabled: false } } as unknown as Parameters<typeof applyConfigToEnv>[0])
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
      } as unknown as Parameters<typeof applyConfigToEnv>[0]

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
