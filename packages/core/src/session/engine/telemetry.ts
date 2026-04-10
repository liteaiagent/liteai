export class TelemetryTracker {
  private step = 0
  private batches = new Map<string, number>()

  public getStep(batchId?: string): number {
    if (batchId) {
      if (this.batches.has(batchId)) {
        return this.batches.get(batchId)!
      }
      this.step++
      this.batches.set(batchId, this.step)
      return this.step
    }

    // No batch ID means strictly sequential isolated action
    this.step++
    return this.step
  }
}
