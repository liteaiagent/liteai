# Phase 3: Critical Core UX — Multi-Phase Implementation Plan

> **Status**: Proposed
> **Date**: 2026-04-28
> **Scope**: `packages/cli` (TUI layer)
> **Prerequisites**: Phase 2.x UI migration complete (foundation, contexts, components, routes)
> **Source**: [cli_feature_gap_analysis.md](./cli_feature_gap_analysis.md) — §1 Critical (Core UX) + §6 Keybinding System

---

## Current State Assessment

The Phase 2.x migration delivered a functional TUI with:

| Component | Status | Gap |
|-----------|--------|-----|
| SessionLayout (FullscreenLayout) | ✅ Done | ScrollBox, sticky headers, modal overlays, "N new" pill |
| VirtualMessageList | ✅ Done | Virtualized scroll with sticky prompt tracking |
| ScrollHandler | ✅ Done | Wheel acceleration, keyboard scroll, page/line/home/end |
| PromptInput | ✅ Substantial | History, paste, slash commands, mode indicator, suggestions |
| Messages → Message → Parts | ⚠️ Partial | Basic rendering chain works, missing interaction richness |
| StatusLine | ⚠️ Minimal | Shows model/CWD/status only — no cost, tokens, context % |
| Spinner | ⚠️ Basic | Animated dots — no stalled detection, no progress detail |
| Keybindings | ⚠️ 4 contexts | Global, Chat (partial), Confirmation, Scroll — 12+ missing |

**What's permanently excluded** (per [excluded_features.md](./excluded_features.md)):
Voice, Coordinator, Bridge, Swarms/Teams, PR Badge, Auto-updater, IDE integration, Fullscreen xterm.js overlay, GrowthBook.

**What's deferred** (per [deferred_features.md](./deferred_features.md)):
Stashed prompt, Queued commands, Permission mode cycling (blocked on core API), Footer pills (dependency-excluded), Agent color/teammate routing (excluded).

---

## Phase Structure

```
Phase 3.0         Phase 3.1         Phase 3.2           Phase 3.3         Phase 3.4
Information   →   Message       →   Active Op       →   Input         →   Keybinding
Layer             Interaction       UX                  Productivity      & Help
(~2 days)         (~3 days)         (~2 days)           (~2-3 days)       (~2 days)
```

Each phase is independently shippable. Dependency arrows indicate recommended order but phases 3.3 and 3.4 can run in parallel.

---

## Phase 3.0: Session Information Layer

**Goal**: Give users real-time visibility into session economics (cost, tokens, context window utilization).

### Data Sources (Already Available)

| Data | Source | Type |
|------|--------|------|
| Per-message cost | `AssistantMessage.cost` | `number` |
| Per-message tokens | `AssistantMessage.tokens.{input,output,reasoning,cache}` | `number` |
| Per-step cost/tokens | `StepFinishPart.cost`, `StepFinishPart.tokens` | same structure |
| Context overflow | `ContextOverflowError` on `AssistantMessage.error` | discriminated union |
| Compaction event | `CompactionPart` (auto/overflow flags) | part type |
| Model context limit | Model definition `limit.context` | `number` |
| Agent progress | `EventAgentProgress.activity` | SSE event |

### Deliverables

#### [MODIFY] `status-line.tsx` → Rich StatusLine
Current: 32 lines showing `Model | CWD | Status`.

Target segments (left-to-right):

| Segment | Content | Source |
|---------|---------|--------|
| Model | Provider/model name, truncated | `sync.provider_default` |
| Context | `ctx: 45% ████░░░░` — visual bar with % | Computed from cumulative input tokens vs model context limit |
| Cost | `$0.12` — cumulative session cost | Sum of `AssistantMessage.cost` across session messages |
| Mode | `[plan]` or `[code]` or `[ask]` | Current message mode |
| Vim | `-- INSERT --` or `-- NORMAL --` when vim mode active | `local.vim.mode` |
| Status | `idle` / `working` / `compacting` | `sync.session.status()` |

#### [NEW] `hooks/use-session-stats.ts` — Session Statistics Hook
Computes derived session data:
```
- totalCost: number           — sum of message.cost
- totalTokens: { input, output, reasoning, cacheRead, cacheWrite }
- contextUtilization: number  — latest input tokens / model context limit
- messageCount: number        — total messages
- stepCount: number           — total step-finish parts
```

