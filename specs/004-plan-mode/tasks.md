# Tasks: Plan Mode

**Input**: Design documents from `/specs/004-plan-mode/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Test tasks T047–T051 are integrated into each user story phase to verify Success Criteria independently.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

**Reference Implementation Mandate**: All implementation tasks MUST be grounded on the MVP reference implementation at `C:\Users\aghassan\Documents\workspace\liteai_cli_mvp\src`. See plan.md for key reference files.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 0: Platform Profile Tool Name Bridge (Prerequisite)

**Purpose**: Extend the platform profile layer to translate external tool names to liteai canonical IDs, closing the silent deny-filter bug where PascalCase names (e.g., `"Edit"`) fail to match lowercase tool IDs (e.g., `"edit"`) in `resolveAgentTools()`.

- [ ] T052 [P] Add `toolNameMap?: Record<string, string>` field to `PlatformProfile` interface in `packages/core/src/platform/profile.ts` — optional mapping from platform-specific tool names to liteai canonical tool IDs per FR-030
- [ ] T053 [P] Populate `toolNameMap` in `packages/core/src/platform/profiles/claude.ts` — map Claude Code tool names to liteai canonical IDs: `Edit→edit`, `Write→write`, `Read→read`, `Glob→glob`, `Grep→grep`, `List→list`, `NotebookEdit→multiedit`, `Agent→task`, `ExitPlanMode→plan_exit`, `Bash→run_command`. Reference: MVP `planAgent.ts` constants
- [ ] T054 Create `normalizeToolNames()` utility in `packages/core/src/platform/profile.ts` (or a co-located module) — accepts a `string | string[]` and an optional `toolNameMap`, returns the array with each entry translated through the map (unknown names pass through unchanged for MCP tools and liteai-native names) per FR-031
- [ ] T055 Wire `normalizeToolNames()` into agent config processing in `packages/core/src/agent/agent.ts` at line ~264 — apply to both `value.disallowedTools` and `value.tools` before storing on the agent definition. Use `Platform.active()?.toolNameMap` per FR-031
- [ ] T056 [P] Add test for toolNameMap normalization — verify that Claude Code PascalCase names in `disallowedTools` are translated to liteai canonical IDs, that unknown names pass through unchanged, and that `undefined` map is a no-op

**Checkpoint**: `disallowedTools: ["Edit", "ExitPlanMode"]` in a Claude Code agent definition is normalized to `["edit", "plan_exit"]` before it reaches `resolveAgentTools()`. The silent deny-filter bug is eliminated.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Schema migration, shared types, and SSE event definitions needed by all user stories

- [ ] T001 Add `plan_mode` nullable JSON column to SessionTable in `packages/core/src/session/session.sql.ts` — type `text({ mode: "json" }).$type<PlanModeState>()` per data-model.md schema migration
- [ ] T002 Generate and apply drizzle-orm migration for the new `plan_mode` column — run `bun db generate` and verify migration SQL
- [ ] T003 [P] Create `packages/core/src/session/plan-mode-state.ts` — define `PlanModeState` interface, `createDefaultPlanModeState(session)` factory, `getPlanModeState(sessionID)` reader (returns default when column is null), and `setPlanModeState(sessionID, updater)` writer per contracts/plan-mode-api.md
- [ ] T004 [P] Define `PlanStateChanged` and `PlanApprovalRequested` BusEvent types in `packages/core/src/session/index.ts` under `Session.Event` namespace — payloads per data-model.md SSE Event Payloads section
- [ ] T005 [P] Route `plan.state_changed` and `plan.approval_requested` BusEvents through the ACP SSE event infrastructure in `packages/core/src/acp/events.ts` — subscribe to Bus events and relay as session-scoped SSE

---

## Phase 2: Foundational — Session-Scoped Plan Mode State (US5, Priority: P1)

**Purpose**: Core `PlanModeState` read/write/persist infrastructure that MUST be complete before ANY other user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

**Goal**: Store plan mode state as a first-class session-scoped object persisted in SQLite, replacing the current `agent.name === 'plan'` inference pattern

**Independent Test**: Activate plan mode, make several turns, verify the turn counter increments and persists between turns. Verify concurrent sessions maintain independent state.

- [ ] T006 [US5] Wire `getPlanModeState()` into the query loop in `packages/core/src/session/engine/query.ts` — read PlanModeState at the start of each turn (after agent resolution at line ~198), store in a local variable for use by downstream systems
- [ ] T007 [US5] Wire `setPlanModeState()` into the query loop in `packages/core/src/session/engine/query.ts` — after each turn completes (before the turn-end yield at line ~472), persist the updated PlanModeState (with incremented `turnsSincePlanReminder` if active) back to the session row
- [ ] T008 [US5] Add `fromRow`/`toRow` integration in `packages/core/src/session/index.ts` — extend `Session.fromRow()` and `Session.toRow()` to read/write the `plan_mode` column, and add `planModeState` to `Session.Info` if needed (or keep it as a separate accessor via `getPlanModeState`)
- [ ] T009 [US5] Add OpenTelemetry span annotations for plan mode state transitions in `packages/core/src/session/plan-mode-state.ts` — log structured events for state reads, writes, and `active` field changes per FR-029
- [ ] T010 [US5] Verify `setPlanModeState()` emits `plan.state_changed` BusEvent when the `active` field changes — confirm the event fires with correct `{ sessionID, active, planFilePath, turnsSincePlanReminder }` payload
- [ ] T047 [US5] Create `tests/plan-mode/plan-mode-state.test.ts` — test PlanModeState CRUD: default initialization, read/write cycle, turn counter increment, persistence via fromRow/toRow, and multi-session isolation. Verify SC-010 (`turnsSincePlanReminder` monotonic increment and reset at 5)

**Checkpoint**: PlanModeState is readable, writable, persisted in SQLite, and integrated with the query loop. All subsequent user stories can now read/write plan mode state.

---

## Phase 3: User Story 1 — Attachment-Driven Plan Reminder Cycle (Priority: P1) 🎯 MVP

**Goal**: Replace the current synthetic-part-based `plan-reminder.ts` with an attachment-based system that appends sparse/full plan text as non-persistent user message parts, driven by `PlanModeState`

**Independent Test**: Activate plan mode and send multiple user messages. Verify each message carries exactly one sparse attachment. Verify every 5th message carries the full plan text attachment. Verify build mode has no attachments.

### Implementation for User Story 1

- [ ] T011 [US1] Rewrite `packages/core/src/session/engine/plan-reminder.ts` — replace `insertPlanReminder()` with `injectPlanAttachment()` per contracts/plan-mode-api.md: accept `PlanModeState` as input, return updated state, append in-memory parts (no `Session.updatePart()` DB writes), set `synthetic: false` on injected parts
- [ ] T012 [US1] Implement sparse reminder injection in `packages/core/src/session/engine/plan-reminder.ts` — when `active === true` and `turnsSincePlanReminder < 5`: append `"Plan at <relative-path>, staying on track?"` as a non-synthetic text part to the last user message
- [ ] T013 [US1] Implement full plan text injection in `packages/core/src/session/engine/plan-reminder.ts` — when `active === true` and `turnsSincePlanReminder >= 5`: read plan file from disk via `fs.readFile()`, append full contents as text part, reset counter to 0. Fall back to sparse if file doesn't exist per edge case specification
- [ ] T014 [US1] Implement plan-not-exists handling in `packages/core/src/session/engine/plan-reminder.ts` — when `active === true` but plan file doesn't exist: append `"No plan file exists yet at <path>"` as sparse attachment per acceptance scenario 4
- [ ] T015 [US1] Implement no-op path in `packages/core/src/session/engine/plan-reminder.ts` — when `active === false`: return messages and state unchanged, zero operations per FR-008
- [ ] T016 [US1] Update `packages/core/src/session/engine/query.ts` to call `injectPlanAttachment()` instead of `insertPlanReminder()` at line ~217 — pass `planModeState` read from Phase 2, capture `updatedState` return value, update the local state variable for persistence in T007
- [ ] T017 [US1] Remove the old `insertPlanReminder()` export and its build-switch / plan-enter synthetic part injection logic from `packages/core/src/session/engine/plan-reminder.ts` — clean break from the legacy approach per Constitution Principle I
- [ ] T018 [US1] Add OpenTelemetry span annotations for reminder injection events in `packages/core/src/session/engine/plan-reminder.ts` — log whether sparse or full reminder was injected, and the current turn counter value per FR-029
- [ ] T048 [US1] Create `tests/plan-mode/plan-reminder.test.ts` — test attachment injection: sparse reminder on every turn, full plan text at turn 5, no-op when inactive, plan-file-not-exists fallback. Verify SC-001 (system prompt unchanged), SC-002 (exactly one attachment per message), SC-003 (full text every 5th)

**Checkpoint**: Plan reminder cycle works end-to-end via PlanModeState. System prompt is never modified (SC-001). Every user message in plan mode carries exactly one attachment (SC-002). Every 5th message carries full plan text (SC-003).

---

## Phase 4: User Story 2 — Plan-to-Build Transition with Inline Approval (Priority: P1)

**Goal**: Rewrite `ExitPlanModeTool` to write plan to disk, emit SSE approval event, block via `Question.ask()`, and inject plan text into the tool result on approval

**Independent Test**: Trigger `ExitPlanModeTool`, verify `plan.approval_requested` SSE event is emitted, send approve action, verify tool result contains full plan text and session mode is `build`.

### Implementation for User Story 2

- [ ] T019 [US2] Rewrite `ExitPlanModeTool` in `packages/core/src/tool/plan.ts` — replace the current synthetic-message-injection approach with the contract from contracts/plan-mode-api.md: accept `plan: z.string().min(1)` parameter, write to disk, emit `plan.approval_requested`, block via `Question.ask()`, return plan-in-tool-result on approval. Reference: MVP `ExitPlanModeV2Tool.ts` lines 243-417
- [ ] T020 [US2] Implement plan file write in `ExitPlanModeTool` execute — use `fs.writeFile()` to write `params.plan` to `PlanModeState.planFilePath`. Create parent directories if needed via `fs.mkdir(recursive: true)`. Update `PlanModeState.planText` per FR-009
- [ ] T021 [US2] Implement approval SSE event emission in `ExitPlanModeTool` execute — after file write, emit `plan.approval_requested` via `Bus.publish()` with `{ sessionID, planText, planFilePath }` per FR-010
- [ ] T022 [US2] Implement approval blocking in `ExitPlanModeTool` execute — call `Question.ask()` with approve/reject options after emitting SSE event. Structure mirrors the existing `PlanExitTool` pattern at `packages/core/src/tool/plan.ts` lines 27-41 per FR-010
- [ ] T023 [US2] Implement approval path in `ExitPlanModeTool` execute — on "Yes" answer: call `setPlanModeState()` to set `active = false`, reset `turnsSincePlanReminder = 0`, emit `plan.state_changed` with `{ active: false }`, return tool result with `{ title, output: <full plan text + execution guidance>, metadata: { planFilePath, approved: true } }` per FR-011, FR-014
- [ ] T024 [US2] Implement rejection path in `ExitPlanModeTool` execute — on "No" answer: throw `Question.RejectedError` containing a descriptive rejection string/reason to be surfaced to the model. `PlanModeState.active` remains `true` per FR-012
- [ ] T025 [US2] Implement empty plan validation in `ExitPlanModeTool` — validate `params.plan` is non-empty before any write/emit operations. Return descriptive error if empty per FR-013
- [ ] T026 [US2] Implement not-in-plan-mode guard in `ExitPlanModeTool` — read `PlanModeState` and return descriptive error if `active === false` per edge case specification
- [ ] T027 [US2] Remove the legacy synthetic user message injection from `ExitPlanModeTool` return — delete the `inject: [{ info: userMsg, parts: [userPart] }]` pattern from the current implementation. The plan text now lives in the tool result `output` field per C-002
- [ ] T029 [US2] Add OpenTelemetry span annotations for ExitPlanModeTool operations in `packages/core/src/tool/plan.ts` — log plan write, approval requested, approved/rejected outcomes per FR-029
- [ ] T049 [US2] Create `tests/plan-mode/exit-plan-tool.test.ts` — test ExitPlanModeTool: plan write to disk, approval_requested SSE event emission, approval path (state transition + plan-in-tool-result), rejection path (RejectedError thrown), empty plan validation, not-in-plan-mode guard. Verify SC-004 (event timing), SC-005 (tool result contents)

**Checkpoint**: ExitPlanModeTool writes plan to disk, emits SSE event, blocks for approval, injects plan into tool result on approval, throws RejectedError on rejection. SC-004, SC-005 are met.

---

## Phase 5: User Story 3 — Build-to-Plan Transition (EnterPlanMode) (Priority: P2)

**Goal**: Restore and rewrite `EnterPlanModeTool` for bidirectional build↔plan transitions with plan-in-tool-result injection and idempotent guard

**Independent Test**: Trigger `EnterPlanModeTool` from build agent. Verify `PlanModeState.active` becomes `true`, verify `plan.state_changed` SSE event is emitted, verify tool result contains existing plan text or creation guidance.

### Implementation for User Story 3

- [ ] T030 [US3] Implement `EnterPlanModeTool` in `packages/core/src/tool/plan.ts` — un-comment the existing `PlanEnterTool` block (lines 76-133) and rewrite per contracts/plan-mode-api.md: no parameters, set `PlanModeState.active = true`, reset `turnsSincePlanReminder = 0`, emit `plan.state_changed`, return plan text or creation guidance in tool result. Reference: MVP `EnterPlanModeTool.ts` lines 77-101
- [ ] T031 [US3] Implement existing plan injection in `EnterPlanModeTool` — when plan file exists on disk, read it via `fs.readFile()` and include full text in tool result with `"Review and refine the existing plan at <path>"` guidance per FR-017
- [ ] T032 [US3] Implement no-plan guidance in `EnterPlanModeTool` — when plan file doesn't exist, return tool result with `"Create a plan at <plan-file-path> using the file write tool"` guidance per FR-017
- [ ] T033 [US3] Implement idempotent guard in `EnterPlanModeTool` — if `PlanModeState.active` is already `true`, return confirmation message without re-emitting events, without resetting turn counter, and without re-reading the plan file per FR-018
- [ ] T034 [US3] Implement agent transition in `EnterPlanModeTool` — set the user message `agent` field to `"plan"` in the tool result to trigger the session's agent switch to the plan agent per FR-019
- [ ] T035 [US3] Add OpenTelemetry span annotations for EnterPlanModeTool operations in `packages/core/src/tool/plan.ts` — log activation, idempotent no-op, and plan file read outcomes per FR-029
- [ ] T028 [US3] Add `EnterPlanModeTool` to `ToolRegistry` import and tool list in `packages/core/src/tool/registry.ts` — import `PlanEnterTool` from `./plan` and include in the `all()` function return array alongside `PlanExitTool`. This task MUST run after T030. Reference: `PlanEnterTool` is already defined (commented out) as `Tool.define("plan_enter", ...)` in `plan.ts:77` but is not currently registered
- [ ] T050 [US3] Create `tests/plan-mode/enter-plan-tool.test.ts` — test EnterPlanModeTool: activation path, existing plan injection, no-plan guidance, idempotent guard (no re-emit), agent transition field. Verify SC-008 (idempotency), SC-009 (event timing)

**Checkpoint**: EnterPlanModeTool enables bidirectional transitions. SC-008 (idempotency) and SC-009 (SSE event timing) are met.

---

## Phase 6: User Story 4 — Plan/Explore Sub-Agents with Tool Restriction (Priority: P2)

**Goal**: Close the `disallowedTools` enforcement gap in `ToolRegistry.tools()` and define the Plan/Explore sub-agent with read-only tool restriction

**Independent Test**: Spawn a Plan/Explore sub-agent, verify file modification tools are absent from the tool pool and the sub-agent can read files.

### Implementation for User Story 4

- [ ] T036 [US4] Wire `disallowedTools` deny filter into `ToolRegistry.tools()` in `packages/core/src/tool/registry.ts` — after the existing assembly steps (config filter at line ~86, model filter at line ~87-95), apply `agent.disallowedTools` as a post-assembly deny filter using exact `t.id` string equality against the normalized canonical IDs per FR-020, FR-022. Log a structured warning if a `disallowedTools` entry does not match any tool in the pool (fail-fast detection per Constitution VI)
- [ ] T037 [US4] Ensure no-op behavior when `disallowedTools` is undefined or empty in `packages/core/src/tool/registry.ts` — verify the deny filter returns the full tool pool unchanged when the agent has no `disallowedTools` config per FR-021, C-003. This is the zero regression guarantee (SC-007)
- [ ] T038 [P] [US4] Create `plan-explore` bundled agent definition in `packages/core/src/bundled/agents/plan-explore.md` — YAML frontmatter with `mode: subagent`, `omitLiteaiMd: true`, `permissionMode: inherit`, `disallowedTools: ["edit", "write", "multiedit", "apply_patch", "plan_exit", "task"]`, `description` for the research use case, and system prompt for read-only exploration per FR-023. Reference: MVP `planAgent.ts:77-83` and `exploreAgent.ts:67-73`
- [ ] T039 [US4] Add `"plan-explore"` to `BUILTIN_AGENT_NAMES` array in `packages/core/src/agent/agent.ts` line 32 — ensures the agent is loaded via `loadBuiltinAgents()` per R-006
- [ ] T040 [US4] Add OpenTelemetry span annotations for `disallowedTools` filtering in `packages/core/src/tool/registry.ts` — log when tools are removed by the deny filter, including the count of removed tools and the agent name per FR-029
- [ ] T051 [US4] Extend or create `tests/tool/registry.test.ts` — test disallowedTools deny filter: tools removed by exact ID match, no-op when empty/undefined, full pool verification snapshot before/after, and integration with `toolNameMap` normalization (Claude Code PascalCase names pre-normalized). Verify SC-006 (disallowed tools absent), SC-007 (zero regression)

**Checkpoint**: Plan/Explore sub-agents cannot invoke file modification tools (SC-006). Existing agents with no `disallowedTools` config receive their full tool pool unchanged (SC-007).

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Cleanup, verification, and documentation updates

- [ ] T041 Remove the legacy `build-switch` and `plan-reminder` bundled prompt references if they are no longer used after the plan-reminder.ts rewrite — check `packages/core/src/bundled/prompts/misc/` for orphaned prompt files
- [ ] T043 Run `bun typecheck` from `packages/core/` and fix all TypeScript errors introduced by the plan mode changes
- [ ] T044 Run `bun lint:fix` from `packages/core/` and verify zero linting warnings in modified files
- [ ] T045 Verify existing tool assembly tests still pass with `disallowedTools` changes — run `bun test test/tool` or relevant scoped test path
- [ ] T046 Update agent execution modes documentation at `packages/core/docs/agent-execution-modes.md` — add Plan/Explore sub-agent details, update Plan Mode description to reflect the new state machine architecture, and document the `toolNameMap` bridge for platform-specific tool name translation

---

## Dependencies & Execution Order

### Phase Dependencies

- **Platform Bridge (Phase 0)**: No dependencies — can start immediately (prerequisite for Phase 6)
- **Setup (Phase 1)**: No dependencies — can run in parallel with Phase 0
- **Foundational/US5 (Phase 2)**: Depends on Setup (T001–T005) — BLOCKS all user stories
- **US1 (Phase 3)**: Depends on Phase 2 completion (PlanModeState infrastructure)
- **US2 (Phase 4)**: Depends on Phase 2 completion. Can run in parallel with US1.
- **US3 (Phase 5)**: Depends on Phase 2 completion. Can run in parallel with US1, US2. T028 (registry import) depends on T030 (tool implementation).
- **US4 (Phase 6)**: Depends on Phase 0 (toolNameMap) and Phase 1 (T003 for types). Can run in parallel with US1–US3 and Phase 2.
- **Polish (Phase 7)**: Depends on all user stories being complete

### User Story Dependencies

- **US5 (P1, Foundational)**: Blocks US1, US2, US3. Independent of US4.
- **US1 (P1, Reminder Cycle)**: Depends on US5. Independent of US2, US3, US4.
- **US2 (P1, ExitPlanModeTool)**: Depends on US5. Independent of US1, US3, US4.
- **US3 (P2, EnterPlanModeTool)**: Depends on US5. Independent of US1, US2, US4.
- **US4 (P2, disallowedTools)**: Independent of US1, US2, US3, US5 (only needs Phase 1 types).

### Within Each User Story

- State module before tools
- Tools before query loop integration
- Core implementation before observability
- Story complete before moving to next priority

### Parallel Opportunities

- T003, T004, T005 can all run in parallel (different files)
- US1, US2, US3 can all run in parallel after Phase 2 completes
- US4 can run in parallel with Phase 2 and US1–US3
- T038 (agent definition) can run in parallel with T036–T037 (registry changes)

---

## Parallel Example: After Phase 2 Completes

```text
# Phase 0 (Platform Bridge) and Phase 1 (Setup) run first, in parallel:
Stream 0: T052 → T053 → T054 → T055 → T056
Stream 1: T001 → T002 (then T003, T004, T005 in parallel)

