# Phase 3: Event Fan-Out & Async Safety

> **Depends on**: Phase 1 (Checkpointer Interface), Phase 2 (Self-Contained Loop)  
> **Enables**: Phase 5 (Backward Execution)  
> **Estimated scope**: ~4 files modified

---

## Goal

Decouple the SSE transport from the checkpointer. The engine loop produces events. Multiple consumers (checkpointer, SSE transport, telemetry) receive them independently. All async work is tracked and awaitable.

---

## Problem

Currently, events flow through a tangled chain:

```
queryLoop yields event
  → EventPersister.handleEvent() (classifies + writes DB synchronously)
  → Bus.publish() (fire-and-forget inside Database.effect)
    → SSE subscriber (async stream.writeSSE)
      → Unhandled rejection if subscriber throws
```

The problems:
1. **Single pipeline**: Checkpointing and SSE are serialized through the same code path
2. **Fire-and-forget Bus.publish**: `Database.effect(() => Bus.publish(...))` creates detached promises
3. **No back-pressure**: If the SSE stream is slow, it doesn't slow down checkpointing (good) but also doesn't surface errors (bad)
4. **Untraceable rejections**: When a subscriber throws, the rejection has no handler attached

---

## Design

### Event Fan-Out

Replace the single-pipeline model with explicit fan-out:

```typescript
// Inside runSessionInner's event loop:
for await (const event of generator) {
  // Fan out to all consumers
  const promises = [
    checkpointer?.handleEvent(event),           // Persistence
    sseTransport.handleEvent(event),              // UI streaming
    telemetryTracker?.handleEvent(event),          // Metrics
  ].filter(Boolean)

  // Track all promises
  for (const p of promises) {
    promiseTracker.track(p)
  }
}
```

### Promise Tracker

Borrowed from LangGraph's `checkpointerPromises` pattern:

```typescript
class PromiseTracker {
  private pending = new Set<Promise<unknown>>()

  track(promise: Promise<unknown>) {
    const tracked = promise.then(
      () => { this.pending.delete(tracked) },
      (error) => { /* Keep failed promises for surfacing */ throw error }
    )
    this.pending.add(tracked)
  }

  /** Await all pending promises. Throws if any failed. */
  async flush(): Promise<void> {
    await Promise.all(this.pending)
  }
}
```

Used in the cleanup path:
```typescript
await using _ = defer(async () => {
  await promiseTracker.flush()  // Ensure all writes complete
  await registry.disposeAll()
  cleanup(sessionID)
})
```

### SSE Transport

Currently, SSE events are pushed via `Bus.publish()` which triggers the wildcard subscriber in `instance.ts`. This is indirect and error-prone.

Instead, the SSE transport becomes an explicit event consumer:

```typescript
interface EventConsumer {
  handleEvent(event: EngineEvent.Any): Promise<void> | void
}

class SSETransport implements EventConsumer {
  handleEvent(event: EngineEvent.Any) {
    // Convert engine event to Bus event and publish
    // This is where Bus.publish calls live — but TRACKED by the promise tracker
  }
}
```

The Bus still exists for SSE forwarding to clients. But `Bus.publish` is called from a tracked context, not from fire-and-forget `Database.effect` callbacks.

---

## Files to Change

| File | Change |
|---|---|
| `[NEW] promise-tracker.ts` | `PromiseTracker` class |
| `[NEW] event-consumer.ts` | `EventConsumer` interface |
| `[MODIFY] loop.ts` | Fan-out event processing; use `PromiseTracker`; await in cleanup |
| `[MODIFY] persister.ts` | Implement `EventConsumer`; remove direct `Bus.publish` calls |

---

## What This Eliminates

- All fire-and-forget `Bus.publish` calls inside catch handlers
- All `Database.effect(() => Bus.publish(...))` detached promises
- The `CRITICAL: Unhandled Promise Rejection` from the crash log
- The need for `.catch()` guards on `Bus.publish` inside generators

---

## Verification

- `bun typecheck` passes
- `bun test test/session` — existing tests pass
- Manual test: model resolution failure → zero unhandled rejections in process
- Manual test: SSE client disconnect mid-stream → clean cleanup, no dangling promises

---

## Analysis Tasks (for future sessions)

- [ ] Audit all `Bus.publish` calls across the engine — which ones should go through the event consumer vs direct Bus?
- [ ] Determine if SSE transport should have back-pressure (slow SSE → slow loop?) or if events should be buffered
- [ ] Evaluate whether `Database.effect` should be deprecated entirely in favor of explicit async tracking
