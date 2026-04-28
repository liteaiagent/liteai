# CLI UI Feature Gap Analysis

**LiteAI CLI** (`packages/cli`) vs **Reference MVP** (`liteai_cli_mvp`)

> [!NOTE]
> This analysis covers **UI/TUI features only** — components, screens, hooks, keybindings, dialogs, and design system elements. Backend tools and non-UI logic are noted but not deeply analyzed.

---

## Executive Summary

| Metric | LiteAI CLI | Reference MVP |
|---|---|---|
| TUI Components | ~31 files | ~144 files (113 top-level + 31 subdirs) |
| TUI Hooks | 10 | 83 |
| Slash Commands | ~15 (dialogs) | ~100+ (commands/) |
| Keybinding Contexts | Basic | 16 contexts, 100+ bindings |
| Design System Elements | 12 | 16 + ThemeProvider + color system |
| Screens | 2 (home, session) | 3 (REPL, Doctor, ResumeConversation) |
| Tools (model-facing) | N/A (delegated to core) | 40+ built-in tool UIs |

---

## 1. Components — Missing Entirely

### 🔴 Critical (Core UX)

| Component | Description | MVP File(s) |
|---|---|---|
| **FullscreenLayout** | Alternate-screen layout with ScrollBox, sticky headers, modal overlays, "N new messages" pill | `FullscreenLayout.tsx` (637 lines) |
| **VirtualMessageList** | Virtualized scroll for large message histories with sticky prompt tracking | `VirtualMessageList.tsx` (44k) |
| **ScrollKeybindingHandler** | Mouse tracking, drag-to-select, copy-on-select, page up/down, ctrl+home/end | `ScrollKeybindingHandler.tsx` (47k) |
| **Messages (full)** | Rich message rendering with tool output, attachments, progress indicators | `Messages.tsx` (42k) |
| **Message (full)** | Individual message with model badge, timestamp, thinking toggle | `Message.tsx` (24k) |
| **MessageRow** | Row-level rendering with hover actions, selection state | `MessageRow.tsx` (14k) |
| **PromptInput (full)** | 99k-line prompt with autocomplete, suggestions overlay, stash, queued commands, voice indicator, mode cycling | `PromptInput/` (21 files) |
| **Spinner (rich)** | Animated spinner with shimmer, glimmer, stalled detection, teammate tree visualization | `Spinner/` (12 files) |
| **StatusLine** | Customizable status bar with model, context %, cost, vim mode, agent info | `StatusLine.tsx` (324 lines) |

### 🟡 Important (Feature Completeness)

| Component | Description | MVP File(s) |
|---|---|---|
| **ContextVisualization** | Token usage grid, category breakdown, MCP tools, memory files, skills, suggestions | `ContextVisualization.tsx` (489 lines) |
| **Stats** | Session analytics with heatmap, model usage charts, streaks, date range cycling | `Stats.tsx` (1228 lines) |
| **ModelPicker** | Model selection with effort cycling, search | `ModelPicker.tsx` (15k) |
| **ThemePicker** | Theme selection with syntax highlighting toggle | `ThemePicker.tsx` (10k) |
| **Feedback** | Feedback submission with thumbs up/down, transcript sharing | `Feedback.tsx` (24k) |
| **FeedbackSurvey** | Post-session surveys, memory surveys, post-compact surveys | `FeedbackSurvey/` (9 files) |
| **LogSelector** | Log/transcript viewer with filtering and navigation | `LogSelector.tsx` (55k) |
| **MessageSelector** | Rewind dialog — navigate and select specific messages | `MessageSelector.tsx` (30k) |
| **FileEditToolDiff** | Inline diff rendering for file edit tool results | `FileEditToolDiff.tsx` + related |
| **TokenWarning** | Context window exhaustion warnings | `TokenWarning.tsx` (5.7k) |
| **CompactSummary** | Summary display after auto-compaction | `CompactSummary.tsx` (3.8k) |
| **TaskListV2** | Todo/task list rendering with status icons | `TaskListV2.tsx` (12k) |

### 🟢 Nice-to-Have (Polish)

