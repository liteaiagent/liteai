# Tasks: yield_turn Removal & State Cleanup

**Input**: Design documents from `specs/014-yield-turn-removal/`

**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, quickstart.md

**Tests**: No test tasks generated — spec does not request TDD. Existing test files referencing
removed infrastructure are updated in-place as part of the cleanup tasks.

**Organization**: Tasks grouped by user story (US1 = yield_turn removal, US2 = plan state cleanup,
US3 = prompt file cleanup). US1 and US2 are both P1 but US2 depends on parts of US1. US3 is P2.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup

**Purpose**: No setup needed — this is a deletion feature in an existing codebase. Phase skipped.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: No foundational work needed — all changes are deletions within existing modules. Phase skipped.

---

## Phase 3: User Story 1 - Clean Codebase After Architecture Migration (Priority: P1) 🎯 MVP

**Goal**: Remove all `yield_turn` tool infrastructure — source file, prompt file, registry entry,
filter entry, coordinator references, agent tool parsing, and query loop detection.

**Independent Test**: `grep -rn "yield_turn" packages/core/src/` returns zero results AND
`bun typecheck` passes with zero new errors in `packages/core`.

### Implementation for User Story 1

- [x] T001 [US1] Delete yield_turn tool source file at `packages/core/src/tool/yield_turn.ts`
- [x] T002 [US1] Delete yield_turn prompt description file at `packages/core/src/bundled/prompts/tools/yield_turn.txt`
- [x] T003 [US1] Remove `export * from "./yield_turn"` from `packages/core/src/tool/index.ts` (line 29)
- [x] T004 [US1] Remove `YieldTurnTool` import (line 32) and array entry (line 44) from `packages/core/src/tool/registry.ts`
- [x] T005 [US1] Remove `"yield_turn"` string literal from `ALL_LITEAI_TOOLS` set in `packages/core/src/agent/filter.ts` (line 37)
- [x] T006 [US1] Remove yield_turn result parsing logic (lines 185-189) from `packages/core/src/tool/agent.ts` — simplify `taskResultContent` to always use `textPart`
- [x] T007 [US1] Remove yield_turn detection block (lines 616-622) from `packages/core/src/session/engine/query.ts` — remove the `calledYieldTurn` variable, condition, log, and break
- [x] T008 [P] [US1] Remove `"yield_turn"` from coordinator tool arrays in `packages/core/src/coordinator/coordinator-mode.ts` (lines 78 and 105)
- [x] T009 [P] [US1] Remove `yield_turn` references from prompt text in `packages/core/src/coordinator/coordinator-prompt.ts` (lines 44 and 114)
- [x] T010 [P] [US1] Remove `yield_turn` reference from worker prompt text in `packages/core/src/coordinator/teammate-runner.ts` (line 204)
- [x] T011 [US1] Run `bun typecheck 2>&1 | Out-String` in `packages/core` and verify zero new errors introduced by T001-T010

**Checkpoint**: At this point, zero `yield_turn` references should exist in `packages/core/src/`.
Verify with `grep -rn "yield_turn" packages/core/src/` returning zero results.

---

## Phase 4: User Story 2 - Simplified Plan Mode State Model (Priority: P1)

**Goal**: Remove `PlanStateChanged` event emission, definition, and subscriptions. Remove
`injectActivePlanReminder()` function and its dispatch branch. Per research.md Decision 1,
`PlanModeState` interface is already clean (4 fields only). Per Decision 3, `StopDriftService`
is retained — it's P2-era code, not legacy.

**Independent Test**: `grep -rn "PlanStateChanged" packages/core/src/` returns zero results AND
`grep -rn "injectActivePlanReminder" packages/core/src/` returns zero results AND `bun typecheck` passes.

### Implementation for User Story 2

