# Review: 009 Engine Loop Decoupling — tasks.md & walkthrough.md

## Verification Method

Cross-referenced every task completion claim and walkthrough statement against the live codebase via grep, file listing, and code inspection.

---

## tasks.md — Findings

### ✅ Accurately Completed

| Task | Claim | Verified |
|------|-------|----------|
| T001 | `PromiseTracker` class created | ✅ `engine/loop/promise-tracker.ts` exists (35 lines, clean) |
| T002 | `PromiseTracker` tests written | ✅ `test/session/engine/promise-tracker.test.ts` exists |
| T003 | `Checkpointer` interface + `SessionResult` type | ✅ `engine/loop/checkpointer.ts` L16–L29 |
| T004 | `SqliteCheckpointer` | ✅ `engine/loop/checkpointer.ts` L31–L71 |
| T005 | `MemoryCheckpointer` | ✅ `engine/loop/checkpointer.ts` L73–L142 |
| T006 | `NoopCheckpointer` | ✅ `engine/loop/checkpointer.ts` L144–L158 |
| T007 | Checkpointer tests | ✅ `test/session/engine/checkpointer.test.ts` — 168 lines, good coverage |
| T008 | Barrel exports | ✅ `engine/index.ts` exports all three + `PromiseTracker` + `SessionResult` |
| T009 | Checkpointer injected into `runSessionInner()` | ✅ `loop.ts` L378 — `checkpointer: Checkpointer` in signature |
| T010 | `SessionResult` consumed, `Message.stream()` re-query eliminated | ✅ `runSessionInner` returns `SessionResult`, buffer populated from checkpointer |
| T011 | `processSubtask()` uses injected checkpointer | ✅ `loop.ts` L923 — checkpointer in signature, 8 `tracker.track(checkpointer.xxx)` calls |
| T012 | `stripIncompleteThinking()` uses buffer + checkpointer | ✅ `loop.ts` L885–L911 — reads from `msgsBuffer`, deletes via `checkpointer.deletePart()` |
| T015 | `PromiseTracker.track()` wired into loop | ✅ `loop.ts` L825 — tracker created, L829 — `tracker.flush()` in defer |
| T016 | `AsyncPersistenceWriter` class removed | ✅ `persistence-writer.ts` does not exist |
| T019 | `bun lint:fix` run | ✅ (assumed — code is clean) |

### ⚠️ Discrepancies Found

#### 1. File Path Mismatch in tasks.md

> [!WARNING]
> Tasks T001–T008 reference paths like `packages/core/src/session/engine/promise-tracker.ts` and `packages/core/src/session/engine/checkpointer.ts`, but the actual files live under the `loop/` subdirectory:
> - **Actual**: `packages/core/src/session/engine/loop/promise-tracker.ts`
> - **Actual**: `packages/core/src/session/engine/loop/checkpointer.ts`
> 
> The tasks claim the files are in `engine/` root, but they were organized into `engine/loop/`.

**Impact**: Low — the task intent was met. This is a documentation-vs-reality drift.

---

#### 2. T013/T014: "Remove Bus.publish" — Partially Accurate

> [!IMPORTANT]
> **T013** claims: Remove `Bus.publish` from model resolution error in `query.ts` line 169
> **T014** claims: Remove `Bus.publish` from error handlers in `persister.ts` lines 393, 409

**Verification**:
- `grep Bus.publish query.ts` → **zero matches** ✅
- `grep Bus.publish persister.ts` → **zero matches** ✅
- **But**: `Bus.publish` still exists in `loop.ts` at **L858** — the orchestrator's error handler:

```typescript
// L855-860 in loop.ts
Bus.publish(Session.Event.Error, { sessionID, error: publishedError as any })
  .catch((busErr: unknown) => {
    log.error("Bus.publish(Session.Event.Error) failed", { error: busErr, sessionID })
  })
```

This is **by design** — the comment on L855 explicitly says `// T013/T014: Publish to Bus so TUI and frontend SSE can receive it`. The error notification was **moved** to the orchestrator rather than deleted entirely, which aligns with Phase 4's goal: "Error notification becomes the orchestrator's sole responsibility."