| Component | Description | MVP File(s) |
|---|---|---|
| **AutoUpdater** | In-app update notifications with native/package-manager variants | `AutoUpdater.tsx`, `NativeAutoUpdater.tsx`, `PackageManagerAutoUpdater.tsx` |
| **Onboarding** | First-run onboarding flow | `Onboarding.tsx` (8.3k) |
| **LogoV2** | Animated logo with channels notice, welcome screen, feed columns | `LogoV2/` (15 files) |
| **DesktopHandoff** | Desktop app integration prompt | `DesktopHandoff.tsx` (5.5k) |
| **RemoteCallout** | Remote session indicators | `RemoteCallout.tsx` (2.6k) |
| **IdeStatusIndicator** | IDE connection status | `IdeStatusIndicator.tsx` (1.7k) |
| **MemoryUsageIndicator** | Process memory display | `MemoryUsageIndicator.tsx` (1.2k) |
| **PrBadge** | Pull request status badge | `PrBadge.tsx` (2.1k) |
| **ClickableImageRef** | Clickable image references in output | `ClickableImageRef.tsx` (2.1k) |
| **EffortCallout** | Effort level display and adjustment | `EffortCallout.tsx` (7.1k) |
| **ThinkingToggle** | Toggle extended thinking visibility | `ThinkingToggle.tsx` (5.1k) |
| **SessionPreview** | Session preview card for session list | `SessionPreview.tsx` (5.4k) |
| **SessionBackgroundHint** | Background session indicator | `SessionBackgroundHint.tsx` (3.4k) |

---

## 2. Component Subdirectory Features — Missing

| Feature Area | MVP Components | LiteAI Status |
|---|---|---|
| **Agents UI** | `AgentsList`, `AgentDetail`, `AgentEditor`, `ColorPicker`, `ModelSelector`, `ToolSelector`, agent generation | ❌ Missing entirely |
| **Tasks/Background** | `BackgroundTasksDialog`, `BackgroundTaskStatus`, `AsyncAgentDetailDialog`, `DreamDetailDialog`, `ShellDetailDialog`, `RemoteSessionDetailDialog` | ❌ Missing entirely |
| **Permissions** | 15+ permission request components (Bash, FileEdit, FileWrite, Sandbox, PowerShell, Notebook, Skill, WebFetch, etc.) + `PermissionExplanation`, `PermissionDecisionDebugInfo` | ✅ Basic (`permission.tsx`, `question.tsx`) |
| **MCP Management** | `MCPListPanel`, `MCPSettings`, `MCPToolDetailView`, `MCPToolListView`, `MCPReconnect`, `ElicitationDialog`, `MCPAgentServerMenu`, `MCPRemoteServerMenu`, `MCPStdioServerMenu` | ✅ Basic (`dialog-mcp.tsx`) |
| **Diff Viewer** | `DiffDialog`, `DiffDetailView`, `DiffFileList` — full diff navigation with file list, source switching | ✅ Basic (`structured-diff.tsx`) |
| **Help System** | `HelpV2` with tabbed General + Commands views | ❌ Missing |
| **Memory** | `MemoryFileSelector`, `MemoryUpdateNotification` | ❌ Missing |
| **Shell Output** | `ShellProgressMessage`, `ShellTimeDisplay`, `OutputLine`, `ExpandShellOutputContext` | ❌ Missing |
| **Skills UI** | `SkillsMenu` — skill browsing and management | ✅ Basic (`dialog-skill.tsx`) |
| **Teams** | `TeamsDialog`, `TeamStatus` | ❌ Missing |
| **Sandbox** | `SandboxSettings` with Config, Dependencies, Overrides, Doctor tabs | ❌ Missing |
| **Wizard** | Wizard framework with `WizardProvider`, `WizardDialogLayout`, `WizardNavigationFooter` | ❌ Missing |
| **Custom Select** | Reusable multi-select with search | ❌ Missing |

---

## 3. Design System Gaps

| Element | MVP | LiteAI |
|---|---|---|
| `ThemeProvider` | ✅ Full theme context with runtime switching | ❌ Missing |
| `Dialog` | ✅ Generic dialog frame component | ❌ Missing (inline in each dialog) |
| `FuzzyPicker` | ✅ Fuzzy-search list selector | ❌ Missing |
| `color.ts` | ✅ Color utilities | ❌ Missing |

---

## 4. Hooks — Missing

### Critical Hooks (48 missing)

