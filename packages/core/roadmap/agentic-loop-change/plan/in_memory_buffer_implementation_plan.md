# Implementation Plan: In-Memory Message Buffer

Replaces per-turn SQLite re-reads in the agentic loop with a shared in-memory buffer.
Spec: `specs/in_memory_message_buffer.md`

---

## Architecture Summary

```
Session start:  loop.ts reads DB once → msgsBuffer
Each turn:      query.ts reads msgsBuffer (no DB) → LLM call → loop.ts writes DB + updates msgsBuffer
After compact:  loop.ts resets msgsBuffer = [compaction_marker, summary_msg]  (both already in-memory)
```

The buffer IS the live `filterCompacted()` view — updated incrementally after each event, never re-read from DB.

---

## Phase 1: Persister In-Memory Accumulation

**Target:** `src/session/engine/persister.ts`

**Goal:** Persister retains all parts in memory throughout the turn so `loop.ts` can build the buffer update without a DB read.

### Tasks

**1.1 — Add `allParts` accumulator**

Add a private field to `EventPersister`:
```typescript
private allParts: Message.Part[] = []
```

After every `Session.updatePart(part)` call in `handleEvent()`, push the returned part:
```typescript
const written = await Session.updatePart({...})
this.allParts.push(written as Message.Part)
```

For _updates_ to existing parts (e.g. tool call going from `pending` → `running` → `completed`), find-and-replace by `id`:
```typescript
private upsertPart(part: Message.Part) {
  const idx = this.allParts.findIndex(p => p.id === part.id)
  if (idx >= 0) this.allParts[idx] = part
  else this.allParts.push(part)
}
```

**1.2 — Keep tool parts after result (stop deleting)**

Remove `delete this.toolcalls[event.id]` from the `result` case (line 275 of persister.ts).
The `toolcalls` map is still used for in-flight lookup; just don't evict on completion.

**1.3 — Replace `Message.parts()` DB read in `flush()`**

Lines 376-396 currently read `const p = await Message.parts(assistantMessage.id)`.
Replace with the in-memory list:
```typescript
// REMOVE:
const p = await Message.parts(assistantMessage.id)

// REPLACE WITH:
const p = this.allParts
```

All downstream logic (`p.type === "tool" && p.state.status !== "completed"...`) is identical.

**1.4 — Add `getCompletedMessage()` method**

```typescript
public getCompletedMessage(): Message.WithParts {
  return {
    info: this.assistantMessage,
    parts: [...this.allParts],
  }
}
```

**Verification:**
```
bun typecheck
grep -n "Message.parts" src/session/engine/persister.ts  # must return 0 results
```

---

## Phase 2: Shared Buffer Wiring

**Target:** `src/session/engine/loop.ts` and `src/session/engine/query.ts`

**Goal:** `query.ts` reads from shared buffer. `loop.ts` owns and maintains it.

### Tasks

**2.1 — Add `msgsBuffer` to `QueryLoopParams`**

```typescript
// query.ts
export type QueryLoopParams = {
  sessionID: SessionID
  session: Session.Info
  abort: AbortSignal
  msgsBuffer: { current: Message.WithParts[] }
}
```

**2.2 — Replace DB read in `query.ts`**

```typescript
// REMOVE (line 77 of query.ts):
let msgs = await Message.filterCompacted(Message.stream(sessionID))

// REPLACE WITH:
let msgs = params.msgsBuffer.current
```

Remove `Message.stream` and `Message.filterCompacted` imports from `query.ts` if no longer used.

**2.3 — Initialize buffer in `runSession()` in `loop.ts`**

```typescript
async function runSession(input: { sessionID, session, abort }) {
  // Single initial DB read — only time DB is read for messages
  const msgsBuffer: { current: Message.WithParts[] } = {
    current: await Message.filterCompacted(Message.stream(input.sessionID)),
  }

  const generator = queryLoop({
    sessionID: input.sessionID,
    session: input.session,
    abort: input.abort,
    msgsBuffer,
  })
  // ...
}
```

**2.4 — Append to buffer after `turn-end`**

In the `turn-end` case of `runSession()`, after `persister.flush()`:
```typescript
case "turn-end": {
  const flushResult = await persister.flush(currentStreamResult)
  currentStreamResult = undefined

  // Update buffer with this turn's completed message (no DB read)
  if (persister) {
    msgsBuffer.current = [...msgsBuffer.current, persister.getCompletedMessage()]
  }

  // ...rest of turn-end handling unchanged...
}
```

**Verification:** Run a 3-turn session with tool calls. Confirm each turn's LLM call receives correct context (tool results from previous turns visible).

---

## Phase 3: Compaction Buffer Reset (No DB Re-Read)

**Target:** `src/session/engine/loop.ts`

**Goal:** After compaction, reset the buffer to the two in-memory messages that were just written — no DB re-read required.

### Key Insight

`SessionCompaction.create()` and `SessionCompaction.process()` both return/produce the written messages. After compaction, `loop.ts` has:
- `compactionUserMsg` — the marker user message with `type: "compaction"` part (returned by `create()` internally, needs exposure)
- `summaryAssistantMsg` — the assistant message with the summary text (already in `processor.message` inside `SessionCompaction.process()`)

The new buffer is simply `[compactionUserMsg, summaryAssistantMsg]`.

### Tasks

**3.1 — Expose written messages from `SessionCompaction.create()`**