#### [NEW] `components/token-warning.tsx` — Context Window Warning
Renders an inline warning when `contextUtilization > 0.85`:
- `⚠ Context 92% full — consider /compact`
- At `> 0.95`: escalate to error color
- On `ContextOverflowError`: show "Context window exhausted" with recovery hint

#### [NEW] `components/compact-summary.tsx` — Compaction Summary
When a `CompactionPart` appears in the message stream:
- Render: `━━━ Context compacted (auto) ━━━`
- If `overflow: true`: add `due to context overflow`

#### [MODIFY] `routes/session/parts.tsx` — Register new part renderers
Add `compaction: CompactionPartView` to `PART_MAPPING`.

### Slash Command Additions

| Command | Action |
|---------|--------|
| `/cost` | Display session cost breakdown in modal (per-message table) |
| `/compact` | Trigger manual context compaction via SDK |

### Verification
- `bun typecheck` passes
- StatusLine shows all segments with real data
- Token warning appears when context > 85%
- `/cost` shows per-message cost table

---

## Phase 3.1: Message Interaction Layer

**Goal**: Make messages interactive — copy, retry, expand/collapse thinking, act on errors.

### Deliverables

#### [MODIFY] `routes/session/parts.tsx` — Thinking Toggle Per-Message
Current: `showThinking` is a global boolean from `SessionRoute`.
Target: Each `ReasoningPartView` gets a collapsible toggle:
- Default: collapsed (show `▶ Thinking (42 tokens)` one-liner)
- Click or keybind: expand to show full reasoning text
- Global `showThinking` still acts as master override (Ctrl+T shows/hides all)

#### [MODIFY] `routes/session/message-row.tsx` — Hover Actions
Current: 536 bytes, just renders `<MessageRow>` wrapper.
Target: On hover, show action bar at top-right of message:
```
┌─────────────────────────────────────────────────┐
│ Message content...                    [📋] [↻]  │
└─────────────────────────────────────────────────┘
```
- `📋` Copy — copies message text to clipboard
- `↻` Retry — re-sends the user message (only on assistant messages with errors)

Implementation:
- Track hover state via `onMouseEnter`/`onMouseLeave` (already in VirtualMessageList)
- Render action icons conditionally on hover
- Copy uses `process.stdout.write(\x1b]52;c;${base64}\\x07)` OSC-52 clipboard

#### [NEW] `hooks/use-clipboard.ts` — Clipboard Copy Hook
Terminal-safe clipboard write using OSC-52 escape sequence.
Falls back to `process.platform`-specific command (`clip.exe` on Windows, `pbcopy` on macOS, `xclip` on Linux).

#### [MODIFY] `routes/session/message.tsx` — Error Recovery Actions
Current: Shows error text in a bordered box.
Target: For `ContextOverflowError`, `APIError` (retryable), `ProviderAuthError`:
- Show contextual action hint:
  - `ContextOverflowError` → "Press Enter to compact and retry"
  - `APIError { isRetryable }` → "Press Enter to retry"
  - `ProviderAuthError` → "Run /provider to configure"

#### [NEW] `components/message-actions-bar.tsx` — Reusable Message Action Bar
Floating action bar component used by MessageRow on hover:
```tsx
type Action = { icon: string; label: string; onAction: () => void }
type Props = { actions: Action[]; visible: boolean }
```

### Keybinding Additions

| Bind | Context | Action |
|------|---------|--------|
| `session_copy_last` | Chat | Copy last assistant message to clipboard |
| `session_retry` | Chat | Retry last failed message |
| `session_thinking_toggle` | Chat | Already exists — toggle all thinking blocks |

### Verification
- Thinking blocks collapse/expand per-message
- Hover shows copy/retry actions on messages
- `/cost` slash command from Phase 3.0 works with retry
- Error messages show recovery hints

---

## Phase 3.2: Active Operation UX

**Goal**: Provide rich feedback during long-running operations (tool calls, agent spawning, stalled states).

### Deliverables

