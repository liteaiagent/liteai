# Research: Engine Loop Decoupling

**Date**: 2026-05-04  
**Scope**: `packages/core/src/session/engine/`

## R1: DB Call Site Audit

### Direct `Session.updateMessage()` Calls in Engine

| File | Line | Context | Migration Path |
|------|------|---------|----------------|
| `loop.ts:417` | Turn-start — persist new assistant message | → `checkpointer.saveMessage()` |
| `loop.ts:507` | Turn-end — structured output capture | → `checkpointer.updateMessage()` |
| `loop.ts:524` | Turn-end — structured output error | → `checkpointer.updateMessage()` |
| `loop.ts:889` | `processSubtask` — create subtask assistant | → `checkpointer.saveMessage()` |
| `loop.ts:1018` | `processSubtask` — finalize subtask assistant | → `checkpointer.updateMessage()` |
| `loop.ts:1072` | `processSubtask` — create synthetic user | → `checkpointer.saveMessage()` |
| `persistence-writer.ts:46` | Drain queue — upsert message | Already routed via write queue → `SqliteCheckpointer.write()` |
| `shell.ts:71,106,251` | Shell command persistence | **Out of scope** — shell commands are a separate subsystem |
| `tools.ts:171` | Resolved tool attachments | **Out of scope** — tool attachment storage is peripheral |
| `input.ts:222` | User message creation | **Out of scope** — user input is pre-loop |
| `correction-injector.ts:43,122` | Correction/notification messages | **Defer** — these inject synthetic messages into the DB for buffer consistency |

### Direct `Session.updatePart()` / `updatePartDelta()` Calls

| File | Line | Context | Migration Path |
|------|------|---------|----------------|
| `persistence-writer.ts:40,43` | Drain queue ops | Already routed via write queue → `SqliteCheckpointer.write()` |
| `loop.ts:914` | `processSubtask` — create tool part | → `checkpointer.savePart()` |
| `loop.ts:961` | `processSubtask` — update tool metadata | → `checkpointer.savePart()` |
| `loop.ts:1020` | `processSubtask` — complete tool part | → `checkpointer.savePart()` |
| `loop.ts:1037` | `processSubtask` — error tool part | → `checkpointer.savePart()` |
| `loop.ts:1073` | `processSubtask` — synthetic text part | → `checkpointer.savePart()` |
| `correction-injector.ts:45,124` | Correction/notification parts | **Defer** — same as message injection |
| `shell.ts:80,124,207,218,267` | Shell parts | **Out of scope** |
| `tools.ts:71,173` | Tool attachment parts | **Out of scope** |
| `input.ts:224` | User message parts | **Out of scope** |

### Direct `Message.stream()` / `Message.get()` DB Reads

| File | Line | Context | Migration Path |
|------|------|---------|----------------|
| `loop.ts:279` | `lastModel()` — scan for last model | **Keep** — not in the loop hot path, used for model resolution at session start |
| `loop.ts:326` | `runSession()` telemetry span — find first user text | **Defer** — telemetry concern, reads from buffer after Phase 2 |
| `loop.ts:352` | `runSession()` telemetry span — find last assistant output | **Defer** — same |
| `loop.ts:399` | `runSessionInner()` — initial buffer load | → `checkpointer.loadHistory()` |
| `loop.ts:808` | `loop()` — DB re-query after runSession | **Eliminate** — use `SessionResult` directly |
| `loop.ts:838` | `stripIncompleteThinking()` — load message parts | → operate on in-memory buffer instead |

### `Bus.publish()` Calls (Fire-and-Forget)

| File | Line | Context | Migration Path |
|------|------|---------|----------------|
| `query.ts:169` | Model resolution error notification | **Eliminate** — generator should NOT publish; orchestrator handles |
| `persister.ts:393` | Context overflow error notification | **Migrate** — move to event consumer, track via PromiseTracker |
| `persister.ts:409` | Fatal error notification | **Migrate** — move to event consumer, track via PromiseTracker |
| `input.ts:480` | Input validation error | **Out of scope** — pre-loop |
| `command.ts:128,140,209` | Command execution events | **Out of scope** — command subsystem |

