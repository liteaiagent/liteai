# LiteAI UI Feature Status

Universal feature set for all LiteAI UIs (CLI, Web, VSCode).
Each platform must implement these capabilities — this document tracks current implementation status against the full inventory.

> **Legend:** ✅ Implemented · 🔶 Partial · ❌ Not Started

---

## 1. Session Management

| Feature | Status | Source |
|---|:---:|---|
| Session List | ✅ | [`dialog-session-list.tsx`](../../packages/cli/src/tui/components/dialog-session-list.tsx) |
| Session Create | ✅ | [`home/index.tsx`](../../packages/cli/src/tui/routes/home/index.tsx) |
| Session Resume | ✅ | [`context/sync.tsx`](../../packages/cli/src/tui/context/sync.tsx), [`context/sdk.tsx`](../../packages/cli/src/tui/context/sdk.tsx) |
| Session Rename | ✅ | [`dialog-session-rename.tsx`](../../packages/cli/src/tui/components/dialog-session-rename.tsx) |
| Session Tagging | ✅ | [`dialog-tag.tsx`](../../packages/cli/src/tui/components/dialog-tag.tsx) |
| Session Archive | ✅ | [`dialog-session-list.tsx`](../../packages/cli/src/tui/components/dialog-session-list.tsx) |
| Session Branch | ✅ | [`dialog-rewind-actions.tsx`](../../packages/cli/src/tui/components/dialog-rewind-actions.tsx) |
| Multi-Session | ✅ | [`session-tab-store.ts`](../../packages/cli/src/tui/state/session-tab-store.ts), [`app.tsx`](../../packages/cli/src/tui/app.tsx) |

---

## 2. Conversation & Message Display

| Feature | Status | Source |
|---|:---:|---|
| Message Display | ✅ | [`session/message.tsx`](../../packages/cli/src/tui/routes/session/message.tsx), [`session/parts.tsx`](../../packages/cli/src/tui/routes/session/parts.tsx) |
| Streaming | ✅ | [`context/sync.tsx`](../../packages/cli/src/tui/context/sync.tsx) |
| Message History | ✅ | [`virtual-message-list.tsx`](../../packages/cli/src/tui/components/virtual-message-list.tsx), [`scroll-handler.tsx`](../../packages/cli/src/tui/components/scroll-handler.tsx) |
| Message Copy | ✅ | [`use-clipboard.ts`](../../packages/cli/src/tui/hooks/use-clipboard.ts), [`message-action-registry.ts`](../../packages/cli/src/tui/components/message-action-registry.ts) |
| Message Retry | ✅ | [`message-action-handlers.ts`](../../packages/cli/src/tui/components/message-action-handlers.ts) |
| Message Edit | ✅ | [`message-action-handlers.ts`](../../packages/cli/src/tui/components/message-action-handlers.ts) |
| Message Queue | ✅ | [`use-queue-processor.ts`](../../packages/cli/src/tui/hooks/use-queue-processor.ts), [`message-queue-store.ts`](../../packages/cli/src/tui/stores/message-queue-store.ts), [`queued-message-display.tsx`](../../packages/cli/src/tui/components/prompt/queued-message-display.tsx) |

---

## 3. Display Density

| Feature | Status | Source |
|---|:---:|---|
| Compact Mode | ✅ | [`session/tools.tsx`](../../packages/cli/src/tui/routes/session/tools.tsx) (mode-aware tool renderers) |
| Transcript Mode | ✅ | [`session/tools.tsx`](../../packages/cli/src/tui/routes/session/tools.tsx) |
| Mode Toggle | ✅ | [`default-bindings.ts`](../../packages/cli/src/tui/keybindings/default-bindings.ts) (`ctrl+o` binding) |
| Per-Message Expand | ✅ | [`session/tools.tsx`](../../packages/cli/src/tui/routes/session/tools.tsx), [`use-message-cursor.ts`](../../packages/cli/src/tui/hooks/use-message-cursor.ts) |
| Collapsed Groups | ✅ | [`collapse-tool-groups.ts`](../../packages/cli/src/tui/utils/collapse-tool-groups.ts), [`collapsed-group-view.tsx`](../../packages/cli/src/tui/components/collapsed-group-view.tsx) |
| Inline Diff Preview | ✅ | [`session/tools.tsx`](../../packages/cli/src/tui/routes/session/tools.tsx) |
| Compact Allowlist | ✅ | [`compact-allowlist.ts`](../../packages/cli/src/tui/constants/compact-allowlist.ts) |

