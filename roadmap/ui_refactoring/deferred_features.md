# Phase 2.5: Deferred Features & Technical Debt

Consolidated register of all features intentionally excluded or deferred during the Phase 2.5 component migration. Each entry includes the MVP/SolidJS source path for future re-analysis.

---

## Deferred UI Features (Prompt Input System)

### 1. Autocomplete / Suggestions Panel
**MVP Sources:**
- [PromptInputFooterSuggestions.tsx](file:///C:/Users/aghassan/Documents/workspace/liteai_cli_mvp/components/PromptInput/PromptInputFooterSuggestions.tsx) — renders suggestion dropdown
- [useTypeahead.ts](file:///C:/Users/aghassan/Documents/workspace/liteai_cli_mvp/hooks/useTypeahead.ts) — typeahead logic
- [usePromptSuggestion.ts](file:///C:/Users/aghassan/Documents/workspace/liteai_cli_mvp/hooks/usePromptSuggestion.ts) — prompt suggestion service
- [commandSuggestions.ts](file:///C:/Users/aghassan/Documents/workspace/liteai_cli_mvp/utils/suggestions/commandSuggestions.ts) — slash command matching

**Why Deferred:** Requires autocomplete overlay rendering + fuzzy matching infrastructure. Separate sub-batch.

---

### 2. Help Menu
**MVP Sources:**
- [PromptInputHelpMenu.tsx](file:///C:/Users/aghassan/Documents/workspace/liteai_cli_mvp/components/PromptInput/PromptInputHelpMenu.tsx) — `?` keybind help overlay

**Why Deferred:** Standalone overlay component, no dependencies on prompt input core logic.

---

### 3. History Search (Ctrl+R)
**MVP Sources:**
- [useHistorySearch.ts](file:///C:/Users/aghassan/Documents/workspace/liteai_cli_mvp/hooks/useHistorySearch.ts) — fuzzy search through history
- [HistorySearchInput.tsx](file:///C:/Users/aghassan/Documents/workspace/liteai_cli_mvp/components/PromptInput/HistorySearchInput.tsx) — inline search input
- [HistorySearchDialog.tsx](file:///C:/Users/aghassan/Documents/workspace/liteai_cli_mvp/components/HistorySearchDialog.tsx) — fullscreen search dialog

**Why Deferred:** Basic up/down arrow history navigation is included. Interactive search is a UX enhancement.

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

### 6. Model Picker / Fast Mode Picker
**MVP Sources:**
- [ModelPicker.tsx](file:///C:/Users/aghassan/Documents/workspace/liteai_cli_mvp/components/ModelPicker.tsx) — model selection dialog
- [FastModePicker.tsx](file:///C:/Users/aghassan/Documents/workspace/liteai_cli_mvp/commands/fast/fast.tsx) — fast mode toggle
- [fastMode.ts](file:///C:/Users/aghassan/Documents/workspace/liteai_cli_mvp/utils/fastMode.ts) — fast mode state

**Why Deferred:** `useLocal().model.cycle()` already exists. Picker dialog is a separate overlay. **Note:** ModelPicker is being ported in Batch 4 using the SolidJS `dialog-model.tsx` as the primary reference.

---

### 7. Prompt Editor (External $EDITOR)
**MVP Sources:**
- [promptEditor.ts](file:///C:/Users/aghassan/Documents/workspace/liteai_cli_mvp/utils/promptEditor.ts) — open prompt in external editor

**Why Deferred:** Requires process spawning and terminal state management.

---

### 8. Text Highlighting (Slash Commands, @mentions, Chips)
**MVP Sources:**
- [textHighlighting.ts](file:///C:/Users/aghassan/Documents/workspace/liteai_cli_mvp/utils/textHighlighting.ts) — highlight spans
- [findSlashCommandPositions](file:///C:/Users/aghassan/Documents/workspace/liteai_cli_mvp/utils/suggestions/commandSuggestions.ts) — slash command detection
- Image pill rendering in PromptInput.tsx lines ~1700-1900

**Why Deferred:** The basic TextInput renders plain text. Syntax highlighting requires highlight spans + custom rendering.

---

## Deferred Technical Debt (from Review Tracker)

### 9. Multi-Toast Stacking (Phase 2.4 C3)
**File:** `src/tui/context/toast.tsx`, `src/tui/ui/toast.tsx`
**Issue:** Spec requires multi-toast stacking; implementation only supports single `currentToast: T | null`.
**Why Deferred:** Moderate scope. Current single-toast is functional for MVP.

---

### 10. FuzzyPicker — No Actual Fuzzy Matching (Phase 2.4 M1)
**File:** `src/tui/ui/fuzzy-picker.tsx`
**Issue:** Despite name, no fuzzy matching algorithm. All filtering delegated to consumers via `onQueryChange`. No match highlights, no category grouping.
**Why Deferred:** Larger scope, requires `fuzzysort` integration or equivalent.

---

### 11. DialogSelect Search Non-Functional (Phase 2.4 M2)
**File:** `src/tui/ui/dialog-select.tsx`
**Issue:** Search box renders but `onQueryChange` is a no-op — typing does nothing. Dependent on M1 (fuzzy matching).
**Why Deferred:** Blocked on #10 (fuzzy matching).

---

### 12. DialogHelp Static Stub (Phase 2.4 m2)
**File:** `src/tui/ui/dialog-help.tsx`
**Issue:** Static stub — hardcoded help text, doesn't list keybindings dynamically. `onCancel` is no-op.
**Why Deferred:** Phase 2.5+ scope.

---

### 13. Toast Positioning (Phase 2.4 m3)
**File:** `src/tui/ui/toast.tsx`
**Issue:** Toast renders inline with `marginTop={1}`, no absolute positioning. Spec says "position at bottom of terminal".
**Why Deferred:** Depends on layout architecture decisions in Phase 2.6.

---

### 14. FuzzyPicker Callback Memoization Risk (Phase 2.5 F1/F2)
**File:** `src/tui/ui/fuzzy-picker.tsx` L115-127
**Issue:** `useEffect` includes `onQueryChange` and `onFocus` in deps. If consumer doesn't memoize callbacks, triggers infinite re-render loop.
**Why Deferred:** Requires either stable callback contract in docs or internal `useRef` stabilization.

---

### 15. Markdown Table wrapText Stub (Phase 2.5 Batch 2 M2)
**File:** `src/tui/components/markdown-table.tsx` L43-57
**Issue:** `wrapText` function is a stub — accepts `hard` option but ignores it. Tables with long cell content won't wrap. Original MVP used `wrapAnsi()`.
**Why Deferred:** Needs dependency evaluation (`wrapAnsi` availability). `wrapAnsi` is exported from `@liteai/ink`.

---

### 16. Diff Cache Unbounded (Phase 2.5 Batch 2 M3)
**File:** `src/tui/components/structured-diff.tsx` L17-28
**Issue:** `diffCache` is an unbounded `Map<string, Map<...>>` with no eviction policy. Long sessions will leak memory.
**Why Deferred:** Pre-existing MVP pattern, not a regression.

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

### 19. Prompt Suggestion / Speculation
**MVP Sources:**
- `usePromptSuggestion.ts` — prompt speculation/completion logic
- Inline suggestion rendering in `PromptInput.tsx`

**Why Deferred:** Distinct from autocomplete (#1). Speculation renders greyed-out predicted text ahead of cursor. Requires streaming suggestion source + custom text rendering.

---

### 20. Footer Pill Navigation
**MVP Sources:**
- Footer pills in `PromptInput.tsx` (tasks indicator, teams status, bridge pill, tmux pill)
- `TungstenPill`, `TeamStatus`, `BridgeStatusIndicator` components

**Why Deferred:** Individual features behind the pills are either permanently excluded (bridge, tmux, swarms — see `excluded_features.md`) or not yet relevant. The pill container/layout pattern may be reused when new footer indicators are needed.

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
