# CLI UI Feature Gap Analysis — Consolidated

**LiteAI CLI** (`packages/cli`) vs **Claude Code** vs **Gemini CLI**

> [!NOTE]
> This document supersedes both `cli_feature_gap_analysis.md` (v1) and `cli_feature_gap_analysis_v2.md` (v2). It reflects **ground-truth verification** against the current codebase as of 2026-05-01.

---

## Executive Summary

| Metric | LiteAI CLI (Current) | Claude Code | Gemini CLI |
|---|---|---|---|
| TUI Components | **~39 files** + 12 design-system | ~113 files | ~177 files |
| TUI Hooks | **18** | 83 | 147 |
| Slash Commands | **~17** (dialogs) | ~100+ | ~42 |
| Keybinding Contexts | **17 contexts** (full system) | 16 contexts | ~26 Providers |
| Design System Elements | **12** primitives + ThemeProvider | 16 + ThemeProvider | Colors + Semantic UI |
| Screens/Views | **2** (home, session) | 3 (REPL, Doctor, Resume) | ~16 view components |
| State Management | **Modular Stores** (Zustand + Context) | AppStateStore (Monolithic) | Heavy Context Providers (26+) |

---

## Phase Status Assessment

### ✅ Phase 1 — Foundation (COMPLETE)

Original v1 goals and their resolution:

| v1 Phase 1 Item | Status | Evidence |
|---|---|---|
| FullscreenLayout + ScrollBox | ✅ Complete | `session-layout.tsx` (5.2KB) — compositional layout with scroll zones |
| Rich message rendering | ✅ Complete | `virtual-message-list.tsx` (10KB) + `parts.tsx` + message cursor system |
| Full PromptInput with autocomplete | ✅ Complete | `prompt/` directory (12 files, ~50KB total) — @ completion, command suggestions, history |
| StatusLine with model/context/cost | ✅ Complete | `status-line.tsx` (4.9KB) — priority-based segment dropping, 8 segment types |
| Complete keybinding system | ✅ Complete | `keybindings/` (9 files) — 17 contexts, chord support, user customization via `tui.json` |

### ✅ Phase 2 — Feature Completeness (COMPLETE, with intentional deferrals)

| v1 Phase 2 Item | Status | Notes |
|---|---|---|
| ContextVisualization + token tracking | ✅ **Tracking complete**, 🔴 **Visualization gap** | `use-session-stats.ts` (8.6KB) tracks everything. `context-usage-display.tsx` shows bar + %. No grid/defragmenter UI. |
| Stats dashboard | ✅ Complete | `dialog-stats.tsx` (7KB) — 7-section panel with per-model breakdown |
| Diff viewer | 🟡 Partial | `structured-diff.tsx` (4.3KB) — basic inline diff. No `DiffDialog`, file list, source switching. |
| Permission request components | 🟡 Partial | Basic `permission.tsx` + `question.tsx`. No per-tool-type specialized UIs. |
| Background task management UI | 🔴 Excluded | No background task visualization. Excluded per `excluded_features.md` (Coordinator-dependent). |

### ✅ Phase 3 — Critical UX (COMPLETE)

All four sub-phases delivered:

| Phase | Scope | Status | Key Deliverables |
|---|---|---|---|
| **3.0** Information Layer | Stats, StatusLine, token tracking | ✅ 2026-05-01 | `use-session-stats.ts`, `status-line.tsx`, `token-warning.tsx`, `compact-summary.tsx`, `/stats` dialog |
| **3.1** Message Interaction | Cursor mode, actions, thinking toggle | ✅ 2026-05-01 | `use-message-cursor.ts`, `message-action-handlers.ts`, `message-action-registry.ts`, `thinking-toggle.tsx` |
| **3.2** Active Operation UX | Spinner, stall detection, subagent tree | ✅ 2026-05-01 | `use-elapsed-time.ts`, `use-stalled-animation.ts`, `use-phrase-cycler.ts`, `subagent-progress.tsx` |
| **3.3** Input Productivity | @ completion, message queue | ✅ 2026-05-01 | `use-at-completer.ts`, `use-queue-processor.ts`, `message-queue-store.ts`, `at-processor.ts` |
| **3.4** Keybinding & Help | 17 contexts, chord support, help dialog | ✅ 2026-04-30 | Full `keybindings/` system (9 files), `tips.tsx` |