---

## 4. Thinking / Reasoning

| Feature | Status | Source |
|---|:---:|---|
| Thinking Indicator | ✅ | [`session/parts.tsx`](../../packages/cli/src/tui/routes/session/parts.tsx) |
| Thinking Title | ✅ | [`session/parts.tsx`](../../packages/cli/src/tui/routes/session/parts.tsx) |
| Thinking Toggle | ✅ | [`thinking-toggle.tsx`](../../packages/cli/src/tui/components/thinking-toggle.tsx) |
| Hide Past Thinking | ✅ | [`session/parts.tsx`](../../packages/cli/src/tui/routes/session/parts.tsx), [`session/ctx.tsx`](../../packages/cli/src/tui/routes/session/ctx.tsx) |

---

## 5. Tool Output

| Feature | Status | Source |
|---|:---:|---|
| File Read | ✅ | [`session/tools.tsx`](../../packages/cli/src/tui/routes/session/tools.tsx) |
| File Write | ✅ | [`session/tools.tsx`](../../packages/cli/src/tui/routes/session/tools.tsx) |
| File Edit | ✅ | [`session/tools.tsx`](../../packages/cli/src/tui/routes/session/tools.tsx), [`structured-diff.tsx`](../../packages/cli/src/tui/components/structured-diff.tsx) |
| Multi-File Patch | ✅ | [`dialog-diff.tsx`](../../packages/cli/src/tui/components/dialog-diff.tsx) |
| Command Execution | ✅ | [`session/tools.tsx`](../../packages/cli/src/tui/routes/session/tools.tsx) |
| Command Output | ✅ | [`session/tools.tsx`](../../packages/cli/src/tui/routes/session/tools.tsx) (shown in transcript mode) |
| Search Results | ✅ | [`session/tools.tsx`](../../packages/cli/src/tui/routes/session/tools.tsx) |
| Web Search/Fetch | ✅ | [`session/tools.tsx`](../../packages/cli/src/tui/routes/session/tools.tsx) |
| Subagent | ✅ | [`subagent-progress.tsx`](../../packages/cli/src/tui/components/subagent-progress.tsx) |
| Error Display | ✅ | [`session/tools.tsx`](../../packages/cli/src/tui/routes/session/tools.tsx) |
| Output File Fallback | ✅ | [`output-file.ts`](../../packages/cli/src/tui/util/output-file.ts), [`session/tools.tsx`](../../packages/cli/src/tui/routes/session/tools.tsx) |

---

## 6. Prompt Input