- [x] T012 [US2] Remove `PlanStateChanged` emission from `PlanModeStateRef.update()` in `packages/core/src/session/plan-mode-state.ts` — remove the `Bus.publish(Session.Event.PlanStateChanged, ...)` block (lines 95-108), the `wasActive`/`isActive` derivation (lines 88-89), and the `Bus` import. Retain the tracing span attributes and `fn(prev)` mutation.
- [x] T013 [US2] Remove `PlanStateChanged` BusEvent definition from `packages/core/src/session/index.ts` (lines 233-244) — delete the `PlanStateChanged: BusEvent.define(...)` entry from the `Event` object
- [x] T014 [US2] Remove `PlanStateChanged` Bus subscription from `packages/core/src/acp/events.ts` (lines 40-47) — delete the `Bus.subscribe(Session.Event.PlanStateChanged, ...)` block
- [x] T015 [US2] Remove `injectActivePlanReminder()` function (lines 188-270) and its dispatch branch (lines 46-51: the `if (planModeState.planSessionID !== undefined)` block) from `packages/core/src/session/engine/plan-reminder.ts` — retain only the build-phase reminder path. Also remove the now-unused `Bundled` import if no other `Bundled.miscPrompt` calls remain.
- [x] T016 [US2] Remove `PlanStateChanged` assertions from test files. The event `PlanStateChanged` is no longer emitted after T012, so all tests that subscribe to or assert on it must be updated. In each file below, locate `Bus.subscribe(Session.Event.PlanStateChanged, ...)` blocks and the enclosing test cases. If the test case's **sole purpose** is to validate `PlanStateChanged` emission (e.g., test names like "emits PlanStateChanged when active field changes", "emits PlanStateChanged on planSessionID transition", "does NOT emit PlanStateChanged when planSessionID is unchanged"), **delete the entire test case**. If the test case validates other behavior alongside a `PlanStateChanged` subscription, remove only the subscription block and any related `expect()` calls. Also remove now-unused imports of `Session.Event.PlanStateChanged` or `Bus` if no other subscribers remain in the file. Files:
    - `packages/core/test/session/plan-mode-state.test.ts` — contains 2 test cases with `Bus.subscribe(Session.Event.PlanStateChanged, ...)` (lines ~106-150)
    - `packages/core/test/plan-mode/plan-mode-state.test.ts` — contains 2 test cases with `Bus.subscribe(Session.Event.PlanStateChanged, ...)` (lines ~142-190)
    - `packages/core/test/plan-mode/enter-plan-tool.test.ts` — contains 1 `Bus.subscribe(Session.Event.PlanStateChanged, ...)` block (line ~68)
- [x] T017 [US2] Run `bun typecheck 2>&1 | Out-String` in `packages/core` and verify zero new errors introduced by T012-T016

### CLI TUI Cleanup (dead code from PlanStateChanged removal)

- [x] T026 [US2] Remove the `case "plan.state_changed"` event handler block (lines 402-446) from `packages/cli/src/tui/state/app-state-events.ts`
- [x] T027 [US2] Remove `PlanState` interface (lines 44-53), `plan` field (line 93), and `prePlanPermissionMode` field (line 103) from `packages/cli/src/tui/state/app-state.ts`. Also remove `plan: {}` (line 134) and `prePlanPermissionMode: {}` (line 137) from `getDefaultAppState()`
- [x] T028 [US2] Run `bun typecheck 2>&1 | Out-String` in `packages/cli` and verify zero new errors introduced by T026-T027

**Checkpoint**: At this point, zero `PlanStateChanged` and `injectActivePlanReminder` references
should exist in `packages/core/src/`. StopDriftService remains intact and functional.
CLI TUI has no dead plan state code.

---

## Phase 5: User Story 3 - Legacy Prompt File Cleanup (Priority: P2)

**Goal**: Delete the remaining obsolete prompt file (`plan-active-reminder.md`). The other two
files (`plan-workflow.md`, `plan-interview.md`) were already deleted in prior work.

**Independent Test**: `ls packages/core/src/bundled/prompts/misc/` shows only `max-steps.md` AND
`grep -rn "plan-active-reminder" packages/core/src/` returns zero results.

### Implementation for User Story 3

- [x] T029 [US3] Delete legacy prompt file at `packages/core/src/bundled/prompts/misc/plan-active-reminder.md`
- [x] T030 [US3] Verify zero remaining references to `plan-active-reminder` in `packages/core/src/` — this should already be clean if T015 was completed correctly, but verify explicitly
- [x] T031 [US3] Run `bun typecheck 2>&1 | Out-String` in `packages/core` and verify zero new errors

**Checkpoint**: All three legacy prompt files are gone. Only `max-steps.md` remains in `bundled/prompts/misc/`.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final verification, linting, and scoped test execution