---

## Remaining Gaps (Verified Against Codebase)

### 🔴 Critical Gaps (Feature Parity Blockers)

| # | Gap | Claude Code | Gemini CLI | LiteAI Current | Effort |
|---|---|---|---|---|---|
| G1 | **Context Visualization (Grid/Breakdown)** | `ContextVisualization.tsx` — token grid, per-category breakdown (memoryFiles, mcpTools, systemPrompt, agents, skills) | `ContextSummaryDisplay.tsx` — basic text | `context-usage-display.tsx` — bar + percentage only | 2–3 days |
| G2 | **Rewind Viewer (Full Time-Travel)** | `MessageSelector.tsx` (831 lines) + `LogSelector.tsx` (1575 lines) — time-travel with DiffStats, partial restore, cross-session search | `RewindViewer.tsx` (335 lines) — jump to prompts with file change warnings | Nothing | 3–5 days |
| G3 | **Diff Dialog (Full)** | `DiffDialog` + `DiffDetailView` + `DiffFileList` — file list, source switching, navigation | Similar | `structured-diff.tsx` — inline only | 2–3 days |
| G4 | **Help System (V2)** | `HelpV2` with tabbed General + Commands views | `HelpScreen` | No `/help` command mapped | 1 day |
| G5 | **Session Resume/History Browser** | `ResumeConversation.tsx` (15k) — session picker | Session browser | `dialog-session-list.tsx` — basic list only | 2 days |

### 🟡 Important Gaps (Productivity)

| # | Gap | Reference | LiteAI Current | Effort |
|---|---|---|---|---|
| G6 | **Prompt Stash** | Both CLIs — save prompt state when switching views | Not implemented | 1 day |
| G7 | **External Editor ($EDITOR)** | `promptEditor.ts` — open prompt in external editor | Keybinding exists (`ctrl+x ctrl+e`), no handler | 1 day |
| G8 | **Permission Mode Cycling** | `Shift+Tab` in permission prompts — cycle Auto/Normal/Deny | Keybinding context exists, no core API | 1–2 days (needs core change) |
| G9 | **Advanced MCP Management** | `MCPListPanel`, settings, tool detail views, reconnect | `dialog-mcp.tsx` — basic panel | 2–3 days |
| G10 | **Memory File Management** | `MemoryFileSelector`, `MemoryUpdateNotification` | Nothing | 1–2 days |
| G11 | **Manual `/compact` Command** | Both CLIs — explicit `/compact` command | Auto-compact only (at threshold). No manual trigger registered. | 0.5 days |

### 🟢 Nice-to-Have (Phase 6 — Post-Launch)

| # | Gap | Effort |
|---|---|---|
| G12 | Agent management UI (agent list, detail, editor) | 3 days |
| G13 | Advanced stats (heatmaps, streaks, date ranges) | 2 days |
| G14 | Session tagging / renaming UX | 1 day |
| G15 | Auto-updater flow | 1 day |
| G16 | Output style picker | 1 day |
| G17 | Toast positioning (absolute bottom) | 0.5 day |
| G18 | Feedback/survey system | 2 days |
| G19 | **Doctor/Diagnostics Screen** — System health check (provider connectivity, MCP status, SDK version, config validation) | 2 days |

---

## Compact / Context Compression: Reference Threshold Analysis

> [!IMPORTANT]
> **Decision**: Both manual `/compact` and auto-compact. Threshold lowered from 95% to match industry practice.

### What the references do