### `Session.removePart()` Calls

| File | Line | Context | Migration Path |
|------|------|---------|----------------|
| `loop.ts:858` | `stripIncompleteThinking()` | → operate on in-memory buffer; checkpointer.deletePart() for persistence |

## R2: Current Architecture Assessment

### What's Already Partially Decoupled

The codebase has already made significant progress toward decoupling:

1. **EventPersister is already a write queue** — `handleEvent()` is synchronous, accumulates `PersistenceOp[]`. No DB writes in the hot path. This is 80% of the way to the Checkpointer interface.

2. **AsyncPersistenceWriter is already a proto-checkpointer** — Its `write(ops)` method is the exact shape of `Checkpointer.putWrites()`. It just needs to be abstracted behind an interface.

3. **msgsBuffer is already the forward-only state** — `runSessionInner` loads from DB once (line 399) and maintains the buffer in-memory for the rest of the session. The generator reads from `msgsBuffer.current`, not from DB.

4. **queryLoop yields events, never writes** — The generator contract is already clean. All DB writes happen in the orchestrator (`runSessionInner`).

### What's NOT Decoupled

1. **`loop()` re-queries DB** (line 808) — After `runSession()` completes, it calls `Message.stream()` to find the last assistant message. This is the `Error: Impossible` crash site.

2. **`processSubtask()` has 8 direct DB writes** — Lines 889, 914, 961, 1018, 1020, 1037, 1072, 1073. These bypass the write queue entirely.

3. **`Bus.publish()` in persister.ts** — Lines 393 and 409 publish error events directly. These are fire-and-forget side-effects inside a class that should be pure event classification.

4. **`Bus.publish()` in query.ts** — Line 169 publishes error events during model resolution inside the generator. This violates the "generator doesn't do side-effects" contract.

5. **`runSession()` telemetry** — Lines 326, 352 do DB reads for telemetry. These should read from the in-memory buffer.

6. **`stripIncompleteThinking()`** — Line 838 reads from DB via `Message.get()`. Should operate on in-memory buffer.

7. **`CorrectionInjector`** — Lines 43, 45, 122, 124 write to DB directly. These synthetic messages need to go through the checkpointer.

## R3: Design Decisions

### D1: Checkpointer Interface Shape

**Decision**: Message-operation-oriented interface, NOT op-array-oriented.

**Rationale**: The current `PersistenceOp` discriminated union maps cleanly to individual methods. Individual methods are more type-safe and self-documenting than `putWrites(ops: GenericOp[])`.

**Alternatives considered**:
- LangGraph's `putWrites(writes, taskId)` — too generic, loses type safety
- Single `write(ops: PersistenceOp[])` method — already exists as `AsyncPersistenceWriter.write()`, but individual methods are clearer for the interface contract

### D2: EventPersister Refactoring Strategy

