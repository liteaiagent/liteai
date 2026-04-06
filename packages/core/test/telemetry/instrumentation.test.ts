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
  })

  describe("applyConfigToEnv", () => {
    test("clears prior telemetry environment variables before applying config", () => {
      process.env.LANGFUSE_SECRET_KEY = "old_secret_key"
      process.env.OTEL_TRACES_EXPORTER = "old_traces_ex"
      process.env.LITEAI_ENABLE_TELEMETRY = "1"

      // Apply empty config
      applyConfigToEnv({} as Config.Info)

      expect(process.env.LANGFUSE_SECRET_KEY).toBeUndefined()
      expect(process.env.OTEL_TRACES_EXPORTER).toBeUndefined()
      expect(process.env.LITEAI_ENABLE_TELEMETRY).toBeUndefined()
    })

    test("sets Langfuse variables correctly", () => {
      applyConfigToEnv({
        telemetry: {
          langfuse: {
            publicKey: "pk",
            secretKey: "sk",
            baseUrl: "https://lf.tld",
          },
        },
      } as Config.Info)

      expect(process.env.LANGFUSE_PUBLIC_KEY).toBe("pk")
      expect(process.env.LANGFUSE_SECRET_KEY).toBe("sk")
      expect(process.env.LANGFUSE_BASEURL).toBe("https://lf.tld")
      expect(process.env.LANGFUSE_HOST).toBe("https://lf.tld")
      expect(process.env.LITEAI_TELEMETRY_DISABLED).toBe("0")
    })

    test("sets OTEL variables correctly", () => {
      applyConfigToEnv({
        telemetry: {
          otel: {
            endpoint: "http://otel",
            protocol: "grpc",
            traceExporter: "ok",
            metricExporter: "ok2",
            exportIntervalMs: 5000,
          },
        },
      } as Config.Info)

      expect(process.env.OTEL_EXPORTER_OTLP_ENDPOINT).toBe("http://otel")
      expect(process.env.OTEL_EXPORTER_OTLP_PROTOCOL).toBe("grpc")
      expect(process.env.OTEL_TRACES_EXPORTER).toBe("ok")
      expect(process.env.OTEL_METRICS_EXPORTER).toBe("ok2")
      expect(process.env.OTEL_METRIC_EXPORT_INTERVAL).toBe("5000")
      expect(process.env.OTEL_LOGS_EXPORT_INTERVAL).toBe("5000")
      expect(process.env.OTEL_TRACES_EXPORT_INTERVAL).toBe("5000")
      expect(process.env.LITEAI_TELEMETRY_DISABLED).toBe("0")
    })

    test("sets LITEAI_TELEMETRY_DISABLED=1 if disabled in config", () => {
      applyConfigToEnv({ telemetry: { disabled: true } } as Config.Info)
      expect(process.env.LITEAI_TELEMETRY_DISABLED).toBe("1")
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
