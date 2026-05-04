# Phase 2: DB Decoupling — Pure In-Memory Persister

> **Depends on**: Phase 1 (stop-drift changes)
> **Risk**: High — changes persistence model for all events
> **Rollback**: Restore `Session.updatePart/Message` calls inside `EventPersister.handleEvent()`
> **Pattern source**: Claude Code MVP (`query.ts` is a pure generator, REPL handles persistence)

---

## 1. Problem Statement

`EventPersister.handleEvent()` calls `Session.updatePart()` and `Session.updateMessage()` **synchronously during event processing**. There are **26 `Session.updatePart()` calls** and **2 `Session.updateMessage()` calls** inside `persister.ts` alone.

### Why This Is a Problem

1. **Performance**: Every streaming token delta triggers a DB write (`Session.updatePartDelta`). For a 2,000-token response, that's ~2,000 DB writes during streaming.
2. **Coupling**: The engine cannot run without a database. No unit testing of the engine in isolation.
3. **Error surface**: DB write failures crash the engine loop (persister throws → `loop.ts` catch → session ends).
4. **Abort data loss**: The `throwIfAborted()` guard at `persister.ts:67` prevents `turn-end` events from being processed during abort, losing accumulated data.

### What the Reference Systems Do

- **Gemini CLI**: History is in-memory (`chat.getHistory()`). `ChatRecordingService` persists asynchronously, outside the hot path.
- **Claude Code**: `queryLoop()` is a pure async generator that `yield`s messages. The consumer (REPL) handles persistence. The generator never touches a database.
- **LiteAI (current)**: `EventPersister` writes to DB inline during `handleEvent()`.

### Target Architecture

```
queryLoop() → yields EngineEvent.Any
    ↓
loop.ts (runSessionInner) → routes events
    ↓                            ↓
EventPersister               AsyncPersistenceWriter
(in-memory only)             (DB writes, async, fire-and-forget)
    ↓
accumulates parts,
tracks state,
returns flush result
```

---

## 2. Design: Split EventPersister into Two Concerns

### 2.1 `EventPersister` (in-memory accumulator) — MODIFY EXISTING

**Responsibility**: Accumulate parts in memory, track state (blocked, needsCompaction, attempt), classify errors. **Zero DB writes.**

All `Session.updatePart()` and `Session.updatePartDelta()` calls are removed. Instead, the persister maintains its existing in-memory arrays (`allParts`, `toolcalls`, `reasoningMap`, `currentText`) and a new **write queue**.

```typescript
export class EventPersister {
  // Existing in-memory state (keep as-is)
  private toolcalls: Record<string, Message.ToolPart> = {}
  private currentText?: Message.TextPart
  private reasoningMap: Record<string, Message.ReasoningPart> = {}
  private allParts: Message.Part[] = []

  // NEW: Write queue for deferred persistence
  private writeQueue: PersistenceOp[] = []

  // Existing public state (keep as-is)
  public blocked = false
  public attempt = 0
  public needsCompaction = false
  public resolved?: string[]

  // CHANGED: handleEvent no longer awaits DB writes
  public handleEvent(event: EngineEvent.Any): EngineEvent.GeneratorResultEvent["action"] | undefined {
    // Same logic as before, but instead of:
    //   await Session.updatePart(part)
    // Do:
    //   this.enqueuePart(part)
    //   this.upsertPart(part)
  }

  // NEW: Drain write queue
  public drainWrites(): PersistenceOp[] {
    const ops = this.writeQueue
    this.writeQueue = []
    return ops
  }

  // CHANGED: flush() no longer writes to DB
  public flush(streamResult?: unknown): "stop" | "continue" | "compact" {
    // Same logic, but Session.updatePart/Message calls replaced with enqueue
    // Returns the same result type
  }

  // Existing method (keep as-is)
  public getCompletedMessage(): Message.WithParts { ... }
}
```

### 2.2 `PersistenceOp` Type — NEW

```typescript
export type PersistenceOp =
  | { type: "upsert-part"; part: Message.Part }
  | { type: "delta-part"; sessionID: SessionID; messageID: MessageID; partID: PartID; field: string; delta: string }
  | { type: "upsert-message"; message: Message.Assistant }
```

### 2.3 `AsyncPersistenceWriter` — NEW

