# Feature Specification: Plan Mode

**Feature Branch**: `004-plan-mode`
**Created**: 2026-04-15
**Status**: Draft
**Input**: User description: "Refactor plan mode from synthetic message injection to an attachment-driven state machine with PlanModeState, sparse/full reminder cycles, ExitPlanModeTool with inline approval UI, and dedicated Plan/Explore sub-agents"

## Reference Implementation Mandate

All work on this feature — specification, planning, task decomposition, design decisions, code implementation, and code reuse — MUST be grounded on the MVP reference implementation at `C:\Users\aghassan\Documents\workspace\liteai_cli_mvp\src`. The target is **same or superior** quality and behavioral parity; no degradation from MVP is acceptable.

Key reference files:
- `tools/ExitPlanModeTool/ExitPlanModeTool.ts` — approval flow, plan-in-context injection, tool result construction
- `tools/EnterPlanModeTool/EnterPlanModeTool.ts` — build-to-plan transition, state mutation
- `tools/ExitPlanModeTool/prompt.ts` and `tools/EnterPlanModeTool/prompt.ts` — tool descriptions
- `state/AppStateStore.ts` — `planModeState` fields, state mutation patterns
- `state/onChangeAppState.ts` — reminder cycle logic (sparse every turn, full every 5 turns)
- `components/messages/PlanApprovalMessage.tsx` — UI approval rendering (reference only; liteai uses SSE events)
- `components/messages/UserPlanMessage.tsx` — plan attachment rendering
- `components/permissions/ExitPlanModePermissionRequest/ExitPlanModePermissionRequest.tsx` — approval gate component

The MVP was built as a **CLI application**; this project implements a **multi-tenant HTTP/SSE backend server**. All patterns from the MVP must be adapted to the backend architecture (session-scoped state per tenant and session, concurrent SSE clients, no process-global state) while preserving behavioral equivalence or improving upon it.

> **Propagation directive**: This mandate MUST be carried forward into `plan.md` and `tasks.md` when those artifacts are generated, ensuring every implementation task references the relevant MVP source for design grounding and parity validation.

## Clarifications

### Session 2026-04-15

- Q: What happens when the user disconnects during the approval wait — should the approval gate time out, and if so, what is the timeout behavior? → A: No timeout — approval gate blocks indefinitely (MVP parity). Disconnect-during-approval is handled by existing session reconnection infrastructure. No future timeout planned; analyze only if issue is reported in production.
- Q: Who is authorized to approve or reject a plan in a multi-tenant backend with multiple connected clients? → A: Any client connected to the session can approve/reject (session = trust boundary, MVP parity). No per-client authorization required.
- Q: What server-side observability (logging, metrics, tracing) is required for plan mode operations? → A: Use existing OpenTelemetry infrastructure — structured log events and span annotations for state transitions, approval requests, and outcomes. No new metrics/counters this phase.
- Q: Should ExitPlanModeTool detect and protect against overwriting an "unrelated file" at the plan path? → A: No — remove this edge case. The plan path is deterministic and session-scoped; any existing file is a prior plan and overwriting is correct behavior.
- Q: Where is PlanModeState persisted for session resume? → A: SQLite session metadata — persisted as a JSON column on the session row, consistent with existing session persistence. No separate sidecar file.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Attachment-Driven Plan Reminder Cycle (Priority: P1)

When the session is in plan mode, the model receives a plan reminder attachment on every turn so it stays oriented toward the plan without the reminder being baked into the system prompt. Every fifth turn the full plan text is included so the model can re-read it and re-anchor its behavior. This reminder cycle preserves prompt cache (the static system prompt prefix is never modified to include plan content) while keeping the model reliably on-track.

**Why this priority**: The reminder cycle is the foundational behavior that makes all other plan mode features coherent. Without it, the model loses track of the plan between turns. It is also the highest-value cache optimization: the current implementation bakes reminders into the message history via synthetic text parts, polluting the cache with session-specific content. The attachment model keeps the cacheable prefix clean.

**Independent Test**: Can be fully tested by activating plan mode and sending multiple user messages, verifying that each message carries a sparse attachment and every fifth message carries the full plan text attachment.

**Acceptance Scenarios**:

