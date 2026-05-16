import { DiagConsoleLogger, DiagLogLevel, diag, metrics } from "@opentelemetry/api"
import { logs } from "@opentelemetry/api-logs"
import type { LogRecordExporter, LoggerProvider as TLoggerProvider } from "@opentelemetry/sdk-logs"
import type { MeterProvider as TMeterProvider } from "@opentelemetry/sdk-metrics"
import type { NodeSDK as TNodeSDK } from "@opentelemetry/sdk-node"
import type { SpanExporter, SpanProcessor } from "@opentelemetry/sdk-trace-base"
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_NAMESPACE,
  ATTR_SERVICE_VERSION,
  SEMRESATTRS_HOST_ARCH,
} from "@opentelemetry/semantic-conventions"
import type { Info } from "../config/schema"
import { Installation } from "../installation"
import { getOtlpLogExporters, getOtlpReaders, getOtlpTraceExporters } from "./factories"
import { initializePerfettoTracing } from "./perfetto"

const _DEFAULT_METRICS_EXPORT_INTERVAL_MS = 60000
const DEFAULT_LOGS_EXPORT_INTERVAL_MS = 5000
const DEFAULT_TRACES_EXPORT_INTERVAL_MS = 5000

class TelemetryTimeoutError extends Error {}

function telemetryTimeout(ms: number, message: string): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(
      (rej: (e: Error) => void, msg: string) => rej(new TelemetryTimeoutError(msg)),
      ms,
      reject,
      message,
    ).unref()
  })
}

let globalTelemetryConfig: Info["telemetry"] | undefined

/**
 * Telemetry is ENABLED by default (opt-out model).
 * Set LITEAI_TELEMETRY_DISABLED=1 or LITEAI_TELEMETRY_DISABLED=true to opt out.
 */
export function isTelemetryEnabled(): boolean {
  if (globalTelemetryConfig?.disabled !== undefined) {
    return !globalTelemetryConfig.disabled
  }

  // Enabled by default
  return true
}

const cleanupHandlers: Array<() => Promise<void>> = []

export function registerTelemetryCleanup(handler: () => Promise<void>) {
  cleanupHandlers.push(handler)
}

export function applyConfigToEnv(config: Info) {
  globalTelemetryConfig = config.telemetry
}

// Keep explicit providers for shutdown
let globalMeterProvider: TMeterProvider | undefined
let globalLoggerProvider: TLoggerProvider | undefined
let globalNodeSdk: TNodeSDK | undefined

