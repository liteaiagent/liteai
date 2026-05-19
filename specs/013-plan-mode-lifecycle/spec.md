# Feature Specification: Plan Mode Lifecycle

**Feature Branch**: `013-plan-mode-lifecycle`

**Created**: 2026-05-19

**Status**: Draft

**Input**: User description: "Phase 2 of Plan Mode Redesign — Rewrite plan_enter to spawn a blocking plan subagent with permission gating. Modify plan_exit for permission restoration and approval flow. Harden the 'plan' permission mode to hard-deny all write operations. Update PlanModeState interface. Update plan agent config. Ensure keepHistory default for KV cache reuse."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Automated Planning via Subagent (Priority: P1)

A developer sends a complex multi-file task to the AI agent. The root agent assesses complexity, optionally asks 1-3 clarifying questions, and then invokes `plan_enter`. The system spawns a dedicated plan subagent that explores the codebase, designs an implementation plan, writes it to disk, and returns the full plan text plus file path. The root agent receives the plan and proceeds to `plan_exit` for user approval. During the entire planning phase, no write operations are possible on the root session.

**Why this priority**: This is the core workflow — the entire Phase 2 redesign revolves around making `plan_enter` spawn a blocking subagent instead of the old state-machine approach. Without this, no other Phase 2 deliverable functions.

**Independent Test**: Can be fully tested by sending a complex task to the agent and verifying that: (1) a plan subagent spawns, (2) the root session is read-only during planning, (3) the plan is written to disk, (4) the full plan text is returned to the root agent without requiring a separate read call.

**Acceptance Scenarios**:

1. **Given** a root agent session in default permission mode, **When** the agent invokes `plan_enter(context)`, **Then** the system sets the root session to "plan" permission mode and spawns a plan subagent that blocks until completion.
2. **Given** a plan subagent is active, **When** the subagent completes its exploration and writes a plan file, **Then** `plan_enter` returns both the plan file path and the full plan text to the root agent.
3. **Given** the root session is in "plan" permission mode, **When** any write tool (edit, write, multiedit, apply_patch) is invoked, **Then** the system hard-denies the operation with a clear error message.

---

### User Story 2 - Plan Approval and Permission Restoration (Priority: P1)

After `plan_enter` returns the plan, the root agent invokes `plan_exit(planText)`. The system fires a `PlanApprovalRequested` event so the TUI can display the plan for preview. A single approval dialog appears. If the user approves, the system restores default permission mode and stores the plan text for the build phase. If the user rejects, the system keeps "plan" permission mode active and the root agent can re-plan or ask follow-up questions.

**Why this priority**: The approval flow is the user-facing gate that controls the transition from planning to implementation. It is equally critical to the subagent spawn.

**Independent Test**: Can be tested by mocking a completed plan and invoking `plan_exit` — verifying the approval dialog appears once (no dual dialogs), approval restores permissions, and rejection preserves read-only state.

**Acceptance Scenarios**:

1. **Given** a plan has been returned from `plan_enter`, **When** the root agent calls `plan_exit(planText)`, **Then** a `PlanApprovalRequested` event is emitted and a single approval dialog is presented to the user.
2. **Given** the approval dialog is shown, **When** the user approves, **Then** the permission mode is restored to "default", the plan text is stored for the build phase, and the `planSessionID` is cleared.
3. **Given** the approval dialog is shown, **When** the user rejects, **Then** the permission mode remains "plan", the root agent receives a rejection signal, and it can re-plan or ask questions.

---

### User Story 3 - Guard Against Invalid Plan Mode Transitions (Priority: P2)

The system prevents entering plan mode when already in plan mode (active `planSessionID` exists). Only the root agent can invoke `plan_enter` — subagents cannot. These guards prevent corrupted state from nested or concurrent planning attempts.

**Why this priority**: Important for system stability but less frequent than the happy path. Guards are defensive and can be implemented after the core workflow.

**Independent Test**: Can be tested by attempting `plan_enter` while a `planSessionID` is already set, and by attempting `plan_enter` from a subagent context — both should fail with clear error messages.

**Acceptance Scenarios**:

1. **Given** the root agent is already in plan mode with an active `planSessionID`, **When** `plan_enter` is invoked again, **Then** the system returns an error indicating plan mode is already active.
2. **Given** a subagent session (not the root agent), **When** that subagent attempts to invoke `plan_enter`, **Then** the system returns an error indicating only the root agent can enter plan mode.

---

### User Story 4 - Plan Subagent History Preservation (Priority: P2)

When the plan subagent is spawned, its session history is preserved (`keepHistory: true`) to leverage KV cache reuse across multi-turn exploration. This ensures the plan subagent's iterative codebase exploration does not re-process previously seen context, improving planning speed and reducing token waste.

**Why this priority**: Performance optimization that enhances the quality of the P1 workflow. Not blocking but significant for production use.

**Independent Test**: Can be tested by verifying that `SessionPrompt.runSubagent()` is called with history persistence enabled, and that the subagent's multi-turn exploration reuses cached context.

**Acceptance Scenarios**:

1. **Given** `plan_enter` spawns a plan subagent, **When** the subagent session is created, **Then** session history persistence is enabled by default.
2. **Given** a plan subagent performs multi-turn codebase exploration, **When** subsequent turns reference previously seen files, **Then** the KV cache hit rate is maintained (no redundant context reprocessing).

---