#### [MODIFY] `ui/spinner.tsx` — Rich Spinner with Stalled Detection
Current: 1.5K, basic animated dots.
Target:
- **Animation phases**: dots → shimmer after 5s → "still working..." label after 15s
- **Elapsed time**: show `(3.2s)` next to spinner after 2s
- **Stalled indicator**: after configurable timeout (default 30s), change to `⚠ Operation may be stalled`
- Uses `useElapsedTime()` hook internally

#### [NEW] `hooks/use-elapsed-time.ts` — Elapsed Timer Hook
```tsx
function useElapsedTime(startTime: number | undefined): string
// Returns formatted duration: "1.2s", "1m 23s", "5m 0s"
```

#### [MODIFY] `routes/session/tools.tsx` — Tool Progress Enhancement
Current: 22.5K, comprehensive tool renderers.
Target additions:
- Show elapsed time on running tools: `⟳ read (1.2s)`
- Show completion time on completed tools: `✓ read (0.8s)`
- Running tools get a shimmer/pulse effect via ThemedText

#### [NEW] `components/subagent-tree.tsx` — Subagent Progress Tree
When `SubtaskPart` (type: 'subtask') appears in message parts:
- Show tree structure:
  ```
  ├─ agent:architect  ⟳ "Analyzing module structure..." (5.2s)
  └─ agent:coder      ✓ completed (12.3s, $0.04)
  ```
- Subscribes to `agent.progress` and `agent.completed` SSE events
- Tree auto-collapses completed branches after 3s

#### [MODIFY] `routes/session/parts.tsx` — Register subtask renderer
Add `subtask: SubtaskPartView` to `PART_MAPPING`.

### SSE Event Subscriptions (New in sync.tsx)

| Event | Sync Field | Usage |
|-------|-----------|-------|
| `agent.spawned` | `sync.agents[sessionID][]` | Track active subagents |
| `agent.progress` | `sync.agents[sessionID][agentId].activity` | Show current activity |
| `agent.completed` | `sync.agents[sessionID][agentId].status` | Mark completion |

### Verification
- Spinner shows elapsed time after 2s
- Spinner shows "still working" after 30s
- Tool calls show individual elapsed times
- Subagent tree renders when `task` tool spawns agents

---

## Phase 3.3: Input Productivity

**Goal**: Accelerate user input with autocomplete overlays and tab completion.

### Deliverables

#### [NEW] `components/prompt/autocomplete-overlay.tsx` — Autocomplete Panel
Renders below the cursor as a floating panel:
```
> /mo█
  ┌─────────────────────┐
  │ /model              │  ← highlighted
  │ /model:manage       │
  │ /model:fast         │
  └─────────────────────┘
```

Features:
- Fuzzy-filtered using existing `fuzzysort` integration
- Arrow keys navigate, Tab/Enter accepts, Escape dismisses
- Shows description text for each item
- Max 8 visible items with scroll indicator

Sources:
- Slash commands (`sync.command[]`)
- File paths (relative to cwd, scanned on `/` trigger)
- `@mention` targets (sessions, files, agents)

#### [MODIFY] `components/prompt/prompt-input.tsx` — Wire Autocomplete
Current: 24.7K with slash suggestion inline ghost text.
Target:
- When user types `/`, activate autocomplete with command list
- When user types `@`, activate autocomplete with mention list
- When inside a command argument, activate file path completion
- Autocomplete dismisses on space or when input no longer matches

#### [NEW] `hooks/use-file-completer.ts` — File Path Completion
Scans working directory for file/directory names:
- Triggered when input contains a path-like pattern
- Uses `readdir` with configurable depth limit (default 2)
- Results cached with 5s TTL
- Respects `.gitignore` via existing VCS integration

#### [MODIFY] `components/prompt/use-command-suggestions.ts` — Enhance Existing
Current: 2.5K, provides inline ghost text.
Target: Also provides structured suggestion list for autocomplete overlay.

### Keybinding Additions

| Bind | Context | Action |
|------|---------|--------|
| `autocomplete_accept` | Autocomplete | Tab or Enter — accept selection |
| `autocomplete_dismiss` | Autocomplete | Escape — close panel |
| `autocomplete_up` | Autocomplete | Up arrow — previous item |
| `autocomplete_down` | Autocomplete | Down arrow — next item |

### Verification
- Type `/` → autocomplete overlay appears with filtered commands
- Arrow keys navigate, Tab accepts
- Type `@` → shows mention targets
- Escape dismisses overlay

---

