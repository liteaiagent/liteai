---
description: "Task list for Subagent Result Flow implementation"
---

# Tasks: Subagent Result Flow

**Input**: Design documents from `/specs/010-subagent-result-flow/`
**Prerequisites**: `plan.md`, `spec.md`, `data-model.md`, `quickstart.md`, `explanation.md`

**Organization**: Tasks are grouped by user story to enable independent implementation and testing.

## Phase 1: Setup

**Purpose**: Project initialization and basic structure

- [x] T001 Read and understand `D:\liteai\specs\010-subagent-result-flow\explanation.md` which contains precise code replacement instructions.

---

## Phase 2: Foundational

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

*(No foundational tasks required for this decoupling phase, as the Checkpointer interface is already established.)*

---

## Phase 3: User Story 1 - Direct Return of Subagent Results (Priority: P1) 🎯 MVP

**Goal**: Child's result is returned directly to the parent in memory, avoiding database queries and exception-based control flow.

**Independent Test**: Execute a task using a subagent. Ensure the parent receives the response and no SQLite `SELECT` operations are performed during subagent resolution.

### Implementation for User Story 1

- [x] T002 [US1] In `packages/core/src/tool/task.ts`, replace the `Message.get` database read with an in-memory lookup using `ctx.messages` as detailed in `explanation.md`.
- [x] T003 [US1] In `packages/core/src/session/engine/loop.ts`, implement and export `runSubagent(input: PromptInput)` to return `SessionResult` directly without throwing exceptions or publishing to the global event bus.
- [x] T004 [US1] In `packages/core/src/tool/task.ts`, update the execution flow to invoke `runSubagent` instead of `prompt`, explicitly handling the `SessionResult`'s `ok` and `error` states to return gracefully formatted text to the parent.
- [x] T005 [US1] Verify that `packages/core/src/session/engine/query.ts` and `packages/core/src/session/engine/streaming-tool-executor.ts` are fully decoupled from database reads for subagent resolution.
- [x] T006 [US1] Run `bun typecheck` to validate the new return signatures and fix any strict-typing errors.
- [x] T007 [US1] Run `bun lint:fix` to ensure formatting compliance.
- [x] T008 [US1] Run isolated scoped tests for `packages/core/test/session/engine/` to ensure no regressions in orchestrator behavior.

---

## Phase 4: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [x] T009 Code cleanup: remove any obsolete error-catching logic in `processSubtask` that is no longer needed after the `SessionResult` migration.
- [x] T010 Final `bun typecheck` and verification of the fail-fast protocol constraints.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: Can start immediately.
- **User Stories (Phase 3)**: Depends on Phase 1.
- **Polish (Phase 4)**: Depends on Phase 3.

### Parallel Opportunities

- Verification task (T005) can be done in parallel with code modification (T002-T004).

### Implementation Strategy

1. Review `explanation.md`.
2. Apply the `task.ts` and `loop.ts` modifications.
3. Validate types and run scoped tests.
4. Verify execution flow aligns with the `SessionResult` architecture.