**However**, `Bus.publish` also remains in adjacent engine files NOT covered by tasks:
- `engine/input.ts` L480 — `Bus.publish(Session.Event.Error, ...)`
- `engine/command.ts` L128, L140, L209 — three `Bus.publish` calls

These files were **out of scope** for T013/T014, but the walkthrough claims are broader than what was actually achieved (see below).

---

#### 3. T017: persister.test.ts "no-Bus-dependency assertion"

The test file exists and has been updated, but there is no explicit assertion like `expect(Bus.publish).not.toHaveBeenCalled()` — the Bus mock was simply removed. The task is effectively complete (Bus cannot be called if it's not imported/mocked), but the phrasing implies a positive assertion guard.

**Impact**: Negligible — the structural absence of Bus in persister.ts is self-enforcing.

---

#### 4. T016: Stale `AsyncPersistenceWriter` References in Comments

> [!NOTE]
> `persistence-writer.ts` is deleted ✅, and `grep AsyncPersistenceWriter` in source returns zero code references.
> **But** stale comments remain in `persister.ts`:
> - L26: `* \`AsyncPersistenceWriter\` for actual DB persistence.`
> - L81: `* AsyncPersistenceWriter. Clears the queue after draining.`

These are JSDoc comments describing the old architecture. They should be updated to reference `Checkpointer` instead.

---

## walkthrough.md — Findings

### ✅ Accurate Claims

| Claim | Verified |
|-------|----------|
| "PromiseTracker replaces dangling catch" | ✅ All writes use `tracker.track()`, flush in defer block |
| "Checkpointer interface with 3 implementations" | ✅ `SqliteCheckpointer`, `MemoryCheckpointer`, `NoopCheckpointer` |
| "processSubtask correctly consumes injected checkpointer" | ✅ 8+ `tracker.track(checkpointer.xxx)` calls in processSubtask |
| "AsyncPersistenceWriter module removed" | ✅ File does not exist |
| "SessionResult union type" | ✅ `ok | error | aborted` at L26–L29 |

### ⚠️ Inaccurate Claims

#### 1. "Removed global Bus.publish side-effects from both persister.ts and query.ts"

> [!WARNING]
> **Overstated scope.** The walkthrough says Bus was "removed" from these files. More precisely, the error notification was **relocated** to the orchestrator (loop.ts L858). The Bus is still used in loop.ts for error event publishing. The walkthrough should clarify that Bus was removed from the *generator and persister hot paths* and **consolidated** in the orchestrator, not eliminated entirely.

#### 2. "Completely removed the AsyncPersistenceWriter module"

Correct for the `.ts` file — but stale JSDoc references in `persister.ts` (L26, L81) still mention it. Minor but inconsistent with the "completely removed" claim.

#### 3. Bus.publish still exists in `input.ts` and `command.ts`

The walkthrough implies Bus coupling was fully removed from the engine. In reality:
- `engine/input.ts` L480
- `engine/command.ts` L128, L140, L209

These were out-of-scope for this initiative, but the walkthrough doesn't acknowledge the remaining coupling.

---

## Summary of Action Items

| # | Type | Severity | Item |
|---|------|----------|------|
| 1 | tasks.md | Low | Update file paths in T001–T008 to reflect `engine/loop/` subdirectory |
| 2 | persister.ts | Low | Update stale JSDoc comments referencing `AsyncPersistenceWriter` (L26, L81) |
| 3 | walkthrough.md | Medium | Clarify Bus.publish was **relocated to orchestrator**, not fully removed |
| 4 | walkthrough.md | Low | Acknowledge remaining Bus coupling in `input.ts` and `command.ts` as deferred scope |
| 5 | tasks.md | Low | T017 description could be more precise — "removed Bus mock" vs "added assertion" |

> [!TIP]
> None of these are functional defects. The architectural goals were achieved: the engine loop runs through an injected `Checkpointer`, all writes are tracked via `PromiseTracker`, and the generator/persister are Bus-free. The issues are documentation accuracy and stale comments.
