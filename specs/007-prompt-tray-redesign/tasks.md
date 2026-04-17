---

description: "Task list for prompt-tray-redesign feature implementation"
---

# Tasks: prompt-tray-redesign

**Input**: Design documents from `specs/007-prompt-tray-redesign/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

*(No additional project setup requested - existing workspace is used)*

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [ ] T001 Update TypeScript definitions for `SessionConfig` by defining the new fields `sessionMode`, `toolProfile`, `forkEnabled` inline in the inferred Drizzle schema types in `packages/core/src/session/session.sql.ts`.
- [ ] T002 Extend `SessionTable` schema fields to store `session_mode`, `tool_profile`, `fork_enabled` in `packages/core/src/session/session.sql.ts`

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Configure Root Agent (Priority: P1) 🎯 MVP

**Goal**: Select the root agent from a list of available agents.

**Independent Test**: Can be tested by opening the Agent Selector dropdown and verifying that available primary agents (e.g., "LiteAI") are listed and selectable.

### Implementation for User Story 1

- [ ] T003 [P] [US1] Remove the `plan` agent reference from `packages/web/src/components/settings-agents.tsx` and rename `build` display to "LiteAI"
- [ ] T004 [US1] Redesign the agent selection UI in `packages/ui/src/panes/chat/chat-prompt-input.tsx` to list custom `mode: primary` agents and exclude `plan`

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently

---

## Phase 4: User Story 2 - Toggle Tool Profile (Priority: P1)

**Goal**: Switch between "Plan" and "Fast" tool profiles to control agent strategy.

**Independent Test**: Can be tested by selecting "Fast" and verifying the agent executes without proposing plan mode.

### Implementation for User Story 2

- [ ] T005 [P] [US2] Implement dynamic exclusion of `EnterPlanModeTool`, `ExitPlanModeV2Tool`, and `Explore`/`Plan` proxy agents depending on whether the active `toolProfile` is "Fast" in `packages/core/src/tool/registry.ts`
- [ ] T006 [P] [US2] Update `packages/core/src/session/engine/query.ts` to pass the active session's `toolProfile` state from DB into the tool registry resolution
- [ ] T007 [P] [US2] Create standalone `tool-profile-selector.tsx` component in `packages/ui/src/panes/chat/tool-profile-selector.tsx`
- [ ] T008 [US2] Integrate `tool-profile-selector.tsx` into `packages/ui/src/panes/chat/chat-prompt-input.tsx`

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently

---

## Phase 5: User Story 3 - Enable Subagent Forking (Priority: P2)

**Goal**: Toggle "Fork" optimization on or off to control spawning efficiency.

**Independent Test**: Can be tested by toggling Fork and validating the updated config state saves.

### Implementation for User Story 3

- [ ] T009 [P] [US3] Create a standalone fork toggle button component in `packages/ui/src/panes/chat/fork-toggle.tsx`
- [ ] T010 [US3] Integrate `fork-toggle.tsx` into `packages/ui/src/panes/chat/chat-prompt-input.tsx`, map it to `forkEnabled` session state, and add a reactive dependency on `sessionMode` to disable and gray out the fork toggle when a mutually exclusive mode (like Coordinator) is active.

**Checkpoint**: All user stories up to P2 should now be independently functional

---

## Phase 6: User Story 4 - Future Session Modes Discoverability (Priority: P3)

**Goal**: Display disabled placeholder options for future session modes (Coordinator, Swarm).

**Independent Test**: Can be tested by inspecting the Session Mode dropdown and hovering over the disabled items.

### Implementation for User Story 4

- [ ] T011 [P] [US4] Create session mode dropdown list in `packages/ui/src/panes/chat/session-mode-selector.tsx` explicitly disabling `Coordinator` and `Swarm`
- [ ] T012 [US4] Integrate `session-mode-selector.tsx` into `packages/ui/src/panes/chat/chat-prompt-input.tsx`

### Implementation for Engine Integration (Edge Cases)
- [ ] T013 [US2] Add reactivity in the session UI or routing engine hook to ensure that toggling the Tool Profile mid-session immediately updates the injected tool pool for the *next* outgoing message without requiring a hard reload.

**Checkpoint**: All user stories should now be independently functional

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3+)**: All depend on Foundational phase completion
  - User stories can then proceed in parallel
  - Or sequentially in priority order (P1 → P1 → P2 → P3)

### User Story Dependencies

- **US1 (P1)**: Can start after Foundational
- **US2 (P1)**: Can start after Foundational
- **US3 (P2)**: Can start after Foundational
- **US4 (P3)**: Can start after Foundational

### Parallel Opportunities

- Foundational tasks can be done together or split.
- `tool-profile-selector.tsx`, `fork-toggle.tsx`, and `session-mode-selector.tsx` UI components can be built in parallel.
- Tool exclusion logic in Core can be built alongside the UI components.

---

## Parallel Example: User Stories 2, 3 and 4

```bash
# Launch generic component building
Task: "[US2] Create standalone tool-profile-selector.tsx component..."
Task: "[US3] Create a standalone fork toggle button component..."
Task: "[US4] Create session mode dropdown list..."

# Build engine modifications in parallel with UI
Task: "[US2] Implement dynamic exclusion of EnterPlanModeTool..."
```

---

## Implementation Strategy

### Incremental Delivery

1. Complete Setup + Foundational (Database schemas ready)
2. Complete US1 (Replaces existing dropdown with exact MVP requirement)
3. Complete US2 (Backend constraints + UI)
4. Add US3 (Optimization switch)
5. Add US4 (Placeholders for future work)