1. **Given** the session is in plan mode with a plan file on disk, **When** any user message is processed, **Then** the message receives a sparse attachment: `"Plan at <relative-path>, staying on track?"` as a non-synthetic user-message part.
2. **Given** the session is in plan mode and `turnsSincePlanReminder` reaches 5, **When** the next user message is processed, **Then** the message receives a full plan text attachment (the complete contents of the plan file) and the turn counter resets to 0.
3. **Given** the session is not in plan mode, **When** a user message is processed, **Then** no plan attachment is added to the message — the reminder cycle is completely inactive.
4. **Given** plan mode is active but the plan file does not yet exist on disk, **When** a user message is processed, **Then** a sparse attachment is still added indicating the plan has not been written yet (`"No plan file exists yet at <path>"`).

---

### User Story 2 — Plan-to-Build Transition with Inline Approval (Priority: P1)

When the planning agent believes the plan is ready, it invokes `ExitPlanModeTool`. The system writes the plan to disk, emits an SSE event requesting user approval, and blocks model execution until the user responds. If the user approves, the session transitions to build mode and the full plan text is injected directly into the `ExitPlanModeTool`'s tool result — giving the build-mode model immediate in-context access to the plan without a separate file read. If the user rejects, the session stays in plan mode and the model is notified to continue refining.

**Why this priority**: This is the critical exit gate from plan mode. Getting it right — especially the plan-in-context injection on approval — is what makes the plan→build handoff functionally superior to the current implementation, which uses a synthetic injected message that pollutes the cache.

**Independent Test**: Can be fully tested end-to-end by triggering `ExitPlanModeTool`, verifying the `plan.approval_requested` SSE event is emitted with the plan text and file path, sending an approve action, and verifying the tool result contains the full plan text and the session mode is now `build`.

**Acceptance Scenarios**:

1. **Given** the planning agent invokes `ExitPlanModeTool` with a plan, **When** the tool executes, **Then** it writes the plan to the session's plan file path before emitting the approval request.
2. **Given** `ExitPlanModeTool` has written the plan, **When** execution proceeds, **Then** a `plan.approval_requested` SSE event is emitted containing `{ planText, planFilePath }` and model execution is blocked until the user responds.
3. **Given** the user approves, **When** the approval is received, **Then** (a) `PlanModeState.active` becomes `false`, (b) `PlanModeState.turnsSincePlanReminder` resets to 0, (c) the tool result contains the full plan text with guidance to execute it, and (d) the session transitions back to the build agent.
4. **Given** the user rejects, **When** the rejection is received, **Then** (a) `PlanModeState.active` remains `true`, (b) the tool throws a `RejectedError`, and (c) the model receives a signal to continue refining the plan.
5. **Given** `ExitPlanModeTool` is invoked with no plan content (empty), **When** the tool executes, **Then** it returns an error indicating the plan must have content before it can be approved.

---

### User Story 3 — Build-to-Plan Transition (EnterPlanMode) (Priority: P2)

When the model determines that the current task requires planning before implementation — or the user explicitly requests plan mode — the model invokes `EnterPlanModeTool`. The session transitions to plan mode, a `plan.state_changed` SSE event is emitted, and the full current plan text (if one exists) is injected into the tool result so the planning agent immediately has context. If no plan exists, the tool result guides the agent to create one.

**Why this priority**: This is the reverse path of Story 2. It enables the AI-initiated build→plan transition that the current system supports only via a hard-coded agent name check. The tool-driven model is architecturally superior and allows re-entry into plan mode at any point, including mid-implementation when the model discovers the task is more complex than expected.

**Independent Test**: Can be fully tested by triggering `EnterPlanModeTool` from the build agent, verifying `PlanModeState.active` becomes `true`, verifying the `plan.state_changed` SSE event is emitted, and verifying the tool result contains the existing plan text (or creation guidance).

**Acceptance Scenarios**:

1. **Given** the session is in build mode, **When** the model invokes `EnterPlanModeTool`, **Then** `PlanModeState.active` is set to `true`, `turnsSincePlanReminder` is reset to 0, and the `plan.state_changed` SSE event is emitted with `{ active: true, planFilePath }`.
2. **Given** a plan file already exists when `EnterPlanModeTool` is invoked, **When** the tool result is constructed, **Then** the tool result contains the full existing plan text and an instruction to review and refine it.
3. **Given** no plan file exists when `EnterPlanModeTool` is invoked, **When** the tool result is constructed, **Then** the tool result instructs the planning agent to create a plan at `<plan-file-path>` using the file write tool.
4. **Given** the session is already in plan mode, **When** `EnterPlanModeTool` is invoked again, **Then** the tool is a no-op (state is already correct) and returns a confirmation without re-emitting events.

---