A simple consumer that drains `PersistenceOp[]` and writes to DB. Called by `loop.ts` after each event batch.

```typescript
export class AsyncPersistenceWriter {
  async write(ops: PersistenceOp[]): Promise<void> {
    for (const op of ops) {
      switch (op.type) {
        case "upsert-part":
          await Session.updatePart(op.part)
          break
        case "delta-part":
          await Session.updatePartDelta(op)
          break
        case "upsert-message":
          await Session.updateMessage(op.message)
          break
      }
    }
  }
}
```

---

## 3. Files to Modify

### 3.1 `packages/core/src/session/engine/persister.ts` — MAJOR REWRITE

This is the core change. Every `await Session.updatePart(...)` and `await Session.updatePartDelta(...)` call becomes a `this.enqueue(...)` call.

#### Specific Changes (by line ranges in current code)

**Lines 57-361 (`handleEvent` method)**:

The method signature changes from `async` to synchronous:

```typescript
// BEFORE
public async handleEvent(event: EngineEvent.Any): Promise<EngineEvent.GeneratorResultEvent["action"] | undefined>

// AFTER
public handleEvent(event: EngineEvent.Any): EngineEvent.GeneratorResultEvent["action"] | undefined
```

Every `await Session.updatePart(X)` becomes:
```typescript
this.writeQueue.push({ type: "upsert-part", part: X as Message.Part })
this.upsertPart(X as Message.Part)
```

Every `await Session.updatePartDelta({ sessionID, messageID, partID, field, delta })` becomes:
```typescript
this.writeQueue.push({ type: "delta-part", sessionID, messageID, partID, field, delta })
```

Every `await Session.updateMessage(assistantMessage)` becomes:
```typescript
this.writeQueue.push({ type: "upsert-message", message: { ...assistantMessage } })
```

**Specific transform examples:**

Line 86 (reasoning part creation):
```typescript
// BEFORE
await Session.updatePart(reasoningPart)
this.upsertPart(reasoningPart)

// AFTER  
this.writeQueue.push({ type: "upsert-part", part: reasoningPart as Message.Part })
this.upsertPart(reasoningPart as Message.Part)
```

Lines 136-142 (reasoning delta):
```typescript
// BEFORE
await Session.updatePartDelta({
  sessionID: m.sessionID,
  messageID: m.messageID,
  partID: m.id,
  field: "text",
  delta: event.text,
})

// AFTER
this.writeQueue.push({
  type: "delta-part",
  sessionID: m.sessionID,
  messageID: m.messageID,
  partID: m.id,
  field: "text",
  delta: event.text,
})
```

**Lines 364-468 (`flush` method)**:

Same transformation pattern. All `await Session.updatePart(...)` → `this.writeQueue.push(...)`.

The `flush` method also becomes synchronous (no more `async`):
```typescript
// BEFORE
public async flush(streamResult?: any)

// AFTER
public flush(streamResult?: unknown): "stop" | "continue" | "compact"
```

**Exception**: The `streamResult.usage` await in `flush()` (lines 418-431) needs special handling since it awaits a promise. This should be moved to the `AsyncPersistenceWriter` or handled in `loop.ts` before calling `flush()`.

#### Error Classification — stays in persister

The `catch` block in `handleEvent` (lines 333-361) handles error classification (AbortError → stop, ContextOverflow → compact, retryable → sleep+continue, fatal → set error). This logic stays in the persister because it determines the return value (`"stop"`, `"continue"`, `"compact"`).

**However**, the `SessionRetry.sleep()` call at line 354 is problematic — it blocks inside the persister. This should be extracted:

```typescript
// BEFORE (inside persister catch block)
await SessionRetry.sleep(delay, this.abort).catch(() => {})
return "continue"

// AFTER — persister returns retry intent, loop.ts handles the sleep
return "retry" // new return value
```

Add `"retry"` to the flush return type:
```typescript
public flush(): "stop" | "continue" | "compact" | "retry"
```

#### New `drainWrites()` method

```typescript
public drainWrites(): PersistenceOp[] {
  const ops = [...this.writeQueue]
  this.writeQueue = []
  return ops
}
```

---

### 3.2 `packages/core/src/session/engine/loop.ts` — MODERATE CHANGES

