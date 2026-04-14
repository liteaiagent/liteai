# Spec: In-Memory Message Buffer for Agentic Loop

## Overview

Replace the per-turn SQLite re-read in `query.ts` with an in-memory message buffer maintained by the orchestrator (`loop.ts`). The database remains the persistence layer but is no longer the **communication channel** between turns of the agentic loop.

---

## Problem Statement

Currently, `query.ts` re-reads all session messages from SQLite at the start of every `while(true)` iteration:

```typescript
let msgs = await Message.filterCompacted(Message.stream(sessionID))
```

This read exists solely to pick up data that `loop.ts` wrote to DB during the previous turn (tool results, assistant message, new parts). The DB is being used as an exchange medium between two in-process functions — introducing unnecessary I/O latency on every turn.

Additionally, `persister.ts` has a second DB read inside `flush()`:

```typescript
const p = await Message.parts(assistantMessage.id)  // reads back what it just wrote
```

This read exists to find any incomplete tool calls for cleanup — data the persister already held in memory moments earlier.

### Goals

1. Eliminate DB reads from the hot path of the agentic loop (every turn).
2. Keep DB writes intact — the database remains the source of truth for persistence and crash recovery.
3. Maintain full behavioral parity with the current implementation.
4. Keep the generator protocol (`for await`) in `loop.ts` unchanged.

### Non-Goals

- Elminating DB reads from session initialization (first read before loop starts is fine).
- Changing the public API of `loop()`, `prompt()`, `cancel()`, or `state()`.

---

## Background: How Compaction Actually Works

Understanding compaction is critical to the buffer design. The dual-view model is:

```
UI display:   Message.stream()     → ALL messages including pre-compaction (full history)
LLM context:  filterCompacted()    → only from compaction boundary forward
```

**Compaction creates exactly two new messages:**

```
SessionCompaction.create()  → user8   { parts: [{ type: "compaction" }] }  (trigger marker)
SessionCompaction.process() → asst9   { summary: true, text: "## Goal..." } (LLM summary)
                               with parentID = user8.id
```

`filterCompacted()` streams messages newest-first, finds `asst9` (adds `user8.id` to `completed`), then finds `user8` (whose ID is now in `completed` AND has a compaction part) and **breaks**. After reversing, the result is:

```
filterCompacted returns: [user8, asst9]
```

The LLM sees only:
- `user8` compaction part → `"What did we do so far?"`
- `asst9` summary text → `"## Goal\n..."`

Everything before `user8` stays in the DB for the UI but never reaches the LLM.

**Key implication for the buffer:** Both `user8` and `asst9` are written by `loop.ts` itself during compaction. `loop.ts` already holds them in-memory. No DB re-read is needed. The buffer simply resets to `[user8, asst9]` after compaction.

### Comparison with liteai_cli_mvp

liteai_cli_mvp keeps the entire message history as a single live JavaScript array with no database. Compaction replaces the array with `buildPostCompactMessages(result)` — a `[boundaryMarker, ...summaryMessages, ...attachments]` splice. `getMessagesAfterCompactBoundary()` is a simple backwards scan + `messages.slice(boundaryIndex)`.

Our buffer approach mirrors this exactly: after compaction, reset the buffer to just the new boundary messages. The full pre-compaction history remains in DB for UI display.

---

## Proposed Architecture

### Core Idea: Shared Mutable Buffer

The orchestrator (`loop.ts`) owns a `msgsBuffer` object shared by reference with `query.ts`:

```
Session start:
  loop.ts: msgsBuffer = { current: await filterCompacted(Message.stream(sessionID)) }

Each turn:
  query.ts reads:  msgsBuffer.current  (instead of DB read)
  loop.ts writes to DB (persistence) AND updates msgsBuffer.current in-memory

After compaction:
  loop.ts resets:  msgsBuffer.current = [compactionUserMsg, summaryAssistantMsg]
```

The generator protocol (`for await`) requires no changes.

### Buffer Update Rules

| Event | Buffer Update |
|-------|--------------|
| Turn ends (normal) | Append `persister.getCompletedMessage()` |
| Compaction completes | Reset to `[user_compaction_marker, asst_summary]` |
| Subtask completes | Append subtask assistant message + synthetic user message if present |
| Overflow compaction | Reset to `[user_compaction_marker, asst_summary]` |

### The `filterCompacted` View vs. The Buffer

The buffer holds the **full compacted view** — equivalent to what `filterCompacted()` would return. The buffer IS `filterCompacted()` output, kept live. No re-computation needed between turns, no DB scan.