### User Story 4 — Plan/Explore Sub-Agents with Tool Restriction (Priority: P2)

When the planning agent needs to do deep research (reading files, searching code, exploring the repository) before writing the plan, it can spawn dedicated Plan/Explore sub-agents. These sub-agents are read-only: they can use all read/search tools but are explicitly blocked from file modification tools. They run on isolated sidechain transcripts and return a structured summary to the planning agent.

**Why this priority**: This is how the MVP avoids the planning agent accidentally modifying files during the research phase. Without tool restriction enforcement, the `disallowedTools` config from Phase 2 is present in the agent definition but never enforced — Plan/Explore sub-agents would have full write access. Fixing this is both a prerequisite (closing the Phase 2 gap in `ToolRegistry`) and a Phase 3 feature.

**Independent Test**: Can be fully tested by spawning a Plan/Explore sub-agent and verifying (a) file modification tools are absent from the tool pool and (b) the sub-agent can read files and return a summary.

**Acceptance Scenarios**:

1. **Given** a Plan/Explore sub-agent is configured with `disallowedTools: ["edit", "write", "multiedit", "apply_patch", "plan_exit", "task"]`, **When** `ToolRegistry.tools()` assembles the tool pool for that agent, **Then** the disallowed tools are filtered out from the returned tool pool.
2. **Given** an Explore sub-agent is spawned, **When** it attempts to invoke a file modification tool, **Then** the tool is not available in the sub-agent's tool pool and the model cannot call it.
3. **Given** an Explore sub-agent runs, **When** it completes its research, **Then** it returns a structured summary to the planning agent via the sidechain transcript result.
4. **Given** the `disallowedTools` list for an agent is empty or undefined, **When** `ToolRegistry.tools()` assembles the tool pool, **Then** no tools are filtered and the full tool pool is returned (no regression).

---

### User Story 5 — Session-Scoped Plan Mode State (Priority: P1)

The current plan mode is determined entirely by checking the agent name (`agent.name === 'plan'`). The new implementation stores plan mode state as a first-class object in the session, persisted across turns. This allows all components (reminder system, tool execution, SSE events, query loop) to read a single source of truth rather than independently inferring mode from the agent name.

**Why this priority**: State centralization is the enabler of all other features. Without a persistent `PlanModeState`, the reminder system cannot maintain its turn counter, the approval tool cannot read the current plan text, and the SSE event system has no state to emit. This is purely infrastructure but blocks everything else.

**Independent Test**: Can be fully tested by activating plan mode, making several turns, and verifying that the turn counter increments correctly and persists between turns (i.e., survives the query loop iteration).

**Acceptance Scenarios**:

1. **Given** a session with no prior plan mode activity, **When** plan mode state is read, **Then** the state is `{ active: false, planText: undefined, planFilePath: '<default-path>', turnsSincePlanReminder: 0 }`.
2. **Given** plan mode is activated, **When** each query loop turn completes, **Then** `turnsSincePlanReminder` increments by 1 (resets at 5 when a full reminder is injected).
3. **Given** a plan mode state update (e.g., `planText` set by `ExitPlanModeTool`), **When** the next turn runs, **Then** the updated state is visible to all components that read it — the state is not reset between turns.
4. **Given** the session is multi-tenant (multiple concurrent sessions), **When** plan mode is activated in one session, **Then** other sessions' plan mode state is unaffected — state is fully session-scoped.

---

### Edge Cases

- **Plan file does not exist when approval is requested**: If `ExitPlanModeTool` is invoked but the plan file path resolves to a non-existent file (plan text was never written), the tool must return an error indicating the plan must be written first, rather than emitting an approval request for an empty plan.
- **User disconnects during approval wait**: If the SSE client disconnects while the approval request is pending, the approval gate remains open indefinitely (no timeout). When the user reconnects, the pending approval request is presented via the existing session reconnection infrastructure. No model execution leak occurs because the query loop is blocked at the `Question.ask()` call until a response is received.
- **EnterPlanModeTool called while already in plan mode**: The tool must be idempotent — re-entering plan mode when already active should not double-emit events or corrupt turn counters.
- **ExitPlanModeTool called while not in plan mode**: The tool must return a descriptive error rather than blindly emitting an approval request for a non-existent plan mode session.
- **Full reminder at turn 5 but plan file deleted between turns**: If the plan file is deleted between the reminder trigger and the file read, the attachment must fall back to sparse mode rather than crashing.
- **Reminder cycle desync after resume**: If the session was interrupted mid-plan-mode and resumed (via Phase 4 infrastructure), `turnsSincePlanReminder` must be restored from the persisted state, not reset to 0.
- **disallowedTools enforcement regression**: Existing agents with no `disallowedTools` config must receive their full tool pool unchanged — the new deny filter must be a no-op when the list is empty or undefined.

