# Tasks: Engine Loop Decoupling

**Input**: Design documents from `/specs/009-engine-loop-decoupling/`
**Prerequisites**: [plan.md](file:///d:/liteai/specs/009-engine-loop-decoupling/plan.md), [spec.md](file:///d:/liteai/specs/009-engine-loop-decoupling/spec.md), [research.md](file:///d:/liteai/specs/009-engine-loop-decoupling/research.md), [data-model.md](file:///d:/liteai/specs/009-engine-loop-decoupling/data-model.md), [contracts/interfaces.md](file:///d:/liteai/specs/009-engine-loop-decoupling/contracts/interfaces.md)

**Execution Guides** (detailed implementation instructions per task):
- [tasks-guide-foundation.md](file:///d:/liteai/specs/009-engine-loop-decoupling/tasks-guide-foundation.md) — T001–T008
- [tasks-guide-wiring.md](file:///d:/liteai/specs/009-engine-loop-decoupling/tasks-guide-wiring.md) — T009–T012
- [tasks-guide-cleanup.md](file:///d:/liteai/specs/009-engine-loop-decoupling/tasks-guide-cleanup.md) — T013–T019

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story (US1–US5 from spec.md)

---

## Phase 1: Setup

**Purpose**: Create foundation types — no behavioral change, no existing code modified.

- [x] T001 [P] [US1] Create `PromiseTracker` class in `packages/core/src/session/engine/loop/promise-tracker.ts`
- [x] T002 [P] [US1] Write `PromiseTracker` tests in `packages/core/test/session/engine/promise-tracker.test.ts`

**Checkpoint**: `bun test test/session/engine/promise-tracker.test.ts` passes.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Define the Checkpointer interface and all three implementations. MUST complete before any wiring.

**⚠️ CRITICAL**: No user story wiring can begin until this phase is complete.

- [x] T003 [US1] Define `Checkpointer` interface and `SessionResult` type in `packages/core/src/session/engine/loop/checkpointer.ts`
- [x] T004 [US1] Implement `SqliteCheckpointer` in `packages/core/src/session/engine/loop/checkpointer.ts`
- [x] T005 [P] [US1] Implement `MemoryCheckpointer` in `packages/core/src/session/engine/loop/checkpointer.ts`
- [x] T006 [P] [US1] Implement `NoopCheckpointer` in `packages/core/src/session/engine/loop/checkpointer.ts`
- [x] T007 [US1] Write `Checkpointer` implementation tests in `packages/core/test/session/engine/checkpointer.test.ts`
- [x] T008 [US1] Export new modules from `packages/core/src/session/engine/index.ts` (barrel re-exports from `engine/loop/`)

**Checkpoint**: `bun test test/session/engine/checkpointer.test.ts` passes. `bun typecheck` passes.

---

## Phase 3: User Story 1 — Engine Runs Without a Database (Priority: P1) 🎯 MVP

**Goal**: Inject checkpointer into the loop so the engine can run with any Checkpointer implementation (SQLite, Memory, Noop) — no direct DB calls in the loop hot path.

**Independent Test**: Run a session loop with `MemoryCheckpointer` and verify it produces a correct result without any SQLite operations.

- [x] T009 [US1] Add `checkpointer` parameter to `runSessionInner()`, replace buffer load + turn-start persist + dbWriter calls in `packages/core/src/session/engine/loop.ts`
- [x] T010 [US1] Update `loop()` to consume `SessionResult`, eliminate `Message.stream()` re-query and `Error: Impossible` guard in `packages/core/src/session/engine/loop.ts`
- [x] T011 [US2] Inject `checkpointer` into `processSubtask()`, replace 8 direct `Session.updateMessage/updatePart` calls in `packages/core/src/session/engine/loop.ts`
- [x] T012 [US2] Refactor `stripIncompleteThinking()` to use in-memory buffer + `checkpointer.deletePart()` in `packages/core/src/session/engine/loop.ts`

**Checkpoint**: `bun typecheck` passes. Existing `bun test test/session/engine/pipeline.test.ts` still passes.

---

## Phase 4: User Story 3 — Error Propagation Without Side Effects (Priority: P1)

**Goal**: Remove all `Bus.publish` calls from the generator and persister. Error notification becomes the orchestrator's sole responsibility.

**Independent Test**: Trigger a model resolution failure and verify exactly one error notification with complete stack trace, zero detached promises.

- [x] T013 [US3] Remove `Bus.publish` from model resolution error in `packages/core/src/session/engine/query.ts` line 169, move notification to `loop()` orchestrator
- [x] T014 [US3] Remove `Bus.publish` from error handlers in `packages/core/src/session/engine/persister.ts` lines 393, 409

**Checkpoint**: `grep -r "Bus.publish" packages/core/src/session/engine/query.ts packages/core/src/session/engine/persister.ts` returns zero matches.

---

## Phase 5: User Story 4 — Tracked Async Safety (Priority: P2)

**Goal**: Wire `PromiseTracker` into the loop so all async work is tracked and awaited during cleanup.

**Independent Test**: All tracked promises resolve/reject before session resources are released. `tracker.size === 0` after cleanup.

- [x] T015 [US4] Wire `PromiseTracker.track()` around checkpointer writes and Bus publishes, add `tracker.flush()` to cleanup in `packages/core/src/session/engine/loop.ts`

**Checkpoint**: `bun typecheck` passes.

---

## Phase 6: User Story 5 — Checkpointer Swappable at Runtime (Priority: P2)

**Goal**: Remove `AsyncPersistenceWriter` — all persistence goes through the single `Checkpointer` interface.

**Independent Test**: Implement a trivial `TestCheckpointer` recording method calls, run a session, verify call sequence matches expectations.

- [x] T016 [US5] Remove `AsyncPersistenceWriter` class from `packages/core/src/session/engine/persistence-writer.ts` (keep `PersistenceOp` type)

**Checkpoint**: `grep -r "AsyncPersistenceWriter" packages/core/src/` returns zero matches. `bun typecheck` passes.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [x] T017 Update `persister.test.ts` to remove Bus mock (structural absence of Bus import enforces the constraint) in `packages/core/test/session/engine/persister.test.ts`
- [x] T018 Run full verification suite: `bun test test/session/engine/checkpointer.test.ts && bun test test/session/engine/promise-tracker.test.ts && bun test test/session/engine/persister.test.ts && bun test test/session/engine/pipeline.test.ts && bun typecheck`
- [x] T019 Run `bun lint:fix` for formatting compliance across all modified files

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — can start immediately
- **Phase 2 (Foundational)**: Depends on T001 completion for PromiseTracker import — BLOCKS all user stories
- **Phase 3 (US1+US2)**: Depends on Phase 2 completion
- **Phase 4 (US3)**: Depends on T010 (SessionResult consumed in loop)
- **Phase 5 (US4)**: Depends on T009 (PromiseTracker instantiated) and T013-T014 (Bus publishes moved)
- **Phase 6 (US5)**: Depends on T009 (dbWriter replaced)
- **Phase 7 (Polish)**: Depends on all prior phases

### User Story Dependencies

- **US1 (P1)**: Foundation — no dependencies on other stories
- **US2 (P1)**: Depends on US1 (checkpointer must be wired before processSubtask can use it)
- **US3 (P1)**: Depends on T010 (error result flow through SessionResult)
- **US4 (P2)**: Depends on US1+US3 (all writes and publishes routed through checkpointer/orchestrator first)
- **US5 (P2)**: Depends on US1 (AsyncPersistenceWriter replaced)

### Within Each Phase

- Types/interfaces before implementations
- Implementations before wiring
- Wiring before cleanup

### Parallel Opportunities

```
Phase 1 parallel group:
  T001 (PromiseTracker class) ║ T002 (PromiseTracker tests)

Phase 2 parallel group (after T003-T004):
  T005 (MemoryCheckpointer) ║ T006 (NoopCheckpointer)

Phase 4 parallel group (after T010):
  T013 (query.ts Bus removal) ║ T014 (persister.ts Bus removal)
```

---

## Implementation Strategy

### MVP First (US1 Only)

1. Complete Phase 1 + Phase 2: Foundation types
2. Complete Phase 3: Wire checkpointer into loop
3. **STOP and VALIDATE**: `bun typecheck` + existing tests pass
4. The engine now runs with SqliteCheckpointer (zero behavioral regression)

### Incremental Delivery

1. Foundation (Phase 1+2) → Types ready
2. US1+US2 (Phase 3) → Checkpointer wired, DB re-query eliminated → **MVP!**
3. US3 (Phase 4) → Bus.publish removed from generator/persister
4. US4 (Phase 5) → PromiseTracker wired into cleanup
5. US5 (Phase 6) → AsyncPersistenceWriter removed
6. Polish (Phase 7) → Tests updated, verification complete

---

## Notes

- All source changes are in `packages/core/src/session/engine/`
- All test changes are in `packages/core/test/session/engine/`
- CorrectionInjector DB writes are **deferred** (research.md D7)
- Telemetry DB reads are **deferred** (research.md D8)
- CompactionOrchestrator is **out of scope** (spec.md Assumptions)
- Each task has detailed line-by-line instructions in the corresponding guide file
