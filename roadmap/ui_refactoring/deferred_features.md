# Phase 2.5: Deferred Features & Technical Debt

Consolidated register of all features intentionally excluded or deferred during the Phase 2.5 component migration. Each entry includes the MVP/SolidJS source path for future re-analysis.

## New UI Features

Switch session (similar to Ctlr+R), without stopping the current session, so user can work on multiple sessions

---

## Deferred UI Features (Prompt Input System)

### 1. Autocomplete / Suggestions Panel
**MVP Sources:**
- [PromptInputFooterSuggestions.tsx](file:///C:/Users/aghassan/Documents/workspace/liteai_cli_mvp/components/PromptInput/PromptInputFooterSuggestions.tsx) — renders suggestion dropdown
- [useTypeahead.ts](file:///C:/Users/aghassan/Documents/workspace/liteai_cli_mvp/hooks/useTypeahead.ts) — typeahead logic
- [usePromptSuggestion.ts](file:///C:/Users/aghassan/Documents/workspace/liteai_cli_mvp/hooks/usePromptSuggestion.ts) — prompt suggestion service
- [commandSuggestions.ts](file:///C:/Users/aghassan/Documents/workspace/liteai_cli_mvp/utils/suggestions/commandSuggestions.ts) — slash command matching

**Why Deferred:** Requires autocomplete overlay rendering + fuzzy matching infrastructure. Separate sub-batch.
**Status:** Implemented in Phase 2.6.

---

### 2. Help Menu
**MVP Sources:**
- [PromptInputHelpMenu.tsx](file:///C:/Users/aghassan/Documents/workspace/liteai_cli_mvp/components/PromptInput/PromptInputHelpMenu.tsx) — `?` keybind help overlay

**Why Deferred:** Standalone overlay component, no dependencies on prompt input core logic.
**Status:** Implemented in Phase 2.5.

---

### 3. History Search (Ctrl+R)
**MVP Sources:**
- [useHistorySearch.ts](file:///C:/Users/aghassan/Documents/workspace/liteai_cli_mvp/hooks/useHistorySearch.ts) — fuzzy search through history
- [HistorySearchInput.tsx](file:///C:/Users/aghassan/Documents/workspace/liteai_cli_mvp/components/PromptInput/HistorySearchInput.tsx) — inline search input
- [HistorySearchDialog.tsx](file:///C:/Users/aghassan/Documents/workspace/liteai_cli_mvp/components/HistorySearchDialog.tsx) — fullscreen search dialog

**Why Deferred:** Basic up/down arrow history navigation is included. Interactive search is a UX enhancement.
**Status:** Implemented in Phase 2.6.

---

### 4. Stashed Prompt
**MVP Sources:**
- [PromptInputStashNotice.tsx](file:///C:/Users/aghassan/Documents/workspace/liteai_cli_mvp/components/PromptInput/PromptInputStashNotice.tsx) — stash notice display
- PromptInput.tsx lines ~140-150 (`stashedPrompt` prop)

**Why Deferred:** Niche feature for saving prompt state when switching views.

---

### 5. Queued Commands
**MVP Sources:**
- [PromptInputQueuedCommands.tsx](file:///C:/Users/aghassan/Documents/workspace/liteai_cli_mvp/components/PromptInput/PromptInputQueuedCommands.tsx) — queued command display
- [useCommandQueue.ts](file:///C:/Users/aghassan/Documents/workspace/liteai_cli_mvp/hooks/useCommandQueue.ts) — command queue management
- [messageQueueManager.ts](file:///C:/Users/aghassan/Documents/workspace/liteai_cli_mvp/utils/messageQueueManager.ts) — queue state

**Why Deferred:** Requires message queue infrastructure not yet ported.

---


### 7. Prompt Editor (External $EDITOR)
**MVP Sources:**
- [promptEditor.ts](file:///C:/Users/aghassan/Documents/workspace/liteai_cli_mvp/utils/promptEditor.ts) — open prompt in external editor

**Why Deferred:** Requires process spawning and terminal state management.

---

## Deferred Technical Debt (from Review Tracker)

### 13. Toast Positioning (Phase 2.4 m3)
**File:** `src/tui/ui/toast.tsx`
**Issue:** Toast renders inline with `marginTop={1}`, no absolute positioning. Spec says "position at bottom of terminal".
**Why Deferred:** Depends on layout architecture decisions in Phase 2.6.

---

## Deferred Core Changes

### 17. Permission Mode Cycling UI
The MVP's Shift+Tab permission mode cycling (`cyclePermissionMode`, `getNextPermissionMode`, `transitionPermissionMode`) is complex and interacts with:
- [getNextPermissionMode.ts](file:///C:/Users/aghassan/Documents/workspace/liteai_cli_mvp/utils/permissions/getNextPermissionMode.ts)
- [permissionSetup.ts](file:///C:/Users/aghassan/Documents/workspace/liteai_cli_mvp/utils/permissions/permissionSetup.ts)
- [AutoModeOptInDialog.tsx](file:///C:/Users/aghassan/Documents/workspace/liteai_cli_mvp/components/AutoModeOptInDialog.tsx)

**Initial port** will display the current mode (read-only). Cycling requires the core API extension described below.

### 18. Permission Mode Set via API
A new `permissionMode` field on `session.prompt()` or `session.update()` is needed in `packages/core`. Deferred to a focused core-change PR.


---

## Deferred Prompt Input Features (from prompt-input.tsx audit)

### 20. Footer Pill Navigation
**MVP Sources:**
- `PromptInputFooterLeftSide.tsx` — pill container layout, mode indicator, task/team/PR pills
- `PromptInputFooter.tsx` — footer orchestrator, `BridgeStatusIndicator`
- `TeamStatus.tsx` — team member status pill (runtime-gated via `isAgentSwarmsEnabled()`)
- `BackgroundTaskStatus` — running task pill (live, no gate)
- `PrBadge.tsx` — PR review status pill (runtime config-gated)
- `TungstenPill` — tmux session pill (compile-time dead: `"external" === 'ant'`)

**Why Deferred:** The pill container/layout and several pills (`TeamStatus`, `BackgroundTaskStatus`, `PrBadge`) are **live runtime code** in the MVP — not dead. `TungstenPill` and `BridgeStatusIndicator` are compile-time dead in external builds. Porting requires the backing infrastructure (Swarms/Teams in core, task system) to be available first.

---

### 21. Agent Color / Teammate View Routing
**MVP Sources:**
- `AgentColorIndicator` component
- `useAgentColor.ts` — per-agent color assignment
- Teammate-specific view routing in `PromptInput.tsx`

**Why Deferred:** Depends on multi-agent/teammate infrastructure (Agent Swarms excluded, Coordinator excluded). Single-agent mode has no need for color differentiation or view routing.

---

> [!NOTE]
> Permanently excluded features (MVP feature-flagged items that are **never** being ported) are documented separately in [excluded_features.md](file:///c:/Users/aghassan/Documents/workspace/liteai/roadmap/ui_refactoring/excluded_features.md).

---

## MVP → TUI Context Mapping Reference

| MVP Pattern | TUI Equivalent | Notes |
|---|---|---|
| `useAppState(s => s.X)` | `useSync().X` | Server-derived state |
| `useSetAppState()` | N/A (server mutations via SDK) | No direct client-side mutations |
| `useAppState(s => s.toolPermissionContext)` | `useSession().permissionMode` (proposed) | See #18 above |
| `useNotifications()` | `useToast()` | [toast.tsx](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/cli/src/tui/context/toast.tsx) |
| `useMainLoopModel()` | `useLocal().model.current()` | [local.tsx](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/cli/src/tui/context/local.tsx) |
| `useShortcutDisplay()` | `useKeybind()` | [keybind.tsx](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/cli/src/tui/context/keybind.tsx) |
| `useTerminalSize()` | `useStdout()` from `@liteai/ink` | Ink provides columns/rows |
| `getGlobalConfig()` | `useSync().config` | [sync.tsx](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/cli/src/tui/context/sync.tsx) |
| `useSettings()` | `useSync().config` | Config is the settings source |
