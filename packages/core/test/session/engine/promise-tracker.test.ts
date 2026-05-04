import { describe, expect, test } from "bun:test"
import { PromiseTracker } from "../../../src/session/engine/loop/promise-tracker"

describe("PromiseTracker", () => {
  test("track() + flush() — resolved promise auto-removes, flush resolves cleanly", async () => {
    const tracker = new PromiseTracker()
    let resolved = false
    const promise = Promise.resolve().then(() => {
      resolved = true
    })

    tracker.track(promise)
    expect(tracker.size).toBe(1)

    // Wait for the tracked promise's then-chain to settle
    await promise
    // Wait a tick for the track() then-chain to complete
    await new Promise((r) => setTimeout(r, 0))

    expect(tracker.size).toBe(0)

    await expect(tracker.flush()).resolves.toBeUndefined()
    expect(resolved).toBeTrue()
  })

  test("track() rejected — rejected promise stays in set, flush throws AggregateError", async () => {
    const tracker = new PromiseTracker()
    const error = new Error("Expected failure")
    // Note: We need to catch the unhandled rejection in the test scope to prevent Bun from failing the test suite
    const promise = Promise.reject(error).catch((e) => {
      throw e
    })

    tracker.track(promise)
    expect(tracker.size).toBe(1)

    // Wait for promise to reject, ignore the unhandled rejection error locally
    await promise.catch(() => {})
    // Wait a tick for the track() then-chain to complete
    await new Promise((r) => setTimeout(r, 0))

    expect(tracker.size).toBe(1) // Still in set

    try {
      await tracker.flush()
      expect(true).toBeFalse() // Should not reach
    } catch (e) {
      expect(e).toBeInstanceOf(AggregateError)
      const agg = e as AggregateError
      expect(agg.errors).toHaveLength(1)
      expect(agg.errors[0]).toBe(error)
    }
    expect(tracker.size).toBe(0) // Flushed
  })

  test("size — returns count of pending", () => {
    const tracker = new PromiseTracker()
    expect(tracker.size).toBe(0)

    // Unresolved promises
    const p1 = new Promise(() => {})
    const p2 = new Promise(() => {})

    tracker.track(p1)
    expect(tracker.size).toBe(1)
    tracker.track(p2)
    expect(tracker.size).toBe(2)
  })

  test("concurrent track() — multiple promises tracked simultaneously, all surface errors", async () => {
    const tracker = new PromiseTracker()
    const e1 = new Error("Error 1")
    const e2 = new Error("Error 2")

    const p1 = Promise.reject(e1)
    const p2 = Promise.reject(e2)

    tracker.track(p1)
    tracker.track(p2)

    await p1.catch(() => {})
    await p2.catch(() => {})
    await new Promise((r) => setTimeout(r, 0))

    expect(tracker.size).toBe(2)

    try {
      await tracker.flush()
    } catch (e) {
      expect(e).toBeInstanceOf(AggregateError)
      const agg = e as AggregateError
      expect(agg.errors).toHaveLength(2)
      expect(agg.errors).toContain(e1)
      expect(agg.errors).toContain(e2)
    }
  })

  test("flush() empty — flush on empty set resolves without error", async () => {
    const tracker = new PromiseTracker()
    await expect(tracker.flush()).resolves.toBeUndefined()
  })

  test("mixed resolved/rejected — only rejected ones surface in AggregateError", async () => {
    const tracker = new PromiseTracker()
    const err = new Error("Rejected")

    const pResolved = Promise.resolve("ok")
    const pRejected = Promise.reject(err)

    tracker.track(pResolved)
    tracker.track(pRejected)

    await pResolved
    await pRejected.catch(() => {})
    await new Promise((r) => setTimeout(r, 0))

    expect(tracker.size).toBe(1) // Only rejected remains

    try {
      await tracker.flush()
    } catch (e) {
      expect(e).toBeInstanceOf(AggregateError)
      const agg = e as AggregateError
      expect(agg.errors).toHaveLength(1)
      expect(agg.errors[0]).toBe(err)
    }
  })
})
