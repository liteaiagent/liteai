import { ConsoleLogRecordExporter } from "@opentelemetry/sdk-logs"
import { ConsoleMetricExporter, PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics"
import type { Info } from "../config/schema"
import { DiagnosticLogExporter, DiagnosticMetricExporter } from "./diagnostic"

const DEFAULT_METRICS_EXPORT_INTERVAL_MS = 60000

function parseExporterTypes(value: string | undefined): string[] {
  return (value || "")
    .trim()
    .split(",")
    .filter(Boolean)
    .map((t) => t.trim())
    .filter((t) => t !== "none")
}

type TelemetryConfig = NonNullable<Info["telemetry"]>["otel"]

export async function getOtlpReaders(otelConfig: TelemetryConfig) {
  const exporterConfig = otelConfig?.metricExporter
  const exporterTypes = parseExporterTypes(exporterConfig ?? process.env.OTEL_METRICS_EXPORTER)

  const intervalConfig = otelConfig?.exportIntervalMs?.toString()
  const exportInterval = parseInt(
    intervalConfig ?? process.env.OTEL_METRIC_EXPORT_INTERVAL ?? DEFAULT_METRICS_EXPORT_INTERVAL_MS.toString(),
    10,
  )

  const exporters = []
  for (const exporterType of exporterTypes) {
    if (exporterType === "console") {
      exporters.push(new ConsoleMetricExporter())
    } else if (exporterType === "otlp") {
      const protocolConfig = otelConfig?.protocol
      const protocol =
        protocolConfig ??
        process.env.OTEL_EXPORTER_OTLP_METRICS_PROTOCOL?.trim() ??
        process.env.OTEL_EXPORTER_OTLP_PROTOCOL?.trim()

      const endpointConfig = otelConfig?.endpoint
      const endpoint =
        endpointConfig ??
        process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT ??
        process.env.OTEL_EXPORTER_OTLP_ENDPOINT
      const url = endpoint ? `${endpoint}/v1/metrics` : undefined

      switch (protocol) {
        case "http/json": {
          const { OTLPMetricExporter } = await import("@opentelemetry/exporter-metrics-otlp-http")
          exporters.push(
            new DiagnosticMetricExporter(new OTLPMetricExporter(url ? { url } : undefined), "otlp-metrics"),
          )
          break
        }
        case "http/protobuf": {
          const { OTLPMetricExporter } = await import("@opentelemetry/exporter-metrics-otlp-proto")
          exporters.push(
            new DiagnosticMetricExporter(new OTLPMetricExporter(url ? { url } : undefined), "otlp-metrics"),
          )
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

export async function getOtlpLogExporters(otelConfig: TelemetryConfig) {
  const exporterConfig = otelConfig?.logExporter
  const exporterTypes = parseExporterTypes(exporterConfig ?? process.env.OTEL_LOGS_EXPORTER)

  const protocolConfig = otelConfig?.protocol
  const protocol =
    protocolConfig ??
    process.env.OTEL_EXPORTER_OTLP_LOGS_PROTOCOL?.trim() ??
    process.env.OTEL_EXPORTER_OTLP_PROTOCOL?.trim()

  const endpointConfig = otelConfig?.endpoint
  const endpoint =
    endpointConfig ??
    process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT ??
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT
  const url = endpoint ? `${endpoint}/v1/logs` : undefined

  const exporters = []
  for (const exporterType of exporterTypes) {
    if (exporterType === "console") {
      exporters.push(new ConsoleLogRecordExporter())
    } else if (exporterType === "otlp") {
      switch (protocol) {
        case "http/json": {
          const { OTLPLogExporter } = await import("@opentelemetry/exporter-logs-otlp-http")
          exporters.push(new DiagnosticLogExporter(new OTLPLogExporter(url ? { url } : undefined), "otlp-logs"))
          break
        }
        case "http/protobuf": {
          const { OTLPLogExporter } = await import("@opentelemetry/exporter-logs-otlp-proto")
          exporters.push(new DiagnosticLogExporter(new OTLPLogExporter(url ? { url } : undefined), "otlp-logs"))
          break
        }
        default:
          throw new Error(`Unknown logs exporter protocol: ${protocol}`)
      }
    }
  }
  return exporters
}
