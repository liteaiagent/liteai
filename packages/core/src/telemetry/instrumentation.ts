import { DiagConsoleLogger, DiagLogLevel, diag, metrics } from "@opentelemetry/api"
import { logs } from "@opentelemetry/api-logs"
import { envDetector, hostDetector, osDetector, resourceFromAttributes } from "@opentelemetry/resources"
import {
  BatchLogRecordProcessor,
  ConsoleLogRecordExporter,
  LoggerProvider,
  type LogRecordExporter,
  type ReadableLogRecord,
} from "@opentelemetry/sdk-logs"
import {
  ConsoleMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
  type PushMetricExporter,
  type ResourceMetrics,
} from "@opentelemetry/sdk-metrics"
import { NodeSDK } from "@opentelemetry/sdk-node"
import { LangfuseSpanProcessor } from "@langfuse/otel"
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION, SEMRESATTRS_HOST_ARCH } from "@opentelemetry/semantic-conventions"

import { Installation } from "../installation"
import { Log } from "../util/log"
import { initializePerfettoTracing } from "./perfetto"

const log = Log.create({ service: "telemetry" })

const DEFAULT_METRICS_EXPORT_INTERVAL_MS = 60000
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

function parseExporterTypes(value: string | undefined): string[] {
  return (value || "")
    .trim()
    .split(",")
    .filter(Boolean)
    .map((t) => t.trim())
    .filter((t) => t !== "none")
}

async function getOtlpReaders() {
  const exporterTypes = parseExporterTypes(process.env.OTEL_METRICS_EXPORTER)
  const exportInterval = parseInt(
    process.env.OTEL_METRIC_EXPORT_INTERVAL || DEFAULT_METRICS_EXPORT_INTERVAL_MS.toString(),
    10,
  )

  const exporters = []
  for (const exporterType of exporterTypes) {
    if (exporterType === "console") {
      exporters.push(new ConsoleMetricExporter())
    } else if (exporterType === "otlp") {
      const protocol =
        process.env.OTEL_EXPORTER_OTLP_METRICS_PROTOCOL?.trim() || process.env.OTEL_EXPORTER_OTLP_PROTOCOL?.trim()

      switch (protocol) {
        case "http/json": {
          const { OTLPMetricExporter } = await import("@opentelemetry/exporter-metrics-otlp-http")
          exporters.push(new DiagnosticMetricExporter(new OTLPMetricExporter(), "otlp-metrics"))
          break
        }
        case "http/protobuf": {
          const { OTLPMetricExporter } = await import("@opentelemetry/exporter-metrics-otlp-proto")
          exporters.push(new DiagnosticMetricExporter(new OTLPMetricExporter(), "otlp-metrics"))
          break
        }
        default:
          throw new Error(`Unknown metrics exporter protocol: ${protocol}`)
      }
    }
  }

  return exporters.map((exporter) => {
    if ("export" in exporter) {
      return new PeriodicExportingMetricReader({
        exporter,
        exportIntervalMillis: exportInterval,
      })
    }
    return exporter as PeriodicExportingMetricReader
  })
}

async function getOtlpLogExporters() {
  const exporterTypes = parseExporterTypes(process.env.OTEL_LOGS_EXPORTER)
  const protocol =
    process.env.OTEL_EXPORTER_OTLP_LOGS_PROTOCOL?.trim() || process.env.OTEL_EXPORTER_OTLP_PROTOCOL?.trim()

  const exporters = []
  for (const exporterType of exporterTypes) {
    if (exporterType === "console") {
      exporters.push(new ConsoleLogRecordExporter())
    } else if (exporterType === "otlp") {
      switch (protocol) {
        case "http/json": {
          const { OTLPLogExporter } = await import("@opentelemetry/exporter-logs-otlp-http")
          exporters.push(new DiagnosticLogExporter(new OTLPLogExporter(), "otlp-logs"))
          break
        }
        case "http/protobuf": {
          const { OTLPLogExporter } = await import("@opentelemetry/exporter-logs-otlp-proto")
          exporters.push(new DiagnosticLogExporter(new OTLPLogExporter(), "otlp-logs"))
          break
        }
        default:
          throw new Error(`Unknown logs exporter protocol: ${protocol}`)
      }
    }
  }
  return exporters
}