---

## Functional Requirements

### FR-1: Single Initial DB Read
The session message list SHALL be read from DB exactly once at session start via `Message.filterCompacted(Message.stream(sessionID))`, before the generator is invoked.

### FR-2: In-Memory Buffer Ownership
`loop.ts` SHALL own and maintain a `msgsBuffer: { current: Message.WithParts[] }` passed to `queryLoop` as a parameter.

### FR-3: Buffer Updated After Each Normal Turn
After `turn-end`, `loop.ts` SHALL append the completed assistant message (with all its parts) to `msgsBuffer.current` using `persister.getCompletedMessage()`. No DB read.

### FR-4: Persister Retains All Parts In-Memory
`EventPersister` SHALL accumulate all created/updated parts in an internal `allParts: Message.Part[]` list rather than discarding references after writing to DB.

### FR-5: Persister Exposes Completed Message
`EventPersister` SHALL expose a `getCompletedMessage(): Message.WithParts` method assembling the full assistant message + all parts from in-memory state.

### FR-6: Flush Cleanup Without DB Read
`EventPersister.flush()` SHALL identify incomplete tool parts using the in-memory `allParts` list, not via `Message.parts(assistantMessage.id)`.

### FR-7: Compaction Resets Buffer (No DB Re-Read)
After any compaction (`compact`, `compaction-task`, `overflow`), `loop.ts` SHALL reset `msgsBuffer.current` to the two in-memory objects it just wrote: the compaction-marker user message and the summary assistant message. No DB re-read.

### FR-8: Subtask Updates Buffer
After `processSubtask()`, `loop.ts` SHALL append the subtask assistant message and any synthetic user message to `msgsBuffer.current` using in-memory references retained by the function.

### FR-9: Behavioral Parity
All existing behaviors — tool execution, structured output, subtask delegation, permission checks, retry logic, doom-loop detection — SHALL remain unchanged.

### FR-10: UI Display Unchanged
The DB write path is unchanged. `Message.stream()` continues to return full history for UI rendering.

---

## Acceptance Criteria

1. `query.ts` has zero calls to `Message.stream()` or `Message.filterCompacted()`.
2. `persister.ts` `flush()` has zero calls to `Message.parts()`.
3. All existing tests pass without modification.
4. Multi-turn sessions with tool calls produce identical message history in DB as before.
5. After compaction, the next LLM call receives only `[compaction_marker_user, summary_assistant]` — verified by test.
6. UI still displays full pre-compaction history (DB unchanged).
7. Abort/tombstone paths correctly clean up without reading from DB.

---

## Corrected Data Flow Diagrams

### Current (DB as exchange medium)
```
Session start:
  query.ts: msgs = DB.read()    ← filterCompacted scan

Turn N:
  query.ts: [uses msgs]
  LLM call → tool calls → yield events
  loop.ts:  writes tool results, assistant msg → DB

Turn N+1:
  query.ts: msgs = DB.read()   ← re-reads to pick up what loop.ts just wrote
```

### Proposed (in-memory buffer, DB is persistence only)
```
Session start:
  loop.ts: msgsBuffer.current = DB.read()  ← one-time only

Turn N:
  query.ts: msgs = msgsBuffer.current
  LLM call → tool calls → yield events
  loop.ts:  DB.write(tool results, assistant msg)        ← persistence
  loop.ts:  msgsBuffer.current.push(persister.getCompletedMessage())  ← buffer

Turn N+1:
  query.ts: msgs = msgsBuffer.current  ← no DB read

After compaction:
  loop.ts:  DB.write(compaction_user_msg, summary_asst_msg)  ← persistence
  loop.ts:  msgsBuffer.current = [compaction_user_msg, summary_asst_msg]  ← reset, no DB read
```

---

## Open Questions

1. **Retry paths**: `SessionRetry` in persister causes the persister to retry the LLM call. On retry the `allParts` may contain partial state from the failed attempt. Should `allParts` be cleared on retry, or should new parts be appended? The buffer append after `turn-end` must only use the final clean state.
2. **`SessionCompaction.prune()`**: Called post-loop in `runSession()`. It mutates `tool part.state.time.compacted`. Since this happens after the loop exits, the buffer is already discarded — no risk, but worth tracking.
3. **`processSubtask()` synthetic user message**: The function conditionally writes a synthetic user message (only for `task.command` tasks). The buffer update logic must match this conditional.
