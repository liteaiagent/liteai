# Tasks: Fork Subagent + Agent Durability

**Input**: Design documents from `/specs/003-fork-subagent-durability/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/

> **MVP Grounding**: All implementation tasks MUST be grounded on the MVP reference implementation at `C:\Users\aghassan\Documents\workspace\liteai_cli_mvp\src`. Each task references the relevant MVP source for parity validation. No behavioral degradation from MVP is acceptable.

**Tests**: Test tasks are included — plan.md explicitly lists test files in the project structure.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

All paths are relative to `packages/core/`:
- Source: `src/agent/`, `src/session/`, `src/tool/`, `src/flag/`, `src/worktree/`
- Tests: `test/agent/`, `test/session/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Define foundational types and feature gate configuration needed by all user stories.

- [x] T001 Add FORK_SUBAGENT feature gate — environment variable `LITEAI_FORK_SUBAGENT`, config flag check, coordinator/non-interactive session guard — in `packages/core/src/flag/` (MVP ref: `forkSubagent.ts:32-39`, Research: R-002)
- [x] T002 Define `CacheSafeParams` interface and session-scoped storage functions (`saveCacheSafeParams`, `getLastCacheSafeParams`) with per-session isolation via Session module in `packages/core/src/agent/fork.ts` (MVP ref: `forkedAgent.ts:57-81`, Research: R-001, Contract: cache-safe-params.md)
- [x] T003 Define `ForkAgentConfig` constant (`agentType: 'fork'`, `tools: '*'`, `maxTurns: 200`, `model: 'inherit'`, `permissionMode: 'bubble'`, `wallClockTimeout: 1_800_000`, `background: true`) in `packages/core/src/agent/fork.ts` (MVP ref: `forkSubagent.ts:60-71`, Data model: entity 1)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [x] T004 Extend `SubagentContext` with fork-specific fields — `isFork: boolean`, `parentSystemPrompt: string | undefined`, `cacheSafeParams: CacheSafeParams | undefined`, cloned `contentReplacementState`, independent abort controller linked to parent, no-op mutation callbacks, fresh query tracking chain with incremented depth — in `packages/core/src/agent/context.ts` (FR-024, FR-025)
- [x] T005 [P] Implement orphaned message filtering pipeline — `filterUnresolvedToolUses()` (remove assistant messages with tool_use blocks lacking matching tool_result), `filterOrphanedThinkingOnlyMessages()` (remove thinking-only assistant messages), `filterWhitespaceOnlyAssistantMessages()` (remove whitespace-only content) — as composable functions in `packages/core/src/agent/filter.ts` (MVP ref: `resumeAgent.ts:70-74`, Research: R-004, FR-014)
- [x] T006 [P] Add transcript read and reconstruct capabilities — `SidechainTranscript.read()` for loading persisted JSONL transcripts, content replacement extraction from transcript records for optimization state reconstruction — in `packages/core/src/session/transcript.ts` (FR-010, FR-011, Research: R-005)
- [x] T007 [P] Add worktree mtime refresh utility function (`refreshWorktreeMtime`) — `utimes()` to current timestamp, stat validation check — in `packages/core/src/worktree/index.ts` (MVP ref: `resumeAgent.ts:93-97`, Research: R-006, FR-012)

**Checkpoint**: Foundation ready — user story implementation can now begin.

---

## Phase 3: User Story 1 — Cache-Optimized Sub-Agent Spawning via Fork (Priority: P1) 🎯 MVP

**Goal**: Spawn fork children that share the parent's prompt cache, reducing per-spawn token cost by ≥80%. Force all agent spawns into async mode when fork is enabled.

**Independent Test**: Spawn a fork child from a parent with known conversation context. Verify the child's upstream request prefix is cache-compatible with the parent's. Verify prompt cache hit rate ≥80% reduction in prompt tokens.

### Implementation for User Story 1

