# Feature Specification: Phase UI-A (Minimal Plan Mode UI)

**Feature Branch**: `[005-plan-mode-ui-minimal]`  
**Created**: 2026-04-16  
**Status**: Draft  
**Input**: User description: "**Phase UI-A (Minimal):** Functional plan mode UI with minimal design polish. Enables end-to-end UAT-1."

## Reference Implementation Mandate

- All work on this feature (specification, planning, tasks, design, implementation, reuse) MUST be grounded on `liteai_cli_mvp/src`.
- The target quality bar: **same or superior** quality and behavioral parity — no degradation from MVP is acceptable.
- The key reference files specific to the phase: `liteai_cli_mvp/src/components/AgentProgressLine.tsx`, `liteai_cli_mvp/src/components/CoordinatorAgentStatus.tsx`. 
- The architecture adaptation note: MVP is a **CLI application** using React/Ink; liteai uses a **SolidJS + Kobalte + vanilla CSS** UI. All MVP patterns must be adapted to the SolidJS architecture while preserving behavioral equivalence or improving upon it. Design language and information architecture are adopted from the MVP TUI.
- The **propagation directive**: this mandate MUST be carried forward into `plan.md` and `tasks.md` when those artifacts are generated, ensuring every implementation task references the relevant MVP source for design grounding and parity validation.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Plan Mode Status Indicator (Priority: P1)

Users need to see when the system is operating in plan mode so they understand the current interaction context.

**Why this priority**: Fundamental for user orientation. The user must know if they are collaborating on a plan versus executing tasks.

**Independent Test**: Can be tested by emitting a `plan.state_changed` event and observing the Session Title Bar update.

**Acceptance Scenarios**:

1. **Given** the agent enters plan mode, **When** the `plan.state_changed` event is received, **Then** the session title bar displays a plan mode badge.

---

### User Story 2 - Plan Approval Dock (Priority: P1)

Users need a way to review, approve, or reject an exit node's plan before the system transitions to execution mode.

**Why this priority**: Required for the plan approval workflow, ensuring user control over the execution phase.

**Independent Test**: Can be tested by emitting a `plan.approval_requested` event. The dock should render and capture user decisions.

**Acceptance Scenarios**:

1. **Given** the system is in plan mode, **When** a `plan.approval_requested` event is received via SSE, **Then** a sticky Plan Approval Dock renders above the chat prompt.
2. **Given** the Plan Approval Dock is active, **When** the user clicks "Approve", **Then** the plan is accepted and the interface transitions to build mode.
3. **Given** the Plan Approval Dock is active, **When** the user clicks "Reject", **Then** the plan mode is maintained and the model is prompted for a revision.

---

### User Story 3 - Prompt Input Lock (Priority: P2)

Users should be prevented from sending generic chat messages or interrupting the system when explicit plan approval is pending.

**Why this priority**: Prevents desynchronization between user actions and backend state machine during critical decision gates.

**Independent Test**: Trigger a plan approval state and verify the standard prompt input is disabled or displays a lock hint.

**Acceptance Scenarios**:

1. **Given** a `plan.approval_requested` event is active, **When** the user attempts to type in the main chat input, **Then** the input is locked and displays a hint directing them to the Plan Approval Dock.

### Edge Cases

- What happens when a network error disrupts SSE events while the dock is visible? (Fallback to querying state on reconnect)
- How does the system handle the user refreshing the page while plan approval is pending? (Should restore state from backend)

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST display a plan mode badge in the session title bar when `plan.state_changed` indicates active plan mode.
- **FR-002**: System MUST render a Plan Approval Dock in the chat pane's `promptDocks` slot upon receiving a `plan.approval_requested` event.
- **FR-003**: System MUST lock the main chat prompt input and display a hint when plan approval is requested.
- **FR-004**: System MUST allow users to explicitly approve or reject the plan via the Plan Approval Dock.

#### Constraints
- **C-001**: All implementation MUST achieve behavioral parity with or superiority to the MVP reference implementation (`liteai_cli_mvp/src`), adapted from CLI to multi-tenant HTTP/SSE backend architecture. No behavioral degradation from MVP is acceptable. See *Reference Implementation Mandate* section above for full context and key reference files.

### Key Entities

- **Plan Approval Dock**: A sticky UI component that appears above the user input area to ask for plan confirmation.
- **Session Title Bar**: The header component that needs to visually reflect the current context mode (build vs. plan).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can clearly identify the active mode (plan vs. build) 100% of the time via the session title bar badge.
- **SC-002**: The Plan Approval Dock correctly intercepts user interaction and captures explicit approve/reject signals.
- **SC-003**: The chat prompt is successfully locked during pending approvals, preventing invalid interactions.

## Assumptions

- The backend SSE infrastructure correctly emits `plan.state_changed` and `plan.approval_requested` events.
- Foundational UI components (SolidJS primitives, Kobalte) are already configured and available in `packages/ui`.
- The initial UI implementation prioritizes functionality over extensive design polish to enable UAT-1 testing, per Phase UI-A scope.
