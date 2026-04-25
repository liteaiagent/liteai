# Sub-batch 3.4: Deferred Features & MVP References

Features intentionally excluded from the basic PromptInput migration. Each entry includes the MVP source path for future re-analysis.

---

## Deferred UI Features

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

**Why Deferred:** `useLocal().model.cycle()` already exists. Picker dialog is a separate overlay.

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

## Deferred Feature-Flagged Features (Permanently Excluded)

These are **never** being ported. Listed for completeness.

| Feature | MVP Source | Reason |
|---|---|---|
| Voice Mode | `hooks/useVoiceEnabled.ts`, `context/voice.ts`, `VoiceIndicator.tsx` | `feature('VOICE_MODE')` |
| Coordinator Mode | `coordinator/coordinatorMode.ts`, `CoordinatorAgentStatus.tsx` | `feature('COORDINATOR_MODE')` |
| Bridge Mode | `bridge/`, `BridgeDialog.tsx`, `BridgeStatusIndicator` | `feature('BRIDGE_MODE')` |
| Proactive/Kairos | `proactive/index.ts`, `ProactiveCountdown` | `feature('PROACTIVE')` / `feature('KAIROS')` |
| Transcript Classifier (auto mode) | `utils/permissions/PermissionMode.ts` line 80-90 | `feature('TRANSCRIPT_CLASSIFIER')` |
| Native Clipboard Image | `utils/imagePaste.ts` lines 101-116 | `feature('NATIVE_CLIPBOARD_IMAGE')` |
| Agent Swarms | `utils/agentSwarmsEnabled.ts`, `TeamStatus.tsx`, `TeamsDialog.tsx` | `isAgentSwarmsEnabled()` |
| Tungsten/Tmux | `TungstenPill`, tmux session state | `"external" === 'ant'` |
| PR Badge | `PrBadge.tsx`, `usePrStatus.ts` | `isPrStatusEnabled()` |
| Undercover mode | `utils/undercover.ts` | Ant-internal |
| Auto-updater | `utils/autoUpdater.ts`, `AutoUpdaterWrapper.tsx` | MVP auto-update system |
| IDE integration | `IdeStatusIndicator.tsx`, `useIdeAtMentioned.ts` | MVP IDE coupling |
| GrowthBook feature flags | `services/analytics/growthbook.ts` | MVP analytics |

---

## Deferred Core Changes

### Permission Mode Cycling UI
The MVP's Shift+Tab permission mode cycling (`cyclePermissionMode`, `getNextPermissionMode`, `transitionPermissionMode`) is complex and interacts with:
- [getNextPermissionMode.ts](file:///C:/Users/aghassan/Documents/workspace/liteai_cli_mvp/utils/permissions/getNextPermissionMode.ts)
- [permissionSetup.ts](file:///C:/Users/aghassan/Documents/workspace/liteai_cli_mvp/utils/permissions/permissionSetup.ts)
- [AutoModeOptInDialog.tsx](file:///C:/Users/aghassan/Documents/workspace/liteai_cli_mvp/components/AutoModeOptInDialog.tsx)

**Initial port** will display the current mode (read-only). Cycling requires the core API extension described in the implementation plan.

### Permission Mode Set via API
See implementation plan Q3 — a new `permissionMode` field on `session.prompt()` or `session.update()` is needed in `packages/core`. Deferred to a focused core-change PR.

---

## MVP → TUI Context Mapping Reference

| MVP Pattern | TUI Equivalent | Notes |
|---|---|---|
| `useAppState(s => s.X)` | `useSync().X` | Server-derived state |
| `useSetAppState()` | N/A (server mutations via SDK) | No direct client-side mutations |
| `useAppState(s => s.toolPermissionContext)` | `useSession().permissionMode` (proposed) | See Q3 in plan |
| `useNotifications()` | `useToast()` | [toast.tsx](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/cli/src/tui/context/toast.tsx) |
| `useMainLoopModel()` | `useLocal().model.current()` | [local.tsx](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/cli/src/tui/context/local.tsx) |
| `useShortcutDisplay()` | `useKeybind()` | [keybind.tsx](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/cli/src/tui/context/keybind.tsx) |
| `useTerminalSize()` | `useStdout()` from `@liteai/ink` | Ink provides columns/rows |
| `getGlobalConfig()` | `useSync().config` | [sync.tsx](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/cli/src/tui/context/sync.tsx) |
| `useSettings()` | `useSync().config` | Config is the settings source |