| Feature | Status | Source |
|---|:---:|---|
| Text Input | ✅ | [`prompt-input.tsx`](../../packages/cli/src/tui/components/prompt/prompt-input.tsx), [`use-text-input.ts`](../../packages/cli/src/tui/hooks/use-text-input.ts), [`vim-text-input.tsx`](../../packages/cli/src/tui/components/vim-text-input.tsx) |
| @ Completion | ✅ | [`use-at-completer.ts`](../../packages/cli/src/tui/hooks/use-at-completer.ts), [`useTypeahead.ts`](../../packages/hooks/src/session/useTypeahead.ts) |
| Slash Commands | ✅ | [`use-slash-suggestion.ts`](../../packages/cli/src/tui/hooks/use-slash-suggestion.ts), [`prompt-command-suggestions.tsx`](../../packages/cli/src/tui/components/prompt/prompt-command-suggestions.tsx) |
| History Navigation | ✅ | [`use-arrow-key-history.ts`](../../packages/cli/src/tui/hooks/use-arrow-key-history.ts), [`useCommandHistory.ts`](../../packages/hooks/src/session/useCommandHistory.ts) |
| History Search | ✅ | [`use-history-search.ts`](../../packages/cli/src/tui/hooks/use-history-search.ts), [`history-search-input.tsx`](../../packages/cli/src/tui/components/prompt/history-search-input.tsx) |
| Prompt Stash | ✅ | [`prompt-input.tsx`](../../packages/cli/src/tui/components/prompt/prompt-input.tsx) |
| External Editor | ✅ | [`editor.ts`](../../packages/cli/src/tui/util/editor.ts), [`prompt-input.tsx`](../../packages/cli/src/tui/components/prompt/prompt-input.tsx) |

---

## 7. Token & Context Tracking

| Feature | Status | Source |
|---|:---:|---|
| Token Count | ✅ | [`use-session-stats.ts`](../../packages/cli/src/tui/hooks/use-session-stats.ts), [`context/stats.tsx`](../../packages/cli/src/tui/context/stats.tsx) |
| Context Percentage | ✅ | [`status-line.tsx`](../../packages/cli/src/tui/components/status-line.tsx) |
| Context Breakdown | ✅ | [`dialog-context.tsx`](../../packages/cli/src/tui/components/dialog-context.tsx) |
| Token Warning | ✅ | [`token-warning.tsx`](../../packages/cli/src/tui/components/token-warning.tsx) |
| Cost Display | ✅ | [`dialog-stats.tsx`](../../packages/cli/src/tui/components/dialog-stats.tsx) |

---

## 8. Context Compaction

| Feature | Status | Source |
|---|:---:|---|
| Auto-Compact | ✅ | [`token-warning.tsx`](../../packages/cli/src/tui/components/token-warning.tsx) (`onAutoCompact` at threshold) |
| Manual Compact | ✅ | Slash command via [`prompt-input.tsx`](../../packages/cli/src/tui/components/prompt/prompt-input.tsx) |
| Compact Summary | ✅ | [`compact-summary.tsx`](../../packages/cli/src/tui/components/compact-summary.tsx) |
| Show All | ✅ | [`session/index.tsx`](../../packages/cli/src/tui/routes/session/index.tsx) |
| Circuit Breaker | ✅ | [`use-compact-circuit-breaker.ts`](../../packages/cli/src/tui/hooks/use-compact-circuit-breaker.ts) |

---

## 9. Time Travel / Rewind

| Feature | Status | Source |
|---|:---:|---|
| Turn Navigation | ✅ | [`dialog-rewind.tsx`](../../packages/cli/src/tui/components/dialog-rewind.tsx) |
| Diff Stats | ✅ | [`use-turn-diffs.ts`](../../packages/cli/src/tui/hooks/use-turn-diffs.ts) |
| Restore Options | ✅ | [`dialog-rewind-actions.tsx`](../../packages/cli/src/tui/components/dialog-rewind-actions.tsx) |

---

## 10. Diff Viewer

| Feature | Status | Source |
|---|:---:|---|
| Inline Diff | ✅ | [`structured-diff.tsx`](../../packages/cli/src/tui/components/structured-diff.tsx) |
| Multi-File Navigation | ✅ | [`dialog-diff.tsx`](../../packages/cli/src/tui/components/dialog-diff.tsx) |

---

## 11. Permissions

| Feature | Status | Source |
|---|:---:|---|
| Permission Prompt | ✅ | [`session/permission.tsx`](../../packages/cli/src/tui/routes/session/permission.tsx) |
| Permission Mode | ✅ | [`status-line.tsx`](../../packages/cli/src/tui/components/status-line.tsx) |
| Mode Cycling | ✅ | [`default-bindings.ts`](../../packages/cli/src/tui/keybindings/default-bindings.ts) |

