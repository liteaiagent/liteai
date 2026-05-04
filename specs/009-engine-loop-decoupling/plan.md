# Implementation Plan: Engine Loop Decoupling

**Branch**: `009-engine-loop-decoupling` | **Date**: 2026-05-04 | **Spec**: [spec.md](file:///d:/liteai/specs/009-engine-loop-decoupling/spec.md)
**Input**: Feature specification from `specs/009-engine-loop-decoupling/spec.md`

## Summary

Decouple the engine execution loop from direct SQLite access by introducing a pluggable `Checkpointer` interface. Replace 14 direct DB write sites in `loop.ts`/`processSubtask()` with checkpointer calls, eliminate the post-loop DB re-query (`Error: Impossible` crash site), and implement a `PromiseTracker` for session-scoped async write tracking. The result is a forward-only state machine that returns typed `SessionResult`, enabling DB-free testing and future extraction into `@liteagent/loop`.

## Technical Context

**Language/Version**: TypeScript 5.x (Bun runtime)
**Primary Dependencies**: Vercel AI SDK (`ai`), `drizzle-orm` (SQLite backend)
**Storage**: SQLite via `better-sqlite3` (existing), Memory/Noop (new)
**Testing**: `bun:test` (existing test suite in `packages/core/test/session/engine/`)
**Target Platform**: Node.js/Bun server, multi-tenant HTTP/SSE backend
**Project Type**: Library (internal, later extracted to `@liteagent/loop`)
**Performance Goals**: Zero regression in streaming latency; checkpointer writes must NOT block event processing
**Constraints**: Forward-only execution (no time-travel/rollback), session-scoped promise tracking
**Scale/Scope**: 14 DB write sites to migrate, 3 DB read sites to eliminate, 4 `Bus.publish` sites to relocate

## Constitution Check

| Mandate | Status | Notes |
|---------|--------|-------|
| §0 Zero Backward Compat | ✅ PASS | Breaking change authorized — Checkpointer is a new interface, no legacy shim |
| §1 Non-blocking | ✅ PASS | Checkpointer writes are tracked-but-not-awaited in the event path |
| §5 No Silent Fallbacks | ✅ PASS | `PromiseTracker.flush()` throws `AggregateError` for any failed writes |
| §7 Multiple Alternatives | ✅ PASS | See R3 design decisions in [research.md](file:///d:/liteai/specs/009-engine-loop-decoupling/research.md) |
| §9 Test Isolation | ✅ PASS | `MemoryCheckpointer` enables hermetic engine tests without DB |

## Reference Implementations

Design is grounded in analysis of two production codebases on the local filesystem:

### LangGraphJS (`D:\langgraphjs`)

| Pattern | Source File | Adoption |
|---------|------------|----------|
| `BaseCheckpointSaver` abstract class | `libs/checkpoint/src/base.ts` | **Adapted** — message-oriented methods vs generic `putWrites(channel, value)` |
| `SqliteSaver` with WAL + transactions | `libs/checkpoint-sqlite/src/index.ts` | **Adapted** — delegates to existing `Session.update*()` instead of raw SQL |
| `MemorySaver` in-memory implementation | `libs/checkpoint/src/memory.ts` | **Simplified** — flat `Map<SessionID, Messages>` vs triple-nested Record |
| `checkpointerPromises` auto-remove Set | `libs/langgraph-core/src/pregel/loop.ts:276-301` | **Adopted directly** — same auto-remove-on-success, keep-on-failure pattern |
| `putWrites` fire-and-forget tracking | `libs/langgraph-core/src/pregel/loop.ts:558-650` | **Adopted** — writes tracked but NOT awaited inline |
| `_checkpointerPutAfterPrevious` chaining | `libs/langgraph-core/src/pregel/loop.ts:534-551` | **Deferred** — only needed if ordering guarantees become required |
| `PregelLoop.status` enum | `libs/langgraph-core/src/pregel/loop.ts:263-268` | **Adapted** — discriminated union with message payload |
| `finishAndHandleError()` cleanup | `libs/langgraph-core/src/pregel/loop.ts:898` | **Adopted** — maps to our `defer()` block |

### Claude Code (`D:\claude-code`)

| Pattern | Source File | Adoption |
|---------|------------|----------|
| `queryLoop` AsyncGenerator | `src/query.ts:241` | **Validated** — confirms our generator architecture is aligned |
| `Project.trackWrite<T>(fn)` | `src/utils/sessionStorage.ts:597` | **Simplified** — `PromiseTracker.track(promise)` |
| Batched write queue + flush | `src/utils/sessionStorage.ts:606-686` | **Validated** — our `EventPersister.drainWrites()` already does this |
| `deserializeMessagesWithInterruptDetection` | `src/utils/conversationRecovery.ts:164-252` | **Noted** — informs future `loadHistory()` recovery classification |
| `StreamingToolExecutor.discard()` | `src/query.ts:734` | **Validated** — our STE already has equivalent cleanup |
| Timer-based flush (100ms) | `src/utils/sessionStorage.ts:567-631` | **Rejected** — per-event-batch drain is more deterministic |
| JSONL append-only persistence | `src/utils/sessionStorage.ts:634-643` | **Rejected** — SQLite is superior for random-access queries |

## Project Structure

### Documentation (this feature)

```text
specs/009-engine-loop-decoupling/
├── plan.md              # This file
├── spec.md              # Feature specification (phases 1-3)
├── research.md          # DB call audit + reference analysis (R1-R5)
├── data-model.md        # Entity definitions + validation rules
├── quickstart.md        # Migration guide + testing patterns
├── contracts/
│   └── interfaces.md    # Interface contract definitions
├── checklists/
│   └── requirements.md  # Quality validation checklist
└── tasks.md             # Generated by /speckit.tasks
```

### Source Code (packages/core)

```text
packages/core/src/session/engine/
├── checkpointer.ts         # [NEW] Checkpointer interface + SqliteCheckpointer + MemoryCheckpointer + NoopCheckpointer
├── promise-tracker.ts       # [NEW] PromiseTracker class
├── loop.ts                  # [MODIFY] Inject checkpointer, return SessionResult, remove DB re-query
├── persister.ts             # [MODIFY] Remove Bus.publish calls
├── persistence-writer.ts    # [MODIFY] Delegate to SqliteCheckpointer.write()
├── query.ts                 # [MODIFY] Remove Bus.publish from generator
└── compaction-orchestrator.ts  # [NO CHANGE]

packages/core/test/session/engine/
├── checkpointer.test.ts     # [NEW] Checkpointer implementation tests
├── promise-tracker.test.ts  # [NEW] PromiseTracker tests
└── persister.test.ts        # [MODIFY] Update for Bus.publish removal
```

**Structure Decision**: All new code lives in `packages/core/src/session/engine/`. No new packages or directories beyond adding `checkpointer.ts` and `promise-tracker.ts`. Tests parallel the source structure under `packages/core/test/session/engine/`.

## Implementation Phases

### Phase 1: Foundation Types (No behavioral change)

1. **Create `PromiseTracker`** (`promise-tracker.ts`)
   - `track(promise)`: Auto-remove on success, keep on failure (per LangGraph `_trackCheckpointerPromise`)
   - `flush()`: `Promise.allSettled` → throw `AggregateError` for rejections
   - `size`: Getter for pending count
   - Tests: `promise-tracker.test.ts`

2. **Create `Checkpointer` interface** (`checkpointer.ts`)
   - `loadHistory(sessionID)`: Returns `Message.WithParts[]`
   - `write(ops: PersistenceOp[])`: Batch write (drains EventPersister)
   - `saveMessage(msg)`: Individual message persist
   - `savePart(part)`: Individual part persist
   - `updateMessage(msg)`: Message metadata update
   - `deletePart(ref)`: Part deletion
   - `dispose()`: Cleanup

3. **Create `SqliteCheckpointer`** — wraps existing `Session.update*()` / `Message.stream()` calls. Zero behavioral change — just indirection.

4. **Create `MemoryCheckpointer`** — in-memory `Map<SessionID, Message.WithParts[]>` for testing.

5. **Create `NoopCheckpointer`** — all methods no-op. For ephemeral sessions.

6. **Define `SessionResult` type** — `{ status: "ok" | "error" | "aborted"; message?: Message.WithParts; error?: unknown }`

### Phase 2: Wire Checkpointer into Loop

7. **`runSessionInner()` → accept `checkpointer` parameter**
   - Replace `Message.filterCompacted(Message.stream(sessionID))` with `checkpointer.loadHistory()`
   - Replace `asyncPersistenceWriter.write(ops)` with `checkpointer.write(ops)`
   - Track writes via `PromiseTracker`
   - Return `SessionResult` instead of `void`

8. **`loop()` → consume `SessionResult`**
   - Remove `Message.stream()` re-query (line 808)
   - Remove `Error: Impossible` guard
   - Use `result.message` directly

9. **`processSubtask()` → accept `checkpointer` parameter**
   - Replace 8 direct `Session.updateMessage/updatePart` calls with checkpointer methods
   - Track writes via the session's `PromiseTracker`

10. **`stripIncompleteThinking()` → operate on in-memory buffer**
    - Replace `Message.get()` DB read with buffer access
    - Replace `Session.removePart()` with `checkpointer.deletePart()`

### Phase 3: Clean Up Side-Effects

11. **Remove `Bus.publish` from `query.ts:169`**
    - Model resolution error notification moves to orchestrator
    - Generator yields error event; orchestrator publishes notification

12. **Remove `Bus.publish` from `persister.ts:393,409`**
    - Error notifications move to orchestrator
    - Persister returns classified error; orchestrator publishes via `PromiseTracker`

13. **Add `PromiseTracker.flush()` to cleanup `defer()` block**
    - Ensures all tracked writes complete before session teardown
    - Surfaces any async write failures

### Phase 4: Migrate AsyncPersistenceWriter

14. **Absorb `AsyncPersistenceWriter.write()` into `SqliteCheckpointer.write()`**
    - `AsyncPersistenceWriter` becomes a thin wrapper or is removed entirely
    - All persistence goes through the single `Checkpointer.write(ops)` entry point

## Verification Plan

### Automated Tests

```bash
# New tests
bun test test/session/engine/checkpointer.test.ts
bun test test/session/engine/promise-tracker.test.ts

# Existing tests that must continue passing
bun test test/session/engine/persister.test.ts
bun test test/session/engine/pipeline.test.ts

# Type checking
bun typecheck
```

### Test Coverage

| Test | What it validates |
|------|-------------------|
| `checkpointer.test.ts` | All 3 implementations (Sqlite/Memory/Noop) satisfy interface contract |
| `promise-tracker.test.ts` | Auto-remove, flush, AggregateError, concurrent track |
| `persister.test.ts` (modified) | Bus.publish removal doesn't break event classification |
| `pipeline.test.ts` (existing) | End-to-end streaming still works with checkpointer injection |

### Manual Verification

- Start a session, verify message persistence works identically
- Cancel mid-stream, verify cleanup completes (PromiseTracker flush)
- Run with `MemoryCheckpointer` in test, verify zero DB touches

## Complexity Tracking

No constitution violations to justify. All changes are within a single package (`packages/core`), use established patterns (interface + implementations), and are authorized by §0 (zero backward compatibility).

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| `processSubtask()` has 8 tightly coupled DB writes | Mechanical migration — each `Session.updateMessage()` → `checkpointer.saveMessage()` is 1:1 |
| PromiseTracker masking async errors | `flush()` uses `Promise.allSettled` and throws `AggregateError` — no silent swallowing |
| SqliteCheckpointer perf regression | Zero behavioral change — same `Session.update*()` calls, just routed through interface |
| CorrectionInjector still writes directly | Deferred — documented in research.md D7. Tolerated during this phase. |
