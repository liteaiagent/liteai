import { LangfuseSpanProcessor } from "@langfuse/otel"
import { DiagConsoleLogger, DiagLogLevel, diag, metrics } from "@opentelemetry/api"
import { logs } from "@opentelemetry/api-logs"
import { envDetector, hostDetector, osDetector, resourceFromAttributes } from "@opentelemetry/resources"
import { BatchLogRecordProcessor, LoggerProvider } from "@opentelemetry/sdk-logs"
import { MeterProvider } from "@opentelemetry/sdk-metrics"
import { NodeSDK } from "@opentelemetry/sdk-node"
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base"
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
let globalMeterProvider: MeterProvider | undefined
let globalLoggerProvider: LoggerProvider | undefined
let globalNodeSdk: NodeSDK | undefined

export async function initializeTelemetry() {
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
    const globalConfig = await getGlobal()
    applyConfigToEnv(globalConfig)
  } catch (error) {}

  const telemetryEnabled = isTelemetryEnabled()

  // Initialize Perfetto tracing (independent of OTEL)
  initializePerfettoTracing(globalTelemetryConfig?.perfetto)

  const readers = []

  if (telemetryEnabled) {
    readers.push(...(await getOtlpReaders(globalTelemetryConfig?.otel)))
  }

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

  if (telemetryEnabled) {
    const logExporters = await getOtlpLogExporters(globalTelemetryConfig?.otel)

    if (logExporters.length > 0) {
      const loggerProvider = new LoggerProvider({
        resource,
        processors: logExporters.map(
          (exporter) =>
            new BatchLogRecordProcessor(exporter, {
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
    const langfusePublicKey = globalTelemetryConfig?.langfuse?.publicKey || process.env.LANGFUSE_PUBLIC_KEY
    const langfuseSecretKey = globalTelemetryConfig?.langfuse?.secretKey || process.env.LANGFUSE_SECRET_KEY
    const langfuseBaseUrl = globalTelemetryConfig?.langfuse?.baseUrl || "https://langfuse.smartnest.info"

    const spanProcessors: Array<any> = []

    if (langfusePublicKey && langfuseSecretKey) {
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
        shouldExportSpan: (span: any) => {
          const targetSpan = span.otelSpan || span
          const scope = targetSpan.instrumentationScope?.name || targetSpan.instrumentationLibrary?.name
          return scope === "ai" || scope === "liteai"
        },
      })

      spanProcessors.push(langfuseProcessor)
    } else {
    }

    const traceExporters = await getOtlpTraceExporters(globalTelemetryConfig?.otel)
    for (const exporter of traceExporters) {
      spanProcessors.push(
        new BatchSpanProcessor(exporter, {
          scheduledDelayMillis: parseInt(
            globalTelemetryConfig?.otel?.exportIntervalMs?.toString() ?? DEFAULT_TRACES_EXPORT_INTERVAL_MS.toString(),
            10,
          ),
        }),
      )
    }

    if (spanProcessors.length > 0) {
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
  } catch (error) {}
}
