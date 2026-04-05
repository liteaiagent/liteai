import { DiagConsoleLogger, DiagLogLevel, diag, metrics, trace } from "@opentelemetry/api"
import { logs } from "@opentelemetry/api-logs"
import { envDetector, hostDetector, osDetector, resourceFromAttributes } from "@opentelemetry/resources"
import { BatchLogRecordProcessor, ConsoleLogRecordExporter, LoggerProvider } from "@opentelemetry/sdk-logs"
import { ConsoleMetricExporter, MeterProvider, PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics"
import { BasicTracerProvider, BatchSpanProcessor, ConsoleSpanExporter } from "@opentelemetry/sdk-trace-base"
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION, SEMRESATTRS_HOST_ARCH } from "@opentelemetry/semantic-conventions"

import { initializePerfettoTracing } from "./perfetto"
import { endInteractionSpan } from "./tracing"

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
          exporters.push(new OTLPMetricExporter())
          break
        }
        case "http/protobuf": {
          const { OTLPMetricExporter } = await import("@opentelemetry/exporter-metrics-otlp-proto")
          exporters.push(new OTLPMetricExporter())
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
          exporters.push(new OTLPLogExporter())
          break
        }
        case "http/protobuf": {
          // Note: you may need to add @opentelemetry/exporter-logs-otlp-proto to dependencies if used
          const { OTLPLogExporter } = await import("@opentelemetry/exporter-logs-otlp-http")
          // For protobuf, SDK often treats http/protobuf natively, or we fallback to http here
          exporters.push(new OTLPLogExporter())
          break
        }
        default:
          throw new Error(`Unknown logs exporter protocol: ${protocol}`)
      }
    }
  }
  return exporters
}

async function getOtlpTraceExporters() {
  const exporterTypes = parseExporterTypes(process.env.OTEL_TRACES_EXPORTER)
  const protocol =
    process.env.OTEL_EXPORTER_OTLP_TRACES_PROTOCOL?.trim() || process.env.OTEL_EXPORTER_OTLP_PROTOCOL?.trim()

  const exporters = []
  for (const exporterType of exporterTypes) {
    if (exporterType === "console") {
      exporters.push(new ConsoleSpanExporter())
    } else if (exporterType === "otlp") {
      switch (protocol) {
        case "http/json": {
          const { OTLPTraceExporter } = await import("@opentelemetry/exporter-trace-otlp-http")
          exporters.push(new OTLPTraceExporter())
          break
        }
        case "http/protobuf": {
          // If proto is needed, make sure @opentelemetry/exporter-trace-otlp-proto is installed.
          const { OTLPTraceExporter } = await import("@opentelemetry/exporter-trace-otlp-http")
          exporters.push(new OTLPTraceExporter())
          break
        }
        default:
          throw new Error(`Unknown trace exporter protocol: ${protocol}`)
      }
    }
  }
  return exporters
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
let globalTracerProvider: BasicTracerProvider | undefined

export async function initializeTelemetry() {
  if (!process.env.OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE) {
    process.env.OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE = "delta"
  }

  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.ERROR)

  // Initialize Perfetto tracing (independent of OTEL)
  initializePerfettoTracing()

  const readers = []
  const telemetryEnabled = isTelemetryEnabled()

  if (telemetryEnabled) {
    readers.push(...(await getOtlpReaders()))
  }

  const baseAttributes: Record<string, string> = {
    [ATTR_SERVICE_NAME]: "liteai",
    [ATTR_SERVICE_VERSION]: "1.0.0", // Could be dynamic from package.json
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
        await globalTracerProvider?.forceFlush()
      })

      process.on("exit", () => {
        void loggerProvider.forceFlush()
        void globalTracerProvider?.forceFlush()
      })
    }

    const traceExporters = await getOtlpTraceExporters()
    if (traceExporters.length > 0) {
      const spanProcessors = traceExporters.map(
        (exporter) =>
          new BatchSpanProcessor(exporter, {
            scheduledDelayMillis: parseInt(
              process.env.OTEL_TRACES_EXPORT_INTERVAL || DEFAULT_TRACES_EXPORT_INTERVAL_MS.toString(),
              10,
            ),
          }),
      )

      const tracerProvider = new BasicTracerProvider({
        resource,
        spanProcessors,
      })

      trace.setGlobalTracerProvider(tracerProvider)
      globalTracerProvider = tracerProvider
    }
  }
}

export async function shutdownTelemetry() {
  const timeoutMs = parseInt(process.env.LITEAI_OTEL_SHUTDOWN_TIMEOUT_MS || "2000", 10)

  try {
    // End any active interaction span before shutdown
    endInteractionSpan()

    const shutdownPromises: Promise<void>[] = []
    if (globalMeterProvider) shutdownPromises.push(globalMeterProvider.shutdown())
    if (globalLoggerProvider) shutdownPromises.push(globalLoggerProvider.shutdown())
    if (globalTracerProvider) shutdownPromises.push(globalTracerProvider.shutdown())
    for (const handler of cleanupHandlers) {
      shutdownPromises.push(handler())
    }

    await Promise.race([Promise.all(shutdownPromises), telemetryTimeout(timeoutMs, "OpenTelemetry shutdown timeout")])
  } catch (error) {
    if (error instanceof Error && error.message.includes("timeout")) {
      console.error(`Telemetry flush timed out after ${timeoutMs}ms.`)
    }
    throw error
  }
}

export async function flushTelemetry(): Promise<void> {
  const timeoutMs = parseInt(process.env.LITEAI_OTEL_FLUSH_TIMEOUT_MS || "5000", 10)

  try {
    const flushPromises: Promise<void>[] = []
    if (globalMeterProvider) flushPromises.push(globalMeterProvider.forceFlush())
    if (globalLoggerProvider) flushPromises.push(globalLoggerProvider.forceFlush())
    if (globalTracerProvider) flushPromises.push(globalTracerProvider.forceFlush())

    await Promise.race([Promise.all(flushPromises), telemetryTimeout(timeoutMs, "OpenTelemetry flush timeout")])
  } catch (error) {
    console.warn(`Telemetry flush failed: ${error}`)
  }
}
