# Tasks: Async Subagent Dispatch

**Input**: Design documents from `specs/015-subagent-async-dispatch/`

**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/ ✅, quickstart.md ✅

**Reference Architecture**: [D:\claude-code\src\tools\AgentTool](file:///d:/claude-code/src/tools/AgentTool) — Claude Code's dual-mode agent dispatch, used as the reference pattern throughout.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3, US4)
- Include exact file paths in descriptions

## Path Conventions

Monorepo: `packages/core/src/` is the primary target package.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create the `task/` module directory and foundational types.

- [x] T001 Create `TaskID` branded type, `TaskStatus` union, `TaskProgress` interface, and `AgentTaskState`/`AgentTaskInfo` types in `packages/core/src/task/task.ts` — model `TaskID` after existing `SessionID` pattern in [packages/core/src/session/schema.ts](file:///d:/liteai/packages/core/src/session/schema.ts), model `TaskStatus` state machine after [D:\claude-code\src\Task.ts](file:///d:/claude-code/src/Task.ts#L6-L76) including `isTerminalStatus()` guard
- [x] T002 Create `AgentTaskRegistry` in `packages/core/src/task/registry.ts` — instance-scoped in-memory `Map<TaskID, AgentTaskState>` with `register()`, `start()`, `complete()`, `fail()`, `kill()`, `get()`, `getBySession()`, `list()`, `getUnnotifiedCompletedTasks()`, `markNotified()`, `runningCount()`, `killAll()` — model after [D:\claude-code\src\tasks\LocalAgentTask\LocalAgentTask.tsx](file:///d:/claude-code/src/tasks/LocalAgentTask/LocalAgentTask.tsx#L116-L148) state management, but use `Instance.state()` for scoping (matching existing [packages/core/src/session/engine/loop.ts](file:///d:/liteai/packages/core/src/session/engine/loop.ts#L62-L77) pattern). Enforce configurable `maxConcurrentTasks` (default 10) in `register()` — throw `TaskLimitExceededError` when exceeded
- [x] T003 Create barrel export `packages/core/src/task/index.ts` re-exporting all types and `AgentTaskRegistry`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Wire `AgentTaskRegistry` into the session engine and extend notification infrastructure. MUST complete before any user story work.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T004 Extend `AppState.tasks` type in [packages/core/src/agent/context.ts](file:///d:/liteai/packages/core/src/agent/context.ts#L22-L36) — add `AgentTaskState` (imported from `task/task.ts`) to the `AppState.tasks` union alongside existing `BackgroundTaskState | TeammateTaskState`. The `type: "agent_task"` discriminator enables type-safe differentiation.
- [x] T005 Extend `CorrectionInjector` in [packages/core/src/session/engine/correction-injector.ts](file:///d:/liteai/packages/core/src/session/engine/correction-injector.ts) — add `injectAgentTaskNotifications()` method that drains `AgentTaskRegistry.getUnnotifiedCompletedTasks(parentSessionId)` and formats agent-specific `<task-notification>` XML (see contracts/task-tool-schemas.md for format). Model notification content after [D:\claude-code\src\tasks\LocalAgentTask\LocalAgentTask.tsx](file:///d:/claude-code/src/tasks/LocalAgentTask/LocalAgentTask.tsx#L197-L262) `enqueueAgentNotification()`. Follow same persist-then-markNotified ordering as existing `injectNotifications()`.
- [x] T006 Wire `AgentTaskRegistry` into `runSessionInner()` in [packages/core/src/session/engine/loop.ts](file:///d:/liteai/packages/core/src/session/engine/loop.ts#L489-L582) — create an instance-scoped `AgentTaskRegistry` (or retrieve from `Instance.state()`), pass it to `CorrectionInjector`, and add an `injectAgentTaskNotifications()` call at the existing turn-boundary injection site ([L740-L754](file:///d:/liteai/packages/core/src/session/engine/loop.ts#L740-L754)) right after the existing `injectNotifications()` for command tasks. Pass the parent `sessionID` so the registry can filter notifications to the correct parent.
- [x] T007 Create `runAsyncAgentLifecycle()` in `packages/core/src/task/lifecycle.ts` — the detached-promise background agent driver. This function: (1) transitions task status to "running", (2) calls `SessionPrompt.runSubagent()` with an independent `AbortController` (NOT linked to parent — see research.md R-003), (3) on success: transitions to "completed" with result text, (4) on error: transitions to "failed" with error message, (5) on abort: transitions to "killed" with partial result. Model after [D:\claude-code\src\tools\AgentTool\agentToolUtils.ts](file:///d:/claude-code/src/tools/AgentTool/agentToolUtils.ts#L508-L686) `runAsyncAgentLifecycle()`. CRITICAL: status transition MUST happen BEFORE the notification drain cycle (research.md R-007, modeled after [D:\claude-code\src\tools\AgentTool\agentToolUtils.ts](file:///d:/claude-code/src/tools/AgentTool/agentToolUtils.ts#L599-L603)).

**Checkpoint**: Task infrastructure is ready — all types, registry, lifecycle driver, and notification pipeline are in place.

---

## Phase 3: User Story 1 — Launch Subagent in Background (Priority: P1) 🎯 MVP

**Goal**: The LLM can dispatch a subagent with `run_in_background: true` and receive an immediate acknowledgment while the subagent runs independently. Results arrive as `<task-notification>` at turn boundaries.

**Independent Test**: Invoke `AgentTool` with `run_in_background: true`, verify immediate return with task ID, verify subagent runs to completion in background, verify `<task-notification>` is injected at next turn boundary.

### Implementation for User Story 1

- [x] T008 [US1] Refactor `AgentTool` in [packages/core/src/tool/agent.ts](file:///d:/liteai/packages/core/src/tool/agent.ts) — add `run_in_background` parameter to the zod schema (see contracts/task-tool-schemas.md). Compute `shouldRunAsync` decision gate: `params.run_in_background === true || isCoordinatorMode(parentSession.sessionMode)` — modeled after [D:\claude-code\src\tools\AgentTool\AgentTool.tsx](file:///d:/claude-code/src/tools/AgentTool/AgentTool.tsx#L567) `shouldRunAsync` decision gate.
- [x] T009 [US1] Implement async dispatch path in `AgentTool.execute()` in [packages/core/src/tool/agent.ts](file:///d:/liteai/packages/core/src/tool/agent.ts) — when `shouldRunAsync` is true: (1) create Session as today, (2) register task in `AgentTaskRegistry`, (3) fire-and-forget `void runAsyncAgentLifecycle(...)` (detached promise — parent doesn't await), (4) return immediate `{ status: 'async_launched', taskId, sessionId }` result. Model after [D:\claude-code\src\tools\AgentTool\AgentTool.tsx](file:///d:/claude-code/src/tools/AgentTool/AgentTool.tsx#L686-L764) async path. The existing sync path ([L136-L145](file:///d:/liteai/packages/core/src/tool/agent.ts#L136-L145)) remains unchanged as the default.
- [x] T010 [US1] Skip abort linkage for async agents in [packages/core/src/tool/agent.ts](file:///d:/liteai/packages/core/src/tool/agent.ts#L129-L133) — the current `ctx.abort.addEventListener("abort", cancel)` pattern links parent abort to subagent cancel. For async dispatch, this linkage must be skipped; the subagent's `AbortController` is independent and owned by `AgentTaskRegistry`. Model after [D:\claude-code\src\tasks\LocalAgentTask\LocalAgentTask.tsx](file:///d:/claude-code/src/tasks/LocalAgentTask/LocalAgentTask.tsx#L486) independent abort.
- [x] T011 [US1] Update agent tool description in [packages/core/src/bundled/prompts/tools/agent.txt](file:///d:/liteai/packages/core/src/bundled/prompts/tools/agent.txt) — document `run_in_background` parameter behavior and `<task-notification>` delivery mechanism so the LLM understands async result arrival.
- [x] T012 [US1] Run `bun typecheck` and `bun lint:fix` against modified files in `packages/core` — fix any type errors or lint violations introduced by T008–T011.
- [x] T013 [US1] Run scoped tests: `bun test test/tool` (or equivalent scope covering agent tool tests) — verify sync path is unchanged and no regressions.

**Checkpoint**: At this point, the core async dispatch flow works end-to-end. A parent can fire-and-forget a subagent and receive the result as a notification.

---

## Phase 4: User Story 2 — Track Background Task State (Priority: P2)

**Goal**: The parent can query the status, progress, and result of any background task by ID or list all tasks.

**Independent Test**: Launch a background subagent, call `agent_get` with the returned task ID, verify status transitions from running → completed. Call `agent_list` and verify the task appears.

### Implementation for User Story 2

- [x] T014 [P] [US2] `AgentGetTool` already exists in `packages/core/src/tool/agent_get.ts` — verify it reads from `AgentTaskRegistry.get()` and returns formatted status/progress/result per contracts/task-tool-schemas.md. Add ownership check (parentSessionId validation) if missing.
- [x] T015 [P] [US2] `AgentListTool` already exists in `packages/core/src/tool/agent_list.ts` — verify it reads from `AgentTaskRegistry.list()` and returns formatted table per contracts/task-tool-schemas.md.
- [x] T016 [US2] Verify `AgentGetTool` and `AgentListTool` are registered in [packages/core/src/tool/registry.ts](file:///d:/liteai/packages/core/src/tool/registry.ts).
- [x] T017 [US2] Add `agent_get` and `agent_list` to `ASYNC_AGENT_ALLOWED_TOOLS` in [packages/core/src/agent/filter.ts](file:///d:/liteai/packages/core/src/agent/filter.ts#L6-L23) — so subagents can query their own background tasks.
- [x] T018 [US2] Run `bun typecheck` and `bun lint:fix` — fix any issues from T014–T017.

**Checkpoint**: Parent agent can now query individual tasks and list all tasks.

---

## Phase 5: User Story 3 — Stop a Running Background Task (Priority: P3)

**Goal**: The parent can cancel a running background subagent, triggering graceful termination and a killed notification.

**Independent Test**: Launch a background subagent, call `agent_stop` with the returned task ID, verify the subagent stops and status transitions to killed.

### Implementation for User Story 3

- [x] T019 [US3] Refactor `AgentStopTool` in [packages/core/src/tool/agent_stop.ts](file:///d:/liteai/packages/core/src/tool/agent_stop.ts) — update to use `AgentTaskRegistry.kill()` for the async dispatch path. The tool name remains `"agent_stop"` (the proposed `task_stop` rename was not implemented per 012-agent-taxonomy-rename alignment). Add ownership check (parentSessionId validation).
- [x] T020 [US3] Verify tool registration in [packages/core/src/tool/registry.ts](file:///d:/liteai/packages/core/src/tool/registry.ts#L8) — confirm `AgentStopTool` is registered.
- [x] T021 [US3] Update `COORDINATOR_ALLOWED_TOOLS` in [packages/core/src/coordinator/coordinator-mode.ts](file:///d:/liteai/packages/core/src/coordinator/coordinator-mode.ts#L75-L82) — add `"agent_get"` and `"agent_list"` alongside existing `"agent_stop"`.
- [x] T022 [US3] Update `INTERNAL_COORDINATOR_TOOLS` in [packages/core/src/coordinator/coordinator-mode.ts](file:///d:/liteai/packages/core/src/coordinator/coordinator-mode.ts#L101) — verify `"agent_stop"` is present.
- [x] T023 [US3] Verify all references to `"agent_stop"` across the codebase — confirm consistency in agent definitions, test fixtures, prompts, and filter lists.
- [x] T024 [US3] Run `bun typecheck` and `bun lint:fix` — fix any issues from T019–T023.
- [x] T025 [US3] Run scoped tests covering agent_stop — verify the tool works correctly with the new registry path.

**Checkpoint**: Full task lifecycle management is available — launch, track, and stop background agents.

---

## Phase 6: User Story 4 — Coordinator Dispatches All Subagents Concurrently (Priority: P4)

**Goal**: In coordinator mode, all agent dispatches are automatically forced to background. The coordinator can manage multiple concurrent workers.

**Independent Test**: Enable coordinator mode, dispatch multiple subagents, verify they all run as background tasks without the LLM explicitly setting `run_in_background`.

### Implementation for User Story 4

- [x] T026 [US4] Verify coordinator force-async in `AgentTool.execute()` in [packages/core/src/tool/agent.ts](file:///d:/liteai/packages/core/src/tool/agent.ts) — the `shouldRunAsync` gate from T008 already includes `isCoordinatorMode()`. Verify this works by tracing through the coordinator tool filter at [packages/core/src/coordinator/coordinator-mode.ts](file:///d:/liteai/packages/core/src/coordinator/coordinator-mode.ts#L87-L95) and confirming the agent tool is in the allowed set and the async path is taken.
- [x] T027 [US4] Update coordinator system prompt to document `<task-notification>` — model after [D:\claude-code\src\coordinator\coordinatorMode.ts](file:///d:/claude-code/src/coordinator/coordinatorMode.ts#L111-L369) which teaches the LLM: (1) worker results arrive as user-role `<task-notification>` messages, (2) XML schema example, (3) conversation flow with notification interleaving. Add this to the coordinator prompt builder in [packages/core/src/coordinator/index.ts](file:///d:/liteai/packages/core/src/coordinator) (or wherever `getCoordinatorSystemPrompt` is defined).
- [x] T028 [US4] Run `bun typecheck` and `bun lint:fix` — fix any issues from T026–T027.

**Checkpoint**: Coordinator mode fully leverages async dispatch for parallel multi-agent orchestration.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Verification, documentation, and edge case hardening.

- [x] T029 Run full `bun typecheck 2>&1 | Out-String` across `packages/core` — ensure zero new type errors across the entire package
- [x] T030 Run `bun lint:fix` across `packages/core` — ensure clean formatting
- [x] T031 Run scoped tests for all modified domains: `bun test test/tool test/session test/coordinator` (adjust scope to actual test paths)
- [x] T032 [P] Verify edge case: parent session cancelled while background subagents running — confirm background agents survive parent cancel (independent AbortController)
- [x] T033 [P] Verify edge case: task concurrency limit — confirm `TaskLimitExceededError` is thrown when limit exceeded and the LLM receives an informative error message
- [x] T034 [P] Verify edge case: `agent_stop` on already-completed task — confirm graceful "already terminal" response
- [x] T035 Update [roadmap/subagent-async-dispatch.md](file:///d:/liteai/roadmap/subagent-async-dispatch.md) status from "Proposed" to "Implemented" and document any deviations from the original proposal

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 — BLOCKS all user stories
- **User Story 1 (Phase 3)**: Depends on Phase 2 — core async dispatch
- **User Story 2 (Phase 4)**: Depends on Phase 2 — can run in parallel with US1
- **User Story 3 (Phase 5)**: Depends on Phase 2 — can run in parallel with US1/US2
- **User Story 4 (Phase 6)**: Depends on Phase 3 (needs async dispatch working) — coordinator integration
- **Polish (Phase 7)**: Depends on all user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Depends on Phase 2 only — no inter-story dependencies
- **User Story 2 (P2)**: Depends on Phase 2 only — `agent_get`/`agent_list` are independent tools reading from the shared registry
- **User Story 3 (P3)**: Depends on Phase 2 only — `agent_stop` reads/writes the same registry
- **User Story 4 (P4)**: Depends on US1 (needs the async dispatch path to exist) — coordinator forces all dispatches async

### Within Each User Story

- Type definitions before implementations
- Registry operations before tool wrappers
- Tool implementation before registration
- Registration before typecheck/lint verification

### Parallel Opportunities

- T001, T002, T003 in Phase 1 are sequential (T002 depends on T001 types)
- T004, T005, T006, T007 in Phase 2: T004 first, then T005+T007 parallel, T006 depends on T005+T007
- T014, T015 in Phase 4 are parallel [P] — different files, no dependencies
- T032, T033, T034 in Phase 7 are parallel [P] — independent edge case verification
- User Stories 1, 2, 3 can run in parallel after Phase 2 (US4 depends on US1)

---

## Parallel Example: User Story 2

```bash
# Launch both task query tools in parallel (different files):
Task T014: "Verify AgentGetTool in packages/core/src/tool/agent_get.ts"
Task T015: "Verify AgentListTool in packages/core/src/tool/agent_list.ts"

# Then register both:
Task T016: "Verify AgentGetTool and AgentListTool in registry.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup — task types and registry
2. Complete Phase 2: Foundational — notification pipeline, lifecycle driver
3. Complete Phase 3: User Story 1 — `AgentTool` dual-mode dispatch
4. **STOP and VALIDATE**: Test async dispatch end-to-end
5. Deploy/demo if ready — parent can fire-and-forget subagents

### Incremental Delivery

1. Setup + Foundational → Core infrastructure ready
2. Add US1 → Async dispatch works → **MVP!**
3. Add US2 → Task observability → `agent_get`, `agent_list`
4. Add US3 → Task control → `agent_stop` (uses `AgentTaskRegistry`)
5. Add US4 → Coordinator integration → All subagents auto-background
6. Each story adds capability without breaking previous stories

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Reference architecture at `D:\claude-code` should be consulted for implementation patterns
- `bun typecheck` exit code 1 on Windows is expected when errors exist — do not treat as crash
- Never run global `bun test` — always scope to modified domains
- Commit after each phase checkpoint
