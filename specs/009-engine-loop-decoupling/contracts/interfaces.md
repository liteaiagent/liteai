# Interface Contracts: Engine Loop Decoupling

**Date**: 2026-05-04

## Checkpointer Interface

```typescript
import type { Message } from "../message"
import type { MessageID, PartID, SessionID } from "../schema"
import type { PersistenceOp } from "./persistence-writer"

/**
 * Abstract persistence interface for the engine loop.
 * 
 * The loop delegates ALL persistence operations through this interface.
 * Implementations determine storage backend and durability guarantees.
 * 
 * Contract:
 * - `loadHistory()` is called ONCE at loop initialization
 * - `write()` / `saveMessage()` / `savePart()` are called during forward execution
 * - The loop does NOT depend on write completion for forward progress
 * - `dispose()` is called during cleanup — implementations should flush pending writes
 */
export interface Checkpointer {
  /**
   * Load conversation history for a session.
   * Called ONCE at loop init — NOT during forward execution.
   * Returns messages in creation order (ascending by ID).
   */
  loadHistory(sessionID: SessionID): Promise<Message.WithParts[]>

  /**
   * Batch write persistence operations.
   * Maps directly from EventPersister.drainWrites() output.
   * Implementations should handle all PersistenceOp discriminants.
   */
  write(ops: PersistenceOp[]): Promise<void>

  /** Persist a new message (assistant or synthetic user). */
  saveMessage(msg: Message.Assistant | Message.User): Promise<Message.Assistant | Message.User>

  /** Persist a message part. */
  savePart(part: Message.Part): Promise<Message.Part>

  /** Update an existing message (metadata, finish reason, cost, tokens). */
  updateMessage(msg: Message.Assistant): Promise<void>

  /** Delete a specific part from a message. */
  deletePart(ref: { sessionID: SessionID; messageID: MessageID; partID: PartID }): Promise<void>

  /** Flush pending writes and release resources. */
  dispose(): Promise<void>
}
```

## EventConsumer Interface

```typescript
import type { EngineEvent } from "../events"

/**
 * Receives engine events independently from other consumers.
 * Multiple consumers can be registered on a single loop.
 * 
 * Contract:
 * - Each consumer receives EVERY event
 * - Failures in one consumer do NOT prevent delivery to others
 * - Returned promises are tracked via PromiseTracker
 */
export interface EventConsumer {
  handleEvent(event: EngineEvent.Any): Promise<void> | void
}
```

## SessionResult Type

```typescript
import type { Message } from "../message"

/**
 * Typed result from a single session loop execution.
 * Eliminates the DB re-query and "Error: Impossible" guard.
 */
export type SessionResult =
  | { status: "ok"; message: Message.WithParts }
  | { status: "error"; error: unknown; message?: Message.WithParts }
  | { status: "aborted" }
```

## PromiseTracker

```typescript
/**
 * Tracked set of async promises spawned during loop execution.
 * Borrowed from LangGraph's checkpointerPromises pattern.
 * 
 * Contract:
 * - All promises added via track() MUST complete before session cleanup
 * - flush() surfaces ALL errors (no silent swallowing)
 * - Thread-safe for concurrent track() calls
 */
export class PromiseTracker {
  private pending: Set<Promise<unknown>>

  /** Track a promise. Auto-removed on resolution. Kept on rejection for error surfacing. */
  track(promise: Promise<unknown>): void

  /** Await all pending promises. Throws AggregateError if any failed. */
  flush(): Promise<void>

  /** Current number of pending promises. */
  get size(): number
}
```
