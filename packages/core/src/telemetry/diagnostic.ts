import type { LogRecordExporter, ReadableLogRecord } from "@opentelemetry/sdk-logs"
import type { PushMetricExporter, ResourceMetrics } from "@opentelemetry/sdk-metrics"

export class DiagnosticMetricExporter implements PushMetricExporter {
  constructor(
    private readonly inner: PushMetricExporter,
    readonly _label: string /* intentionally unused: maintained for constructor compatibility with factories */,
  ) {}

  async forceFlush(): Promise<void> {
    return this.inner.forceFlush?.()
  }

  export(metrics: ResourceMetrics, resultCallback: (result: { code: number; error?: Error }) => void): void {
    this.inner.export(metrics, (result) => {
      resultCallback(result)
    })
  }

  async shutdown(): Promise<void> {
    return this.inner.shutdown()
  }
}

export class DiagnosticLogExporter implements LogRecordExporter {
  constructor(
    private readonly inner: LogRecordExporter,
    readonly _label: string /* intentionally unused: maintained for constructor compatibility with factories */,
  ) {}

  export(logsBatch: ReadableLogRecord[], resultCallback: (result: { code: number; error?: Error }) => void): void {
    this.inner.export(logsBatch, (result) => {
      resultCallback(result)
    })
  }

  async shutdown(): Promise<void> {
    return this.inner.shutdown()
  }
}