class DiagnosticMetricExporter implements PushMetricExporter {
  private exportCount = 0
  private successCount = 0
  private failureCount = 0

  constructor(
    private readonly inner: PushMetricExporter,
    private readonly label: string,
  ) {}

  async forceFlush(): Promise<void> {
    return this.inner.forceFlush?.()
  }

  export(metrics: ResourceMetrics, resultCallback: (result: { code: number; error?: Error }) => void): void {
    this.exportCount++
    const batchNum = this.exportCount

    const dataPointsCount = metrics.scopeMetrics.reduce((acc, sm) => acc + sm.metrics.length, 0)

    log.info("metric export attempt", {
      exporter: this.label,
      batch: batchNum,
      scopes: metrics.scopeMetrics.length,
      dataPointsCount,
    })

    this.inner.export(metrics, (result) => {
      if (result.code === 0) {
        this.successCount++
        log.info("metric export success", {
          exporter: this.label,
          batch: batchNum,
          totalSuccess: this.successCount,
        })
      } else {
        this.failureCount++
        log.error("metric export failed", {
          exporter: this.label,
          batch: batchNum,
          code: result.code,
          error: result.error?.message,
          totalFailures: this.failureCount,
        })
      }
      resultCallback(result)
    })
  }

  async shutdown(): Promise<void> {
    log.info("metric exporter shutdown", {
      exporter: this.label,
      totalExports: this.exportCount,
      totalSuccess: this.successCount,
      totalFailures: this.failureCount,
    })
    return this.inner.shutdown()
  }
}

class DiagnosticLogExporter implements LogRecordExporter {
  private exportCount = 0
  private successCount = 0
  private failureCount = 0

  constructor(
    private readonly inner: LogRecordExporter,
    private readonly label: string,
  ) {}

  export(logsBatch: ReadableLogRecord[], resultCallback: (result: { code: number; error?: Error }) => void): void {
    this.exportCount++
    const batchNum = this.exportCount
    log.info("log export attempt", { exporter: this.label, batch: batchNum, logs: logsBatch.length })

    this.inner.export(logsBatch, (result) => {
      if (result.code === 0) {
        this.successCount++
        log.info("log export success", {
          exporter: this.label,
          batch: batchNum,
          logs: logsBatch.length,
          totalSuccess: this.successCount,
        })
      } else {
        this.failureCount++
        log.error("log export failed", {
          exporter: this.label,
          batch: batchNum,
          logs: logsBatch.length,
          code: result.code,
          error: result.error?.message,
          totalFailures: this.failureCount,
        })
      }
      resultCallback(result)
    })
  }

  async shutdown(): Promise<void> {
    log.info("log exporter shutdown", {
      exporter: this.label,
      totalExports: this.exportCount,
      totalSuccess: this.successCount,
      totalFailures: this.failureCount,
    })
    return this.inner.shutdown()
  }
}


export function isTelemetryEnabled() {
  return Boolean(
    process.env.LITEAI_ENABLE_TELEMETRY &&
      process.env.LITEAI_ENABLE_TELEMETRY !== "0" &&
      process.env.LITEAI_ENABLE_TELEMETRY !== "false",
  )
}

const cleanupHandlers: Array<() => Promise<void>> = []

