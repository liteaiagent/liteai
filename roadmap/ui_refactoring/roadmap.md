
## Remaining Gaps

### Phase 5 — Display Density & Productivity

> Focus: Transcript mode refinements from competitive audit + productivity gaps.

| # | Feature | Description | Effort |
|---|---|---|---|
| 5.0 | **Collapsed Read/Search Groups** | Collapse consecutive read/grep calls into a single summary line (e.g., `→ Read 5 files, Searched 3 patterns`). Click to expand individual tools. | 2–3 days |
| 5.1 | **Inline Diff Preview** | Show up to N lines of diff inline in compact mode (like Gemini's `COMPACT_TOOL_SUBVIEW_MAX_LINES = 15`) instead of zero-line summary. | 1–2 days |
| 5.2 | **Per-Message Expand/Collapse** | Selective verbose toggle per tool call (via cursor or click), OR'd with global mode. Leverages existing `MessageCursor`. | 1–2 days |
| 5.3 | **Hide Past Thinking** | In transcript mode, show only the latest thinking block, hide all previous. Sentinel ID for streaming. | 0.5 day |
| 5.4 | **Compact Tool Allowlist** | Explicit set of tool names eligible for compaction. Unknown/MCP tools default to verbose. | 0.5 day |
| 5.5 | **External Editor** | Wire `ctrl+x ctrl+e` to spawn `$EDITOR` with temp file, suspend TUI via `exitTemporarily()`. | 1 day |
| 5.6 | **Prompt Stash** | Save/restore prompt text when switching views or opening dialogs. | 0.5 day |
| 5.7 | **Permission Mode Cycling** | `Shift+Tab` in permission prompts — cycle modes. Requires core API extension. | 1–2 days |

### Phase 6 — Search & Advanced Commands

> Focus: Search infrastructure, cross-session features, command coverage.

| # | Feature | Description | Effort |
|---|---|---|---|
| 6.0 | **Transcript Search** | In-memory text search across rendered messages with position highlighting. Tool-specific text extractors. | 3–4 days |
| 6.1 | **Global File Search** | Ripgrep-powered workspace search dialog (`ctrl+shift+f`) with preview pane and editor-open. | 2–3 days |
| 6.2 | **Cross-Session Search** | Core FTS5 infrastructure + `GET /session/search?q=` route. Enables searching across all historical sessions. | 3–5 days |
| 6.3 | **MCP Management** | Extend `dialog-mcp.tsx` with tool detail views, reconnect, server settings. | 2–3 days |
| 6.4 | **Memory File Management** | `/memory` command with file selector and update notifications. | 1–2 days |
| 6.5 | **Slash Command Sweep** | Register remaining commands: `/diff`, `/export`, `/permissions`, `/plan`, `/context`, `/effort`. | 2 days |

### Phase 7 — Polish & Deferred

> Focus: Nice-to-have features and low-priority gaps.

| # | Feature | Description | Effort |
|---|---|---|---|
| 7.0 | **Error Verbosity Control** | `errorVerbosity: 'low' | 'full'` setting — hide internal tool errors in low mode. | 0.5 day |
| 7.1 | **Output File Support** | When tool output exceeds threshold, save to file and show path. | 1 day |
| 7.2 | **Subagent Hint Suppression** | Suppress `(ctrl+o to expand)` hint inside nested subagent output. | 0.5 day |
| 7.3 | **Agent Management UI** | Agent list, detail view, editor. | 3 days |
| 7.4 | **Advanced Stats** | Heatmaps, streaks, date range cycling. | 2 days |
| 7.5 | **Doctor/Diagnostics** | System health check (providers, MCP, SDK version, config validation). | 2 days |
| 7.6 | **Session Tagging/Renaming** | Tag system for sessions. Enhanced rename UX. | 1 day |
| 7.7 | **Toast Positioning** | Absolute bottom positioning instead of inline. | 0.5 day |
| 7.8 | **Feedback/Survey System** | Thumbs up/down + transcript sharing. | 2 days |
| 7.9 | **Output Style Picker** | Named output styles (response personalities) in settings. | 1 day |
| 7.10 | **MCP Tool Compact Opt-In** | Allow MCP servers to declare tools as compact-eligible via manifest metadata. Extends the static `COMPACT_TOOL_ALLOWLIST` with dynamic entries. | 1 day |

---

## Excluded Features

~40 commands and their backing infrastructure are permanently excluded. See [excluded_features.md](ui_refactoring/excluded_features.md) for the full list. Key exclusions: Voice Mode, Coordinator/Swarms, Bridge Mode, Proactive/Kairos, IDE coupling, auto-updater, PR badges, and sandbox.

## References

- [CLI Feature Comparison](ui_refactoring/cli_feature_comparison.md) — 3-way competitive audit vs Claude Code and Gemini CLI
- [UI Migration RFC](ui_refactoring/ui-migration-rfc.md) — Architecture decision, package structure, migration phases
- [Excluded Features](ui_refactoring/excluded_features.md) — Permanently deferred features
