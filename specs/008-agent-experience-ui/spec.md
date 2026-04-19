# Feature Specification: Agent Experience UI

**Feature Branch**: `[008-agent-experience-ui]`  
**Created**: 2026-04-19  
**Status**: Draft  
**Input**: User description: "Phase UI-B (Full agent experience design) and Backend SSE event wiring (agent.* + plan.* events)"

## Reference Implementation Mandate

- All work on the feature (specification, planning, tasks, design, implementation, reuse) MUST be grounded on `liteai_cli_mvp/src`.
- The target quality bar: same or superior quality and behavioral parity — no degradation from MVP is acceptable.
- The key reference files specific to the phase include MVP UI components like `AgentProgressLine.tsx` and `CoordinatorAgentStatus.tsx`.
- The architecture adaptation note: MVP is a CLI application; liteai is a multi-tenant HTTP/SSE backend server and web application. All MVP patterns must be adapted to backend architecture (session-scoped state, tenant isolation, concurrent connection management) while preserving behavioral equivalence or improving upon it.
- The propagation directive: this mandate MUST be carried forward into `plan.md` and `tasks.md` when those artifacts are generated, ensuring every implementation task references the relevant MVP source for design grounding and parity validation.

## Clarifications

### Session 2026-04-19

- Q: What happens when an agent completes but the panel is manually closed? → A: Animate/highlight the "explore agent" toggle button.
- Q: How does the system handle an error or backgrounded status inside the agent status chip? → A: Show explicit error/paused icon in the chip and persist the state.
- Q: What happens if the plan approval request is received while the user is disconnected from the event stream? → A: Replay the pending approval state upon reconnection via an explicit fetch/sync.
- Q: Should the `agent.*` and `plan.*` SSE event payloads strictly match the MVP CLI internal state structure? → A: Maintain parity with the MVP CLI internal state field structures.
- Q: Will we still show the link to the agent in the main chat window or will it be removed? → A: Keep a contextual inline link/chip inside the chat message that opens the agent in the drawer.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Plan Approval Integration (Priority: P1)

Users must be able to visually see when the agent requires plan approval via a dedicated "Plan Mode" user interface above the prompt input.

**Why this priority**: Plan mode blocks further agent progress until the user approves or rejects; missing this state would lead to application stalls.

**Independent Test**: Can be fully tested by triggering a plan approval request event and verifying the UI appropriately prompts the user with the plan text and action buttons.

**Acceptance Scenarios**:

1. **Given** the agent triggers a plan mode exit, **When** the approval requested event fires, **Then** a sticky plan mode bar and plan approval dock appear above the prompt input.
2. **Given** the user is viewing the plan approval dock, **When** they approve the plan, **Then** the interface transitions back to build mode and input is unlocked.

---

### User Story 2 - Sub-Agent Observability (Agent Panel) (Priority: P1)

Users must be able to view currently spawned sub-agents and their progress without navigating away from the chat interface.

**Why this priority**: Users need transparency into multi-agent operations to trust the system and understand delays or complex computations.

**Independent Test**: Can be fully tested by firing an agent spawned event and observing the Agent Panel slide-in drawer automatically open and populate with an Agent Row.

**Acceptance Scenarios**:

1. **Given** no agents are active, **When** an agent spawned event is received, **Then** the Agent Panel drawer automatically slides out and opens.
2. **Given** the Agent Panel is open, **When** agent progress updates arrive, **Then** the corresponding agent row updates its status/stats chip in real-time.

---

### User Story 3 - Sidechain Transcript Viewer (Priority: P2)

Users must be able to view the full sidechain transcript of any specific sub-agent within the panel drawer without switching pages.

**Why this priority**: Essential for deep-dive debugging and understanding exactly what a sub-agent considered.

**Independent Test**: Can be fully tested by selecting an agent row in the drawer and verifying the drawer body seamlessly swaps to transcript view.

**Acceptance Scenarios**:

1. **Given** an agent row is visible in the panel, **When** the user clicks it, **Then** the drawer body swaps to display the sidechain transcript.

### Edge Cases

- If the panel is manually closed when an agent completes, the UI MUST animate/highlight the "explore agent" toggle button without auto-opening.
- If an agent enters an error or backgrounded state (identified via `isAsync: true` on `agent.spawned`), the UI MUST show an explicit error/paused icon in the chip and persist the state in the list.
- If the plan approval request is received while the user is disconnected, the system MUST replay the pending approval state upon reconnection via an explicit fetch/sync.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001a**: System MUST subscribe to agent lifecycle events (`agent.spawned`, `agent.progress`, `agent.completed`, `agent.terminal_notification`) from the backend SSE stream.
- **FR-001b**: System MUST subscribe to plan mode events (`plan.state_changed`, `plan.approval_requested`) from the backend SSE stream.
- **FR-002**: System MUST emit appropriate backend events for agent metadata and plan states from the core backend module, maintaining parity with the existing codebase event schemas (see data-model.md).
- **FR-003**: System MUST auto-open an Agent Panel drawer upon the first agent spawned event.
- **FR-004**: System MUST render an inline, sticky Plan Approval Dock when a plan awaits user approval, blocking standard chat input simultaneously.
- **FR-005**: System MUST render sub-agent sidechain transcripts directly in the Agent Panel via drawer body swap.
- **FR-006**: System MUST render a contextual inline link/chip inside the main chat response that explicitly opens the corresponding agent's details within the Agent Panel drawer.

#### Constraints
- **C-001**: All implementation MUST achieve behavioral parity with or superiority to the MVP reference, grounded on the existing codebase event schemas and agent lifecycle patterns (see research.md R-009, data-model.md). MVP source (`liteai_cli_mvp/src`) is not present in workspace; designs are validated against the live `packages/core/src/agent/events.ts` and `packages/core/src/session/` schemas. No behavioral degradation from the established event contracts is acceptable.

### Key Entities

- **Agent Panel Drawer**: The UI container tracking agent trees and statuses.
- **Plan Approval Dock**: The UI container soliciting plan feedback.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Agent spawned event triggers open state of Agent Panel within 1 animation frame (~16ms) of the `agent.spawned` SSE event arriving.
- **SC-002**: Agent transitions (running/done/error) reflect in Agent Status Badges in real-time with no flickering.
- **SC-003**: Users successfully review and approve/reject plans from the dock without needing to refresh or navigate away from the primary chat input area.
- **SC-004**: Application UI components remain responsive (no dropped frames >16ms) under a simulated burst of 50+ agent events within 1 second, with 0 visual glitches or unresponsive states.

## Assumptions

- Assumes underlying sub-agent architecture and plan mode infra correctly persist state and trigger lifecycle callbacks.
- User interface targets desktop form factors primarily (chat pane side-drawer architecture).
