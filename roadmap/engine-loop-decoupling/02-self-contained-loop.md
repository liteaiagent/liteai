# Phase 2: Self-Contained Loop

> **Depends on**: Phase 1 (Checkpointer Interface)  
> **Enables**: Phase 3 (Event Fan-Out), Phase 4 (Subagent Result Flow)  
> **Estimated scope**: ~5 files modified

---

## Goal

Make the engine loop a forward-only state machine. It receives initial state as input, processes it, and returns a typed result. Zero DB reads during forward execution.

---

## Design

### Typed Result

```typescript
// packages/core/src/session/engine/result.ts

export type SessionResult =
  | { status: "ok"; message: Message.WithParts }
  | { status: "error"; error: unknown; message?: Message.WithParts }
  | { status: "aborted" }
```

### `runSessionInner` Changes

Currently returns `void`. Will return `SessionResult`.

**State it already tracks internally:**
- `currentAssistantMessage: Message.Assistant | undefined`
- `currentStreamResult: unknown`
- `persister: EventPersister | undefined`

On successful completion, `persister` has the completed message. On pre-turn error (model resolution), no persister exists but the error is known. On abort, we catch `AbortError`.

```typescript
async function runSessionInner(input: RunSessionInput): Promise<SessionResult> {
  // ... existing logic ...

  // Currently: implicit return (void)
  // After: explicit result

  // Success path (persister completed):
  if (persister && currentAssistantMessage) {
    const parts = persister.getCompletedParts()
    return { status: "ok", message: { info: currentAssistantMessage, parts } }
  }

  // Pre-turn error (model resolution failed, no persister):
  if (preTurnError) {
    return { status: "error", error: preTurnError }
  }

  // Abort:
  return { status: "aborted" }
}
```

### `loop()` Changes

Currently:
```typescript
await runSession(...)
for await (const item of Message.stream(sessionID)) { ... }  // DB read!
throw new Error("Impossible")  // crash guard
```

After:
```typescript
const result = await runSession(...)
switch (result.status) {
  case "ok":
    // Resolve queued callbacks, return directly
    const queued = state()[sessionID]?.callbacks ?? []
    for (const q of queued) q.resolve(result.message)
    return result.message
  case "error":
    // Publish error to Bus (AWAITED, not fire-and-forget)
    await Bus.publish(Session.Event.Error, { sessionID, error: ... })
    // If partial message exists, return it; otherwise throw
    if (result.message) return result.message
    throw result.error
  case "aborted":
    // Cleanup handles idle transition via defer
    return  // never reaches — defer runs first
}
```

**Eliminated:**
- `Message.stream(sessionID)` re-query
- `throw new Error("Impossible")` guard
- Implicit void return from `runSessionInner`

### `queryLoop` Changes

Currently calls `Bus.publish(Session.Event.Error)` inside the model resolution `.catch()` handler (mixed concern — error propagation + notification in the same callback).

After: the generator only propagates errors. Notification is the orchestrator's job.

```typescript
// BEFORE (mixed concerns):
const model = await Provider.getModel(...).catch((e) => {
  log.error(...)
  Bus.publish(Session.Event.Error, { ... }).catch(...)  // side-effect!
  return e as Error
})

// AFTER (pure error propagation):
const model = await Provider.getModel(...).catch((e) => {
  log.error(...)
  return e as Error
})
```

### Initial State Injection

Currently, `queryLoop` receives `msgsBuffer` which is loaded from DB by `runSessionInner`:
```typescript
const msgsBuffer = { current: await Message.filterCompacted(Message.stream(sessionID)) }
```

This DB read moves to the `loop()` function, which loads history via the checkpointer:
```typescript
// loop() — before calling runSession
const history = checkpointer 
  ? await collectHistory(checkpointer.loadHistory(sessionID))
  : []

const result = await runSession({ ..., initialMessages: history })
```

The loop still needs the initial messages — but the source is abstracted (checkpointer, not raw DB).

---

## Files to Change

| File | Change |
|---|---|
| `[NEW] result.ts` | `SessionResult` type definition |
| `[MODIFY] loop.ts` | `runSessionInner` returns `SessionResult`; `loop()` uses result directly; remove DB re-query and "Impossible" guard; load initial messages via checkpointer |
| `[MODIFY] query.ts` | Remove `Bus.publish` from model resolution catch; pure error propagation |
| `[MODIFY] events.ts` | Add `PreFlightErrorEvent` for model resolution failures (clean event taxonomy) |

---

## Verification

- `bun typecheck` passes
- `bun test test/session` — existing tests pass
- Manual test: configure non-existent model → single error toast, session idle, `/new` works, zero crashes, zero unhandled rejections
- Manual test: configure valid model → normal conversation works identically

---

## Analysis Tasks (for future sessions)

- [ ] Audit all places where `msgsBuffer.current` is read inside `queryLoop` — ensure the in-memory buffer is self-consistent without DB reads
- [ ] Verify that `Message.filterCompacted()` can work on an in-memory array (it currently iterates an AsyncIterable from DB)
- [ ] Determine how tool results that create new messages interact with the in-memory buffer (currently they write to DB and the buffer re-reads)
