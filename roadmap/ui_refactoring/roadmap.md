
## Remaining Gaps

### Phase 7 — Polish & Deferred

> Focus: Nice-to-have features and low-priority gaps.

| # | Feature | Description | Effort |
|---|---|---|---|
| 7.1 | **Output File Support** | When tool output exceeds threshold, save to file and show path. | 1 day |
| 7.2 | **Subagent Hint Suppression** | Suppress `(ctrl+o to expand)` hint inside nested subagent output. | 0.5 day |
| 7.3 | **Agent Management UI** | Agent list, detail view, editor. | 3 days |
| 7.4 | **Advanced Stats** | Heatmaps, streaks, date range cycling. | 2 days |
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
