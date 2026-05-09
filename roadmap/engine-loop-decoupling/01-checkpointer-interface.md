# Phase 1: Checkpointer Interface

> **Status**: ✅ **DONE** (completed 2026-05-09)  
> **Depends on**: Nothing  
> **Enables**: Phase 2 (Self-Contained Loop), Phase 5 (Backward Execution)  
> **Estimated scope**: ~8 files modified, ~3 new files
>
> **Implemented in**: `packages/core/src/session/engine/loop/checkpointer.ts`  
> **What was built**: `Checkpointer` interface, `SqliteCheckpointer`, `MemoryCheckpointer`, `NoopCheckpointer`, `PersistenceOp` union type. `CheckpointStore` + `CheckpointManager` for in-memory lifecycle management. All `processSubtask()` DB writes migrated to checkpointer ops.

---

## Goal

Extract the persistence contract from the concrete `EventPersister` + SQLite implementation into an abstract `Checkpointer` interface. The loop's event consumer should depend on the interface, not the implementation.

---

## Design

### The Interface

Borrowing from LangGraph's `BaseCheckpointSaver` but adapted to LiteAI's message-based model:

```typescript
// packages/core/src/session/engine/checkpointer.ts

export interface Checkpointer {
  /** Persist an assistant message (turn-start) */
  saveMessage(msg: Message.Assistant): Promise<void>

  /** Persist a message part (streaming event) */
  savePart(part: Message.Part): Promise<void>

  /** Update an existing message (turn-end metadata, finish reason, usage) */
  updateMessage(msg: Message.Assistant): Promise<void>

  /** Load conversation history for a session (used at loop init, NOT during forward execution) */
  loadHistory(sessionID: SessionID): AsyncIterable<Message.WithParts>

  /** Persist session-level metadata (summary, diff, etc.) */
  saveSessionMetadata(sessionID: SessionID, metadata: SessionMetadata): Promise<void>

  /** Dispose / flush pending writes */
  dispose(): Promise<void>
}
```

### Implementations

#### `SqliteCheckpointer`
Wraps the current `Session.updateMessage()`, `Session.updatePart()`, `Message.stream()` calls. This is a 1:1 extraction of what `EventPersister` currently does — zero behavioral change.

#### `MemoryCheckpointer`
Stores messages and parts in `Map<string, Message.WithParts[]>`. For unit testing only. Enables testing the engine without SQLite.

#### `NoopCheckpointer`
Does nothing. For ephemeral sessions where persistence is explicitly unwanted.

---

## Current Code to Extract

### `EventPersister` (persister.ts)

Currently does TWO things:
1. **Event classification** — receives raw `EngineEvent` and classifies it (text delta, tool call, error, etc.)
2. **Persistence** — calls `Session.updateMessage()`, `Session.updatePart()` directly

These must be separated:
- **Event classification** stays in a renamed `EventClassifier` (or stays as `EventPersister` but loses the DB calls)
- **Persistence** moves to the `Checkpointer` implementation

### `AsyncPersistenceWriter` (persistence-writer.ts)

Currently batches DB writes. This becomes an internal detail of `SqliteCheckpointer` — the checkpointer interface is synchronous from the loop's perspective (fire-and-track, not fire-and-forget).

---

## Files to Change

| File | Change |
|---|---|
| `[NEW] checkpointer.ts` | `Checkpointer` interface + `MemoryCheckpointer` + `NoopCheckpointer` |
| `[NEW] sqlite-checkpointer.ts` | `SqliteCheckpointer` wrapping current DB calls |
| `[MODIFY] persister.ts` | Remove direct DB calls, accept `Checkpointer` via constructor injection |
| `[MODIFY] loop.ts` | `runSessionInner` receives `Checkpointer` instead of creating `EventPersister` with hardcoded DB |
| `[MODIFY] persistence-writer.ts` | Move into `SqliteCheckpointer` as internal batching strategy |

---

## Verification

- `bun typecheck` passes
- `bun test test/session` — all existing tests pass (SqliteCheckpointer preserves current behavior)
- New unit test: engine runs with `MemoryCheckpointer`, produces correct assistant message without DB

---

## Analysis Tasks (for future sessions)

- [ ] Audit all `Session.updateMessage` / `Session.updatePart` call sites outside `EventPersister` — some may need to go through the checkpointer
- [ ] Determine if `loadHistory` should support pagination or always return full history
- [ ] Evaluate whether snapshot (git write-tree) operations belong in the checkpointer or remain separate