- [x] T032 [POLISH] Run `bun lint:fix 2>&1 | Out-String` in `packages/core` — fix any formatting drift introduced by the deletions
- [x] T033 [POLISH] Run `bun lint:fix 2>&1 | Out-String` in `packages/cli` — fix any formatting drift introduced by T026-T027
- [x] T034 [POLISH] Run `bun test test/plan-mode 2>&1 | Out-String` in `packages/core` (22/22 pass)
- [x] T035 [POLISH] Run `bun test test/session 2>&1 | Out-String` in `packages/core` (pre-existing failures only; zero regressions from our changes)
- [x] T036 [POLISH] Run `bun test test/tools 2>&1 | Out-String` in `packages/core` (yield_turn tool test coverage)
- [x] T037 [POLISH] Final verification grep: confirm zero references to `yield_turn`, `PlanStateChanged`, `injectActivePlanReminder`, and `plan-active-reminder` in `packages/core/src/` and `packages/cli/src/`: `yield_turn`, `PlanStateChanged`, `plan-active-reminder`, `injectActivePlanReminder`, `plan.state_changed`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: Skipped
- **Phase 2 (Foundational)**: Skipped
- **Phase 3 (US1 — yield_turn removal)**: Can start immediately — no dependencies
- **Phase 4 (US2 — plan state cleanup)**: Can start after T011 (typecheck gate for US1). T015 depends on T001/T002 being done (prompt file reference cleanup ties to yield_turn file deletion)
- **Phase 5 (US3 — prompt cleanup)**: Depends on T015 completing (the `plan-active-reminder` reference in `plan-reminder.ts` must be removed first)
- **Phase 6 (Polish)**: Depends on all user stories completing

### User Story Dependencies

- **User Story 1 (P1)**: No dependencies — can start immediately
- **User Story 2 (P1)**: Logically independent from US1 but benefits from US1 completing first (US1's typecheck gate validates the codebase before US2 makes further changes). Includes CLI cleanup (T026-T028) which depends on T012-T014 completing.
- **User Story 3 (P2)**: Depends on US2's T015 — the `injectActivePlanReminder` removal eliminates the last code reference to `plan-active-reminder.md`

### Within Each User Story

- File deletions (T001, T002) before reference removal (T003-T010)
- Reference removal before typecheck gate (T011)
- Event definition removal (T013) after emission removal (T012)
- Subscription removal (T014) can parallel with definition removal (T013)
- Test updates (T016) after source changes (T012-T015)

### Parallel Opportunities

Within US1:
- T008, T009, T010 are [P] — three coordinator files can be edited simultaneously
- T001 and T002 are file deletions that can run simultaneously

Within US2:
- T013 and T014 can run in parallel (different files, both depend only on T012)

---

## Parallel Example: User Story 1

```bash
# Launch coordinator cleanups together (all [P] — different files):
Task: "Remove yield_turn from coordinator tool arrays in coordinator-mode.ts"
Task: "Remove yield_turn from prompt text in coordinator-prompt.ts"
Task: "Remove yield_turn from worker prompt in teammate-runner.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 3: User Story 1 (T001-T011)
2. **STOP and VALIDATE**: `bun typecheck` + `grep yield_turn` = zero
3. This alone delivers SC-001 (zero yield_turn references)

### Incremental Delivery

1. User Story 1 → Typecheck passes → yield_turn fully purged
2. User Story 2 → Typecheck passes → PlanStateChanged purged, injectActivePlanReminder removed
3. User Story 3 → Typecheck passes → Prompt file deleted
4. Polish → Lint + scoped tests → Feature complete

### Sequential Execution (Recommended)

This feature is best executed sequentially (not in parallel) because:
- It's a single-developer cleanup task
- Each phase's typecheck gate validates the previous phase
- The total task count (25) is small enough for serial execution
- Dependencies between phases make parallelism minimal

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Per research.md Decision 3: StopDriftService is **retained** — do NOT remove it
- Per research.md Decision 1: PlanModeState interface is **already clean** — no field changes needed
- Per research.md: `plan-workflow.md` and `plan-interview.md` are **already deleted** — only `plan-active-reminder.md` remains
- Commit after each phase checkpoint for clean git history