---

## 12. Settings & Configuration

| Feature | Status | Source |
|---|:---:|---|
| Model Selection | ✅ | [`dialog-model.tsx`](../../packages/cli/src/tui/components/dialog-model.tsx), [`dialog-manage-models.tsx`](../../packages/cli/src/tui/components/dialog-manage-models.tsx) |
| Provider Selection | ✅ | [`dialog-provider.tsx`](../../packages/cli/src/tui/components/dialog-provider.tsx) |
| Theme Selection | ✅ | [`dialog-theme.tsx`](../../packages/cli/src/tui/components/dialog-theme.tsx) |
| Output Styles | ✅ | [`dialog-output-style.tsx`](../../packages/cli/src/tui/components/dialog-output-style.tsx) |
| Stats Dashboard | ✅ | [`dialog-stats.tsx`](../../packages/cli/src/tui/components/dialog-stats.tsx), [`use-global-stats.ts`](../../packages/cli/src/tui/hooks/use-global-stats.ts) |
| Help System | ✅ | [`dialog-help-v2.tsx`](../../packages/cli/src/tui/components/dialog-help-v2.tsx) |

---

## 13. Active Operation Feedback

| Feature | Status | Source |
|---|:---:|---|
| Progress Indicator | ✅ | [`spinner.tsx`](../../packages/cli/src/tui/ui/spinner.tsx), [`use-elapsed-time.ts`](../../packages/cli/src/tui/hooks/use-elapsed-time.ts) |
| Stall Detection | ✅ | [`use-stalled-animation.ts`](../../packages/cli/src/tui/hooks/use-stalled-animation.ts) |
| Subagent Progress | ✅ | [`subagent-progress.tsx`](../../packages/cli/src/tui/components/subagent-progress.tsx) |
| Phrase Cycling | ✅ | [`use-phrase-cycler.ts`](../../packages/cli/src/tui/hooks/use-phrase-cycler.ts) |

---

## 14. Search

| Feature | Status | Source |
|---|:---:|---|
| Transcript Search | ✅ | [`transcript-search.tsx`](../../packages/cli/src/tui/components/transcript-search.tsx) |
| Workspace Search | ✅ | [`dialog-search.tsx`](../../packages/cli/src/tui/components/dialog-search.tsx) |
| Cross-Session Search | ✅ | [`fts.ts`](../../packages/core/src/storage/fts.ts) |

---

## 15. MCP & Agents

| Feature | Status | Source |
|---|:---:|---|
| MCP Server List | ✅ | [`dialog-mcp.tsx`](../../packages/cli/src/tui/components/dialog-mcp.tsx) |
| MCP Management | ✅ | [`dialog-mcp.tsx`](../../packages/cli/src/tui/components/dialog-mcp.tsx) |
| Agent Management | ✅ | [`dialog-agent-list.tsx`](../../packages/cli/src/tui/components/dialog-agent-list.tsx), [`dialog-agent-editor.tsx`](../../packages/cli/src/tui/components/dialog-agent-editor.tsx) |
| Memory Management | ✅ | [`dialog-memory.tsx`](../../packages/cli/src/tui/components/dialog-memory.tsx) |

---

## 16. Status Display

| Feature | Status | Source |
|---|:---:|---|
| Model Indicator | ✅ | [`status-line.tsx`](../../packages/cli/src/tui/components/status-line.tsx) |
| Context Usage | ✅ | [`status-line.tsx`](../../packages/cli/src/tui/components/status-line.tsx) |
| Session Cost | ✅ | [`status-line.tsx`](../../packages/cli/src/tui/components/status-line.tsx) |
| Mode Indicator | ✅ | [`status-line.tsx`](../../packages/cli/src/tui/components/status-line.tsx) |
| Working Directory | ✅ | [`dialog-workspace.tsx`](../../packages/cli/src/tui/components/dialog-workspace.tsx) |
| Toast System | ✅ | [`toast-item.tsx`](../../packages/cli/src/tui/components/toast-item.tsx), [`session-layout.tsx`](../../packages/cli/src/tui/components/session-layout.tsx) |

