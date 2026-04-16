---
description: "Task list template for feature implementation"
---

# Tasks: Phase UI-A (Minimal Plan Mode UI)

**Input**: Design documents from `/specs/005-plan-mode-ui-minimal/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [ ] T001 Initialize Phase UI-A structure by creating packages/ui/src/components/plan-approval-dock.tsx
- [ ] T002 [P] Create empty styles in packages/ui/src/components/plan-approval-dock.css
- [ ] T003 Read reference implementations liteai_cli_mvp/src/components/AgentProgressLine.tsx and CoordinatorAgentStatus.tsx for MVP compliance

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [ ] T004 Setup `isPlanModeActive` and `isApprovalPending` view state logic in packages/ui/src/panes/chat/chat-pane.tsx
- [ ] T005 Wire SSE events (`plan.state_changed`, `plan.approval_requested`) listeners to view state in packages/ui/src/panes/chat/chat-pane.tsx

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Plan Mode Status Indicator (Priority: P1) 🎯 MVP

**Goal**: Users need to see when the system is operating in plan mode so they understand the current interaction context.

**Independent Test**: Can be tested by emitting a `plan.state_changed` event and observing the Session Title Bar update.

### Implementation for User Story 1

- [ ] T006 [P] [US1] Update packages/ui/src/panes/chat/session-title-bar.tsx to accept `isPlanModeActive` prop
- [ ] T007 [US1] Implement Plan Mode Badge rendering in packages/ui/src/panes/chat/session-title-bar.tsx when `isPlanModeActive` is true

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently

---

## Phase 4: User Story 2 - Plan Approval Dock (Priority: P1)

**Goal**: Users need a way to review, approve, or reject an exit node's plan before the system transitions to execution mode.

**Independent Test**: Can be tested by emitting a `plan.approval_requested` event. The dock should render and capture user decisions.

### Implementation for User Story 2

- [ ] T008 [P] [US2] Build base Plan Approval Dock UI component in packages/ui/src/components/plan-approval-dock.tsx (using SolidJS/Kobalte)
- [ ] T009 [P] [US2] Implement vanilla CSS styling in packages/ui/src/components/plan-approval-dock.css
- [ ] T010 [US2] Adapt MVP design elements from liteai_cli_mvp/src/components/CoordinatorAgentStatus.tsx into packages/ui/src/components/plan-approval-dock.tsx
- [ ] T011 [US2] Add Approve/Reject button handlers and wire callbacks in packages/ui/src/components/plan-approval-dock.tsx
- [ ] T012 [US2] Render the Dock within the `promptDocks` slot of packages/ui/src/panes/chat/chat-pane.tsx based on `isApprovalPending` state

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently

---

## Phase 5: User Story 3 - Prompt Input Lock (Priority: P2)

**Goal**: Users should be prevented from sending generic chat messages or interrupting the system when explicit plan approval is pending.

**Independent Test**: Trigger a plan approval state and verify the standard prompt input is disabled or displays a lock hint.

### Implementation for User Story 3

- [ ] T013 [P] [US3] Update packages/ui/src/panes/chat/chat-prompt-input.tsx to accept `isApprovalPending` prop
- [ ] T014 [US3] Disable chat input and display lock hint in packages/ui/src/panes/chat/chat-prompt-input.tsx when `isApprovalPending` is true

**Checkpoint**: All user stories should now be independently functional

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [ ] T015 Verify behavioral parity with MVP TUI reference (liteai_cli_mvp/src) against packages/ui implementation
- [ ] T016 Run typechecking in packages/ui using `bun run typecheck`
- [ ] T017 Validate UI rendering by running frontend web app via `bun run dev` in packages/web

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3+)**: All depend on Foundational phase completion
- **Polish (Final Phase)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 3 (P2)**: Can start after Foundational (Phase 2) - Best implemented alongside US2

### Within Each User Story

- Core implementation before integration
- Story complete before moving to next priority

### Parallel Opportunities

- Foundational tasks can be developed simultaneously
- US1, US2 can be developed in parallel as they target distinct files (title bar vs dock)
- Styling (CSS) can run synchronously with Dock component logic

---

## Parallel Example: User Story 1 & 2

```bash
# Launch components for US1 and US2 simultaneously:
Task: "Update session-title-bar.tsx to accept prop"
Task: "Build base Plan Approval Dock UI component"
```

---

## Implementation Strategy

### MVP First (User Story 1 & 2)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3 & 4 (US1, US2)
4. **STOP and VALIDATE**: Test Plan indicator and Dock interactions
5. Implement Phase 5 (US3) lock mechanic

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test independently
3. Add User Story 2 → Test independently
4. Add User Story 3 → Test independently
5. Ensure UI MVP parity