| Aspect | Claude Code | Gemini CLI |
|---|---|---|
| **Auto-compact threshold** | **Dynamic**: `effectiveContextWindow - 13,000 tokens` (`AUTOCOMPACT_BUFFER_TOKENS`). On a 200K model this is ~93%. On smaller models it triggers earlier. | **50%** (`DEFAULT_COMPRESSION_THRESHOLD = 0.5`). User-configurable via `model.compressionThreshold`. |
| **Warning threshold** | `threshold - 20,000 tokens` (`WARNING_THRESHOLD_BUFFER_TOKENS`). Separate error threshold at same buffer. | Warning color kicks in at the compression threshold. |
| **Manual command** | ✅ `/compact` — always available, separate from auto-compact. Can be disabled independently (`DISABLE_AUTO_COMPACT` vs `DISABLE_COMPACT`). | ✅ `/compress` — always available. |
| **Circuit breaker** | Yes — max 3 consecutive auto-compact failures, then stops retrying for the session. | None visible in source. |
| **User config** | `autoCompactEnabled` boolean in global config. `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` env var for testing. | `model.compressionThreshold` (0.0–1.0 float) in settings.json. |

### LiteAI action items

1. **Lower auto-compact threshold**: Change from `0.95` to `0.80` (80%). This is between Gemini's aggressive 50% and Claude's ~93%. Reasoning: our context windows are currently smaller than Claude's 200K, so 95% leaves almost no buffer.
2. **Lower warning threshold**: Change from `0.85` to `0.65` (65%). Gives users advance notice.
3. **Register manual `/compact`**: Wire as a TUI slash command that submits `/compact` to the session.
4. **Add circuit breaker**: Prevent runaway auto-compact attempts (max 3 failures, matching Claude).
5. **Make threshold configurable**: Add `tui.json` → `compaction.threshold` float field.

---

## Rewind Viewer: Architecture Decision

> [!IMPORTANT]
> **Decision**: Full time-travel model with DiffStats, not the simple "jump to prompt" model.

### Rationale

LiteAI core already tracks snapshots for every state transition. The infrastructure exists:
- Session message history with full persistence (SQLite via drizzle-orm)
- JSONL sidechain transcript files on disk
- Fork/subagent session tracking with parent-child relationships

### Scope for Phase 4

The rewind viewer will implement:
1. **Message-level navigation** — browse all turns in the session
2. **DiffStats per turn** — show which files were changed, insertions/deletions for each turn
3. **Restore options** — "Restore Code & Conversation", "Restore Conversation Only", "Summarize from here"

> [!NOTE]
> **Cross-session search** (searching transcripts across all historical sessions) is deferred to Phase 5.
> Rationale: With multiple UIs (CLI, Web, VSCode), this must be a core API — not client-side JSONL parsing.
> Requires new core routes + potentially SQLite FTS5 indexing. See `phase4_open_questions.md` Q2.

Reference: Claude Code's `MessageSelector.tsx` (831 lines) + `LogSelector.tsx` (1575 lines).

---

## Slash Command Coverage

### Currently Implemented (~17)

`/stats`, `/model`, `/settings`, `/theme`, `/skill`, `/mcp`, `/agents` (stub), `/provider`, `/plugin`, `/workspace`, `/session-list`, `/session-rename`, `/manage-models`, `/status`, `/dialog-agent`

### Roadmap (Phases 4–5, ~15)

`/compact`, `/help`, `/diff`, `/export`, `/history`, `/rewind`, `/memory`, `/plan`, `/permissions`, `/context`, `/effort`, `/doctor` (Phase 6)

### Excluded (~40)