| Hook | Purpose |
|---|---|
| `useVoice` / `useVoiceIntegration` | Voice input/output (45k + 31k lines) |
| `useTypeahead` | Autocomplete with fuzzy matching (61k) |
| `useReplBridge` | REPL-backend bridge communication (35k) |
| `useVirtualScroll` (full) | Virtualized scrolling with sticky detection (35k) |
| `useInboxPoller` | Background task inbox polling (34k) |
| `useRemoteSession` | SSH/remote session management (23k) |
| `useTextInput` (full) | Rich text input with undo, clipboard, selection (17k) |
| `useManagePlugins` | Plugin lifecycle management (11k) |
| `useSearchInput` | Search-mode input handling (10k) |
| `usePasteHandler` (full) | Multi-format paste handling including images (10k) |
| `useCancelRequest` | Request cancellation with state machine (10k) |
| `useCanUseTool` | Tool permission resolution (9.6k) |
| `useGlobalKeybindings` | Global keyboard shortcut handling (9.3k) |
| `useArrowKeyHistory` (full) | Arrow-key command history navigation (9.5k) |
| `useHistorySearch` (full) | Ctrl+R history search (9.4k) |
| `useAssistantHistory` | Assistant conversation history (9.2k) |
| `useVimInput` (full) | Full vim mode with motions, operators, text objects (9.7k) |
| `useDiffInIDE` | Open diffs in IDE (9.8k) |
| `useBackgroundTaskNavigation` | Navigate between background tasks (8.5k) |
| `useTasksV2` | Task list management (8.8k) |
| `useSSHSession` | SSH session handling (8.3k) |
| `useDirectConnect` | Direct connect session (7.5k) |
| `useTurnDiffs` | Per-turn diff tracking (6.6k) |
| `useTaskListWatcher` | File-based task list watching (6.8k) |
| `useScheduledTasks` | Cron-like scheduled tasks (5.9k) |
| `useLogMessages` | Structured log message handling (5.7k) |
| `usePromptSuggestion` | AI-powered prompt suggestions (5.3k) |
| `useSessionBackgrounding` | Session background/foreground switching (4.9k) |
| `useClipboardImageHint` | Clipboard image detection (2.4k) |
| `useIdeSelection` | IDE text selection bridging (4.3k) |
| `useCopyOnSelect` | Terminal copy-on-select (4.2k) |
| `useAwaySummary` | Away-from-session summary (3.8k) |
| `useSwarmInitialization` | Multi-agent swarm init (3.1k) |
| `useCommandKeybindings` | Command-specific keybindings (3.2k) |
| `useDiffData` | Diff data preparation (2.8k) |
| `useIDEIntegration` | IDE bridge integration (2.7k) |
| `useTeleportResume` | Teleport session resume (2.6k) |
| `usePromptsFromClaudeInChrome` | Chrome extension prompts (2.4k) |
| `useElapsedTime` | Timer display (1.2k) |
| `useMemoryUsage` | Memory usage tracking (1.2k) |
| `useUpdateNotification` | Update availability notification (0.9k) |

---

## 5. Slash Commands — Missing (~85)

The MVP has **100+ slash commands** organized in 86 subdirectories. LiteAI CLI has ~15 dialogs.

### High Priority Missing Commands

| Command | Purpose |
|---|---|
| `/compact` | Context compaction |
| `/cost` | Session cost display |
| `/diff` | File diff viewer |
| `/doctor` | System diagnostics |
| `/export` | Session export |
| `/feedback` | Send feedback |
| `/files` | List tracked files |
| `/help` | Help system |
| `/init` | Project initialization |
| `/keybindings` | Keybinding management |
| `/memory` | Memory file management |
| `/permissions` | Permission mode management |
| `/plan` | Plan mode toggle |
| `/resume` | Session resume |
| `/rewind` | Rewind to previous state |
| `/stats` | Usage statistics |
| `/tasks` | Task management |
| `/vim` | Vim mode toggle |
| `/voice` | Voice mode |
| `/agents` | Agent management |

### Medium Priority

| Command | Purpose |
|---|---|
| `/branch` | Git branch management |
| `/color` | Agent color picker |
| `/context` | Context visualization |
| `/copy` | Copy last message |
| `/effort` | Effort level adjustment |
| `/fast` | Fast mode toggle |
| `/hooks` | Hook management |
| `/ide` | IDE integration |
| `/login` / `/logout` | Authentication |
| `/model` | Model switching |
| `/output-style` | Output style picker |
| `/release-notes` | Changelog viewer |
| `/rename` | Session rename |
| `/review` | Code review |
| `/share` | Session sharing |
| `/tag` | Session tagging |
| `/theme` | Theme switching |
| `/upgrade` | Version upgrade |
| `/usage` | Usage reporting |

---

## 6. Keybinding System Gaps

### MVP: 16 Keybinding Contexts

