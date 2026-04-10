export class TelemetryTracker {
  private step = 0
  private batches = new Map<string, number>()

  public getStep(batchId?: string): number {
    if (batchId) {
      const existing = this.batches.get(batchId)
      if (existing !== undefined) {
        return existing
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