---

## 17. Diagnostics & Error Control

| Feature | Status | Source |
|---|:---:|---|
| Doctor/Diagnostics | ✅ | [`dialog-doctor.tsx`](../../packages/cli/src/tui/components/dialog-doctor.tsx), [`diagnostics.ts`](../../packages/core/src/server/routes/diagnostics.ts) |
| Error Verbosity | ✅ | [`dialog-settings.tsx`](../../packages/cli/src/tui/components/dialog-settings.tsx), [`tui-schema.ts`](../../packages/cli/src/cli/config/tui-schema.ts) |
| Effort Level | ✅ | [`dialog-effort.tsx`](../../packages/cli/src/tui/components/dialog-effort.tsx) |
| Permissions Dialog | ✅ | [`dialog-permissions.tsx`](../../packages/cli/src/tui/components/dialog-permissions.tsx) |
| Plan Mode Indicator | ✅ | [`status-line.tsx`](../../packages/cli/src/tui/components/status-line.tsx) |
| Session Export | ✅ | [`use-session-export.ts`](../../packages/cli/src/tui/hooks/use-session-export.ts), [`dialog-export-options.tsx`](../../packages/cli/src/tui/components/dialog-export-options.tsx) |
| Feedback System | ✅ | [`dialog-feedback.tsx`](../../packages/cli/src/tui/components/dialog-feedback.tsx), [`redact.ts`](../../packages/cli/src/tui/util/redact.ts) |

---

## Summary

| Category | ✅ Done | 🟡 Partial | ❌ Missing | Total |
|---|:---:|:---:|:---:|:---:|
| Session Management | 8 | 0 | 0 | 8 |
| Conversation | 7 | 0 | 0 | 7 |
| Display Density | 7 | 0 | 0 | 7 |
| Thinking / Reasoning | 4 | 0 | 0 | 4 |
| Tool Output | 11 | 0 | 0 | 11 |
| Prompt Input | 7 | 0 | 0 | 7 |
| Token & Context Tracking | 5 | 0 | 0 | 5 |
| Context Compaction | 5 | 0 | 0 | 5 |
| Time Travel / Rewind | 3 | 0 | 0 | 3 |
| Diff Viewer | 2 | 0 | 0 | 2 |
| Permissions | 3 | 0 | 0 | 3 |
| Settings & Configuration | 6 | 0 | 0 | 6 |
| Active Operation Feedback | 4 | 0 | 0 | 4 |
| Search | 3 | 0 | 0 | 3 |
| MCP & Agents | 4 | 0 | 0 | 4 |
| Status Display | 6 | 0 | 0 | 6 |
| Diagnostics & Error Control | 7 | 0 | 0 | 7 |
| **Total** | **92** | **0** | **0** | **92** |

> **Coverage: 100% complete · 0% partial · 0% remaining**

---

## Architectural Strengths (Retain)

These are deliberate advantages over Claude Code and Gemini CLI. Do NOT regress:

1. **Modular hook architecture** — 18 focused hooks vs. Claude's 83 monolithic hooks
2. **SDK-routed file search** — `use-at-completer.ts` offloads to backend, no client-side fs watchers
3. **Separated keybinding system** — 9-file system with parser/matcher/resolver
4. **Priority-based StatusLine** — Graceful segment dropping on narrow terminals
5. **Module-level message queue** — `useSyncExternalStore` avoids React batching delays
6. **Non-modal transcript** — Prompt stays active during `ctrl+o` (Claude swaps the entire screen)
7. **Thinking titles** — First-sentence heuristic + token count (unique to LiteAI)
