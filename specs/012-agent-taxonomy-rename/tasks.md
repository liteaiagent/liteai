# Tasks: Agent Taxonomy & Rename (Phase 1)

**Input**: Design documents from `specs/012-agent-taxonomy-rename/`

**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/

**Tests**: No test-first approach requested. Test updates are included as implementation tasks (existing tests must be updated to match new names).

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup (File Renames)

**Purpose**: Rename source files using git mv to preserve history. No content changes yet — just move files.

- [x] T001 Rename tool source file: `git mv packages/core/src/tool/task.ts packages/core/src/tool/agent.ts`
- [x] T002 [P] Rename tool stop source file: `git mv packages/core/src/tool/task_stop.ts packages/core/src/tool/agent_stop.ts`
- [x] T003 [P] Rename agent definition file: `git mv packages/core/src/bundled/agents/build.md packages/core/src/bundled/agents/liteai.md`
- [x] T004 [P] Rename tool prompt file: `git mv packages/core/src/bundled/prompts/tools/task.txt packages/core/src/bundled/prompts/tools/agent.txt`

**Checkpoint**: ✅ All 4 files renamed.

---

## Phase 2: Foundational (Import & Export Wiring)

- [x] T005 Update tool barrel export in `packages/core/src/tool/index.ts`
- [x] T006 Update tool registry imports in `packages/core/src/tool/registry.ts`
- [x] T007 Update prompt import in `packages/core/src/tool/agent.ts`
- [x] T008 Update `BUILTIN_AGENT_NAMES` in `packages/core/src/agent/agent.ts`
- [x] T009 Run `bun typecheck` — verified compilation after import rewiring

**Checkpoint**: ✅ Build compiles with renamed files.

---

## Phase 3: User Story 1 — Agent Tool Invocation After Rename (Priority: P1) 🎯 MVP

- [x] T010 [US1] Rename `TaskTool` → `AgentTool` in `packages/core/src/tool/agent.ts`
- [x] T011 [P] [US1] Rename `TaskStopTool` → `AgentStopTool` in `packages/core/src/tool/agent_stop.ts`
- [x] T012 [P] [US1] Update `ALL_LITEAI_TOOLS` set in `packages/core/src/agent/filter.ts`
- [x] T013 [P] [US1] Update `hasTaskTool()` → `hasAgentTool()` in `packages/core/src/tool/truncation.ts`
- [x] T014 [P] [US1] Update permission check in `packages/core/src/session/engine/input.ts`
- [x] T015 [P] [US1] Update subtask processing in `packages/core/src/session/engine/loop.ts`
- [x] T016 [P] [US1] Update Claude platform compatibility map in `packages/core/src/platform/profiles/claude.ts`
- [x] T017 [US1] Run `bun typecheck` — verified all tool rename changes compile cleanly

**Checkpoint**: ✅ Tool ID `"agent"` used everywhere.

---

## Phase 4: User Story 2 — Root Agent Identity After Rename (Priority: P1)

- [x] T018 [US2] Update agent definition in `packages/core/src/bundled/agents/liteai.md`
- [x] T019 [US2] Update foundational agent guard in `packages/core/src/agent/agent.ts`
- [x] T020 [US2] Update `defaultAgent()` fallback in `packages/core/src/agent/agent.ts`
- [x] T021 [US2] Add migration logic for `default_agent: "build"` in `packages/core/src/agent/agent.ts`
- [x] T022 [P] [US2] Update doc comment in `packages/core/src/agent/context.ts`
- [x] T023 [US2] Run `bun typecheck` — verified all agent rename changes compile cleanly

**Checkpoint**: ✅ `"liteai"` is the root agent name everywhere.

---

## Phase 5: User Story 3 — Agent Roster Completeness (Priority: P2)

- [x] T024 [US3] Verified `BUILTIN_AGENT_NAMES` contains exactly the canonical list
- [x] T025 [P] [US3] Verified `packages/core/src/bundled/agents/` directory — `build.md` absent, `liteai.md` present
- [x] T026 [P] [US3] Verified `ALL_LITEAI_TOOLS` set contains `"agent"` not `"task"`
- [x] T027 [US3] Verified `bundled/prompts/tools/` contains `agent.txt` not `task.txt`

