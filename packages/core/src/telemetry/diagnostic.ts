import type { LogRecordExporter, ReadableLogRecord } from "@opentelemetry/sdk-logs"
import type { PushMetricExporter, ResourceMetrics } from "@opentelemetry/sdk-metrics"
import { Log } from "../util/log"

const log = Log.create({ service: "telemetry-diagnostic" })

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