export function registerTelemetryCleanup(handler: () => Promise<void>) {
  cleanupHandlers.push(handler)
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

  log.info("initializing telemetry", {
    enabled: isTelemetryEnabled(),
    endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    protocol: process.env.OTEL_EXPORTER_OTLP_PROTOCOL,
    tracesExporter: process.env.OTEL_TRACES_EXPORTER,
    metricsExporter: process.env.OTEL_METRICS_EXPORTER,
    logsExporter: process.env.OTEL_LOGS_EXPORTER,
    perfetto: process.env.LITEAI_PERFETTO_TRACE,
  })

  // Initialize Perfetto tracing (independent of OTEL)
  initializePerfettoTracing()

  const readers = []
  const telemetryEnabled = isTelemetryEnabled()

  if (telemetryEnabled) {
    readers.push(...(await getOtlpReaders()))
  }

  const baseAttributes: Record<string, string> = {
    [ATTR_SERVICE_NAME]: "liteai",
    [ATTR_SERVICE_VERSION]: Installation.VERSION,
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
    const logExporters = await getOtlpLogExporters()

    if (logExporters.length > 0) {
      const loggerProvider = new LoggerProvider({
        resource,
        processors: logExporters.map(
          (exporter) =>
            new BatchLogRecordProcessor(exporter, {
              scheduledDelayMillis: parseInt(
                process.env.OTEL_LOGS_EXPORT_INTERVAL || DEFAULT_LOGS_EXPORT_INTERVAL_MS.toString(),
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
    const langfusePublicKey = process.env.LANGFUSE_PUBLIC_KEY
    const langfuseSecretKey = process.env.LANGFUSE_SECRET_KEY
    const langfuseBaseUrl = process.env.LANGFUSE_BASEURL ?? process.env.LANGFUSE_HOST

    if (langfusePublicKey && langfuseSecretKey) {
      log.info("trace exporter configured", { type: "langfuse", baseUrl: langfuseBaseUrl ?? "cloud.langfuse.com" })

      const langfuseProcessor = new LangfuseSpanProcessor({
        publicKey: langfusePublicKey,
        secretKey: langfuseSecretKey,
        ...(langfuseBaseUrl ? { baseUrl: langfuseBaseUrl } : {}),
        flushAt: 10,
        flushInterval: parseInt(process.env.OTEL_TRACES_EXPORT_INTERVAL ?? DEFAULT_TRACES_EXPORT_INTERVAL_MS.toString(), 10) / 1000,
      })

      const sdk = new NodeSDK({
        resource,
        spanProcessors: [langfuseProcessor],
      })

      sdk.start()
      globalNodeSdk = sdk
    } else {
      log.warn("Langfuse trace exporter skipped: LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY not set")
    }
  }
}

export async function shutdownTelemetry() {
  const timeoutMs = parseInt(process.env.LITEAI_OTEL_SHUTDOWN_TIMEOUT_MS || "2000", 10)
  log.info("shutting down telemetry", { timeoutMs })

  try {
    const shutdownPromises: Promise<void>[] = []
    if (globalMeterProvider) shutdownPromises.push(globalMeterProvider.shutdown())
    if (globalLoggerProvider) shutdownPromises.push(globalLoggerProvider.shutdown())
    if (globalNodeSdk) shutdownPromises.push(globalNodeSdk.shutdown())
    for (const handler of cleanupHandlers) {
      shutdownPromises.push(handler())
    }

    await Promise.race([Promise.all(shutdownPromises), telemetryTimeout(timeoutMs, "OpenTelemetry shutdown timeout")])
    log.info("telemetry shutdown complete")
  } catch (error) {
    if (error instanceof Error && error.message.includes("timeout")) {
      log.error("telemetry shutdown timed out", { timeoutMs })
    }
    throw error
  }
}

export async function flushTelemetry(): Promise<void> {
  const timeoutMs = parseInt(process.env.LITEAI_OTEL_FLUSH_TIMEOUT_MS || "5000", 10)
  log.info("flushing telemetry", { timeoutMs })

  try {
    const flushPromises: Promise<void>[] = []
    if (globalMeterProvider) flushPromises.push(globalMeterProvider.forceFlush())
    if (globalLoggerProvider) flushPromises.push(globalLoggerProvider.forceFlush())
    // NodeSDK does not expose forceFlush directly; shutdown handles final flush

    await Promise.race([Promise.all(flushPromises), telemetryTimeout(timeoutMs, "OpenTelemetry flush timeout")])
    log.info("telemetry flush complete")
  } catch (error) {
    log.error("telemetry flush failed", { error })
  }
}