**Decision**: Keep `EventPersister` as-is (it's already clean). The `AsyncPersistenceWriter` becomes an internal detail of `SqliteCheckpointer`.

**Rationale**: EventPersister is already a pure in-memory accumulator. It doesn't need to know about the checkpointer. The orchestrator drains writes from EventPersister and passes them to the checkpointer.

**The flow stays the same**:
```
event → EventPersister.handleEvent() → writeQueue += ops
              ↓ (drain)
         orchestrator → checkpointer.write(ops)
```

### D3: `processSubtask()` Migration Strategy

**Decision**: Inject checkpointer into `processSubtask()`. All 8 direct DB writes become checkpointer calls.

**Rationale**: `processSubtask()` is a contained function with a clear input/output boundary. Adding `checkpointer` as a parameter is mechanical.

### D4: Bus.publish Removal from Generator/Persister

**Decision**: Remove all `Bus.publish` calls from `query.ts` and `persister.ts`. Error notification becomes the orchestrator's responsibility.

**Rationale**: 
- `query.ts:169` — Generator publishes error AND yields error event. Duplicate notification. Remove the publish.
- `persister.ts:393,409` — Persister publishes errors. This mixes classification with notification. The orchestrator should publish after receiving the classified result.

### D5: SessionResult Type

**Decision**: Return `SessionResult` from `runSessionInner()`. Eliminate the `Message.stream()` re-query and `Error: Impossible` guard.

**Rationale**: The persister already holds the completed message in memory (`getCompletedMessage()`). Returning it directly eliminates the DB round-trip and the crash-on-empty-result bug.

### D6: PromiseTracker Scope

**Decision**: Session-scoped PromiseTracker, created in `runSessionInner()`, passed to event consumers.

**Rationale**: The tracker must survive across turns (a checkpointer write from turn N might complete during turn N+1). Session scope ensures all promises are tracked for the full session lifetime and flushed during cleanup.

### D7: CorrectionInjector DB Writes

**Decision**: **Defer** — CorrectionInjector writes are tolerated during this phase.

**Rationale**: Correction messages are synthetic messages injected between turns. They need to be persisted for session recovery. Migrating them to the checkpointer is possible but adds scope. The current behavior is correct — it just uses direct DB calls instead of the checkpointer interface. This can be migrated in a follow-up.

### D8: Telemetry DB Reads

**Decision**: **Defer** — Telemetry span reads from DB are tolerated.

**Rationale**: Lines 326 and 352 read message history for OpenTelemetry span attributes. These are in the `runSession()` wrapper, not in the hot path. After Phase 2, the buffer is available — these can trivially switch to buffer reads in a follow-up.

---

## R4: Reference Implementation — LangGraphJS (`D:\langgraphjs`)

### R4.1: BaseCheckpointSaver Interface

**Source**: [`libs/checkpoint/src/base.ts`](file:///D:/langgraphjs/libs/checkpoint/src/base.ts)

LangGraph's checkpointer is an **abstract class** with 4 required methods:

```typescript
abstract class BaseCheckpointSaver<V> {
  serde: SerializerProtocol = new JsonPlusSerializer()
  
  abstract getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined>
  abstract list(config: RunnableConfig, options?): AsyncGenerator<CheckpointTuple>
  abstract put(config, checkpoint, metadata, newVersions): Promise<RunnableConfig>
  abstract putWrites(config, writes: PendingWrite[], taskId: string): Promise<void>
  abstract deleteThread(threadId: string): Promise<void>
  
  getNextVersion(current: V | undefined): V  // Default: integer increment
}
```

**Key observations**:
- **Generic `PendingWrite` type**: `[Channel, PendingWriteValue]` — a 2-tuple of channel name + value. Very generic but loses type safety. Our `PersistenceOp` discriminated union is strictly better for our use case.
- **Config-driven addressing**: All methods take `RunnableConfig` with `thread_id` + `checkpoint_ns` + `checkpoint_id`. We use `SessionID` directly — simpler and sufficient.
- **Serde layer**: LangGraph serializes everything through `JsonPlusSerializer` before storage. Our messages are already JSON-native — no need for this.
- **Version tracking**: `channel_versions` + `versions_seen` enable time-travel. We don't need this for forward-only execution.

**What we borrow**: The interface shape (abstract class with multiple implementations). What we reject: the generic channel model, serde layer, and version tracking.

### R4.2: MemorySaver Implementation

**Source**: [`libs/checkpoint/src/memory.ts`](file:///D:/langgraphjs/libs/checkpoint/src/memory.ts)

```typescript
class MemorySaver extends BaseCheckpointSaver {
  storage: Record<string, Record<string, Record<string, [Uint8Array, Uint8Array, string | undefined]>>> = {}
  writes: Record<string, Record<string, [string, string, Uint8Array]>> = {}
}
```

**Key observations**:
- Triple-nested `Record` for `thread_id → checkpoint_ns → checkpoint_id`. Overly complex for testing.
- Still goes through serde for storage — even in-memory values are serialized/deserialized.
- Our `MemoryCheckpointer` should be dead simple: `Map<SessionID, Message.WithParts[]>`.

### R4.3: SqliteSaver Implementation

**Source**: [`libs/checkpoint-sqlite/src/index.ts`](file:///D:/langgraphjs/libs/checkpoint-sqlite/src/index.ts)

```typescript
class SqliteSaver extends BaseCheckpointSaver {
  db: DatabaseType
  
  async put(config, checkpoint, metadata): Promise<RunnableConfig> {
    // INSERT OR REPLACE INTO checkpoints ...
    this.db.prepare(`INSERT OR REPLACE INTO checkpoints ...`).run(...)
  }
  
  async putWrites(config, writes, taskId): Promise<void> {
    // Transaction wrapping multiple INSERT OR REPLACE INTO writes
    const transaction = this.db.transaction(rows => { ... })
    transaction(rows)
  }
}
```

**Key observations**:
- WAL mode (`journal_mode=WAL`) for concurrent readers.
- `putWrites` uses a transaction — our `SqliteCheckpointer.write(ops)` should do the same for atomicity.
- Schema: `checkpoints(thread_id, checkpoint_ns, checkpoint_id, ...)` + `writes(thread_id, checkpoint_ns, checkpoint_id, task_id, idx, ...)`. We don't need this schema — our existing `Session.updateMessage/updatePart` already handles it.

### R4.4: PregelLoop — Promise Tracking Pattern (CRITICAL)

**Source**: [`libs/langgraph-core/src/pregel/loop.ts:276-301`](file:///D:/langgraphjs/libs/langgraph-core/src/pregel/loop.ts#L276-L301)

This is the exact pattern referenced in our roadmap:

```typescript
class PregelLoop {
  checkpointerPromises: Set<Promise<unknown>> = new Set()
  
  protected _trackCheckpointerPromise(promise: Promise<unknown>) {
    const tracked = promise.then(
      (value) => {
        this.checkpointerPromises.delete(tracked)  // Auto-remove on success
        return value
      },
      (error) => {
        // Keep failed promises in the set so errors surface via Promise.all()
        throw error
      }
    )
    this.checkpointerPromises.add(tracked)
  }
}
```

**Key observations**:
- **Auto-remove on success, keep on failure** — This ensures `Promise.all(checkpointerPromises)` in the `finally` block of `_streamIterator` surfaces any errors that occurred asynchronously.
- **Session-scoped lifetime** — The `Set` lives on `PregelLoop`, which corresponds to a single graph invocation. Our `PromiseTracker` should live in `runSessionInner()`.
- **Chained writes** (line 534-551): `_checkpointerPutAfterPrevious` chains checkpoint puts sequentially to preserve ordering. We may need this for ordered message persistence.

### R4.5: PregelLoop — Tick/Execute Architecture

**Source**: [`libs/langgraph-core/src/pregel/loop.ts:747-896`](file:///D:/langgraphjs/libs/langgraph-core/src/pregel/loop.ts#L747-L896)

```
PregelLoop.tick()        ← Advances state machine by one step
  ├── _first()           ← Process input (first tick only)
  ├── _applyWrites()     ← Apply pending writes to channels
  ├── _putCheckpoint()   ← Persist checkpoint (tracked promise)
  └── _prepareNextTasks() ← Determine what runs next
```

**Key observations**:
- **Status enum**: `"pending" | "done" | "interrupt_before" | "interrupt_after" | "out_of_steps"` — maps to our `SessionResult`.
- **`finishAndHandleError()`** (line 898): Persists the final checkpoint AND flushes pending writes. Called from `_streamIterator`'s `finally` block. This is the pattern for our cleanup `defer()`.
- **Durability modes**: `"exit"` (persist only on clean exit) vs default (persist after every tick). Our use case is always persist-as-you-go.

### R4.6: PregelLoop — putWrites Pattern

**Source**: [`libs/langgraph-core/src/pregel/loop.ts:558-650`](file:///D:/langgraphjs/libs/langgraph-core/src/pregel/loop.ts#L558-L650)

```typescript
putWrites(taskId: string, writes: PendingWrite<string>[]) {
  // 1. Deduplicate special channel writes (ERROR, INTERRUPT, etc.)
  // 2. Update local checkpointPendingWrites
  // 3. Fire-and-forget: checkpointer.putWrites() via _trackCheckpointerPromise
  // 4. Emit output writes
  if (this.durability !== "exit" && this.checkpointer != null) {
    this._trackCheckpointerPromise(
      this.checkpointer.putWrites(config, writesToSave, taskId)
    )
  }
}
```

**Key observation**: Writes are tracked but NOT awaited inline. The loop continues immediately. This is the exact pattern we want — `checkpointer.write(ops)` returns a promise tracked by `PromiseTracker`, not awaited in the event processing path.

---

## R5: Reference Implementation — Claude Code (`D:\claude-code`)

### R5.1: Query Loop Architecture

**Source**: [`src/query.ts:219-280`](file:///D:/claude-code/src/query.ts#L219-L280)

Claude Code's query loop is an `AsyncGenerator` (same as our `queryLoop`):

```typescript
async function* queryLoop(params: QueryParams, consumedCommandUuids: string[]):
  AsyncGenerator<StreamEvent | Message | TombstoneMessage, Terminal>
```

**Key observations**:
- **Mutable `State` object** (lines 204-217): Carries `messages`, `toolUseContext`, `autoCompactTracking`, `maxOutputTokensRecoveryCount`, etc. Very similar to our `msgsBuffer` + local variables.
- **Continue-site pattern**: Instead of modifying individual fields, Claude Code reassigns the entire `state` object at continue points. Cleaner for reasoning about state transitions.
- **`Terminal` return type**: The generator returns `{ reason: string }` on exit. Equivalent to our `SessionResult`.

### R5.2: Persistence — JSONL Append-Only Log

**Source**: [`src/utils/sessionStorage.ts:532-686`](file:///D:/claude-code/src/utils/sessionStorage.ts#L532-L686)

Claude Code uses a fundamentally different persistence model — append-only JSONL files:

```typescript
class Project {
  // Per-file write queues with batching
  private writeQueues = new Map<string, Array<{ entry: Entry; resolve: () => void }>>()
  private FLUSH_INTERVAL_MS = 100
  
  private enqueueWrite(filePath: string, entry: Entry): Promise<void> {
    return new Promise<void>(resolve => {
      queue.push({ entry, resolve })
      this.scheduleDrain()
    })
  }
  
  private async drainWriteQueue(): Promise<void> {
    for (const [filePath, queue] of this.writeQueues) {
      const batch = queue.splice(0)
      let content = ''
      for (const { entry, resolve } of batch) {
        content += jsonStringify(entry) + '\n'
        resolvers.push(resolve)
      }
      await this.appendToFile(filePath, content)
    }
  }
}
```

**Key observations**:
- **Batched writes**: Claude Code buffers writes and flushes every 100ms. Similar to our `AsyncPersistenceWriter` but with timer-based batching.
- **`trackWrite<T>(fn)`** pattern (line 597): Wraps any write in pending-count tracking. Cleanup awaits `pendingWriteCount === 0`. Identical intent to our `PromiseTracker`.
- **Flush resolvers** (line 558-595): `flush()` returns a `Promise` that resolves when all pending writes complete. Clean cleanup semantics.
- **100MB chunk limit** (line 568): `MAX_CHUNK_BYTES = 100 * 1024 * 1024`. Prevents OOM on large append batches. We should consider a similar limit for our `SqliteCheckpointer.write()`.

### R5.3: Conversation Recovery

**Source**: [`src/utils/conversationRecovery.ts:164-252`](file:///D:/claude-code/src/utils/conversationRecovery.ts#L164-L252)

Claude Code's recovery reconstructs from the JSONL transcript:

```typescript
function deserializeMessagesWithInterruptDetection(serializedMessages: Message[]): DeserializeResult {
  // 1. Migrate legacy attachment types
  // 2. Filter unresolved tool uses
  // 3. Filter orphaned thinking-only assistant messages
  // 4. Filter whitespace-only assistant messages
  // 5. Detect turn interruption (none / interrupted_prompt / interrupted_turn)
  // 6. Append synthetic continuation for interrupted turns
  // 7. Append sentinel assistant message after last user
}
```

**Key observations**:
- **Multi-pass filtering**: Recovery is a sequence of idempotent transformations. Clean and testable.
- **Turn interruption detection** (line 272-333): Classifies the last message state as `none`, `interrupted_prompt`, or `interrupted_turn`. Our checkpointer's `loadHistory()` can adopt this — classify state based on the last message when resuming.
- **Orphaned thinking cleanup**: Filters reasoning parts without end timestamps — exactly what our `stripIncompleteThinking()` does, but at the recovery layer instead of inline.

### R5.4: StreamingToolExecutor

**Source**: [`src/services/tools/StreamingToolExecutor.ts`](file:///D:/claude-code/src/services/tools/StreamingToolExecutor.ts) (referenced from `src/query.ts:96`)

Claude Code has the same streaming tool executor pattern we have:

```typescript
// query.ts:562-567
let streamingToolExecutor = useStreamingToolExecution
  ? new StreamingToolExecutor(tools, canUseTool, toolUseContext)
  : null
```

**Key observations**:
- Created fresh per turn (inside `while(true)`)
- `discard()` method for fallback recovery (line 734)
- Our `StreamingToolExecutor` is already well-aligned with this pattern

### R5.5: Key Architectural Differences

| Concern | LangGraphJS | Claude Code | LiteAI (Current) | LiteAI (Target) |
|---------|-------------|-------------|-------------------|------------------|
| **Persistence** | Checkpointer interface (SQLite/Postgres/Redis/Memory) | JSONL append-only + batched write queue | Direct `Session.updateMessage/Part()` calls | Checkpointer interface (SQLite/Memory/Noop) |
| **Loop** | `PregelLoop.tick()` returns boolean | `async function* queryLoop()` generator | `async function* queryLoop()` generator | Same (no change) |
| **Promise tracking** | `checkpointerPromises: Set<Promise>` with auto-remove on success | `pendingWriteCount` + `flushResolvers` | None (fire-and-forget) | `PromiseTracker` (Set-based, LangGraph pattern) |
| **Result** | `PregelLoop.output` + `status` enum | Generator returns `Terminal { reason: string }` | DB re-query + `Error: Impossible` guard | `SessionResult` discriminated union |
| **Recovery** | Checkpoint restore (full state snapshot) | JSONL deserialize + multi-pass filter | DB re-read (`Message.stream()`) | `checkpointer.loadHistory()` (one-time) |
| **Side-effects** | `_emit()` to stream, no Bus | `yield` to consumer, no global bus | `Bus.publish()` inside persister/generator | Orchestrator-only via `PromiseTracker` |

### R5.6: Patterns We Adopt

1. **LangGraph's `_trackCheckpointerPromise`** → Our `PromiseTracker` (auto-remove on success, keep on failure)
2. **LangGraph's `putWrites` fire-and-forget** → `checkpointer.write(ops)` tracked but not awaited inline
3. **LangGraph's status enum** → Our `SessionResult` discriminated union
4. **Claude Code's `trackWrite<T>(fn)`** → Simplified into `PromiseTracker.track(promise)` 
5. **Claude Code's batched write queue** → Our `EventPersister.drainWrites()` already does this per-event-batch

### R5.7: Patterns We Reject

1. **LangGraph's generic `PendingWrite` channel model** — Too abstract for our message-oriented domain
2. **LangGraph's serde layer** — Our messages are already JSON-native
3. **LangGraph's version/time-travel tracking** — Forward-only architecture doesn't need it
4. **Claude Code's JSONL append-only model** — Our SQLite model is superior for random-access queries
5. **Claude Code's timer-based flush** — Our per-event-batch drain is more deterministic