| Context | LiteAI Status |
|---|---|
| **Global** (ctrl+c/d/l/t/o/r, search, quick-open) | ⚠️ Partial |
| **Chat** (escape, mode cycle, model picker, submit, history, undo, external editor, stash, image paste, voice) | ⚠️ Partial |
| **Autocomplete** (tab/escape/up/down) | ❌ Missing |
| **Settings** (search, toggle, save, retry) | ❌ Missing |
| **Confirmation** (y/n, navigation, toggle, cycle mode, explanation toggle) | ✅ Basic |
| **Tabs** (tab/shift+tab, left/right) | ❌ Missing |
| **Transcript** (toggle show all, exit, q) | ❌ Missing |
| **HistorySearch** (ctrl+r cycle, accept, cancel, execute) | ❌ Missing |
| **Task** (ctrl+b background) | ❌ Missing |
| **ThemePicker** (ctrl+t syntax highlighting) | ❌ Missing |
| **Scroll** (pageup/down, wheel, home/end, copy) | ❌ Missing |
| **Help** (escape dismiss) | ❌ Missing |
| **Attachments** (left/right/backspace/escape) | ❌ Missing |
| **Footer** (up/down/left/right/enter/escape) | ❌ Missing |
| **MessageSelector** (vim navigation, jump to top/bottom) | ❌ Missing |
| **MessageActions** (navigate, copy, paste actions) | ❌ Missing |

### Missing Keybinding Infrastructure

| Feature | Description |
|---|---|
| User-customizable keybindings | `loadUserBindings.ts` (14k) — JSON-based user override system |
| Keybinding validation | `validate.ts` (13k) — conflict detection, reserved key enforcement |
| Keybinding resolver | `resolver.ts` (7k) — context-aware key resolution |
| Shortcut display formatting | `shortcutFormat.ts` + `useShortcutDisplay.ts` |
| Reserved shortcuts | `reservedShortcuts.ts` — system-level key protection |

---

## 7. Services — Missing UI-Adjacent

| Service | Purpose | Size |
|---|---|---|
| Voice STT/TTS | Voice streaming, speech-to-text, keyterms | 3 files, ~41k |
| Prompt Suggestions | AI-powered input suggestions | Directory |
| Session Memory | Cross-session memory persistence | Directory |
| Agent Summary | Post-session agent summaries | Directory |
| Tips System | Contextual tips registry | Directory |
| Compact Service | Automatic context compaction | Directory |
| LSP Integration | Language server protocol | Directory |
| OAuth Flow | Console OAuth authentication | `ConsoleOAuthFlow.tsx` (23k) |
| Analytics/GrowthBook | Feature flags and analytics | Multiple files |
| Rate Limit Messages | Rate limit display and messaging | Multiple files |
| Token Estimation | Token counting and estimation | `tokenEstimation.ts` (16k) |
| VCR Recording | Session recording/replay | `vcr.ts` (12k) |
| Policy Limits | Enterprise policy enforcement | Directory |

---

## 8. State Management Gap

| Feature | MVP | LiteAI |
|---|---|---|
| `AppStateStore` | 21k — centralized reactive store with selectors | ❌ Using context directly |
| `onChangeAppState` | 6k — state change side-effect handlers | ❌ Missing |
| `selectors` | Derived state selectors | ❌ Missing |
| Teammate view helpers | 4k — multi-agent view state | ❌ Missing |

---

## 9. Screens Gap

| Screen | MVP | LiteAI |
|---|---|---|
| REPL (main) | `REPL.tsx` — **258k lines**, the entire session experience | Session route (~3.8k) |
| Doctor | `Doctor.tsx` (19k) — system diagnostics UI | ❌ Missing |
| ResumeConversation | `ResumeConversation.tsx` (15k) — session resume picker | ❌ Missing |

---

## 10. Priority Roadmap

### Phase 1 — Foundation (Must-Have for Parity)
1. FullscreenLayout + ScrollBox integration
2. Rich message rendering (Message, MessageRow, Messages)
3. Full PromptInput with autocomplete overlay
4. StatusLine with model/context/cost display
5. Complete keybinding system (all 16 contexts)

### Phase 2 — Feature Completeness
6. ContextVisualization + token tracking
7. Stats dashboard with heatmaps
8. Diff viewer (DiffDialog, detail view, file list)
9. Permission request components (per-tool types)
10. Background task management UI

### Phase 3 — Polish
11. Auto-updater flow
12. Theme/model/output-style pickers
13. Agent management UI
14. MCP management panel
15. Voice integration
16. Session memory and away summaries

> [!IMPORTANT]
> The MVP's `REPL.tsx` alone is **258k lines** — it contains the entire session orchestration logic. The current LiteAI session route is ~3.8k. This is the single largest gap and represents the core user experience.
