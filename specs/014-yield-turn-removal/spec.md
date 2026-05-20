# Feature Specification: yield_turn Removal & State Cleanup

**Feature Branch**: `014-yield-turn-removal`

**Created**: 2026-05-19

**Status**: Draft

**Input**: User description: "Phase 3 of core-roadmap roadmap — Remove all deprecated yield_turn infrastructure, clean up obsolete plan mode state fields, and delete legacy prompt files rendered unnecessary by the new blocking subagent-driven planning architecture."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Clean Codebase After Architecture Migration (Priority: P1)

As a developer maintaining the LiteAI core package, I need all deprecated `yield_turn` tool infrastructure removed so that the codebase contains zero dead code paths related to the legacy plan mode state machine, reducing confusion and maintenance burden.

**Why this priority**: Dead code from the pre-P2 architecture actively misleads contributors, introduces false positive search results during debugging, and creates drift risk where outdated code paths could be accidentally re-activated. This is the foundational cleanup that unblocks all downstream prompt and cache work (P4, P6).

**Independent Test**: Can be fully tested by running the type checker and linting tools across the core package after deletion and verifying zero compilation errors, zero references to `yield_turn` in the codebase, and no runtime regressions in scoped test suites.

**Acceptance Scenarios**:

1. **Given** the `yield_turn` tool file exists, **When** Phase 3A is completed, **Then** the file `tool/yield_turn.ts` no longer exists and the tool is not exportable, registrable, or referenceable from any module.
2. **Given** the tool registry includes `yield_turn`, **When** Phase 3A is completed, **Then** the registry, tool filter, and coordinator modules contain zero imports or references to `yield_turn`.
3. **Given** the agent tool (formerly task tool) contains yield_turn parsing logic, **When** Phase 3A is completed, **Then** the agent tool processes subagent results without any yield_turn-specific branching.
4. **Given** the full test suite is scoped to the affected domains, **When** all 3A deletions are complete, **Then** `bun typecheck` reports zero new errors and scoped tests pass.

---

### User Story 2 - Simplified Plan Mode State Model (Priority: P1)

As the LiteAI runtime, I need the plan mode state model stripped of legacy fields (`active`, `workflowType`) and legacy event emissions (`PlanStateChanged`) so that the only state governing plan mode is the permission mode and the `planSessionID` — matching the new blocking subagent architecture from Phase 2.

**Why this priority**: The legacy `active` boolean and `workflowType` enum created a dual-source-of-truth problem where both the permission mode and the plan state independently tracked "are we planning?". Removing these fields eliminates an entire class of state synchronization bugs and is required before prompt rewrites in Phase 4.

**Independent Test**: Can be fully tested by verifying the `PlanModeState` interface contains only `planText`, `planFilePath`, `turnsSincePlanReminder`, and `planSessionID` fields, and that the session engine no longer emits or subscribes to `PlanStateChanged` events.

**Acceptance Scenarios**:

1. **Given** `PlanModeState` contains `active` and `workflowType` fields, **When** Phase 3B is completed, **Then** the interface contains only: `planText`, `planFilePath`, `turnsSincePlanReminder`, and `planSessionID`.
2. **Given** the session engine emits `PlanStateChanged` events, **When** Phase 3B is completed, **Then** zero event emissions or subscriptions for `PlanStateChanged` exist in the codebase.
3. **Given** `plan-reminder.ts` contains `injectActivePlanReminder()` and an `if (planModeState.active)` branch, **When** Phase 3B is completed, **Then** only the build-phase reminder path remains.
4. **Given** `stop-drift.ts` contains the `StopDriftService`, **When** Phase 3B is completed, **Then** `StopDriftService` is retained unchanged — it is P2-era enforcement logic, not legacy infrastructure (FR-006).
5. **Given** `query.ts` contains yield_turn detection (`calledYieldTurn` check and loop break), **When** Phase 3B is completed, **Then** the `calledYieldTurn` detection is removed while the stop-drift recovery path (which depends on the retained `StopDriftService`) is preserved (FR-007).

---

### User Story 3 - Legacy Prompt File Cleanup (Priority: P2)

As the AI agent operating within LiteAI, I need obsolete prompt files (plan-active-reminder, plan-workflow, plan-interview) deleted so that I am never injected with instructions referencing a state machine that no longer exists, preventing hallucinated behaviors and confused planning workflows.