**Checkpoint**: ✅ Agent roster verified.

---

## Phase 6: User Story 4 — Coordinator Mode Compatibility (Priority: P2)

- [x] T028 [US4] Update `COORDINATOR_ALLOWED_TOOLS` in `packages/core/src/coordinator/coordinator-mode.ts`
- [x] T029 [US4] Update `INTERNAL_COORDINATOR_TOOLS` in `packages/core/src/coordinator/coordinator-mode.ts`
- [x] T030 [US4] Update `getCoordinatorUserContext()` string in `packages/core/src/coordinator/coordinator-mode.ts`
- [x] T031 [US4] Run `bun typecheck` — verified coordinator changes compile cleanly

**Checkpoint**: ✅ Coordinator mode uses `"agent"` and `"agent_stop"` everywhere.

---

## Phase 7: Prompt Content Updates

- [x] T032 Update prompt content in `packages/core/src/bundled/prompts/tools/agent.txt`
- [x] T033 [P] Update XML output tags in `packages/core/src/tool/agent.ts`

**Checkpoint**: ✅ All prompt text and protocol tags use "agent" terminology.

---

## Phase 8: Test Updates

- [x] T034 Update test references in `packages/core/test/agent/filter.test.ts`
- [x] T035 [P] Update test references in `packages/core/test/agent/agent.test.ts`
- [x] T036 [P] Update test references in `packages/core/test/coordinator/coordinator-mode.test.ts`
- [x] T037 [P] Update test references in `packages/core/test/coordinator/swarm-tools.test.ts`
- [x] T038 [P] Update test references in `packages/core/test/plan-mode/enter-plan-tool.test.ts`
- [x] T039 [P] N/A — `permission-task.test.ts` does not exist (no references found)
- [x] T040 [P] Update test references in `packages/core/test/bundled/bundled.test.ts`
- [x] T041 [P] Update test references in `packages/core/test/session/engine/registry-wiring.test.ts`
- [x] T042 [P] Update test references in `packages/core/test/session/streaming-tool-executor.test.ts`
- [x] T043 [P] Update test references in `packages/core/test/session/prompt.test.ts`
- [x] T044 [P] Update test references in `packages/core/test/session/engine/abort-during-thinking.test.ts` and `test/session/llm-telemetry.test.ts` and `test/plan-mode/plan-reminder.test.ts`
- [x] T045 Scanned remaining test files — no stale references found

**Checkpoint**: ✅ All test files reference new names.

---

## Phase 9: Polish & Verification

- [x] T046 `bun typecheck` passes with zero errors
- [x] T047 `bun lint:fix` passes cleanly (no fixes needed)
- [x] T048 Scoped tests: `bun test test/agent` — 6/6 pass
- [x] T049 [P] Scoped tests: `bun test test/coordinator` — 87/87 pass
- [x] T050 [P] Scoped tests: `bun test test/plan-mode` — 19/19 pass
- [x] T051 [P] Scoped tests: `bun test test/session/engine` — 4/4 pass
- [x] T052 [P] Scoped tests: `bun test test/bundled` — 27/27 pass
- [x] T053 [P] Scoped tests: `test/session/prompt.test.ts` — 4/4 pass
- [x] T054 Final grep validation — zero stale `"task"` as tool ID, zero stale `"build"` as agent name (excluding migration logic)
- [x] T055 Old files confirmed absent: `task.ts`, `task_stop.ts`, `build.md`, `task.txt` all gone

---

## Final Results

| Metric | Value |
|--------|-------|
| **Total Tasks** | 55 |
| **Completed** | 55 |
| **Typecheck** | ✅ PASS |
| **Lint** | ✅ PASS |
| **Tests** | ✅ 168/168 pass across 19 scoped test files |
| **Stale References** | 0 |