## Requirements *(mandatory)*

### Functional Requirements

#### Plan Mode State Machine

- **FR-001**: System MUST store plan mode state as a session-scoped object with fields: `active: boolean`, `planText: string | undefined`, `planFilePath: string`, `turnsSincePlanReminder: number`. This state persists for the lifetime of the session and is never inferred dynamically from the agent name.
- **FR-002**: System MUST expose `PlanModeState` read/write operations that are safe for concurrent access within a single session's query loop without external synchronization (query loop is single-threaded per session).
- **FR-003**: System MUST initialize `PlanModeState` with `active: false` and `turnsSincePlanReminder: 0` for new sessions, and restore persisted state when resuming interrupted sessions. `PlanModeState` is persisted as a JSON column on the session row in SQLite, consistent with existing session persistence.

#### Attachment-Based Reminder System

- **FR-004**: System MUST append a sparse plan reminder attachment to every user message when `PlanModeState.active === true`. The attachment text is: `"Plan at <relative-plan-path>, staying on track?"` and is appended as a non-synthetic user message part.
- **FR-005**: System MUST replace the sparse attachment with a full plan text attachment when `PlanModeState.turnsSincePlanReminder >= 5`. The full attachment contains the complete plan file contents. After injection, `turnsSincePlanReminder` is reset to 0.
- **FR-006**: System MUST increment `PlanModeState.turnsSincePlanReminder` by 1 after each query loop turn when plan mode is active. The counter resets to 0 after a full reminder is injected (per FR-005).
- **FR-007**: System MUST inject the full plan text as part of the tool result content when plan mode transitions occur (enter and exit), giving the model immediate in-context access to the plan without an additional file-read round trip.
- **FR-008**: System MUST NOT inject any plan reminder content when `PlanModeState.active === false`. The reminder system must be completely inactive in build mode.

#### ExitPlanModeTool (Plan-to-Build Transition)

- **FR-009**: `ExitPlanModeTool` MUST write the plan content to the session's plan file path on disk before emitting an approval request.
- **FR-010**: `ExitPlanModeTool` MUST emit a `plan.approval_requested` SSE event containing `{ planText, planFilePath }` and block model execution until the session receives a user approval or rejection action. Any client connected to the session is authorized to respond — the session boundary is the trust boundary (no per-client authorization).
- **FR-011**: On approval, `ExitPlanModeTool` MUST: (a) set `PlanModeState.active = false`, (b) reset `PlanModeState.turnsSincePlanReminder = 0`, (c) transition the session to the build agent, and (d) return a tool result containing the full plan text and instruction to execute it — NOT a synthetic user message.
- **FR-012**: On rejection, `ExitPlanModeTool` MUST throw a typed `RejectedError` that the query loop handles by leaving `PlanModeState.active = true` and surfacing a model-visible explanation to continue refining the plan.
- **FR-013**: `ExitPlanModeTool` MUST validate that the plan content is non-empty before writing and requesting approval. Empty plan content is rejected with a descriptive error.
- **FR-014**: `ExitPlanModeTool` MUST emit a `plan.state_changed` SSE event with `{ active: false }` on successful approval to notify clients that plan mode has deactivated.

#### EnterPlanModeTool (Build-to-Plan Transition)

- **FR-015**: `EnterPlanModeTool` MUST set `PlanModeState.active = true` and reset `PlanModeState.turnsSincePlanReminder = 0`.
- **FR-016**: `EnterPlanModeTool` MUST emit a `plan.state_changed` SSE event with `{ active: true, planFilePath }` after setting state.
- **FR-017**: `EnterPlanModeTool` MUST return a tool result containing the full existing plan text (if a plan file exists) with instructions to review and refine it, OR creation guidance (if no plan file exists).
- **FR-018**: `EnterPlanModeTool` MUST be idempotent — invoking it when `PlanModeState.active` is already `true` must be a no-op that returns a confirmation without re-emitting events or resetting the turn counter.
- **FR-019**: `EnterPlanModeTool` MUST transition the session to the plan agent on activation.

#### disallowedTools Enforcement (Phase 2 Gap Closure)