**Why this priority**: While lower impact than code removal (agents won't crash from orphaned prompt files), stale prompts actively degrade agent behavior by injecting contradictory instructions. This is a prerequisite for the prompt rewrite phase (P4) which needs a clean baseline.

**Independent Test**: Can be fully tested by confirming the three legacy prompt files do not exist on disk and that no module loads or references them.

**Acceptance Scenarios**:

1. **Given** the files `plan-active-reminder.md`, `plan-workflow.md`, and `plan-interview.md` exist under `bundled/prompts/misc/`, **When** Phase 3C is completed, **Then** all three files are deleted from disk.
2. **Given** modules may reference these prompt files by path or name, **When** Phase 3C is completed, **Then** zero references to these filenames exist in the codebase.
3. **Given** `plan-exit.txt` may contain references to the old state machine workflow, **When** Phase 3C is completed, **Then** the plan-exit tool description is reviewed and updated if it still references deprecated concepts (deferred to P4 if already aligned with P2 changes).

---

### Edge Cases

- What happens if a running session has `yield_turn` in its conversation history when the tool is removed? The system must not crash when encountering historical tool-call records for a deleted tool — the conversation replay logic must gracefully skip unknown tool references.
- What happens if `PlanModeState` is serialized with legacy `active` or `workflowType` fields in persisted session data? The deserialization logic must ignore unknown fields without throwing errors (standard behavior for well-designed schema evolution).
- What happens if a third-party integration or coordinator mode references `yield_turn` by string name? The cleanup must cover all string-literal references, not just import-based references.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST fully remove the `yield_turn` tool definition, including its source file, prompt description file, registry entry, tool filter entry, and all coordinator references.
- **FR-002**: System MUST remove `yield_turn` parsing and handling logic from the agent tool (subagent result processing).
- **FR-003**: System MUST remove the `active` and `workflowType` fields from the `PlanModeState` interface and all code that reads or writes these fields.
- **FR-004**: System MUST remove the `PlanStateChanged` event definition, all emissions of this event, all subscriptions to this event, and the CLI TUI's `plan.state_changed` event handler and associated dead state fields (`PlanState` interface, `plan`, `prePlanPermissionMode`).
- **FR-005**: System MUST remove `injectActivePlanReminder()` and the `planSessionID !== undefined` conditional branch from the plan reminder module, while preserving the build-phase reminder path.
- **FR-006**: System MUST retain the `StopDriftService` in the stop-drift module — the current implementation is P2-era enforcement logic, not legacy infrastructure. No changes required.
- **FR-007**: System MUST remove yield_turn detection from the query module (`calledYieldTurn` check and loop break). The stop-drift recovery path is retained as it depends on the P2-era `StopDriftService`.
- **FR-008**: System MUST delete the prompt files: `plan-active-reminder.md`, `plan-workflow.md`, and `plan-interview.md`.
- **FR-009**: System MUST pass type checking (`bun typecheck`) with zero new errors after all changes are applied.
- **FR-010**: System MUST pass linting (`bun lint:fix`) cleanly after all changes are applied.
- **FR-011**: System MUST pass scoped tests for all affected domains (tools, sessions, plan-mode) with no regressions.
- **FR-012**: System MUST gracefully handle historical conversation records containing references to the deleted `yield_turn` tool without runtime errors.

### Key Entities

- **yield_turn tool**: A deprecated tool that allowed the root agent to yield control back to the user during the old plan mode state machine. Fully superseded by the blocking subagent architecture.
- **PlanModeState**: The state object tracking plan mode lifecycle. Being simplified to remove legacy fields (`active`, `workflowType`) and legacy event (`PlanStateChanged`), retaining only `planText`, `planFilePath`, `turnsSincePlanReminder`, and `planSessionID`.
- **Plan prompt files**: Markdown/text files injected into agent context during the old plan mode lifecycle. Three files are fully obsolete: `plan-active-reminder.md`, `plan-workflow.md`, `plan-interview.md`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Zero references to `yield_turn` (as identifier, string literal, or import) remain in the entire `packages/core` codebase after completion.
- **SC-002**: Zero references to `PlanStateChanged` event remain in the codebase after completion.
- **SC-003**: *(Pre-satisfied)* Zero references to `planModeState.active` or `workflowType` remain in the codebase — these were already removed during Phase 2.
- **SC-004**: The `PlanModeState` interface contains exactly 4 fields: `planText`, `planFilePath`, `turnsSincePlanReminder`, `planSessionID`.
- **SC-005**: Type checking completes with zero new errors introduced by this feature.
- **SC-006**: All scoped tests (tools, sessions, plan-mode) pass with zero regressions.
- **SC-007**: The three legacy prompt files (`plan-active-reminder.md`, `plan-workflow.md`, `plan-interview.md`) do not exist on disk.
- **SC-008**: The planning workflow (plan_enter → subagent → plan_exit → approve) continues to function correctly after cleanup, with no behavioral changes observed.

## Assumptions

- Phase 2 (Plan Mode Lifecycle rewrite) is complete before this work begins — the blocking subagent architecture is in place, meaning `yield_turn` is already unused at runtime.
- The `plan_exit` tool description update (if needed) may be deferred to Phase 4 (Prompt Rewrites) if the P2 implementation already aligned it with the new architecture.
- Persisted session data uses a schema-evolution-friendly format that ignores unknown fields during deserialization, so removing `active` and `workflowType` from `PlanModeState` does not corrupt existing session stores.
- The coordinator modules (`coordinator-mode.ts`, `coordinator-prompt.ts`, `teammate-runner.ts`) may or may not still exist in their current form — references are removed if present, or this step is skipped if the module has been restructured in P2.
- No external consumers outside `packages/core` depend on `yield_turn` as a public API.