#### Change 1: Create `AsyncPersistenceWriter` instance

In `runSessionInner()`, add alongside persister creation:

```typescript
const dbWriter = new AsyncPersistenceWriter()
```

#### Change 2: After each event, drain and write

In the `default` case of the event switch (lines 760-771):

```typescript
// BEFORE
default: {
  if (persister) {
    const action = await persister.handleEvent(event)
    if (action === "stop") {
      return
    }
  }
  break
}

// AFTER
default: {
  if (persister) {
    const action = persister.handleEvent(event)  // no longer async
    // Drain accumulated writes and persist asynchronously
    const ops = persister.drainWrites()
    if (ops.length > 0) {
      await dbWriter.write(ops)
    }
    if (action === "stop") {
      return
    }
  }
  break
}
```

#### Change 3: Handle `turn-start` persistence

Currently at line 408:
```typescript
currentAssistantMessage = (await Session.updateMessage(event.assistantMessage)) as Message.Assistant
```

This stays in `loop.ts` since it's the orchestrator's responsibility to persist the initial message. This is correct — it's the consumer creating the record before streaming begins.

#### Change 4: Handle `turn-end` flush

Currently at line 441:
```typescript
const flushResult = await persister.flush(currentStreamResult)
```

After the persister change, `flush()` returns synchronously, but we still need to drain writes:

```typescript
const flushResult = persister.flush(currentStreamResult)
const flushOps = persister.drainWrites()
if (flushOps.length > 0) {
  await dbWriter.write(flushOps)
}
```

#### Change 5: Handle retry sleep

If `flushResult === "retry"`:
```typescript
if (flushResult === "retry") {
  const delay = SessionRetry.delay(persister.attempt)
  SessionStatus.set(sessionID, {
    type: "retry",
    attempt: persister.attempt,
    message: "Retrying...",
    next: Date.now() + delay,
  })
  await SessionRetry.sleep(delay, abort).catch(() => {})
  // Don't break — continue to next generator event
  break
}
```

---

### 3.3 `packages/core/src/session/engine/persistence-writer.ts` — NEW FILE

```typescript
import { Session } from ".."
import type { Message } from "../message"
import type { MessageID, PartID, SessionID } from "../schema"

export type PersistenceOp =
  | { type: "upsert-part"; part: Message.Part }
  | { type: "delta-part"; sessionID: SessionID; messageID: MessageID; partID: PartID; field: string; delta: string }
  | { type: "upsert-message"; message: Message.Assistant }

export class AsyncPersistenceWriter {
  async write(ops: PersistenceOp[]): Promise<void> {
    for (const op of ops) {
      switch (op.type) {
        case "upsert-part":
          await Session.updatePart(op.part)
          break
        case "delta-part":
          await Session.updatePartDelta(op)
          break
        case "upsert-message":
          await Session.updateMessage(op.message)
          break
      }
    }
  }
}
```

---

## 4. Migration Strategy

### Step 1: Add `PersistenceOp` type and `AsyncPersistenceWriter` class (new file)
### Step 2: Add `writeQueue` and `drainWrites()` to `EventPersister`
### Step 3: Transform `handleEvent()` — replace `await Session.updatePart()` with `enqueue()`
### Step 4: Transform `flush()` — same replacement
### Step 5: Update `loop.ts` to drain writes after each event
### Step 6: Remove `async` from `handleEvent()` signature
### Step 7: Extract retry sleep from persister to loop.ts

Each step is independently testable.

---

## 5. Testing Strategy

### Unit Tests
- Test `EventPersister.handleEvent()` without a database — verify it accumulates parts correctly
- Test `EventPersister.drainWrites()` — verify it returns all accumulated ops and clears the queue
- Test `EventPersister.flush()` — verify correct return values for each error class
- Test `AsyncPersistenceWriter.write()` — verify it calls `Session.updatePart/Message` correctly

### Integration Tests
- Full session flow: verify all parts are persisted to DB via the writer
- Abort mid-stream: verify reasoning parts are persisted (the original bug from the RFC)
- Context overflow: verify compaction is triggered correctly
- Retry: verify retry sleep happens in loop.ts, not persister

### Performance
- Compare DB write latency before/after (batching ops should be faster)
- Measure memory usage of write queue during long sessions
