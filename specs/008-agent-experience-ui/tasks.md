# Tasks: Agent Experience UI

**Input**: Design documents from `/specs/008-agent-experience-ui/`  
**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, quickstart.md ✅

**Tests**: Not explicitly requested — test tasks omitted per workflow rules.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Backend**: `packages/core/src/` (existing — no modifications needed)
- **Web Host**: `packages/web/src/context/`
- **UI Library**: `packages/ui/src/components/`, `packages/ui/src/panes/chat/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create the new directory structure and foundational files for the Agent Panel components.

- [x] T001 Create agent-panel component directory at `packages/ui/src/components/agent-panel/`
- [x] T002 [P] Create `packages/ui/src/components/agent-panel/agent-panel.css` with drawer layout, spring-animated slide-in, and responsive width styles. Reference `packages/ui/src/components/todo-panel-motion.stories.tsx` for motion patterns.
- [x] T003 [P] Create `packages/ui/src/components/agent-panel/agent-row.css` with agent row layout, status chip variants (`running`/`completed`/`failed`/`killed`), activity text truncation, and hover/selection states.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Wire the event subscription bridge in the web host — this BLOCKS all UI event subscriptions.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete. The existing plan event subscriptions in `chat-pane.tsx:157-180` are currently dead code because the web `ChatController` does not provide `events`. This task activates them.

- [x] T004 Wire `events` property on `createWebChatController()` in `packages/web/src/context/web-chat-controller.ts`. Bridge `useGlobalSDK().event` (the `createGlobalEmitter` from `packages/web/src/context/global-sdk.tsx`) into a `subscribe(eventType, callback)` adapter that filters SSE payloads by `payload.type` and invokes the callback with `payload.properties`. Return an unsubscribe function. This activates the existing `controller.events?.subscribe()` calls in `chat-pane.tsx` for both `plan.*` and `agent.*` events.

**Checkpoint**: After T004, trigger a plan approval event and verify the existing `PlanApprovalDock` in the web UI actually appears (it was wired but dead). This validates US1 (Plan Approval Integration) end-to-end without any US1-specific code changes.

---

## Phase 3: User Story 1 — Plan Approval Integration (Priority: P1) 🎯 MVP

**Goal**: Users can see and interact with the Plan Approval Dock when the agent requests plan approval. The dock blocks standard input until the user approves or rejects.

**Independent Test**: Trigger a `plan.approval_requested` SSE event and verify the dock renders above the prompt input with plan text and approve/reject buttons. Verify approving dismisses the dock and calls `onApprovePlan`.

**Note**: This user story is **already fully implemented** in `chat-pane.tsx` and `plan-approval-dock.tsx`. The only blocker was T004 (event wiring). After T004, US1 should be functional with zero additional code changes. The task below is a verification-only task.

### Implementation for User Story 1

- [x] T005 [US1] Verify plan approval dock works end-to-end in web UI after T004 event wiring. Manually test: (1) trigger a session into plan mode, (2) verify `plan.state_changed` event sets the `isPlanModeActive` signal in `packages/ui/src/panes/chat/chat-pane.tsx`, (3) verify `plan.approval_requested` event renders `PlanApprovalDock` at `packages/ui/src/components/plan-approval-dock.tsx` with plan text, (4) verify approve/reject buttons dismiss the dock and call the host callbacks. Document any issues found.

- [x] T005b [FR-002] Verify backend event emission end-to-end. Trigger a sub-agent lifecycle (spawn → progress → complete) and verify the backend emits `agent.spawned`, `agent.progress`, `agent.completed`, and `agent.terminal_notification` SSE events with correct payloads matching data-model.md schemas. Verify `plan.state_changed` and `plan.approval_requested` events emit when plan mode activates. This validates FR-002 independently of UI rendering.

**Checkpoint**: Plan approval flow verified functional. Backend event emission validated. US1 complete.

---

## Phase 4: User Story 2 — Sub-Agent Observability / Agent Panel (Priority: P1)

**Goal**: Users can view currently spawned sub-agents and their progress in a slide-in Agent Panel drawer without navigating away from chat.

**Independent Test**: Fire an `agent.spawned` SSE event and verify the Agent Panel drawer automatically slides out and populates with an agent row. Fire `agent.progress` and verify the row's activity text updates in real-time. Fire `agent.completed` and verify the status chip transitions.

### Implementation for User Story 2

- [x] T006 [P: Phase 1 CSS only] [US2] Create `AgentRow` component in `packages/ui/src/components/agent-panel/agent-row.tsx`. Render a single agent entry with: agent type label, status icon/chip (`running` = spinner, `completed` = check, `failed` = error icon, `killed` = stop icon), latest activity text (from `agent.progress`), and duration/token usage (from `agent.completed`). Accept `AgentEntry` props (see data-model.md `AgentEntry` interface). Add `onClick` prop for transcript view navigation (US3). Use styles from `agent-row.css` (T003). **Note**: T006 is parallel with T002/T003 (CSS files), NOT with T007 which depends on T006.

- [x] T007 [US2] Create `AgentPanel` drawer component in `packages/ui/src/components/agent-panel/agent-panel.tsx`. Implement a right-side slide-in drawer using spring-animated transforms (reference: `packages/ui/src/components/todo-panel-motion.stories.tsx` drawer patterns). Manage `AgentPanelState` as a SolidJS reactive store (`createStore`) with `agents: Map<string, AgentEntry>`, `drawerOpen: boolean`, and `selectedAgentId?: string`. Render a list of `AgentRow` components from the store. Include a close button and a "toggle" button that persists outside the drawer. Export `createAgentPanelState()` factory function for use by the host. Use styles from `agent-panel.css` (T002).

- [x] T008 [US2] Wire agent event subscriptions in `packages/ui/src/panes/chat/chat-pane.tsx`. Add a `createEffect` block (alongside the existing plan event subscriptions at line ~157) that subscribes to `agent.spawned`, `agent.progress`, `agent.completed`, and `agent.terminal_notification` via `controller.events.subscribe()`. On `agent.spawned`: insert a new `AgentEntry` into the panel state with `status: "running"` and auto-set `drawerOpen: true` if this is the first agent. On `agent.progress`: update the matching entry's `activity` field. On `agent.completed`: update `status`, `duration`, and `usage`. On `agent.terminal_notification`: update `error` field. All subscriptions must be cleaned up via `onCleanup()`. **Fail-Fast (Constitution VI)**: Each subscription callback MUST validate the incoming event payload with type guards before processing. Malformed or missing fields (e.g., null `sessionId`, unexpected `status` values) MUST be logged via `console.error` with the raw payload and surfaced — never silently dropped or swallowed with fallback defaults.

- [x] T009 [US2] Mount `AgentPanel` in the `chat-pane.tsx` render tree at `packages/ui/src/panes/chat/chat-pane.tsx`. Place the `AgentPanel` component alongside the main chat content area so it overlays/pushes from the right. Pass the reactive `AgentPanelState` store and agent entry list. Pass `onSelectAgent` callback for US3 transcript navigation. Ensure the drawer toggle button is always rendered (even when drawer is closed). Ensure the drawer animation does not cause layout shifts in the chat message timeline.

**Checkpoint**: Agent Panel drawer opens on `agent.spawned`, rows update on `agent.progress`, status chips transition on `agent.completed`. Testable with any prompt that triggers a sub-agent.

---

## Phase 5: User Story 2 (continued) — Inline Agent Chip (FR-006)

**Goal**: Chat messages that triggered sub-agents show an inline link/chip that opens the corresponding agent in the Agent Panel drawer.

**Independent Test**: Verify that a `task` tool result in the chat timeline shows a clickable chip that opens the Agent Panel and highlights the corresponding agent row.

### Implementation for Inline Agent Chip

- [x] T010 [US2] Extend `packages/ui/src/components/message-parts/tool.tsx` to add an Agent Panel drawer trigger. For `task` tool parts that have `metadata.sessionId`, add an `onClick` handler alongside the existing `taskHref` link that: (1) sets `drawerOpen: true` on the `AgentPanelState`, and (2) sets `selectedAgentId` to the `sessionId`. This requires the `AgentPanelState` to be accessible from the tool part — either via SolidJS context (new `AgentPanelContext`) or via a callback prop threaded through `MessagePartProps`. Evaluate which approach is cleaner given the component hierarchy. The rendered chip should have a distinct visual style (small pill/badge) that says "Explore Agent" or displays the agent type name.

**Checkpoint**: Clicking the inline agent chip in chat opens the Agent Panel and highlights the correct agent. US2 fully complete (FR-003, FR-006).

---

## Phase 6: User Story 3 — Sidechain Transcript Viewer (Priority: P2)

**Goal**: Users can view the full sidechain transcript of any sub-agent directly within the Agent Panel drawer without navigating away.

**Independent Test**: Click an agent row in the panel and verify the drawer body swaps from the agent list to a transcript view showing the sub-agent's conversation history.

### Implementation for User Story 3

- [x] T011 [P] [US3] Create `packages/ui/src/components/agent-panel/transcript-view.css` with transcript layout styles (message bubbles, scrollable container, back-navigation header, loading state).

- [x] T012 [US3] Create `TranscriptView` component in `packages/ui/src/components/agent-panel/transcript-view.tsx`. Accept `agentId: string` prop. Use the `ChatController.messages(agentId)` and `ChatController.parts(messageId)` APIs to load the sub-agent's conversation history (the `agentId` IS the child session ID). Render messages using a simplified message timeline or markdown renderer. Include a "← Back to agents" header button that clears `selectedAgentId` and returns to the agent list view. Handle loading states (messages not yet fetched) with a spinner. Use styles from `transcript-view.css` (T011).

- [x] T013 [US3] Wire drawer body swap in `packages/ui/src/components/agent-panel/agent-panel.tsx`. When `selectedAgentId` is set in the `AgentPanelState`, render `TranscriptView` instead of the agent list. When `selectedAgentId` is cleared (via back button), return to the agent list. Use SolidJS `<Show>` / `<Switch>` for conditional rendering. The swap should be seamless — no layout jumps or flickering.

**Checkpoint**: Clicking an agent row shows its transcript. Back button returns to agent list. US3 complete (FR-005).

---

## Phase 7: Polish & Edge Cases

**Purpose**: Handle edge cases from the spec and cross-cutting quality improvements.

- [ ] T014 [P] Handle edge case EC-001 (panel closed on agent complete): When an `agent.completed` event is received and the drawer is closed, animate/highlight the Agent Panel toggle button (e.g., pulse animation, badge count) in `packages/ui/src/components/agent-panel/agent-panel.tsx` to draw attention without auto-opening the drawer.

- [ ] T015 [P] Handle edge case EC-002 (error/backgrounded state): Ensure `AgentRow` in `packages/ui/src/components/agent-panel/agent-row.tsx` renders an explicit error icon with red status chip when `status === "failed"`, and a distinct "async" indicator when `isAsync === true`. Error text from `AgentEvent.TerminalNotification` should be shown in a tooltip or expandable detail on the row.

- [ ] T016 Handle edge case EC-003 (SSE reconnection replay): In `packages/ui/src/panes/chat/chat-pane.tsx`, when the SSE stream reconnects (detectable via the `GlobalSDK` heartbeat/reconnect logic in `packages/web/src/context/global-sdk.tsx`), fetch the current session state via `controller.session.sync(sessionID)` to restore any pending plan approval or active agent states that may have been missed during the disconnection window.

- [ ] T017 Run `bun typecheck 2>&1 | Out-String` from `packages/ui` and `packages/web` to verify zero type errors across all modified and new files.

- [ ] T018 Run `bun lint:fix` from `packages/ui` and `packages/web` to ensure formatting compliance across all modified and new files.

- [ ] T019 Run quickstart.md verification steps: (1) verify agent events in SSE stream, (2) verify plan events in SSE stream, (3) verify Agent Panel drawer opens and updates, (4) verify plan approval dock works. Ensure to also measure and document the event-to-render latency for panel drawer opening to verify the 1-frame (~16ms) constraint (SC-001).

- [ ] T020 [P] Create a verification test script or browser harness that simulated a burst of 50+ agent events within 1 second and confirm that the `AgentPanel` UI remains responsive with no active dropped frames (SC-004).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion — **BLOCKS all user stories**
- **US1 (Phase 3)**: Depends on Foundational (T004) — verification only
- **US2 (Phase 4-5)**: Depends on Foundational (T004) + Setup (T001-T003)
- **US3 (Phase 6)**: Depends on US2 completion (needs AgentPanel + AgentPanelState)
- **Polish (Phase 7)**: Depends on US2 and US3 completion

### User Story Dependencies

- **User Story 1 (P1)**: Can verify immediately after T004 — no story-specific code needed
- **User Story 2 (P1)**: Can start after T004 — independent of US1; delivers Agent Panel + inline chip
- **User Story 3 (P2)**: Depends on US2 (requires AgentPanel drawer and AgentPanelState infrastructure)

### Within Each User Story

- CSS files before TSX components (styles referenced by components)
- AgentRow before AgentPanel (panel renders rows)
- Event subscriptions before mounting (state must exist before UI renders)
- Core panel before inline chip (panel must exist to be opened)

### Parallel Opportunities

- T002 and T003 can run in parallel (different CSS files, no dependencies)
- T006 can run in parallel with T002/T003 (different file types, no dependency) — but NOT with T007 which depends on T006
- T011 can run in parallel with any prior US3 task (CSS only)
- T014 and T015 can run in parallel (different component files)

---

## Parallel Example: User Story 2

```text
# Phase 1 (parallel CSS):
Task T002: Create agent-panel.css
Task T003: Create agent-row.css

