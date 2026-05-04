# Data Model: Engine Loop Decoupling

**Date**: 2026-05-04  
**Scope**: `packages/core/src/session/engine/`

## Entities

### Checkpointer (Interface)

The abstract persistence contract. Storage-agnostic — implementations determine durability guarantees.

```
Checkpointer
├── saveMessage(msg: Message.Assistant | Message.User)  → Promise<void>
├── savePart(part: Message.Part)                         → Promise<void>
├── updateMessage(msg: Message.Assistant)                → Promise<void>
├── deletePart(ref: { sessionID, messageID, partID })    → Promise<void>
├── loadHistory(sessionID: SessionID)                    → Promise<Message.WithParts[]>
├── write(ops: PersistenceOp[])                          → Promise<void>
│     ↑ Batch interface for draining EventPersister write queue
└── dispose()                                            → Promise<void>
```

**State transitions**: None — Checkpointer is stateless from the interface perspective. Implementations may hold internal buffers (e.g., `SqliteCheckpointer` batching).

**Relationships**:
- Consumed by: `runSessionInner()`, `processSubtask()`
- Implementations: `SqliteCheckpointer`, `MemoryCheckpointer`, `NoopCheckpointer`

### SqliteCheckpointer (Implementation)

Wraps `Session.updateMessage()`, `Session.updatePart()`, `Session.updatePartDelta()`, `Session.removePart()`, `Message.filterCompacted(Message.stream())`. Zero behavioral change from current path.

```
SqliteCheckpointer implements Checkpointer
├── write(ops) → iterates ops, delegates to Session.* methods
│     ↑ Absorbs AsyncPersistenceWriter.write() logic
├── saveMessage(msg) → Session.updateMessage(msg)
├── savePart(part) → Session.updatePart(part)
├── updateMessage(msg) → Session.updateMessage(msg)
├── deletePart(ref) → Session.removePart(ref)
├── loadHistory(sessionID) → Message.filterCompacted(Message.stream(sessionID))
└── dispose() → no-op (DB connections managed externally)
```

### MemoryCheckpointer (Implementation)

In-memory storage for testing. Messages stored in `Map<SessionID, Message.WithParts[]>`.

```
MemoryCheckpointer implements Checkpointer
├── messages: Map<SessionID, Message.WithParts[]>
├── write(ops) → applies ops to in-memory map
├── saveMessage(msg) → append to messages[sessionID]
├── savePart(part) → append to matching message's parts
├── updateMessage(msg) → replace matching message info
├── deletePart(ref) → filter out from matching message's parts
├── loadHistory(sessionID) → return messages[sessionID] ?? []
└── dispose() → clear map
```

### NoopCheckpointer (Implementation)

Discards all operations. For ephemeral sessions.

```
NoopCheckpointer implements Checkpointer
├── write(ops) → no-op
├── saveMessage(msg) → no-op
├── savePart(part) → no-op
├── updateMessage(msg) → no-op
├── deletePart(ref) → no-op
├── loadHistory(sessionID) → return []
└── dispose() → no-op
```

### EventConsumer (Interface)

Receives engine events independently. Multiple consumers can be registered.

```
EventConsumer
└── handleEvent(event: EngineEvent.Any) → Promise<void> | void
```

**Implementations**:
- `CheckpointerConsumer` — routes events to checkpointer write ops
- `SSETransportConsumer` — routes events to Bus.publish for SSE forwarding
- `TelemetryConsumer` (future) — routes events to telemetry collector

### PromiseTracker

Tracks async promises spawned during loop execution. Ensures all complete before cleanup.

```
PromiseTracker
├── pending: Set<Promise<unknown>>
├── track(promise: Promise<unknown>) → void
│     ↑ Adds promise to set, auto-removes on resolution
├── flush() → Promise<void>
│     ↑ Awaits all pending promises, surfaces errors
└── size → number
      ↑ Current count of pending promises
```

**Lifecycle**: Created at session start. Passed to event consumers. Flushed during cleanup (`defer` block).

### SessionResult (Type)

Discriminated union representing loop outcome.

```
SessionResult
├── { status: "ok"; message: Message.WithParts }
├── { status: "error"; error: unknown; message?: Message.WithParts }
└── { status: "aborted" }
```

**Produced by**: `runSessionInner()`  
**Consumed by**: `loop()` — resolves queued callbacks, publishes error notifications

## Validation Rules

- `Checkpointer.saveMessage()`: Message MUST have a valid `id`, `sessionID`, and `role`.
- `Checkpointer.savePart()`: Part MUST have a valid `id`, `messageID`, and `sessionID`.
- `Checkpointer.loadHistory()`: MUST return messages in creation order (ascending by `id`).
- `PromiseTracker.flush()`: MUST throw `AggregateError` if any tracked promise rejected.
- `SessionResult.status === "ok"`: MUST include a non-null `message` with at least one part.

## Relationships

```
loop()
  └─ runSessionInner()
       ├── checkpointer.loadHistory()     ← Initial state (one-time)
       ├── queryLoop()                    ← Generator (forward-only)
       │     └── yields EngineEvent.Any
       ├── EventPersister.handleEvent()   ← Event classification (sync)
       ├── EventPersister.drainWrites()   ← Batch ops
       ├── checkpointer.write(ops)        ← Persistence (tracked)
       ├── processSubtask()               ← Uses checkpointer for child writes
       │     ├── checkpointer.saveMessage()
       │     └── checkpointer.savePart()
        └── PromiseTracker.flush()         ← Cleanup (await all)
```

## Reference Provenance

| Entity | LangGraph Source | Claude Code Source | Design Divergence |
|--------|--------------------|-----------------------|-------------------|
| **Checkpointer** | `BaseCheckpointSaver` in `libs/checkpoint/src/base.ts` — abstract class with `put`/`putWrites`/`getTuple`/`list` | N/A (JSONL append-only) | Message-operation methods instead of generic `putWrites(channel, value)`. No serde layer. No version tracking. |
| **SqliteCheckpointer** | `SqliteSaver` in `libs/checkpoint-sqlite/src/index.ts` — WAL mode, transactional `putWrites` | `Project.drainWriteQueue` in `src/utils/sessionStorage.ts:645` — batched JSONL append | Delegates to existing `Session.updateMessage/Part()`. Uses existing schema, not LangGraph's `checkpoints`/`writes` tables. |
| **MemoryCheckpointer** | `MemorySaver` in `libs/checkpoint/src/memory.ts` — triple-nested Record, serde round-trip | N/A | Flat `Map<SessionID, Message.WithParts[]>`. No serde. |
| **PromiseTracker** | `PregelLoop.checkpointerPromises` in `libs/langgraph-core/src/pregel/loop.ts:276-301` — `Set<Promise>`, auto-remove on success | `Project.trackWrite` in `src/utils/sessionStorage.ts:597` — pending counter + flush resolvers | LangGraph's Set-based pattern with Claude Code's flush semantics. |
| **SessionResult** | `PregelLoop.status` in `loop.ts:263-268` — 5-value string enum | `Terminal` in `src/query.ts:104` — `{ reason: string }` | Discriminated union with completed message, eliminating DB re-query. |
| **EventConsumer** | `PregelLoop._emit()` in `loop.ts:652` — pushes to stream | `yield` in `queryLoop` at `src/query.ts:241` | Interface-based multi-consumer with independent PromiseTracker tracking. |

