# Tasks: Message Rendering & Error Resilience

**Input**: Design documents from `specs/016-message-rendering/`

**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, quickstart.md ✅

**Tests**: Not explicitly requested — omitted per template rules.

**Organization**: Tasks grouped by user story. Bug fixes (US1) are prerequisites; rendering overhaul (US2, US6) is the core work; polish (US3, US4, US5) follows.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: New files and constants that all user stories depend on.

- [ ] T001 [P] Create tool status icon constants in `packages/cli/src/tui/constants/tool-status.ts` — define `PENDING_ICON` (○), `SUCCESS_ICON` (✓), `CONFIRMING_ICON` (?), `CANCELLED_ICON` (–), `ERROR_ICON` (✗) and `ToolDisplayStatus` enum (Pending, Executing, Success, Confirming, Cancelled, Error)
- [ ] T002 [P] Create display status mapper in `packages/cli/src/tui/utils/tool-display-status.ts` — implement `mapToolPartToDisplayStatus(part, permissions)` function that maps core 4-state (`pending`, `running`, `completed`, `error`) to display 6-state, deriving Confirming from permission request matching `callID`, and Cancelled from error messages containing "rejected permission" / "user dismissed" / "specified a rule"
- [ ] T003 [P] Create `ToolStatusIndicator` component in `packages/cli/src/tui/components/tool-status-indicator.tsx` — renders status icon with correct color per `ToolDisplayStatus` enum, uses Ink spinner for Executing state
- [ ] T004 [P] Create `ErrorMessage` component in `packages/cli/src/tui/components/error-message.tsx` — persistent `✗`-prefixed message rendered in conversation history with `theme.error` color
- [ ] T005 [P] Create `WarningMessage` component in `packages/cli/src/tui/components/warning-message.tsx` — persistent `⚠`-prefixed message rendered in conversation history with `theme.warning` color

**Checkpoint**: Foundation components exist but are not wired into the rendering pipeline yet.

---

## Phase 2: User Story 1 — Error-Free Session Interaction (Priority: P1) 🎯 MVP

**Goal**: Eliminate spurious errors ("X undefined", plan_enter model crash) and ensure clean session lifecycle.

**Independent Test**: Start a session, trigger plan mode + multiple tool calls, abort with Esc, type "continue" — verify no spurious errors, input clears correctly.

> **NOTE**: Bug 1 (plan_enter model resolution) was already fixed in the prerequisite commit. The remaining items are display-side error handling fixes.

### Implementation for User Story 1

- [ ] T006 [US1] Fix `onSessionError` error shape extraction in `packages/cli/src/tui/state/app-state-context.tsx` — change `err?.data?.message` to `err?.message ?? "Session encountered an error"` (FR-002, R3)
- [ ] T007 [US1] Fix thinking block collapse arrow in `packages/cli/src/tui/routes/session/parts.tsx` — change `▼` to `▶` for collapsed state (FR-007, R7)
- [ ] T008 [US1] Fix `todowrite` null render in `packages/cli/src/tui/routes/session/parts.tsx` — remove `return null` from the `todowrite` case so it falls through to the renderer (FR-016, R5)
- [ ] T009 [US1] Verify input clear after submission regardless of error state in `packages/cli/src/tui/components/prompt/` — ensure the submit handler clears unconditionally (FR-004, R6)

**Checkpoint**: Basic session interaction is error-free. No "X undefined" messages, plan mode works, thinking arrows correct.

---

## Phase 3: User Story 2 — Unified Tool Call Rendering (Priority: P2)

**Goal**: Replace 17 per-tool components (`InlineTool`/`BlockTool` primitives) with a single `DenseToolMessage` pattern adapted from Gemini CLI.

**Independent Test**: Trigger 5+ different tool types (Read, Write, Shell, Grep, Question) — verify ALL use the same `[status] [bold name] [muted description] → [result]` columnar layout.

### Implementation for User Story 2

- [ ] T010 [US2] Define `ViewParts` interface and `ToolFormatterRegistry` type in `packages/cli/src/tui/routes/session/tools.tsx` — `{ description, summary, payload }` as documented in data-model.md
- [ ] T011 [US2] Implement per-tool formatter functions in `packages/cli/src/tui/routes/session/tools.tsx` — one function per tool type (read, write, edit, glob, grep, list, webfetch, codesearch, websearch, run_command, command_status, send_command_input, apply_patch, task, ask_user, todowrite, skill, plan_enter, plan_exit, default) returning `ViewParts`
- [ ] T012 [US2] Implement `DenseToolMessage` component in `packages/cli/src/tui/routes/session/tools.tsx` — unified renderer consuming `ToolStatusIndicator` + `ViewParts` with fixed-width columns: status (3ch), tool name (bold, max 25ch), description (muted), `→` result summary, optional payload below
- [ ] T013 [US2] Rewrite `ToolPartView` dispatch in `packages/cli/src/tui/routes/session/parts.tsx` — replace the 17-case switch statement with: (1) call `mapToolPartToDisplayStatus`, (2) call formatter from registry, (3) render `DenseToolMessage`. Keep `ShellOutput` as the only specialized sub-view (payload for `run_command`)
- [ ] T014 [US2] Remove `InlineTool` and `BlockTool` primitives from `packages/cli/src/tui/routes/session/tools.tsx` — delete bordered-box rendering pattern entirely (FR-014). Preserve `ShellOutput` component (FR-018)

