# Task Guide: Foundation (Phase 1–2)

**Parent**: [tasks.md](file:///d:/liteai/specs/009-engine-loop-decoupling/tasks.md)

## T001 — Create `PromiseTracker` class

**File**: `packages/core/src/session/engine/promise-tracker.ts`

**What to build** (reference: [contracts/interfaces.md](file:///d:/liteai/specs/009-engine-loop-decoupling/contracts/interfaces.md) §PromiseTracker):

```typescript
export class PromiseTracker {
  private pending: Set<Promise<unknown>> = new Set()

  track(promise: Promise<unknown>): void {
    const tracked = promise.then(
      (value) => { this.pending.delete(tracked); return value },
      (error) => { /* keep in set for error surfacing */ throw error }
    )
    this.pending.add(tracked)
  }

  async flush(): Promise<void> {
    const results = await Promise.allSettled([...this.pending])
    this.pending.clear()
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected")
    if (rejected.length > 0) {
      throw new AggregateError(rejected.map(r => r.reason), "PromiseTracker: tracked promises failed")
    }
  }

  get size(): number { return this.pending.size }
}
```

**Pattern source**: LangGraph `PregelLoop.checkpointerPromises` ([research.md R4.4](file:///d:/liteai/specs/009-engine-loop-decoupling/research.md)). Auto-remove on success, keep on failure. `flush()` uses `Promise.allSettled` → `AggregateError`.

---

## T002 — Write `PromiseTracker` tests

**File**: `packages/core/test/session/engine/promise-tracker.test.ts`

**Test cases** (use `bun:test`, follow existing pattern in [persister.test.ts](file:///d:/liteai/packages/core/test/session/engine/persister.test.ts)):

1. `track() + flush()` — resolved promise auto-removes, flush resolves cleanly
2. `track() rejected` — rejected promise stays in set, flush throws `AggregateError`
3. `size` — returns count of pending (not yet resolved/rejected)
4. `concurrent track()` — multiple promises tracked simultaneously, all surface errors
5. `flush() empty` — flush on empty set resolves without error
6. `mixed resolved/rejected` — only rejected ones surface in `AggregateError`

No mocking needed — pure class, no external dependencies.

---

## T003 — Define `Checkpointer` interface + `SessionResult` type

**File**: `packages/core/src/session/engine/checkpointer.ts`

**What to build** (reference: [contracts/interfaces.md](file:///d:/liteai/specs/009-engine-loop-decoupling/contracts/interfaces.md) §Checkpointer, §SessionResult):

```typescript
import type { Message } from "../message"
import type { MessageID, PartID, SessionID } from "../schema"
import type { PersistenceOp } from "./persistence-writer"

export interface Checkpointer {
  loadHistory(sessionID: SessionID): Promise<Message.WithParts[]>
  write(ops: PersistenceOp[]): Promise<void>
  saveMessage(msg: Message.Assistant | Message.User): Promise<Message.Assistant | Message.User>
  savePart(part: Message.Part): Promise<Message.Part>
  updateMessage(msg: Message.Assistant): Promise<void>
  deletePart(ref: { sessionID: SessionID; messageID: MessageID; partID: PartID }): Promise<void>
  dispose(): Promise<void>
}

export type SessionResult =
  | { status: "ok"; message: Message.WithParts }
  | { status: "error"; error: unknown; message?: Message.WithParts }
  | { status: "aborted" }
```

**Design decision D1**: Message-operation-oriented methods (not generic `putWrites(channel, value)`). See [research.md R3/D1](file:///d:/liteai/specs/009-engine-loop-decoupling/research.md).

---

## T004 — Implement `SqliteCheckpointer`

**File**: `packages/core/src/session/engine/checkpointer.ts` (same file as T003)

**What to build**: Wraps existing `Session.updateMessage()`, `Session.updatePart()`, `Session.updatePartDelta()`, `Session.removePart()`, `Message.filterCompacted(Message.stream())`. Zero behavioral change.

```typescript
import { Session } from ".."
import { Message } from "../message"

export class SqliteCheckpointer implements Checkpointer {
  async loadHistory(sessionID: SessionID): Promise<Message.WithParts[]> {
    return Message.filterCompacted(Message.stream(sessionID))
  }

  async write(ops: PersistenceOp[]): Promise<void> {
    // Absorbs AsyncPersistenceWriter.write() logic
    for (const op of ops) {
      switch (op.type) {
        case "upsert-part": await Session.updatePart(op.part); break
        case "delta-part": await Session.updatePartDelta(op); break
        case "upsert-message": await Session.updateMessage(op.message); break
      }
    }
  }

  async saveMessage(msg: Message.Assistant | Message.User) {
    return Session.updateMessage(msg) as Promise<Message.Assistant | Message.User>
  }

  async savePart(part: Message.Part) {
    return Session.updatePart(part) as Promise<Message.Part>
  }

  async updateMessage(msg: Message.Assistant): Promise<void> {
    await Session.updateMessage(msg)
  }

  async deletePart(ref: { sessionID: SessionID; messageID: MessageID; partID: PartID }): Promise<void> {
    await Session.removePart(ref)
  }

  async dispose(): Promise<void> { /* DB connections managed externally */ }
}
```

**Critical**: This is a mechanical wrap — same `Session.*` calls, just routed through the interface. Zero behavioral change from [persistence-writer.ts](file:///d:/liteai/packages/core/src/session/engine/persistence-writer.ts).

---

## T005 — Implement `MemoryCheckpointer`

**File**: `packages/core/src/session/engine/checkpointer.ts` (same file)

**What to build**: In-memory `Map<SessionID, Message.WithParts[]>` for testing.

```typescript
export class MemoryCheckpointer implements Checkpointer {
  private messages = new Map<string, Message.WithParts[]>()

  async loadHistory(sessionID: SessionID): Promise<Message.WithParts[]> {
    return this.messages.get(sessionID) ?? []
  }

  async write(ops: PersistenceOp[]): Promise<void> {
    for (const op of ops) {
      switch (op.type) {
        case "upsert-part": await this.savePart(op.part); break
        case "upsert-message": {
          // Update message info in the stored WithParts
          const msgs = this.messages.get(op.message.sessionID) ?? []
          const idx = msgs.findIndex(m => m.info.id === op.message.id)
          if (idx >= 0) msgs[idx] = { ...msgs[idx], info: op.message }
          break
        }
        case "delta-part": {
          // Apply text delta to matching part
          const msgs = this.messages.get(op.sessionID) ?? []
          for (const m of msgs) {
            const part = m.parts.find(p => p.id === op.partID)
            if (part && op.field in part) {
              ;(part as Record<string, unknown>)[op.field] =
                ((part as Record<string, unknown>)[op.field] as string ?? "") + op.delta
              break
            }
          }
          break
        }
      }
    }
  }

  async saveMessage(msg: Message.Assistant | Message.User) {
    const sid = msg.sessionID
    const msgs = this.messages.get(sid) ?? []
    msgs.push({ info: msg, parts: [] })
    this.messages.set(sid, msgs)
    return msg
  }

  async savePart(part: Message.Part) {
    const msgs = this.messages.get(part.sessionID) ?? []
    const msg = msgs.find(m => m.info.id === part.messageID)
    if (msg) {
      const idx = msg.parts.findIndex(p => p.id === part.id)
      if (idx >= 0) msg.parts[idx] = part
      else msg.parts.push(part)
    }
    return part
  }

  async updateMessage(msg: Message.Assistant): Promise<void> {
    const msgs = this.messages.get(msg.sessionID) ?? []
    const idx = msgs.findIndex(m => m.info.id === msg.id)
    if (idx >= 0) msgs[idx] = { ...msgs[idx], info: msg }
  }

  async deletePart(ref: { sessionID: SessionID; messageID: MessageID; partID: PartID }): Promise<void> {
    const msgs = this.messages.get(ref.sessionID) ?? []
    const msg = msgs.find(m => m.info.id === ref.messageID)
    if (msg) msg.parts = msg.parts.filter(p => p.id !== ref.partID)
  }

  async dispose(): Promise<void> { this.messages.clear() }
}
```

**Design source**: Simplified from LangGraph `MemorySaver` — flat `Map` vs triple-nested Record ([research.md R4.2](file:///d:/liteai/specs/009-engine-loop-decoupling/research.md)).

---

## T006 — Implement `NoopCheckpointer`

**File**: `packages/core/src/session/engine/checkpointer.ts` (same file)

```typescript
export class NoopCheckpointer implements Checkpointer {
  async loadHistory(): Promise<Message.WithParts[]> { return [] }
  async write(): Promise<void> {}
  async saveMessage(msg: Message.Assistant | Message.User) { return msg }
  async savePart(part: Message.Part) { return part }
  async updateMessage(): Promise<void> {}
  async deletePart(): Promise<void> {}
  async dispose(): Promise<void> {}
}
```

All methods no-op. For ephemeral sessions per [data-model.md §NoopCheckpointer](file:///d:/liteai/specs/009-engine-loop-decoupling/data-model.md).

---

## T007 — Write `Checkpointer` implementation tests

**File**: `packages/core/test/session/engine/checkpointer.test.ts`

**Test strategy**: Test all 3 implementations against the same contract.

### MemoryCheckpointer tests (primary — no mocking needed):
1. `saveMessage` + `loadHistory` — message round-trips
2. `savePart` — part attaches to correct message
3. `updateMessage` — metadata updates reflected in loadHistory
4. `deletePart` — part removed from message
5. `write(ops)` — batch ops applied correctly (upsert-part, upsert-message, delta-part)
6. `dispose` — clears all data
7. `loadHistory` empty session — returns `[]`

### NoopCheckpointer tests:
1. All methods resolve without error
2. `loadHistory` always returns `[]`
3. `saveMessage` returns the input message unchanged

### SqliteCheckpointer tests:
1. Mock `Session.updateMessage`, `Session.updatePart`, `Session.updatePartDelta`, `Session.removePart`, `Message.stream`, `Message.filterCompacted`
2. Verify each checkpointer method delegates to the correct `Session.*` call
3. Verify `write(ops)` iterates ops and calls correct Session method per op type

**Mock pattern**: Use `spyOn` per §9 mandate — no `mock.module` for complex objects.

---

## T008 — Export new modules from engine index

**File**: `packages/core/src/session/engine/index.ts`

Current content is just `export * from "./namespace"`. Add:

```typescript
export * from "./namespace"
export { PromiseTracker } from "./promise-tracker"
export type { Checkpointer, SessionResult } from "./checkpointer"
export { SqliteCheckpointer, MemoryCheckpointer, NoopCheckpointer } from "./checkpointer"
```
