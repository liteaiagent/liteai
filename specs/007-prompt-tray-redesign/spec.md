# Feature Specification: prompt-tray-redesign

**Feature Branch**: `[007-prompt-tray-redesign]`  
**Created**: 2026-04-17  
**Status**: Draft  
**Input**: User description: "@[c:\Users\aghassan\Documents\workspace\liteai\roadmap\prompt-tray-redesign-rfc.md]"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Configure Root Agent (Priority: P1)

As a user, I want to select the root agent from a list of available agents so that I can choose which persona or capability set will lead my session.

**Why this priority**: It is essential for custom agents (e.g., `code-reviewer`) and sets the primary identity of the session assistant. It replaces the old combined dropdown.

**Independent Test**: Can be tested by opening the Agent Selector dropdown and verifying that available primary agents (e.g., "LiteAI") are listed and selectable, and that selecting an agent changes the active agent context.

**Acceptance Scenarios**:

1. **Given** I am in a chat session, **When** I click the Agent Selector dropdown, **Then** I see "LiteAI" and any custom user agents (`mode: primary`), but I do not see "plan".
2. **Given** I have a custom agent "security-auditor", **When** I select it in the Agent Selector, **Then** the session uses the "security-auditor" agent for prompt routing.

---

### User Story 2 - Toggle Tool Profile (Priority: P1)

As a user, I want to switch between "Plan" and "Fast" tool profiles so that I can control whether the agent explores a strategy first or acts immediately.

**Why this priority**: This control is replacing the previous agent conflation to directly give users the ability to skip planning, mirroring the MVP's CLI `/fast` capability effectively.

**Independent Test**: Can be tested by selecting "Fast", giving a complex task, and verifying no plan mode is proposed. Toggling back to "Plan" and verifying the agent can propose plan mode.

**Acceptance Scenarios**:

1. **Given** I select the "Fast" profile, **When** I prompt the agent with a complex request, **Then** the agent immediately executes actions without proposing or entering plan mode.
2. **Given** I select the "Plan" profile, **When** I prompt the agent with a complex request, **Then** the agent may propose a plan by requesting user approval.

---

### User Story 3 - Enable Subagent Forking (Priority: P2)

As a user, I want to toggle "Fork" on or off to optimize subagent spawning speed and cost.

**Why this priority**: Focuses on performance and cost optimization which is important but secondary to core functional logic.

**Independent Test**: Can be tested by enabling Fork and observing that subagents are spawned using the cache-optimized mechanism.

**Acceptance Scenarios**:

1. **Given** the Fork toggle is On, **When** the root agent spawns a subagent, **Then** the system uses the fork/cache mechanism for the new context.
2. **Given** the Fork toggle is Off, **When** the root agent spawns a subagent, **Then** the system uses standard spawning without context fork optimization.

---

### User Story 4 - Future Session Modes Discoverability (Priority: P3)

As a user, I want to see disabled placeholder options for "Coordinator" and "Swarm" session modes so that I am aware of upcoming capabilities.

**Why this priority**: It improves user discoverability and prepares the UI layout for future architectural additions without affecting current core logic.

**Independent Test**: Can be tested by opening the Session Mode dropdown and hovering over the disabled options to see the tooltip.

**Acceptance Scenarios**:

1. **Given** I open the Session Mode dropdown, **When** I inspect the options, **Then** "Coordinator" and "Swarm" are visible but disabled.
2. **Given** I hover over or focus "Coordinator" or "Swarm", **Then** a "Coming soon" tooltip is displayed (see **FR-TOOLTIP-001**).

## Edge Cases

- Naming collisions between custom agents and built-in subagents (e.g., custom agent named "plan" vs built-in subagent `plan`): The system MUST reject the creation of custom agents with reserved/built-in names. Reserved names include `plan` and `build`. The system MUST return an error message formatted as: "Agent creation failed: The name '<name>' is reserved by the system."
- How does system handle toggling Fork while Coordinator mode is selected (if enabled via hack/inspector)? The system must auto-disable and ignore the fork state if session mode is incompatible.
- What happens when switching Tool Profiles mid-session (the toolProfile toggle)? **Resolution**: This edge-case behavior is elevated to **FR-011**.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST display 4 independent controls in the prompt tray: Agent Selector, Session Mode Selector, Tool Profile Selector, and Fork Toggle.
- **FR-002**: System MUST list all available `mode: primary` agents in the Agent Selector.
- **FR-003**: System MUST exclude the `plan` agent from the Agent Selector list.
- **FR-004**: System MUST rename the display name of the `build` agent to "LiteAI" in the Agent Selector.
- **FR-005**: System MUST allow selecting "Normal" from the Session Mode dropdown, and display "Coordinator" and "Swarm" as disabled.
- **FR-006**: System MUST allow setting the Tool Profile to either "Plan" or "Fast".
- **FR-007**: System MUST remove `EnterPlanModeTool`, `ExitPlanModeTool`, `Explore` proxy agent, and `Plan` proxy agent from the available tool pool when the "Fast" profile is active.
- **FR-008**: System MUST support toggling "Fork" subagent spawning behavior between On and Off.
- **FR-009**: System MUST require a mode-level capability flag (`supportsFork`: boolean) in the session mode definition. The UI MUST disable and gray out the Fork toggle whenever the active session mode has `supportsFork: false` (e.g., Coordinator or Swarm). Any newly added mode MUST set `supportsFork` accordingly so the system can determine Fork compatibility programmatically.
- **FR-010**: System MUST persist the Tool Profile and Fork states at a session-level configuration layer (Default: Tool Profile = Plan; Fork = Off).
- **FR-011**: When the UI sends a Tool Profile change mid-session (the toolProfile toggle), the system MUST dynamically re-evaluate the tool registry for any subsequent user message and immediately add or remove plan-related tools without requiring a session reload. This re-evaluation MUST occur during the message handling path that evaluates tool availability, before handling the next user message, and MUST be applied atomically for that message.
- **FR-TOOLTIP-001**: The system MUST display a "Coming soon" tooltip for disabled session mode options. The tooltip MUST be triggered by mouse hover or keyboard focus, MUST be visible only when the option is disabled, MUST be positioned adjacent to the control, and MUST meet accessibility requirements (ARIA role/label and focusable via keyboard).

### Key Entities

- **Session Config**: Stores `sessionMode`, `toolProfile`, and `forkEnabled` state per session.
- **Tool Pool**: The collection of dynamically injected tools and subagents available to the root LM engine based on the active Tool Profile.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can select custom root agents from the UI dropdown menu successfully.
- **SC-002**: All 4 axes in the prompt tray correctly reflect default UI configurations (Agent=LiteAI, Session=Normal, Tool Profile=Plan, Fork=Off) on a fresh session start.
- **SC-003**: Tool pool contains exactly 0 plan-mode-related tools and agents when the 'Fast' profile is selected mid-session.
- **SC-004**: The 'plan' subagent never appears in the primary agent dropdown.

## Assumptions

- We assume `/plan` and `/fast` commands will map to configuring these UI settings or acting as aliases internally.
- We assume "Normal" is the only functional Session Mode currently implemented in `packages/core`.
- We assume the existing database schema for session configuration can support adding the new fields without major migrations, or standard nullable JSON extensions will be used.