- **FR-020**: `ToolRegistry.tools()` MUST apply the agent's `disallowedTools` array as a deny filter, removing matching tools from the assembled tool pool before returning it. The filter must be applied after all other assembly steps (allow-list, capability checks). The `disallowedTools` values MUST be liteai canonical tool IDs (lowercase, e.g., `edit`, `write`, `plan_exit`).
- **FR-021**: When an agent has no `disallowedTools` config (undefined or empty array), `ToolRegistry.tools()` MUST return the full tool pool unchanged — the deny filter must be a no-op in this case (no regression).
- **FR-022**: The `disallowedTools` deny filter MUST match tools by exact `t.id` string equality against liteai canonical tool IDs. External-platform tool names (e.g., Claude Code's `Edit`, `ExitPlanMode`, `Bash`) are translated to canonical IDs by the platform profile's `toolNameMap` at config load time — the deny filter never sees external names.

#### Plan/Explore Sub-Agents

- **FR-023**: Plan and Explore sub-agent definitions MUST declare `omitLiteaiMd: true` (skip project-level context to reduce noise), independent sidechain transcripts, and a `disallowedTools` list that excludes all file modification tools (`edit`, `write`, `multiedit`, `apply_patch`), the plan exit tool (`plan_exit`), and the agent/task tool (`task`). Reference: MVP `planAgent.ts:77-83`, `exploreAgent.ts:67-73`.
- **FR-024**: Plan/Explore sub-agents MUST operate within the Phase 2 sub-agent infrastructure: context forking, isolated sidechain transcripts, and async lifecycle management.
- **FR-025**: The planning agent MUST be able to spawn Plan/Explore sub-agents without requiring explicit user approval (they inherit the parent's permission mode with bubble surfacing).

#### SSE Events

- **FR-026**: System MUST emit `plan.state_changed` when plan mode activates or deactivates. Payload: `{ active: boolean, planFilePath: string, turnsSincePlanReminder: number }`.
- **FR-027**: System MUST emit `plan.approval_requested` when `ExitPlanModeTool` blocks awaiting user action. Payload: `{ planText: string, planFilePath: string }`.
- **FR-028**: Both SSE event types MUST be scoped to the session — only clients subscribed to the affected session receive them.

#### Observability

- **FR-029**: Plan mode state transitions (enter, exit, approval requested, approved, rejected), reminder cycle events (sparse vs full injection), and `disallowedTools` filtering actions MUST emit structured log events and OpenTelemetry span annotations using the existing `@opentelemetry/api` infrastructure. No new metrics or counters are required in this phase.

#### Platform Profile Tool Name Bridge

- **FR-030**: The `PlatformProfile` interface MUST be extended with an optional `toolNameMap: Record<string, string>` field that maps platform-specific tool names to liteai canonical tool IDs (e.g., Claude Code's `"Edit"` → `"edit"`, `"ExitPlanMode"` → `"plan_exit"`, `"Bash"` → `"run_command"`, `"Agent"` → `"task"`).
- **FR-031**: During agent config processing in `agent.ts`, the `disallowedTools` and `tools` arrays MUST be normalized using the active platform profile's `toolNameMap` before being stored on the agent definition. This ensures the core system only ever operates on liteai canonical tool IDs. Unknown names (not in the map) pass through unchanged to support MCP tools and liteai-native names.

#### Constraints

- **C-001**: All implementation MUST achieve behavioral parity with or superiority to the MVP reference implementation (`liteai_cli_mvp/src`), adapted from CLI to multi-tenant HTTP/SSE backend architecture. No behavioral degradation from MVP is acceptable. See *Reference Implementation Mandate* section above for full context and key reference files.
- **C-002**: The reminder system MUST NOT modify the system prompt or any static message parts — all plan content is injected via user-message attachments or tool results only, preserving the cacheable system prompt prefix.
- **C-003**: The `disallowedTools` enforcement (FR-020–FR-022) MUST NOT break any existing agent that does not configure `disallowedTools`. Zero regression on existing tool pool assembly.

### Key Entities

- **PlanModeState**: The session-scoped object tracking plan mode activity: `{ active: boolean, planText: string | undefined, planFilePath: string, turnsSincePlanReminder: number }`. Single source of truth for all plan mode logic. Persisted as a JSON column on the session row in SQLite; restored on session resume.
- **Plan Attachment**: A non-synthetic user message part appended by the reminder system containing either a sparse reminder (`"Plan at <path>, staying on track?"`) or the full plan text. Appended to the last user message before it is sent to the model.
- **ExitPlanModeTool**: The tool the planning agent invokes when the plan is ready. Writes the plan to disk, emits an approval SSE event, blocks until user responds, then returns a tool result containing the full plan text for the build agent.
- **EnterPlanModeTool**: The tool the build agent invokes when the current task requires planning. Sets `PlanModeState.active = true`, emits a state-changed SSE event, and returns the existing plan (or creation guidance) in its tool result.
- **Plan/Explore Sub-Agent**: A read-only sub-agent definition (using Phase 2 infrastructure) with `omitLiteaiMd: true` and a `disallowedTools` list excluding all mutation tools (`edit`, `write`, `multiedit`, `apply_patch`), the plan exit tool (`plan_exit`), and the agent/task tool (`task`). Used by the planning agent for deep repository research.
- **Approval Gate**: The server-side mechanism that suspends model execution after `ExitPlanModeTool` emits `plan.approval_requested` and resumes it when the client sends an approve or reject action. Backed by the existing `Question.ask()` infrastructure.
- **disallowedTools Deny Filter**: A filter pass in `ToolRegistry.tools()` that removes tools matching any liteai canonical ID in the agent's `disallowedTools` array, applied after all other assembly steps. External-platform tool names are translated at the config boundary by the platform profile's `toolNameMap`.
- **toolNameMap**: A `Record<string, string>` on `PlatformProfile` that translates platform-specific tool names (e.g., `"Edit"`, `"ExitPlanMode"`, `"Bash"`) to liteai canonical tool IDs (e.g., `"edit"`, `"plan_exit"`, `"run_command"`). Applied once at agent config load time so the core system never deals with external naming conventions.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The system prompt prefix is identical between plan mode and build mode turns — no plan-mode-specific content is injected into the static prompt, enabling 100% prompt cache hits on the cacheable prefix across mode transitions.
- **SC-002**: Every user message sent while plan mode is active carries exactly one plan reminder attachment — zero messages without it, zero messages with more than one.
- **SC-003**: Every 5th user message in plan mode carries the full plan text attachment, verified by reading the actual plan file content from disk. Other messages carry the sparse reminder only.
- **SC-004**: The `plan.approval_requested` SSE event is emitted within 500ms of `ExitPlanModeTool` invocation, and model execution is verifiably blocked until a user action is received.
- **SC-005**: On plan approval, the `ExitPlanModeTool` tool result contains the full plan text and the session mode is `build` — verified by inspecting the tool result content and the session's agent state.
- **SC-006**: Plan/Explore sub-agents cannot invoke any file modification tool (`edit`, `write`, `multiedit`, `apply_patch`) — 100% of invocation attempts of disallowed tools result in a tool-not-found error, not a permission error.
- **SC-007**: `ToolRegistry.tools()` returns an identical tool pool for agents with no `disallowedTools` config before and after this change — zero regression verified by existing tool assembly tests.
- **SC-008**: `EnterPlanModeTool` is idempotent — invoking it N times when already in plan mode produces the same result as invoking it once and does not emit redundant SSE events.
- **SC-009**: The `plan.state_changed` SSE event is emitted within 500ms of any plan mode state transition (enter or exit), and only subscribed session clients receive it.
- **SC-010**: `turnsSincePlanReminder` survives across query loop turns without resetting — verified by checking the counter value increments monotonically between turn 1 and turn 4 and resets exactly at turn 5.

## Assumptions

- Phase 2 sub-agent infrastructure (context forking, sidechain transcripts, `disallowedTools` config fields in `Agent.Info`, async lifecycle management) is fully implemented and stable before Phase 3 begins.
- The existing `Question.ask()` infrastructure (used currently by `PlanExitTool`) can serve as the approval gate mechanism, or a compatible blocking SSE-based approval mechanism is available.
- The session's plan file path (`Session.plan(session)`) is a deterministic, per-session path that is consistent across turns and process restarts.
- The `acp/events.ts` SSE event emission infrastructure can be extended with two new event types (`plan.state_changed`, `plan.approval_requested`) without architectural changes.
- The `ToolRegistry` already has access to the active agent's configuration at the time `tools()` is called, making the `disallowedTools` deny filter implementable in a single narrow change.
- The `plan-reminder.ts` module is responsible for all plan-related message mutation and is the correct integration point for the attachment system.
- The query loop (`session/engine/query.ts`) is the correct place to read `PlanModeState` and pass it to the reminder and attachment systems.
- Mobile/browser disconnection scenarios during the approval wait are handled by the existing session reconnection infrastructure, not by new logic in this phase.