## Phase 3.4: Keybinding & Help System

**Goal**: Complete the keybinding infrastructure and provide a discoverable help system.

### Current Keybinding Contexts (4 active)

| Context | Status |
|---------|--------|
| Global (leader, session_new, session_list) | ✅ Active |
| Chat (session_thinking_toggle, session_sidebar_toggle) | ✅ Active |
| Scroll (page_up/down, line_up/down, home/end) | ✅ Active |
| Confirmation (permission/question prompts) | ✅ Active |

### Keybinding Contexts to Add

| Context | Bindings | Depends On |
|---------|----------|------------|
| **Autocomplete** | Tab, Escape, Up, Down | Phase 3.3 |
| **Help** | `?` (leader) to open, Escape to dismiss | This phase |
| **MessageActions** | `y` (copy), `r` (retry), Enter (action) | Phase 3.1 |

### Deliverables

#### [MODIFY] `context/keybind.tsx` — Context-Aware Keybinding Resolution
Current: Flat keybind map, no context scoping.
Target:
- Keybindings are scoped to contexts (e.g., `autocomplete.accept`, `help.dismiss`)
- Active context stack determines which bindings fire
- Higher-priority contexts shadow lower ones (e.g., autocomplete shadows chat arrow keys)

#### [NEW] `components/dialog-keybindings.tsx` — Keybinding Reference Dialog
Slash command `/keybindings` opens a dialog listing all registered keybindings:
- Grouped by context
- Shows current key mapping
- Searchable via fuzzy picker
- Highlights user-customized bindings

#### [MODIFY] `ui/dialog-help.tsx` — Enhanced Help Dialog
Current: 938 bytes, basic help text.
Target:
- Two tabs: **Commands** (slash commands) and **Keybindings** (all bindings)
- Commands tab: filtered list of all registered slash commands with descriptions
- Keybindings tab: grouped by context, shows key + action
- Searchable

#### [NEW] Config: `keybinds` user overrides
Support custom keybinding overrides in project config:
```json
{
  "keybinds": {
    "session_sidebar_toggle": "ctrl+b",
    "messages_page_up": "ctrl+u",
    "messages_page_down": "ctrl+d"
  }
}
```
This already partially works via `useTuiConfig().keybinds` — needs documentation and validation.

### Verification
- `?` (or configured leader+?) opens help dialog
- Help shows all commands and keybindings
- `/keybindings` shows reference dialog
- Custom keybindings in config override defaults

---

## Cross-Cutting Concerns

### Error Handling
All new components must:
- Throw structured errors on invalid state (per mandate §5)
- Display errors in toast via `useToast()` for recoverable failures
- Log via `Log.Default.error()` for debugging

### Performance
- `useSessionStats` must memoize aggregations — recalculate only when message list changes
- File completer must debounce filesystem reads (100ms minimum)
- Autocomplete overlay must not cause layout reflow in the main ScrollBox

### Testing Strategy
- Unit tests for `use-session-stats`, `use-clipboard`, `use-elapsed-time`, `use-file-completer`
- Integration tests for StatusLine rendering with mock sync data
- Scoped: `bun test test/tui/` (do NOT run full suite)

---

## Effort Summary

| Phase | Scope | Est. Effort | Dependencies |
|-------|-------|-------------|--------------|
| 3.0 | StatusLine, token tracking, cost, compaction | 2 days | None |
| 3.1 | Thinking toggle, hover actions, copy, retry, error recovery | 3 days | 3.0 (token data) |
| 3.2 | Rich spinner, tool timing, subagent tree | 2 days | None |
| 3.3 | Autocomplete overlay, file completion, @ mentions | 2-3 days | None |
| 3.4 | Keybinding contexts, help dialog, customization | 2 days | 3.1, 3.3 (new contexts) |

**Total**: ~11-12 days

---

## References

- [cli_feature_gap_analysis.md](./cli_feature_gap_analysis.md) — Source gap analysis
- [excluded_features.md](./excluded_features.md) — Permanently excluded features
- [deferred_features.md](./deferred_features.md) — Deferred features & dependencies
- [deferred_readiness_analysis.md](./deferred_readiness_analysis.md) — Readiness assessment
- [ui-migration-rfc.md](./ui-migration-rfc.md) — Architecture context (layered architecture)