- [x] T008 [US1] Implement `isForkSubagentEnabled(sessionContext)` gate function — check config flag, exclude coordinator mode and non-interactive sessions — and export `FORK_BOILERPLATE_TAG` sentinel constant in `packages/core/src/agent/fork.ts` (MVP ref: `forkSubagent.ts:32-39`, FR-004, FR-005, Research: R-002)
- [x] T009 [US1] Implement `isInForkChild(messages)` recursion guard — scan transcript user messages for `<fork_boilerplate>` sentinel tag, return boolean — in `packages/core/src/agent/fork.ts` (MVP ref: `forkSubagent.ts:78-89`, FR-003, Research: R-003)
- [x] T010 [US1] Implement `buildChildMessage(directive)` — construct user message containing `<fork_boilerplate>` tag with 10 behavioral rules, structured output format (Scope, Result, Key files, Files changed, Issues), and per-child directive suffix — in `packages/core/src/agent/fork.ts` (MVP ref: `forkSubagent.ts:171-198`, FR-008, Data model: entity 7)
- [x] T011 [US1] Implement `buildForkedMessages(directive, assistantMessage)` — clone parent's last assistant message, generate identical `toolResultPlaceholders` (`"Fork started — processing in background"`), append child directive via `buildChildMessage()`, return cache-compatible message array — in `packages/core/src/agent/fork.ts` (MVP ref: `forkSubagent.ts:107-169`, FR-002, FR-007, FR-009, Contract: fork-spawn.md)
- [x] T012 [US1] Wire fork spawn path into agent spawning — detect fork trigger (no `subagent_type` + gate enabled), force ALL spawns to async mode when fork active (FR-005), create SubagentContext with parent's rendered system prompt (no recomputation), parent's exact tool pool, and permission mode composition (elevated parent overrides bubble) — in `packages/core/src/agent/runner.ts` (MVP ref: `AgentTool.ts` fork path, FR-001, FR-005, FR-007, FR-009, Research: R-009, R-010)
- [x] T013 [US1] Extend `runAsyncAgentLifecycle` to accept and thread `CacheSafeParams` through fork child spawn — pass params to forked query loop, ensure fork child API requests use parent's system prompt, tool config, and context messages — in `packages/core/src/agent/lifecycle.ts` (FR-023, Contract: cache-safe-params.md)
- [x] T014 [P] [US1] Create unit tests for fork spawn — gate function (enabled/disabled/coordinator/non-interactive), recursion guard (detect/miss), buildForkedMessages cache compatibility (identical prefixes across siblings, placeholder text equality), buildChildMessage contract completeness (all 10 rules, boilerplate tag, output format) — in `packages/core/test/agent/fork.test.ts` (Validates: SC-001, SC-003, SC-005, SC-010)

**Checkpoint**: Fork spawning is functional. A parent agent can spawn fork children that share its prompt cache. All agent spawns run in async mode. Fork recursion is blocked.

---

## Phase 4: User Story 2 — Agent Resume from Persisted Transcripts (Priority: P2)

**Goal**: Resume interrupted background agents from their persisted sidechain transcripts with full prior context, cleaned-up message history, and cache stability.

**Independent Test**: Run a background agent, persist its transcript, simulate interruption, invoke resume, verify agent continues from last valid state with no re-execution.

**Dependency**: Core resume flow (T015–T019) can start after Foundational. Fork-child system prompt re-threading (T018) depends on US1's `fork.ts` being available.

### Implementation for User Story 2