### Edge Cases

- What happens when the plan subagent times out before completing its plan?
  - The system should propagate a timeout error to `plan_enter`, restore default permission mode, and return an error to the root agent.
- What happens when the plan subagent crashes or produces invalid output (no plan file path)?
  - The system should catch the error, restore default permission mode, log the failure, and return a structured error to the root agent.
- What happens when `plan_exit` is called without a prior `plan_enter` (no plan data available)?
  - The system should return an error indicating no active plan exists.
- What happens when the user's TUI disconnects during the plan approval dialog?
  - The system should preserve the plan state. When the user reconnects, the plan should still be available for review.
- How does `run_command` behave during plan mode?
  - Read-only commands (git log, ls, find, cat, etc.) are allowed. Write commands are denied.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST spawn a dedicated plan subagent when `plan_enter` is invoked, blocking the root agent until the subagent completes.
- **FR-002**: System MUST set the root session permission mode to "plan" before spawning the plan subagent, hard-denying all write operations (edit, write, multiedit, apply_patch).
- **FR-003**: The plan subagent MUST write the implementation plan to disk and return both the plan file path and the full plan text upon completion.
- **FR-004**: `plan_enter` MUST return the plan file path and full plan text to the root agent, eliminating the need for a separate file read call.
- **FR-005**: `plan_exit` MUST emit a `PlanApprovalRequested` event and present a single approval dialog to the user.
- **FR-006**: On user approval, `plan_exit` MUST restore the permission mode to "default", store the plan text for the build phase, and clear the `planSessionID`.
- **FR-007**: On user rejection, `plan_exit` MUST keep the permission mode as "plan" and signal the root agent to re-plan or ask questions.
- **FR-008**: `plan_enter` MUST guard against re-entry (active `planSessionID` check) and restrict invocation to the root agent only.
- **FR-009**: The `PlanModeState` interface MUST be updated to remove deprecated fields (`active`, `workflowType`) and add `planSessionID` for tracking the active plan subagent session.
- **FR-010**: The plan agent configuration MUST be updated to instruct the subagent to write the plan to disk and return the full plan as its final response.
- **FR-011**: The plan subagent MUST be spawned with `keepHistory: true` to enable KV cache reuse across multi-turn exploration.
- **FR-012**: On plan subagent timeout or crash, `plan_enter` MUST restore default permission mode and return a structured error to the root agent.
- **FR-013**: During "plan" permission mode, `run_command` MUST allow read-only commands (git log, ls, find, cat, etc.) and deny write/mutating commands.
- **FR-014**: The old approval gate (`Question.ask` in `plan_enter`) and `PlanApprovalRequested` from `plan_enter` MUST be removed — approval lives exclusively in `plan_exit`.
- **FR-015**: The `interviewMode` parameter MUST be removed from `plan_enter` — the root agent handles all clarification before entering plan mode.

### Key Entities

- **PlanModeState**: Represents the current plan mode state for a session. Contains `planText`, `planFilePath`, `turnsSincePlanReminder`, and `planSessionID`. Tracks whether a plan subagent is active and the resulting plan artifact.
- **Plan Subagent Session**: A child session spawned by `plan_enter` that inherits codebase context and runs with read-only tools plus a write tool scoped to the plan file. Blocks the root session until completion.
- **Permission Mode**: A session-level access control state ("default" or "plan") that determines which tools the root agent can invoke. "Plan" mode hard-denies all write operations except those explicitly whitelisted for read-only exploration.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: End-to-end `plan_enter` → plan subagent → `plan_exit` → approve flow completes successfully with zero manual intervention beyond the single approval dialog.
- **SC-002**: During "plan" permission mode, 100% of write tool invocations are denied with a clear error message — zero silent fallbacks or bypasses.
- **SC-003**: Only ONE approval dialog is presented during the entire planning lifecycle (no dual dialogs between `plan_enter` and `plan_exit`).
- **SC-004**: The plan text returned by `plan_enter` matches the plan written to disk — no data loss or truncation between the subagent's output and the root agent's received result.
- **SC-005**: Plan rejection flow allows the root agent to re-enter planning without session corruption or stale state.
- **SC-006**: All existing scoped tests pass after the changes, and new tests cover the plan_enter guards, permission toggling, and plan_exit approval/rejection flows.
- **SC-007**: Clean `bun typecheck` and `bun lint:fix` with zero errors after implementation.

## Assumptions

- Phase 1 (Agent Taxonomy & Rename) is complete — all `task` → `agent` and `build` → `liteai` renames are finalized and verified.
- The `SessionPrompt.runSubagent()` API exists and supports blocking subagent execution with `keepHistory` configuration.
- The existing `permission/service.ts` already has a `setPermissionMode()` method that can be hardened, not rewritten from scratch.
- The plan subagent has access to the `write` tool for writing the plan file to disk, even though the root session is in "plan" (read-only) mode — the subagent runs in its own session with separate permissions.
- The TUI already supports rendering `PlanApprovalRequested` events — no TUI changes are required for this phase.
- The `Question.ask()` API for approval dialogs is stable and does not need modification.
- Read-only command classification for `run_command` in plan mode will use a whitelist approach based on command patterns (e.g., `git log`, `ls`, `find`, `cat`), not a full shell parser.
- Old plan mode state machine fields (`active`, `workflowType`) have no downstream consumers outside the files being modified — removal is safe.
