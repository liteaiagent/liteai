# Tasks: Plan Mode MVP Parity

**Input**: Design documents from `specs/006-plan-mode-mvp-parity/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, quickstart.md

**Tests**: Test update tasks are included because the existing test suite (`test/plan-mode/`) must be updated for the intentional architectural changes (per Test Resolution Protocol §VII).

**Organization**: Tasks follow the 6-layer change map from `plan.md`. User stories are mapped to layers rather than phases, because this is a refactor of an existing system — the layers represent a strict execution dependency chain where legacy must be purged before new behavior is built.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## User Story Mapping

| Story | Spec Reference | Priority | Summary |
|-------|---------------|----------|---------|
| US1 | User Story 1 | P1 | Agent proactively enters plan mode with user approval |
| US2 | User Story 2 | P1 | 5-phase planning workflow |
| US3 | User Story 3 | P2 | Interview mode variant |
| US4 | User Story 4 | P2 | Plan reminders during build phase |
| US5 | User Story 5 | P1 | Subagent naming and permission parity |

---

## Phase 1: MVP Source Audit (C-006 — Mandatory Pre-Implementation Gate)

**Purpose**: Read and cross-reference every MVP source file listed in RFC Section 3.1 BEFORE writing any code. This is non-negotiable per constraint C-006.

- [ ] T001 Read MVP `EnterPlanModeTool.ts` and document the permission context mutation pattern, `shouldDefer` behavior, and which tool result text is returned on activation — file: `liteai_cli_mvp/src/tools/EnterPlanModeTool/EnterPlanModeTool.ts`
- [ ] T002 [P] Read MVP `prompt.ts` and extract the complete "When to Use / When NOT to Use" tool description text (external + internal variants) — file: `liteai_cli_mvp/src/tools/EnterPlanModeTool/prompt.ts`
- [ ] T003 [P] Read MVP `ExitPlanModeV2Tool.ts` and document the approval flow, plan-in-context injection, and tool result text — file: `liteai_cli_mvp/src/tools/ExitPlanModeTool/ExitPlanModeV2Tool.ts`
- [ ] T004 [P] Read MVP `messages.ts` lines 3207-3297 (5-phase workflow) and lines 3330-3361 (interview phase) and extract the complete instruction text — file: `liteai_cli_mvp/src/utils/messages.ts`
- [ ] T005 [P] Read MVP `exploreAgent.ts` and extract `getExploreSystemPrompt()`, `disallowedTools`, and `whenToUse` — file: `liteai_cli_mvp/src/tools/AgentTool/built-in/exploreAgent.ts`
- [ ] T006 [P] Read MVP `planAgent.ts` and extract `getPlanV2SystemPrompt()`, `disallowedTools`, and `whenToUse` — file: `liteai_cli_mvp/src/tools/AgentTool/built-in/planAgent.ts`
- [ ] T007 [P] Read MVP `planModeV2.ts` and document agent count configuration (explore: 3, plan: 1-3) — file: `liteai_cli_mvp/src/utils/planModeV2.ts`

**Checkpoint**: All MVP source files read and understood. Implementation may now proceed.

---

## Phase 2: Legacy Purge (FR-015a–g, SC-009)

**Purpose**: Remove all legacy artifacts that implement the broken persona-swap pattern. This MUST complete before any new behavior is built. Order is critical — remove agent references from code before deleting agent files.

**⚠️ CRITICAL**: No new behavior can be built until the legacy purge is complete.

- [ ] T008 [US1] Remove the `inject: [{ info: userMsg, parts: [] }]` return and the `getLastModel()` + `userMsg` construction from `PlanEnterTool.execute()`, including the idempotent (already-active) path — file: `packages/core/src/tool/plan.ts` (lines 94-110, 142-158, 18-25)
- [ ] T009 [US1] Remove the `inject: [{ info: userMsg, parts: [] }]` return and the `getLastModel()` + `userMsg` construction from `PlanExitTool.execute()` — file: `packages/core/src/tool/plan.ts` (lines 94-110)
- [ ] T010 [US5] Remove `"plan-explore"` from the `BUILTIN_AGENT_NAMES` array — file: `packages/core/src/agent/agent.ts` (line 37)
- [ ] T011 [US5] Delete the `plan-explore.md` agent file (dead code, never spawned, duplicates explore.md) — file: `packages/core/src/bundled/agents/plan-explore.md`
- [ ] T012 Run `bun typecheck` to verify no broken references from the purge. Expect clean build after removing the file and its reference from the names array.

**Checkpoint**: Legacy persona-swap mechanism is fully removed. `bun typecheck` passes. No `agent: "plan"` or `agent: "build"` inject patterns remain in `plan.ts`.

---

## Phase 3: MVP Prompt Porting (FR-007–010, FR-016–020, C-004)

**Purpose**: Port all prompts, system instructions, and tool descriptions from the MVP reference implementation. All ported content must be sourced from the MVP files read in Phase 1.

- [ ] T013 [P] [US2] Create `plan-workflow.md` with the 5-phase workflow instructions ported verbatim from MVP `messages.ts` lines 3207-3297. Adapt any MVP-specific tool names to LiteAI equivalents where necessary. — file: `packages/core/src/bundled/prompts/misc/plan-workflow.md`
- [ ] T014 [P] [US3] Create `plan-interview.md` with the interview mode instructions ported verbatim from MVP `messages.ts` lines 3330-3361. — file: `packages/core/src/bundled/prompts/misc/plan-interview.md`
- [ ] T015 [P] [US5] Rewrite `plan.md` as a subagent definition: change `mode: primary` to `mode: subagent`, add `omitLiteaiMd: true`, set `disallowedTools: [task, plan_exit, edit, write, multiedit]`, port description from MVP `PLAN_AGENT.whenToUse`, port system prompt from MVP `getPlanV2SystemPrompt()`. Remove the legacy read-only root-agent system-reminder body. — file: `packages/core/src/bundled/agents/plan.md`
- [ ] T016 [P] [US5] Verify `explore.md` against MVP `EXPLORE_AGENT` definition — compare description, permissions, disallowedTools, and system prompt. Align any discrepancies with the MVP source. Do NOT create a second explore agent file. — file: `packages/core/src/bundled/agents/explore.md`
- [ ] T017 [P] [US1] Rewrite the `plan_enter` tool description: replace the current 3-line `ENTER_DESCRIPTION` constant with the complete "When to Use This Tool" / "When NOT to Use" / "What Happens in Plan Mode" / examples text ported from MVP `prompt.ts`. — file: `packages/core/src/tool/plan.ts` (lines 122-124)
- [ ] T018 [P] [US1] Rewrite `plan-exit.txt` tool description: expand from the current 1-line description to include plan file content requirements, prohibition on using plain text/questions for approval, and when to call, ported from MVP `ExitPlanModeV2Tool.ts`. — file: `packages/core/src/bundled/prompts/tools/plan-exit.txt`
- [ ] T019 [US1] Update `system.md` Section 5 (lines 30-36): replace the current "you are strictly in Planning Mode" directives with a reference to the `plan_enter` tool as the mechanism for structured planning. The stale text currently conflicts with Section 6's autonomous execution directives. — file: `packages/core/src/bundled/prompts/system/system.md`
- [ ] T020 [US1] Update `build.md` comment block (line 13): the comment says "Subagents (explore.md, plan.md) define their own prompts" — after the rewrite, `plan.md` IS a subagent, so the comment is now correct. Verify no stale references remain. — file: `packages/core/src/bundled/agents/build.md`
- [ ] T021 Run `bun typecheck` to verify the prompt file imports resolve correctly after creating the new misc/ files.

**Checkpoint**: All prompts ported from MVP. No custom-authored prompt content. `bun typecheck` passes.

---

## Phase 4: User Story 1 — Approval-Gated Plan Mode Entry (Priority: P1) 🎯 MVP

**Goal**: Agent proactively enters plan mode with user approval. The root agent remains continuous (zero amnesia). Workflow instructions are injected as tool result output.

**Independent Test**: Send a complex task → agent calls `plan_enter` → user sees approval prompt → approve → agent receives workflow instructions → root agent identity unchanged.

### Implementation

- [ ] T022 [US1] Add `Question.ask()` approval gate to `PlanEnterTool.execute()`: before mutating `PlanModeStateRef`, ask the user "Approve entering plan mode?" with Accept/Decline options. On decline, throw `Question.RejectedError`. Import `Question` if not already imported. — file: `packages/core/src/tool/plan.ts`
- [ ] T022a [US1] Add an "already active" guard at the top of `PlanEnterTool.execute()`: if `PlanModeStateRef.for(session).active === true`, return immediately with `output: "Plan mode is already active."` (FR-014). This replaces the legacy idempotent path removed in T008. — file: `packages/core/src/tool/plan.ts`
- [ ] T023 [US1] Add `interviewMode` optional boolean parameter to `PlanEnterTool` schema: `parameters: z.object({ interviewMode: z.boolean().optional().default(false) })`. — file: `packages/core/src/tool/plan.ts`
- [ ] T024 [US1] Load workflow text and return as tool output: import `plan-workflow.md` and `plan-interview.md` as bundled text assets. In `execute()`, after approval, select the correct workflow text based on `params.interviewMode` and return it as the `output` field along with the plan file path. — file: `packages/core/src/tool/plan.ts`
- [ ] T025 [US1] Verify that `PlanExitTool.execute()` returns the plan text as `output` field (plan-in-context) after removing the inject pattern. Ensure the output includes both the status message and the plan content so the model has the plan in-context when transitioning to build mode. — file: `packages/core/src/tool/plan.ts`
- [ ] T025a [US2] Verify plan rejection behavior in `PlanExitTool.execute()`: when `Question.ask()` throws `Question.RejectedError`, confirm that (1) `PlanModeStateRef` is NOT mutated (plan mode remains active), (2) no plan text is injected into context, and (3) the agent remains in plan mode to revise the plan. Add a comment documenting this as the "rejection → revision → re-submission" path per spec edge case L113. — file: `packages/core/src/tool/plan.ts`
- [ ] T026 [US1] Emit `Bus.publish(Session.Event.PlanApprovalRequested)` from `PlanEnterTool` after the user approves entry, so the UI can show the "Plan" badge. Verify the event payload matches what the frontend expects. — file: `packages/core/src/tool/plan.ts`

**Checkpoint**: Plan mode entry requires user approval. Workflow instructions are returned as tool output. No agent swap. `bun typecheck` passes.

---

## Phase 5: User Story 5 — Subagent Naming and Permission Parity (Priority: P1)

**Goal**: Explore and Plan subagents have correct names and read-only permissions matching the MVP. Both are spawnable via the Agent tool during the 5-phase workflow.

**Independent Test**: Inspect agent definitions → Explore is "explore" with read-only permissions → Plan is "plan" with read-only permissions → neither can edit/write files or spawn agents.

### Implementation

- [ ] T027 [US5] Verify that the rewritten `plan.md` (from T015) is correctly loaded by `loadBuiltinAgents()` with `mode: subagent`. Confirm it appears in the agent registry with the correct `disallowedTools` and permissions. — file: `packages/core/src/agent/agent.ts`
- [ ] T028 [US5] Verify that the `explore.md` agent (verified in T016) has the correct `disallowedTools` alignment with the Plan subagent. Both should disallow: `edit`, `write`, `multiedit`, `task`, `plan_exit`. Confirm `plan_enter` is also disallowed for subagents (since `isRootAgent()` check already prevents it). — file: `packages/core/src/bundled/agents/explore.md`

**Checkpoint**: Both subagents are registered with correct names and read-only permissions. `bun typecheck` passes.

---

## Phase 6: User Story 2 — 5-Phase Planning Workflow (Priority: P1)

**Goal**: After entering plan mode, the agent follows the 5-phase workflow: Explore subagents → Plan subagents → Review → Write Plan → Exit & Approval.

**Independent Test**: Enter plan mode → agent spawns Explore subagent(s) → spawns Plan subagent(s) → writes plan file → calls plan_exit → user approves → agent continues with full tools.

### Implementation

- [ ] T029 [US2] Verify that the 5-phase workflow text (created in T013) references the correct LiteAI tool names for spawning subagents (the `task` tool with agent type "explore" or "plan"). If the MVP uses different tool names, map them to LiteAI equivalents in the workflow text. — file: `packages/core/src/bundled/prompts/misc/plan-workflow.md`
- [ ] T030 [US2] Verify that when `PlanEnterTool` returns the 5-phase workflow text as output, the model can parse and follow the phase structure. Review the output format for clarity and ensure phase numbering, subagent count guidance, and tool names are correct. — file: `packages/core/src/tool/plan.ts`

**Checkpoint**: 5-phase workflow text is in-context after plan mode entry. Agent can follow the workflow to completion.

---

## Phase 7: User Story 3 — Interview Mode Variant (Priority: P2)

**Goal**: When interview mode is enabled, the agent uses read-only tools directly and iterates with the user instead of spawning subagents.

**Independent Test**: Enable interview mode → enter plan mode → agent uses read-only tools directly → asks user questions → writes plan file → exits via same approval.

### Implementation

- [ ] T031 [US3] Verify that the interview mode text (created in T014) correctly instructs the agent to use read-only tools directly, lists the allowed tools, and describes the iterative dialogue workflow. — file: `packages/core/src/bundled/prompts/misc/plan-interview.md`
- [ ] T032 [US3] Verify that `PlanEnterTool` correctly selects interview mode text when `params.interviewMode === true` (implemented in T024). — file: `packages/core/src/tool/plan.ts`

**Checkpoint**: Interview mode produces a different workflow instruction set. No subagent spawning in interview mode.

---

## Phase 8: User Story 4 — Plan Reminders During Build Phase (Priority: P2)

**Goal**: After plan exit and approval, periodic reminders keep the agent on-plan during build mode.

**Independent Test**: Complete plan mode cycle → approve plan → send build-phase messages → verify sparse reminders every turn and full plan refresh every 5 turns.

### Implementation

- [ ] T033 [US4] Invert the guard condition in `injectPlanAttachment()`: change `if (!planModeState.active)` early return to `if (planModeState.active || !planModeState.planText)` early return. This makes reminders fire during build phase (when plan mode is inactive but a plan has been approved), not during plan phase. — file: `packages/core/src/session/engine/plan-reminder.ts` (line 47)
- [ ] T034 [US4] Update the JSDoc comment for `injectPlanAttachment()` to reflect the new contract: "Inject a plan reminder attachment into the last user message when a plan has been approved and the agent is in build mode." — file: `packages/core/src/session/engine/plan-reminder.ts` (lines 22-35)
- [ ] T035 [US4] Verify that `PlanExitTool.execute()` sets `planText` on the state ref when the user approves the plan (this is the signal that activates build-phase reminders). Confirm the existing code at `plan.ts:91` already does `planText: params.plan`. — file: `packages/core/src/tool/plan.ts`

**Checkpoint**: Reminders fire during build phase, not plan phase. Sparse every turn, full every 5 turns.

---

## Phase 9: Test Updates (Test Resolution Protocol §VII)

**Purpose**: Update existing test suite for intentional architectural changes. All failures are expected — the tests are outdated, not the code.

- [ ] T036 [P] Update `enter-plan-tool.test.ts`: remove assertions for `inject` in return value, add assertions for `Question.ask()` approval flow, add assertion for workflow text in output, add assertion for `interviewMode` parameter behavior. — file: `packages/core/test/plan-mode/enter-plan-tool.test.ts`
- [ ] T037 [P] Update `exit-plan-tool.test.ts`: remove assertions for `inject` in return value, verify that `output` field contains plan text (plan-in-context), verify `Question.ask()` approval still works. — file: `packages/core/test/plan-mode/exit-plan-tool.test.ts`
- [ ] T038 [P] Update `plan-reminder.test.ts` (both copies): change test cases to verify reminders fire when `active === false && planText !== undefined`, not when `active === true`. Update the "no-op when inactive" test to "no-op when active or no plan text". — file: `packages/core/test/plan-mode/plan-reminder.test.ts` and `packages/core/test/session/engine/plan-reminder.test.ts`
- [ ] T039 Verify `plan-mode-state.test.ts` still passes — no changes expected to `PlanModeStateRef` itself, but run to confirm. — file: `packages/core/test/plan-mode/plan-mode-state.test.ts`
- [ ] T040 Run full scoped test suite: `bun test test/plan-mode/` — all tests must pass.
- [ ] T041 Run `bun typecheck` — full type check must pass with zero errors.
- [ ] T042 Run `bun lint:fix` — formatting must be clean.

**Checkpoint**: All scoped tests pass. Typecheck clean. Lint clean.

---

## Phase 10: Legacy Verification (C-007, SC-009)

**Purpose**: Post-implementation codebase search confirming zero residual legacy artifacts. Any match is a blocking defect.

- [ ] T043 Search for `agent: "plan"` in inject messages across `packages/core/src/` — must return zero results.
- [ ] T044 [P] Search for `agent: "build"` in inject messages across `packages/core/src/` — must return zero results.
- [ ] T045 [P] Search for `plan-explore` references across `packages/core/src/` — must return zero results.
- [ ] T046 [P] Search for any code path that swaps the root agent identity during plan/build transitions across `packages/core/src/` — must return zero results.
- [ ] T047 Verify that `plan-explore.md` file no longer exists on disk at `packages/core/src/bundled/agents/plan-explore.md`.
- [ ] T048 Verify that `plan.md` has `mode: subagent` (not `mode: primary`) at `packages/core/src/bundled/agents/plan.md`.

**Checkpoint**: SC-009 verified. Zero legacy artifacts remain. Feature is complete.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (MVP Audit)**: No dependencies — must start first (C-006 gate)
- **Phase 2 (Legacy Purge)**: Depends on Phase 1 — BLOCKS all new behavior
- **Phase 3 (Prompt Porting)**: Depends on Phase 2 — ported content goes into vacated/new files
- **Phase 4 (US1 — Entry)**: Depends on Phase 2 + Phase 3 (needs purged plan.ts + ported descriptions)
- **Phase 5 (US5 — Subagents)**: Depends on Phase 3 (needs rewritten plan.md subagent)
- **Phase 6 (US2 — 5-Phase)**: Depends on Phase 3 + Phase 5 (needs workflow text + subagent definitions)
- **Phase 7 (US3 — Interview)**: Depends on Phase 3 + Phase 4 (needs interview text + interviewMode param)
- **Phase 8 (US4 — Reminders)**: Depends on Phase 2 (needs purged plan.ts with clean exit tool)
- **Phase 9 (Tests)**: Depends on Phases 4–8 (all behavioral changes complete)
- **Phase 10 (Verification)**: Depends on Phase 9 (all tests passing)

### User Story Dependencies

- **US1 (Entry + Approval)**: Foundational — most tasks depend on the purged plan.ts
- **US5 (Subagent Parity)**: Foundational — US2 depends on correct subagent definitions
- **US2 (5-Phase Workflow)**: Depends on US1 + US5
- **US3 (Interview Mode)**: Depends on US1 (shares plan.ts changes)
- **US4 (Reminders)**: Independent — can be done in parallel with US2/US3/US5 after purge

### Within Each Phase

- Tasks marked [P] are parallelizable within the phase
- Tasks without [P] must be done sequentially within the phase
- Typecheck/lint tasks (T012, T021, T041, T042) are phase-end gates

### Parallel Opportunities

Within Phase 1 (MVP Audit):
```
T002, T003, T004, T005, T006, T007 — all independent MVP file reads
```

Within Phase 3 (Prompt Porting):
```
T013, T014, T015, T016, T017, T018 — all independent file creates/rewrites
```

After Phase 2 completion (cross-phase):
```
US4 (Reminders, Phase 8) can run in parallel with Phase 3/4/5/6/7
```

Within Phase 9 (Tests):
```
T036, T037, T038 — all different test files
```

---

## Implementation Strategy

### MVP First (US1 + US5 Only)

1. Complete Phase 1: MVP Source Audit
2. Complete Phase 2: Legacy Purge
3. Complete Phase 3: Prompt Porting
4. Complete Phase 4: US1 (Entry + Approval)
5. Complete Phase 5: US5 (Subagent Parity)
6. **STOP and VALIDATE**: Send a complex task, verify approval prompt, verify no amnesia
7. Run scoped tests → fix → deploy

### Full Delivery

1. MVP (above) + Phase 6 (US2) + Phase 7 (US3) + Phase 8 (US4)
2. Phase 9: Update all tests
3. Phase 10: Legacy verification
4. End-to-end E2E validation per RFC Section 8

---

## Notes

- [P] tasks = different files, no dependencies within the phase
- [Story] label maps task to specific user story for traceability
- Phase 1 is a READ-ONLY audit — zero code changes
- Phase 2 is DESTRUCTIVE — delete/remove only, no new code
- Phases 3-8 are CONSTRUCTIVE — new code built on purged foundation
- The MVP source files (Phase 1) are the ONLY source of truth for prompt content (C-004, C-006)
- Commit after each phase completes, not after individual tasks
