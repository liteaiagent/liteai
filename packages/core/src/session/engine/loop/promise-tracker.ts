export class PromiseTracker {
  private pending: Set<Promise<unknown>> = new Set()

  track(promise: Promise<unknown>): void {
    const tracked = promise.then(
      (value) => {
        this.pending.delete(tracked)
        return value
      },
      (error) => {
        /* keep in set for error surfacing */ throw error
      },
    )
    // Prevent unhandled promise rejection warnings from the runtime
    tracked.catch(() => {})
    this.pending.add(tracked)
  }

  async flush(): Promise<void> {
    const results = await Promise.allSettled([...this.pending])
    this.pending.clear()
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected")
    if (rejected.length > 0) {
      throw new AggregateError(
        rejected.map((r) => r.reason),
        "PromiseTracker: tracked promises failed",
      )
    }
  }

  get size(): number {
    return this.pending.size
  }
}