Formalized in [excluded_features.md](file:///d:/liteai/roadmap/ui_refactoring/excluded_features.md). Commands tied to permanently excluded infrastructure (voice, swarms, bridge, coordinator, auto-updater, IDE coupling, etc.).

---

## Architectural Strengths (Retain)

These are **deliberate architectural advantages** over the reference CLIs. Do NOT regress:

1. **Modular hook architecture** — 18 focused hooks vs. Claude's 83 monolithic hooks. Each hook has clear boundaries.
2. **SDK-routed file search** — `use-at-completer.ts` offloads file indexing to the backend. No client-side fs watchers.
3. **Separated keybinding system** — 9-file system with parser, matcher, resolver. Context-block structure > flat arrays.
4. **Priority-based StatusLine** — Graceful degradation on narrow terminals. No truncation artifacts.
5. **Module-level message queue** — `useSyncExternalStore` pattern avoids React batching delays.
6. **Zustand materialized view** for stats — O(1) incremental updates, never recomputes from message history.

---

## Proposed Next Steps

### Phase 4 — Specialized Views & Commands (✅ COMPLETED)

> Focus: Fill the **critical functional gaps** that block parity.

| Step | Gap(s) | Deliverable | Status |
|---|---|---|---|
| 4.0 | G4 | **Help Dialog V2** — Tabbed General + Commands view, powered by keybinding system | ✅ Done |
| 4.1 | G11 | **Manual `/compact`** — Register as TUI slash command + lower auto-compact to 80% + add circuit breaker | ✅ Done |
| 4.2 | G1 | **Context Visualization** — Core API endpoint (`GET /session/:id/context`) + CLI dialog. Token breakdown grid with static category estimates (system prompt, tools, agents, MCP, conversation). | ✅ Done |
| 4.3 | G3 | **Diff Dialog** — File list navigation + detail view. Extend `structured-diff.tsx` into a multi-file dialog. | ✅ Done |
| 4.4 | G2 | **Rewind Viewer** — Message navigation with per-turn DiffStats, restore options. Cross-session search deferred to Phase 5. | ✅ Done |
| 4.5 | G5 | **Session Browser** — Core: AI-generated session descriptions (`tasks/description.ts`). CLI: branch indicators, archive support. | ✅ Done |

**Phase 4 Completion Summary:**
- **Help System**: Built a tabbed dialog (`DialogHelpV2`) grouping keybindings by context and documenting all slash commands.
- **Compaction**: Implemented `/compact` slash command, `useCompactCircuitBreaker` to prevent compact loops, and adjusted auto-compact threshold to 80%.
- **Context Breakdown**: Built `GET /session/:id/context` backend route and `ContextBreakdown` task to estimate token usage across categories (System, Models, Memory, Tools, Conversation), surfaced via `DialogContext`.
- **Diff & Rewind**: Implemented `DialogDiff` for exploring cross-file session changes, and `DialogRewind` (Time Travel) for navigating user message history and viewing per-turn DiffStats.
- **Session Metadata**: Extended `Session.Info` with AI-generated session descriptions using a fire-and-forget task triggered on the first session turn, and updated the session browser to display them.

### Phase 5 — Productivity & Polish

> Focus: Fill **important productivity gaps** and slash command coverage.

| Step | Gap(s) | Deliverable |
|---|---|---|
| 5.0 | G7 | **External Editor** — Wire `ctrl+x ctrl+e` to spawn `$EDITOR` with temp file |
| 5.1 | G6 | **Prompt Stash** — Save/restore prompt state on dialog open/close |
| 5.2 | G8 | **Permission Mode Cycling** — Core API extension + `Shift+Tab` handler |
| 5.3 | G9 | **MCP Management** — Extend `dialog-mcp.tsx` with tool detail, reconnect, settings |
| 5.4 | G10 | **Memory File Management** — `/memory` command with file selector |
| 5.5 | G2 | **Cross-Session Search** — Core FTS5 infrastructure + `GET /session/search?q=` route. Enables rewind viewer to search across all historical sessions. |
| 5.6 | — | **Slash Command Registration Sweep** — Map remaining commands to dialogs/actions |

### Phase 6 — Deferred (Post-Launch)

| Item |
|---|
| G12: Agent management UI |
| G13: Advanced stats (heatmaps) |
| G14–G18: Session tags, auto-updater, output picker, toast position, feedback |
| G19: Doctor/Diagnostics screen |