Currently `create()` returns `undefined`. Change it to return the written user message:
```typescript
// compaction.ts
export const create = fn(..., async (input) => {
  const msg = await Session.updateMessage({...})
  await Session.updatePart({...type: "compaction"...})
  return msg  // ← return the created message
})
```

**3.2 — Expose `summaryMessage` from `SessionCompaction.process()`**

`process()` already has `const msg = (await Session.updateMessage({...summary: true...})) as Message.Assistant` and `processor.message`. After the summary stream completes, assemble the `WithParts` for the buffer:
```typescript
// At end of process(), before return:
const summaryWithParts: Message.WithParts = {
  info: processor.message,
  parts: await Message.parts(processor.message.id),  // one targeted read, inside process()
}
return { result: "continue", summaryWithParts }
```

**3.3 — Update buffer after all compaction paths**

`control` → `compact` case:
```typescript
case "compact": {
  const { lastUser } = event.payload
  const compactionMarker = await SessionCompaction.create({...})
  // compactionMarker is now returned
  const { summaryWithParts } = await SessionCompaction.process({...parentID: compactionMarker.id})
  const compactionMarkerWithParts: Message.WithParts = {
    info: compactionMarker,
    parts: await Message.parts(compactionMarker.id),  // small: just the compaction part
  }
  msgsBuffer.current = [compactionMarkerWithParts, summaryWithParts]
  break
}
```

> Note: The two `Message.parts()` reads here are **inside the compaction path**, not the hot path. Compaction is rare (context overflow), so this is acceptable. Alternatively, these parts can be accumulated in-memory during creation and returned without a DB read.

**3.4 — Same pattern for `overflow` and `turn-end` → `"compact"` cases**

Apply the same buffer reset logic to all paths that trigger compaction.

**Verification:** Trigger compaction in a test. Assert `msgsBuffer.current.length === 2` immediately after compaction. Assert next LLM call sends only 2 messages.

---

## Phase 4: Subtask Buffer Update

**Target:** `src/session/engine/loop.ts` — `processSubtask()`

**Goal:** Messages written by `processSubtask()` are reflected in the buffer.

### Tasks

**4.1 — Return written messages from `processSubtask()`**

`processSubtask()` creates:
1. `assistantMessage` — the subtask assistant message
2. `part` — a tool part on that assistant message
3. Optionally: a synthetic `summaryUserMsg` (only when `task.command` is set)

Change the function to return these:
```typescript
async function processSubtask(input: ...): Promise<{
  subtaskAssistant: Message.WithParts
  syntheticUser?: Message.WithParts
}> {
  // ...existing logic...
  // At the end, assemble WithParts from in-memory objects:
  return {
    subtaskAssistant: { info: assistantMessage, parts: [part] },
    syntheticUser: task.command ? { info: summaryUserMsg, parts: [summaryTextPart] } : undefined,
  }
}
```

**4.2 — Append to buffer after subtask**

```typescript
case "subtask": {
  const { subtaskAssistant, syntheticUser } = await processSubtask({...})
  msgsBuffer.current = [
    ...msgsBuffer.current,
    subtaskAssistant,
    ...(syntheticUser ? [syntheticUser] : []),
  ]
  break
}
```

---

## Phase 5: Verification & Cleanup

### Tasks

**5.1 — Import audit on `query.ts`**
```
grep -n "Message.stream\|filterCompacted\|Message.parts" src/session/engine/query.ts
```
Must return zero results.

**5.2 — Import audit on `persister.ts`**
```
grep -n "Message.parts" src/session/engine/persister.ts
```
Must return zero results (the `flush()` re-read is eliminated).

**5.3 — Run full test suite**
```
bun test
bun typecheck
```

**5.4 — Buffer integrity test**

Write a test that:
1. Runs a 3-turn session with tool calls
2. After each turn, asserts `msgsBuffer.current.length` increments correctly
3. After compaction, asserts `msgsBuffer.current.length === 2`
4. Asserts DB still contains full history (all pre-compaction messages present)

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Part upsert misses an update (stale part in buffer) | Medium | High | Careful `upsertPart()` by ID in Phase 1 |
| Compaction WithParts assembly misses parts | Low | High | Phase 3 targeted `Message.parts()` reads are inside compaction — acceptable |
| Subtask synthetic user message conditionally missing | Medium | Medium | Phase 4 mirrors the `task.command` conditional exactly |
| Retry leaves partial allParts in persister | Low | Medium | Document that allParts reflects final state after last successful flush |
| `prune()` runs post-loop, mutates DB | None | None | Buffer is discarded when loop exits — no impact |

---

## Ordering & Dependencies

```
Phase 1 (persister accumulation)
    ↓
Phase 2 (buffer wiring — depends on Phase 1 for getCompletedMessage)
    ↓
Phase 3 (compaction — depends on Phase 2 for msgsBuffer access)
    ↓
Phase 4 (subtask — depends on Phase 2 for msgsBuffer access)
    ↓
Phase 5 (verification)
```

Phases 3 and 4 can be developed in parallel after Phase 2.

---

## Estimated Effort

| Phase | Effort |
|-------|--------|
| Phase 1: Persister accumulation + expose method | ~2 hours |
| Phase 2: Buffer wiring (loop + query) | ~1.5 hours |
| Phase 3: Compaction reset (expose from create/process) | ~2 hours |
| Phase 4: Subtask buffer update | ~1 hour |
| Phase 5: Verification + cleanup | ~1 hour |
| **Total** | **~7.5 hours** |