- [x] T015 [US2] Implement `resumeAgentBackground(params)` orchestrator — load transcript + metadata from disk, apply 3-pass orphan filter pipeline (from `filter.ts`), assemble `AgentResumeState` — in `packages/core/src/agent/resume.ts` (MVP ref: `resumeAgent.ts:63-97`, FR-010, Contract: agent-resume.md, Data model: entity 4)
- [x] T016 [US2] Implement content optimization state reconstruction — `reconstructContentOptimizationState()` scanning resumed messages for persisted content references, gap-filling from parent's live optimization state for inherited entries — in `packages/core/src/agent/resume.ts` (MVP ref: `toolResultStorage.ts:reconstructForSubagentResume()`, FR-011, Research: R-005, SC-012)
- [x] T017 [US2] Implement worktree validation and mtime refresh in resume flow — stat check for worktree existence, `refreshWorktreeMtime()` BEFORE agent begins execution (prevents GC race), fallback to parent cwd with diagnostic log if worktree GC'd — in `packages/core/src/agent/resume.ts` (MVP ref: `resumeAgent.ts:82-97`, FR-012, Research: R-006)
- [x] T018 [US2] Implement three-tier system prompt re-threading for fork child resume — Tier 1: parent's live rendered prompt, Tier 2: rebuild from session config, Tier 3: throw explicit error (fail-fast) — in `packages/core/src/agent/resume.ts` (MVP ref: `resumeAgent.ts:116-148`, FR-013, Research: R-008)
- [x] T019 [US2] Wire resume into async agent lifecycle — set `invocationKind: 'resume'` on agent context (FR-017), skip permission re-gating (FR-018), preserve agent name registry entry, handle concurrent resume attempts (dedup guard) — in `packages/core/src/agent/resume.ts` (Contract: agent-resume.md, SC-004, SC-006)
- [x] T020 [P] [US2] Create unit tests for agent resume — transcript loading + orphan filtering (all 3 filter types), content optimization state reconstruction (cache-identical decisions), worktree validation (exists/GC'd fallback), system prompt re-threading (3 tiers), invocationKind marking — in `packages/core/test/agent/resume.test.ts` (Validates: SC-002, SC-004, SC-006, SC-012)

**Checkpoint**: Interrupted agents can be resumed from sidechain transcripts with full context, cleaned messages, and cache stability.

---

## Phase 5: User Story 3 — Fork Child Behavioral Contract (Priority: P2)

**Goal**: Ensure fork children receive and follow a strict behavioral contract that constrains execution to be focused, efficient, and non-conversational with structured output.

**Independent Test**: Spawn a fork child with a directive, verify the contract includes all 10 rules, boilerplate tag for recursion detection, and structured output format matching MVP.

**Note**: The behavioral contract implementation is in `buildChildMessage()` (T010, US1). This phase validates MVP parity of the contract content and ensures the contract is complete.

### Implementation for User Story 3

- [x] T021 [US3] Validate and finalize fork behavioral contract content — verify all 10 non-negotiable rules match MVP parity (`forkSubagent.ts:171-198`), verify `<fork_boilerplate>` tag wrapping, verify structured output format (Scope, Result, Key files, Files changed, Issues), verify directive prefix placement, verify report length constraint (500 words) — in `packages/core/src/agent/fork.ts` (FR-008, Data model: entity 7, SC-010)

**Checkpoint**: Fork children produce predictable, machine-parseable structured reports.

---

## Phase 6: User Story 4 — Fork-Aware Worktree Isolation (Priority: P3)

**Goal**: Inject path translation guidance into fork children operating in isolated worktrees so they correctly map parent-referenced file paths to worktree-local equivalents.

**Independent Test**: Spawn a fork child in a worktree, verify the path translation notice maps parent CWD to worktree path, verify isolation semantics messaging.

### Implementation for User Story 4

- [x] T022 [US4] Implement `buildWorktreeNotice(parentCwd, worktreePath)` — generate path translation notice mapping parent workspace paths to child's worktree-local paths, include re-read guidance and isolation semantics ("changes stay in worktree, will not affect parent's files") — in `packages/core/src/agent/fork.ts` (FR-006, Data model: entity 9, SC-007)
- [x] T023 [US4] Integrate worktree notice injection into fork spawn path — when worktree isolation is active, call `buildWorktreeNotice()` and set `ForkedMessageSet.worktreeNotice`, include in child's context messages — in `packages/core/src/agent/runner.ts` (FR-006, Contract: fork-spawn.md postcondition 1)

**Checkpoint**: Fork children in worktrees correctly resolve parent-referenced file paths to worktree-local equivalents.

---

## Phase 7: User Story 5 — Teammate Re-engagement via Messaging (Priority: P3)

**Goal**: Allow users to re-engage with previously completed or interrupted background agents via 3-way message routing (running→queue, stopped→auto-resume, evicted→resume from disk).

**Independent Test**: Complete a background agent run, send a follow-up message, verify the agent responds with full awareness of prior work.

**Dependency**: Depends on US2 (T015 `resumeAgentBackground`) for the stopped/evicted routing paths.

### Implementation for User Story 5

- [x] T024 [US5] Implement `routeMessage(params)` with 3-way routing logic — resolve recipient via AgentNameRegistry lookup then raw ID validation, route based on agent lifecycle state: running→`queuePendingMessage()`, stopped→`resumeAgentBackground()`, evicted→resume from disk transcript — in `packages/core/src/tool/send_message.ts` (MVP ref: `SendMessageTool.ts:800-873`, FR-015, FR-016, Contract: messaging.md)
- [x] T025 [US5] Implement `queuePendingMessage(agentId, message)` — add message to agent's pending message queue on task state, consumed by query loop at next tool round — in `packages/core/src/tool/send_message.ts` (Contract: messaging.md queue delivery mechanism)
- [x] T026 [US5] Wire SendMessage tool definition — define tool schema (recipientNameOrId, message params), register in tool pool, integrate with existing tool resolution — in `packages/core/src/tool/send_message.ts` (FR-015, SC-011)

**Checkpoint**: Users can re-engage with any background agent by name or ID, with correct routing for all three lifecycle states.

---

## Phase 8: User Story 6 — Async Agent Lifecycle Observability (Priority: P4)

**Goal**: Provide real-time progress tracking, structured notifications, partial result preservation, and optional summarization for all async background agents.

**Independent Test**: Spawn a background agent, verify progress updates appear within 2 seconds of each tool round, verify completion/kill notifications include expected data.

**Dependency**: Depends on US1 (T013) for `lifecycle.ts` CacheSafeParams integration being in place.

### Implementation for User Story 6

- [x] T027 [P] [US6] Implement real-time progress tracking — report tool use counts and activity descriptions as each tool round completes, emit progress updates within 2 seconds — in `packages/core/src/agent/lifecycle.ts` (FR-019, SC-008, MVP ref: `agentToolUtils.ts` progress tracking)
- [x] T028 [US6] Implement structured completion/failure/kill notification generation — include agent's final message, usage metrics (tokens consumed, tool uses, duration), worktree information, structured error for failures — in `packages/core/src/agent/lifecycle.ts` (FR-022, SC-009, MVP ref: `agentToolUtils.ts` notification generation)
- [x] T029 [US6] Implement partial result extraction from killed agent's last coherent assistant message and optional agent summarization trigger (enabled when fork active, coordinator active, or explicitly requested) in `packages/core/src/agent/lifecycle.ts` (FR-020, FR-021, SC-009)

**Checkpoint**: All background agents provide real-time observability with structured lifecycle notifications.

---

## Phase 9: User Story 7 — Post-Turn Fork Cache Sharing (Priority: P4)

**Goal**: After the main agent loop completes a turn, preserve cache-critical parameters so post-turn system forks (summarization, memory extraction) share the main loop's prompt cache.

**Independent Test**: Complete a main loop turn, run a post-turn fork, verify it achieves a prompt cache hit from the main loop's context.

**Dependency**: Depends on US1 (T002 for `CacheSafeParams` type, T013 for lifecycle integration).

### Implementation for User Story 7

- [x] T030 [US7] Wire `saveCacheSafeParams` into main agent loop's post-turn hook — after each turn completes, capture system prompt, user/system context, tool config, and context messages into session-scoped slot, clear on session end — in `packages/core/src/agent/lifecycle.ts` / `loop.ts` (FR-023, Contract: cache-safe-params.md, SC-013, MVP ref: `forkedAgent.ts:73-77`)
- [x] T031 [US7] Implement ephemeral fork variant with `skipTranscript` support — when `skipTranscript: true`, bypass sidechain transcript recording for system-internal forks (summarization, speculation), reducing I/O overhead — in `packages/core/src/agent/fork.ts` / `runner.ts` (FR-026)

**Checkpoint**: Post-turn system forks achieve ≥90% prompt cache hit rate with main loop's context.

---

## Phase 10: Polish & Cross-Cutting Concerns

**Purpose**: Test updates, type validation, formatting, and end-to-end validation.

- [x] T032 [P] Update orphaned message filter tests — add test cases for all 3 filter functions (unresolved tool uses, thinking-only, whitespace-only), verify composable pipeline order — in `packages/core/test/agent/filter.test.ts` (Validates: SC-006)
- [x] T033 [P] Update transcript read/reconstruct tests — add test cases for JSONL loading, content replacement extraction, optimization state reconstruction — in `packages/core/test/session/transcript.test.ts` (Validates: SC-012)
- [x] T034 Update module barrel exports — ensure all new public APIs (`isForkSubagentEnabled`, `buildForkedMessages`, `resumeAgentBackground`, `routeMessage`, `CacheSafeParams`, etc.) are exported from their respective module indices in `packages/core/src/`
- [x] T035 Run `bun typecheck` and resolve all type errors across modified files
- [x] T036 Run `bun lint:fix` and validate formatting compliance across modified files
- [x] T037 Run quickstart.md validation scenarios — execute all 5 quickstart flows (fork spawn, agent resume, teammate re-engagement, post-turn cache sharing, behavioral contract) and verify behavioral parity with MVP

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion — BLOCKS all user stories
- **User Story 1 (Phase 3)**: Depends on Foundational (Phase 2)
- **User Story 2 (Phase 4)**: Depends on Foundational (Phase 2); T018 (fork resume re-threading) soft-depends on US1's `fork.ts`
- **User Story 3 (Phase 5)**: Depends on US1 T010 (`buildChildMessage`) — validates contract content
- **User Story 4 (Phase 6)**: Depends on US1 T012 (fork spawn path in `runner.ts`)
- **User Story 5 (Phase 7)**: Depends on US2 T015 (`resumeAgentBackground`) for stopped/evicted routing
- **User Story 6 (Phase 8)**: Depends on US1 T013 (`lifecycle.ts` CacheSafeParams integration)
- **User Story 7 (Phase 9)**: Depends on US1 T002 (`CacheSafeParams` type) and T013 (lifecycle integration)
- **Polish (Phase 10)**: Depends on all user stories being complete

### User Story Dependencies

```
                    ┌─── US3 (validates US1's contract)
                    │
Setup → Foundation ─┤─── US1 (P1) ──┬──→ US4 (needs fork spawn path)
                    │               ├──→ US6 (needs lifecycle.ts)
                    │               └──→ US7 (needs CacheSafeParams)
                    │
                    └─── US2 (P2) ──────→ US5 (needs resumeAgentBackground)
```

### Within Each User Story

- Type definitions before functions
- Functions before wiring (integration into runner/lifecycle)
- Core implementation before tests
- Validate parity with MVP reference at each step

### Parallel Opportunities

- **Phase 2**: T005 (filter.ts), T006 (transcript.ts), T007 (worktree/index.ts) — all different files, no dependencies
- **Phase 3**: T014 (fork.test.ts) can run once T008–T011 are complete, parallel with T012–T013
- **Phase 4**: T020 (resume.test.ts) can run once T015–T019 are complete
- **Phase 8**: T027 (progress tracking) can start before T028–T029 since it's a separate concern in lifecycle.ts
- **Phase 10**: T032 (filter.test.ts) and T033 (transcript.test.ts) are independent files, can run in parallel
- **US1 + US2**: Can start in parallel after Foundational — they target different files (`fork.ts` vs `resume.ts`) except for the shared `runner.ts` and `lifecycle.ts` integration points

---

## Parallel Example: User Story 1

```bash
# Phase 2 foundational tasks run in parallel (different files):
Task T005: "Implement orphaned message filtering pipeline in packages/core/src/agent/filter.ts"
Task T006: "Add transcript read/reconstruct capabilities in packages/core/src/session/transcript.ts"
Task T007: "Add worktree mtime refresh utility in packages/core/src/worktree/index.ts"

# After US1 core implementation (T008-T011), tests run parallel with integration:
Task T014: "Create unit tests for fork spawn in packages/core/test/agent/fork.test.ts"
# (T012 and T013 run sequentially — they modify runner.ts and lifecycle.ts)
```

## Parallel Example: User Story 1 + User Story 2

```bash
# After Foundational, US1 and US2 can start in parallel on separate files:
# Developer A (fork.ts):
Task T008-T011: Fork spawn implementation in packages/core/src/agent/fork.ts
# Developer B (resume.ts):
Task T015-T017: Resume implementation in packages/core/src/agent/resume.ts

# Integration tasks (runner.ts, lifecycle.ts) must serialize after both are ready
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001–T003)
2. Complete Phase 2: Foundational (T004–T007) — **CRITICAL: blocks all stories**
3. Complete Phase 3: User Story 1 (T008–T014)
4. **STOP and VALIDATE**: Fork spawning works, cache hits confirmed, recursion blocked
5. This alone delivers ≥80% token cost reduction for multi-agent workflows

### Incremental Delivery

1. Setup + Foundational → Foundation ready
2. Add US1 (Fork Spawn) → Validate cache sharing → **MVP!**
3. Add US2 (Resume) → Validate transcript resume → Durability unlocked
4. Add US3 (Contract) → Validate behavioral parity → Predictable output
5. Add US4 (Worktree) → Validate path translation → Full isolation
6. Add US5 (Messaging) → Validate re-engagement → UX enhancement
7. Add US6 (Observability) → Validate notifications → Monitoring
8. Add US7 (Post-Turn Cache) → Validate cache sharing → Cost optimization
9. Polish → Typecheck, lint, quickstart validation → Release ready

### Suggested MVP Scope

**US1 (Cache-Optimized Fork Spawning)** is the recommended MVP boundary:
- Delivers the primary cost/performance optimization (≥80% token reduction)
- Self-contained: fork spawn, recursion guard, behavioral contract, async lifecycle
- 14 tasks (T001–T014) from Setup through US1 completion
- All subsequent stories are incremental enhancements

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- **MVP parity rule**: Every task must reference the specific MVP source and verify behavioral output matches MVP for equivalent inputs
- Avoid: vague tasks, same file conflicts, cross-story dependencies that break independence
