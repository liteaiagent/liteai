import type { LogRecordExporter, ReadableLogRecord } from "@opentelemetry/sdk-logs"
import type { PushMetricExporter, ResourceMetrics } from "@opentelemetry/sdk-metrics"

export class DiagnosticMetricExporter implements PushMetricExporter {
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

    this.inner.export(metrics, (result) => {
      if (result.code === 0) {
        this.successCount++
      } else {
        this.failureCount++
      }
      resultCallback(result)
    })
  }

  async shutdown(): Promise<void> {
    return this.inner.shutdown()
  }
}

export class DiagnosticLogExporter implements LogRecordExporter {
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

    this.inner.export(logsBatch, (result) => {
      if (result.code === 0) {
        this.successCount++
      } else {
        this.failureCount++
      }
      resultCallback(result)
    })
  }

  async shutdown(): Promise<void> {
    return this.inner.shutdown()
  }
}