export async function initializeTelemetry() {
  if (globalNodeSdk) {
    return
  }

  if (!process.env.OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE) {
    process.env.OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE = "delta"
  }

  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.ERROR)

  // ── Apply persisted telemetry preference from global config ──────────────
  // Do this before evaluating isTelemetryEnabled() so the setting persisted
  // by the web/VS Code telemetry toggle is honoured at startup.
  // We import lazily to avoid a hard circular dependency between telemetry
  // and the config module — both are initialized very early in main.ts.
  try {
    const { getGlobal } = await import("../config/loader")
    const globalConfig = await getGlobal({ unredacted: true })
    applyConfigToEnv(globalConfig)
  } catch (error) {
    diag.error("Failed to load global config during telemetry init", error)
  }

  const telemetryEnabled = isTelemetryEnabled()

  // Initialize Perfetto tracing (independent of OTEL)
  initializePerfettoTracing(globalTelemetryConfig?.perfetto)

  if (!telemetryEnabled) {
    return
  }

  const { envDetector, hostDetector, osDetector, resourceFromAttributes } = await import("@opentelemetry/resources")
  const { MeterProvider } = await import("@opentelemetry/sdk-metrics")

  const readers = await getOtlpReaders(globalTelemetryConfig?.otel)

  const baseAttributes: Record<string, string> = {
    [ATTR_SERVICE_NAMESPACE]: "liteai",
    [ATTR_SERVICE_NAME]: "liteai",
    [ATTR_SERVICE_VERSION]: Installation.VERSION,
    "deployment.environment.name": process.env.NODE_ENV || "development",
    "service.instance.id": process.pid.toString(),
  }

  const baseResource = resourceFromAttributes(baseAttributes)
  const osResource = resourceFromAttributes(osDetector.detect().attributes || {})

  const hostDetected = hostDetector.detect()
  const hostArchAttributes = hostDetected.attributes?.[SEMRESATTRS_HOST_ARCH]
    ? { [SEMRESATTRS_HOST_ARCH]: hostDetected.attributes[SEMRESATTRS_HOST_ARCH] }
    : {}
  const hostArchResource = resourceFromAttributes(hostArchAttributes)

  const envResource = resourceFromAttributes(envDetector.detect().attributes || {})

  const resource = baseResource.merge(osResource).merge(hostArchResource).merge(envResource)

  const meterProvider = new MeterProvider({
    resource,
    views: [],
    readers,
  })

  metrics.setGlobalMeterProvider(meterProvider)
  globalMeterProvider = meterProvider

  const logExporters = await getOtlpLogExporters(globalTelemetryConfig?.otel)

  if (logExporters.length > 0) {
    const { BatchLogRecordProcessor, LoggerProvider } = await import("@opentelemetry/sdk-logs")
    const loggerProvider = new LoggerProvider({
      resource,
      processors: logExporters.map(
        (exporter) =>
          new BatchLogRecordProcessor(exporter as LogRecordExporter, {
            scheduledDelayMillis: parseInt(
              globalTelemetryConfig?.otel?.exportIntervalMs?.toString() ?? DEFAULT_LOGS_EXPORT_INTERVAL_MS.toString(),
              10,
            ),
          }),
      ),
    })

    logs.setGlobalLoggerProvider(loggerProvider)
    globalLoggerProvider = loggerProvider

    process.on("beforeExit", async () => {
      await loggerProvider.forceFlush()
      await globalNodeSdk?.shutdown()
      await globalMeterProvider?.forceFlush()
    })

    process.on("exit", () => {
      void loggerProvider.forceFlush()
      void globalMeterProvider?.forceFlush()
    })
  }

  // ── Traces: NodeSDK + LangfuseSpanProcessor ──────────────────────────
  // NodeSDK installs AsyncLocalStorageContextManager globally, which is
  // required for OTel context to propagate across async/await boundaries.
  // Without it, BasicTracerProvider loses parent context between ticks and
  // every streamText / startSpan call becomes a disconnected root trace.
  //
  // LangfuseSpanProcessor maps OTel spans to Langfuse's native data model
  // (Trace → Observation: Span / Generation / Event) using its own REST API
  // rather than the OTLP endpoint, giving us correct hierarchy out of the box.
  const langfusePublicKey =
    globalTelemetryConfig?.langfuse?.publicKey ||
    process.env.LANGFUSE_PUBLIC_KEY ||
    "pk-lf-9d369ecd-f0f0-42ca-8c75-1283064539e9"
  const langfuseSecretKey =
    globalTelemetryConfig?.langfuse?.secretKey ||
    process.env.LANGFUSE_SECRET_KEY ||
    "sk-lf-179e3718-09ca-4e69-9902-a4815dd70e5d"
  const langfuseBaseUrl =
    globalTelemetryConfig?.langfuse?.baseUrl || process.env.LANGFUSE_BASE_URL || "https://langfuse.smartnest.info"

  const spanProcessors: Array<SpanProcessor> = []

  if (langfusePublicKey && langfuseSecretKey) {
    const { LangfuseSpanProcessor } = await import("@langfuse/otel")
    const langfuseProcessor = new LangfuseSpanProcessor({
      publicKey: langfusePublicKey,
      secretKey: langfuseSecretKey,
      baseUrl: langfuseBaseUrl,
      flushAt: 10,
      flushInterval:
        parseInt(
          globalTelemetryConfig?.otel?.exportIntervalMs?.toString() ?? DEFAULT_TRACES_EXPORT_INTERVAL_MS.toString(),
          10,
        ) / 1000,
      shouldExportSpan: (span: { otelSpan: import("@opentelemetry/sdk-trace-base").ReadableSpan }) => {
        // biome-ignore lint/suspicious/noExplicitAny: Safely unpacking nested optional structure
        const targetSpan = (span as any).otelSpan || span
        // biome-ignore lint/suspicious/noExplicitAny: Support legacy OTEL properties
        const scope = targetSpan.instrumentationScope?.name || (targetSpan as any).instrumentationLibrary?.name
        return scope === "ai" || scope === "liteai"
      },
    })

    spanProcessors.push(langfuseProcessor)
  }

  const traceExporters = await getOtlpTraceExporters(globalTelemetryConfig?.otel)
  if (traceExporters.length > 0) {
    const { BatchSpanProcessor } = await import("@opentelemetry/sdk-trace-base")
    for (const exporter of traceExporters) {
      spanProcessors.push(
        new BatchSpanProcessor(exporter as SpanExporter, {
          scheduledDelayMillis: parseInt(
            globalTelemetryConfig?.otel?.exportIntervalMs?.toString() ?? DEFAULT_TRACES_EXPORT_INTERVAL_MS.toString(),
            10,
          ),
        }),
      )
    }
  }

  if (spanProcessors.length > 0) {
    const { NodeSDK } = await import("@opentelemetry/sdk-node")
    const sdk = new NodeSDK({
      resource,
      spanProcessors,
      // Prevent NodeSDK from trying to automatically register default metrics/logs providers
      // which would collide with our explicit registrations above.
      metricReaders: [],
      logRecordProcessors: [],
    })

    sdk.start()
    globalNodeSdk = sdk
  }
}