# Phase 2 starts after Phase 1 completes:
Stream 2: T006 → T007 → T008 → T009 → T010 → T047

# After Phase 2, all P1 user stories can start simultaneously:
Stream A (US1): T011 → T012 → T013 → T014 → T015 → T016 → T017 → T018 → T048
Stream B (US2): T019 → T020 → T021 → T022 → T023 → T024 → T025 → T026 → T027 → T029 → T049
Stream C (US4): T036 → T037 → T038 → T039 → T040 → T051  (requires Phase 0 complete)

# US3 can start anytime after Phase 2:
Stream D (US3): T030 → T031 → T032 → T033 → T034 → T035 → T028 → T050
```

---

## Implementation Strategy

### MVP First (US5 + US1 Only)

1. Complete Phase 1: Setup (T001–T005)
2. Complete Phase 2: US5 Foundational (T006–T010)
3. Complete Phase 3: US1 Reminder Cycle (T011–T018)
4. **STOP and VALIDATE**: Plan reminders work, system prompt is clean (SC-001, SC-002, SC-003)
5. Proceed to US2 (ExitPlanModeTool) for the full plan→build flow

### Incremental Delivery

1. Setup + US5 → PlanModeState infrastructure ready
2. Add US1 → Test reminder cycle independently → MVP checkpoint
3. Add US2 → Test plan→build flow → Core plan mode complete
4. Add US3 → Test build→plan flow → Bidirectional transitions complete
5. Add US4 → Test tool restriction → Read-only sub-agents complete
6. Polish → Documentation, cleanup → Feature complete

### Parallel Team Strategy

With two developers:
1. Both complete Setup + US5 together
2. Once Phase 2 is done:
   - Developer A: US1 (reminder cycle) then US3 (enter plan mode)
   - Developer B: US2 (exit plan mode) then US4 (tool restriction)
3. Both do Polish together

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story is independently completable and testable after Phase 2
- All implementation MUST reference the MVP at `liteai_cli_mvp/src` for behavioral parity (C-001)
- The `plan-reminder.ts` rewrite (US1) is a clean break — the old module is deleted, not patched
- `disallowedTools` (US4) closes a Phase 2 gap — existing agents MUST NOT regress (C-003)
- Platform profile `toolNameMap` (Phase 0) fixes the silent deny-filter bug where PascalCase tool names fail to match lowercase canonical IDs
- Total Tasks: 56 (T001–T056, with T042 removed as duplicate of T028)
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