**Checkpoint**: All 17 tool types render through `DenseToolMessage`. No bordered boxes remain. Shell retains its scrollable sub-view.

---

## Phase 4: User Story 6 — Special Tool UX Consistency (Priority: P2)

**Goal**: Question, TodoWrite, Task, Plan tools render through the unified system with correct interactive behaviors.

**Independent Test**: (a) Trigger `ask_user` — Q&A renders in unified layout. (b) Use todos — checklist items visible. (c) Use plan mode — clean status feedback.

### Implementation for User Story 6

- [ ] T015 [US6] Implement `ask_user` formatter with completed-tool hiding in `packages/cli/src/tui/routes/session/tools.tsx` — pending: show `?` + question text; completed: hide description, show answer as result (FR-015, Gemini's `isCompletedAskUserTool` pattern)
- [ ] T016 [US6] Implement `todowrite` formatter with checklist payload in `packages/cli/src/tui/routes/session/tools.tsx` — render checklist items as payload beneath unified line, show "→ N items" summary (FR-016)
- [ ] T017 [US6] Implement `task` (subagent) formatter in `packages/cli/src/tui/routes/session/tools.tsx` — show spinner + delegation description + sub-toolcall count (FR-018 subagent variant)
- [ ] T018 [US6] Implement `plan_enter` / `plan_exit` formatters in `packages/cli/src/tui/routes/session/tools.tsx` — human-readable descriptions ("Entering plan mode", "Exiting plan mode") instead of GenericTool fallback with raw JSON (FR-017)
- [ ] T019 [US6] Implement `run_command` unified header with `ShellOutput` payload in `packages/cli/src/tui/routes/session/tools.tsx` — status indicator header row + existing `ShellOutput` component as payload (FR-018)

**Checkpoint**: All special tools render recognizably. Question shows answers, todos show checklists, plan shows clean descriptions.

---

## Phase 5: User Story 3 — Thinking Block Display (Priority: P3)

**Goal**: Collapsible thinking blocks with left-border when expanded, `▶` when collapsed, deduplication across boundaries.

**Independent Test**: Trigger reasoning output — collapsed shows `▶ Thinking (N tokens)`, expanded shows left-bordered indented block.

### Implementation for User Story 3

- [ ] T020 [US3] Update thinking block expanded view in `packages/cli/src/tui/routes/session/parts.tsx` — add left vertical border (`│`) when expanded, bold subject line, muted body text (FR-007)
- [ ] T021 [US3] Verify thinking deduplication in `packages/cli/src/tui/routes/session/parts.tsx` — ensure dedup filter works across message boundaries (FR-008)

**Checkpoint**: Thinking blocks are visually distinct and correctly collapsed/expanded.

---

## Phase 6: User Story 4 — Ephemeral Toast & Persistent Error Display (Priority: P3)

**Goal**: Two-channel notification system — inline text toast (3s, no borders) for input feedback, persistent `ErrorMessage`/`WarningMessage` in history for session errors.

**Independent Test**: (a) Press Esc once — inline text toast in footer, no boxes, auto-dismisses. (b) Trigger session error — `✗` prefixed message in history, persists.

### Implementation for User Story 4

- [ ] T022 [US4] Modify toast context to enforce single-toast in `packages/cli/src/tui/context/toast.tsx` — most recent replaces previous, no stacking (FR-009)
- [ ] T023 [US4] Modify toast renderer to remove borders in `packages/cli/src/tui/ui/toast.tsx` — inline `<Text color={variantColor}>{icon} {message}</Text>`, no `<Box borderStyle>`, no overlays (FR-009)
- [ ] T024 [US4] Wire `ErrorMessage` component into session error flow in `packages/cli/src/tui/routes/session/message.tsx` — session errors rendered as persistent entries with `✗` prefix (FR-013)
- [ ] T025 [US4] Wire `WarningMessage` component into session warning flow in `packages/cli/src/tui/routes/session/message.tsx` — warnings rendered with `⚠` prefix (FR-013)

**Checkpoint**: Toast is inline text. Session errors/warnings are persistent in history.

---

## Phase 7: User Story 5 — Clean Status Line (Priority: P3)

**Goal**: Status line shows only model display name, no error text leaks into columns.

**Independent Test**: Start session — status line shows "gemini-3.5-flash" only. Trigger error — no error in status columns.

### Implementation for User Story 5

- [ ] T026 [US5] Clean model display name in `packages/cli/src/tui/components/status-line.tsx` — strip agent/provider prefix if present, show only model name (FR-010, R9)
- [ ] T027 [US5] Prevent error text leak in `packages/cli/src/tui/components/status-line.tsx` — guard status column values against error data (FR-011)

**Checkpoint**: Status line is clean and informational.

---

## Phase 8: User Story 2 (Continued) — Collapsed Tool Groups (Priority: P2)

**Goal**: Collapsed tool groups show grouped status indicators and summary counts.

**Independent Test**: Trigger 5+ tool calls that collapse into a group — verify grouped `✓✓✓` status indicators + "3 tools" summary.

### Implementation for Collapsed Groups

- [ ] T028 [US2] Update `collapsed-group-view.tsx` to use `ToolStatusIndicator` in `packages/cli/src/tui/components/collapsed-group-view.tsx` — replace raw text with grouped status indicators and summary count (FR-012)

**Checkpoint**: Collapsed groups show visual status indicators instead of raw text.

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Final verification, cleanup, and typecheck/lint compliance.

- [ ] T029 Run `bun typecheck 2>&1 | Out-String` in `packages/core` and `packages/cli` — fix any type errors
- [ ] T030 Run `bun lint:fix` across workspace — fix formatting
- [ ] T031 Run quickstart.md manual verification — trigger 5+ tool types in TUI, verify unified rendering
- [ ] T032 Remove dead code — delete any remaining `InlineTool`/`BlockTool` imports and unused per-tool component exports
- [ ] T033 Update spec status from "Draft" to "Complete" in `specs/016-message-rendering/spec.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — all tasks [P] parallelizable
- **Phase 2 (US1 Bug Fixes)**: Can start after Phase 1 — small targeted fixes
- **Phase 3 (US2 Unified Rendering)**: Depends on Phase 1 (needs `ToolStatusIndicator`, `ToolDisplayStatus`) — the **core** work
- **Phase 4 (US6 Special Tools)**: Depends on Phase 3 (DenseToolMessage must exist)
- **Phase 5 (US3 Thinking)**: Independent of Phases 3-4 — only touches `parts.tsx` thinking section
- **Phase 6 (US4 Toast/Errors)**: Independent of Phases 3-4 — separate toast/error rendering
- **Phase 7 (US5 Status Line)**: Independent — touches `status-line.tsx` only
- **Phase 8 (US2 Groups)**: Depends on Phase 3 (needs `ToolStatusIndicator`)
- **Phase 9 (Polish)**: Depends on all prior phases

### Optimal Execution Order

```
Phase 1 (Setup) ────────────────────────────────┐
                                                 │
Phase 2 (US1 Bug Fixes) ──── can run parallel ───┤
                                                 │
Phase 3 (US2 Unified Rendering) ─────────────────┤
                                                 │
Phase 4 (US6 Special Tools) ─── after Phase 3 ───┤
                                                 │
Phase 5 (US3 Thinking) ──── parallel w/ 3-4 ─────┤
Phase 6 (US4 Toast/Errors) ── parallel w/ 3-4 ───┤
Phase 7 (US5 Status Line) ── parallel w/ 3-4 ────┤
                                                 │
Phase 8 (US2 Groups) ────── after Phase 3 ───────┤
                                                 │
Phase 9 (Polish) ────────── after all ────────────┘
```

### Parallel Opportunities

```bash
# Phase 1 — all 5 tasks in parallel:
T001: tool-status.ts
T002: tool-display-status.ts
T003: tool-status-indicator.tsx
T004: error-message.tsx
T005: warning-message.tsx

# Phases 2, 5, 6, 7 — independent of Phase 3, can run in parallel:
T006-T009: Bug fixes (US1)
T020-T021: Thinking blocks (US3)
T022-T025: Toast/Errors (US4)
T026-T027: Status line (US5)
```

---

## Implementation Strategy

### MVP First (Phase 1 + Phase 2 + Phase 3)

1. Complete Phase 1: Foundation components (T001-T005)
2. Complete Phase 2: Bug fixes (T006-T009) — immediately testable
3. Complete Phase 3: DenseToolMessage rewrite (T010-T014) — the core deliverable
4. **STOP and VALIDATE**: Run TUI, trigger 5+ tool types, verify unified rendering
5. Commit as working MVP

### Incremental Delivery

1. MVP above → unified rendering works
2. Add Phase 4 (Special tools) → Question, Todo, Task, Plan correct
3. Add Phases 5-7 (Polish) → Thinking, Toast, Status clean
4. Add Phase 8 (Groups) → Collapsed groups with indicators
5. Phase 9 (Final verification) → Ship

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Bug 1 (plan_enter model resolution) already fixed in prerequisite commit — T006-T009 cover remaining display bugs
- `ShellOutput` component is preserved as the ONLY tool-specific sub-view (FR-018)
- `run_command` still gets `ShellOutput` as its payload — the header row just uses `DenseToolMessage`
- All `InlineTool`/`BlockTool` imports must be removed in T032