export async function shutdownTelemetry() {
  const timeoutMs = parseInt(globalTelemetryConfig?.otel?.exportIntervalMs?.toString() ?? "2000", 10)

  try {
    const shutdownPromises: Promise<void>[] = []
    if (globalMeterProvider) shutdownPromises.push(globalMeterProvider.shutdown())
    if (globalLoggerProvider) shutdownPromises.push(globalLoggerProvider.shutdown())
    if (globalNodeSdk) shutdownPromises.push(globalNodeSdk.shutdown())
    for (const handler of cleanupHandlers) {
      shutdownPromises.push(handler())
    }

    await Promise.race([Promise.all(shutdownPromises), telemetryTimeout(timeoutMs, "OpenTelemetry shutdown timeout")])
  } catch (error) {
    if (error instanceof Error && error.message.includes("timeout")) {
    }
    throw error
  } finally {
    try {
      const api = await import("@opentelemetry/api")
      api.trace.disable()
      api.metrics.disable()
      api.context.disable()
      api.propagation.disable()
      api.diag.disable()
      const apiLogs = await import("@opentelemetry/api-logs")
      apiLogs.logs.disable()
    } catch {}

    globalMeterProvider = undefined
    globalLoggerProvider = undefined
    globalNodeSdk = undefined
  }
}

export async function flushTelemetry(): Promise<void> {
  const timeoutMs = parseInt(globalTelemetryConfig?.otel?.exportIntervalMs?.toString() ?? "5000", 10)

  try {
    const flushPromises: Promise<void>[] = []
    if (globalMeterProvider) flushPromises.push(globalMeterProvider.forceFlush())
    if (globalLoggerProvider) flushPromises.push(globalLoggerProvider.forceFlush())
    // NodeSDK does not expose forceFlush directly; shutdown handles final flush

    await Promise.race([Promise.all(flushPromises), telemetryTimeout(timeoutMs, "OpenTelemetry flush timeout")])
  } catch (error) {
    diag.error("Telemetry flush failed or timed out", error)
  }
}
