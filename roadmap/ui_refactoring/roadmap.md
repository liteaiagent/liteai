
## Remaining Gaps

### Phase 7 — Polish & Deferred

> Focus: Nice-to-have features and low-priority gaps.
> Split into 4 sub-phases ordered by dependency and complexity.
> All plans respect the **remote-mode constraint**: `packages/core` must not require CLI-side filesystem access for server state. Data flows through HTTP/SSE APIs.

#### Sub-Phase Execution Order

| Sub-Phase | Plan | Features | Effort | Core Changes |
|---|---|---|---|---|
| **7A** | [phase7a-tool-rendering.md](phase7a-tool-rendering.md) | Output File (7.1), Subagent Hints (7.2 — already resolved), MCP Compact (7.10) | 1 day | None |
| **7B** | [phase7b-agent-management.md](phase7b-agent-management.md) | Agent Management UI (7.3) | 2.5 days | New `AgentWriter`, `AgentRoutes`, `Agent.reload()` |
| **7C** | [phase7c-stats-tagging.md](phase7c-stats-tagging.md) | Advanced Stats (7.4), Session Tagging (7.6) | 3 days | DB migration (`tags` column), route changes |
| **7D** | [phase7d-feedback-styles-toast.md](phase7d-feedback-styles-toast.md) | Feedback (7.8), Output Styles (7.9), Toast Positioning (7.7) | 3 days | New `OutputStyle` module, style routes, config schema |
| **Total** | | **9 features (1 already resolved)** | **~9.5 days** | |

#### Feature Matrix

| # | Feature | Status | Sub-Phase |
|---|---|---|---|
| 7.1 | **Output File Support** | Planned | 7A |
| 7.2 | **Subagent Hint Suppression** | ✅ Already resolved by architecture | 7A |
| 7.3 | **Agent Management UI** | Planned — 3 new dialogs + core CRUD API | 7B |
| 7.4 | **Advanced Stats** | Planned — heatmap, streaks, date ranges | 7C |
| 7.6 | **Session Tagging** | Planned — DB migration required | 7C |
| 7.7 | **Toast Positioning** | Planned — layout change only | 7D |
| 7.8 | **Feedback System** | Planned — local-first approach (no central backend) | 7D |
| 7.9 | **Output Style Picker** | Planned — `.liteai/styles/*.md` via core API | 7D |
| 7.10 | **MCP Tool Compact Opt-In** | Planned — dynamic allowlist from MCP annotations | 7A |

---

## Excluded Features

~40 commands and their backing infrastructure are permanently excluded. See [excluded_features.md](excluded_features.md) for the full list. Key exclusions: Voice Mode, Coordinator/Swarms, Bridge Mode, Proactive/Kairos, IDE coupling, auto-updater, PR badges, and sandbox.

## References

- [Phase 7 Analysis](phase7_analysis.md) — Competitive analysis vs Claude Code and Gemini CLI
- [CLI Feature Comparison](cli_feature_comparison.md) — 3-way competitive audit vs Claude Code and Gemini CLI
- [UI Migration RFC](ui-migration-rfc.md) — Architecture decision, package structure, migration phases
- [Excluded Features](excluded_features.md) — Permanently deferred features