# Phase 4 (after CSS):
Task T006: Create AgentRow component (parallel with T007 prep)
Task T007: Create AgentPanel drawer (depends on T006 for row rendering)
Task T008: Wire event subscriptions (depends on T007 for state store)
Task T009: Mount AgentPanel in chat-pane (depends on T007, T008)
Task T010: Extend tool.tsx with inline chip (depends on T007 for panel context)
```

---

## Implementation Strategy

### MVP First (US1 Verification + T004 Event Wiring)

1. Complete Phase 1: Setup (T001-T003)
2. Complete Phase 2: Foundational (T004 — event bridge)
3. Complete Phase 3: Verify US1 (T005 — plan approval dock works)
4. **STOP and VALIDATE**: Plan approval dock functional in web UI
5. This is the minimum viable increment — plan mode is unblocked

### Incremental Delivery

1. Setup + Foundational → Event bridge active (T001-T004)
2. Verify US1 → Plan approval dock works (T005) — **MVP shipped**
3. Add US2 → Agent Panel drawer + inline chips (T006-T010) — **Core agent experience**
4. Add US3 → Transcript viewer (T011-T013) — **Deep-dive capability**
5. Polish → Edge cases (T014-T019) — **Production hardening**

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- All backend event infrastructure is EXISTING — no core package modifications needed
- The `PlanApprovalDock` component and its event wiring in `chat-pane.tsx` are EXISTING — US1 is a verification-only phase
- The `agent.backgrounded` event referenced in spec FR-001 does NOT exist in the codebase. Background agents are identified via `isAsync: true` on `agent.spawned` and terminate via `agent.completed`
- MVP reference (`liteai_cli_mvp/src`) is absent from workspace — all designs grounded on actual codebase schemas (see research.md R-009)
