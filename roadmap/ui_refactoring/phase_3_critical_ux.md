# Phase 3: Critical Core UX — Master Plan

> **Status**: In Progress (Phase 3.4 complete)
> **Date**: 2026-04-28 (updated 2026-05-01)
> **Scope**: `packages/cli` (TUI layer)
> **Prerequisites**: Phase 2.x UI migration complete
> **Source**: [cli_feature_gap_analysis.md](./cli_feature_gap_analysis.md), [phase_3_comparison.md](./phase_3_comparison.md)

---

## Implementation Status

| Phase | Title | Status | Detail Doc |
|-------|-------|--------|------------|
| 3.0 | [Session Information Layer](#phase-30) | 🔲 Not Started | [phase_3.0_information_layer.md](./phase_3.0_information_layer.md) |
| 3.1 | [Message Interaction Layer](#phase-31) | 🔲 Not Started | [phase_3.1_message_interaction.md](./phase_3.1_message_interaction.md) |
| 3.2 | [Active Operation UX](#phase-32) | 🔲 Not Started | [phase_3.2_active_operation_ux.md](./phase_3.2_active_operation_ux.md) |
| 3.3 | [Input Productivity](#phase-33) | ⚠️ Partial | [phase_3.3_input_productivity.md](./phase_3.3_input_productivity.md) |
| 3.4 | [Keybinding & Help System](#phase-34) | ✅ Complete | [phase_3.4_keybinding_help.md](./phase_3.4_keybinding_help.md) |

---

## Current Codebase Inventory

What exists today in `packages/cli/src/tui/`:

| Component | File(s) | Status |
|-----------|---------|--------|
| **Keybinding System** | `keybindings/` (9 files) | ✅ Complete — 17 contexts, chord support, user-configurable |
| **Status Line** | `components/status-line.tsx` (32 lines) | ⚠️ Minimal — model/CWD/status only |
| **Spinner** | `ui/spinner.tsx` (61 lines) | ⚠️ Basic — animated dots, no stall detection |
| **Tool Use Loader** | `components/tool-use-loader.tsx` (40 lines) | ⚠️ Basic — blinking dot, no timing |
| **Message Actions Bar** | `components/message-actions-bar.tsx` (51 lines) | ⚠️ Shell — renders action hints, no navigation logic |
| **Clipboard** | `hooks/use-clipboard.ts` (92 lines) | ✅ Done — OSC-52 + platform fallback |
| **History (Arrow Keys)** | `hooks/use-arrow-key-history.ts` (208 lines) | ✅ Done — chunk-based lazy loading |
| **History (Ctrl+R Search)** | `hooks/use-history-search.ts` (80 lines) | ✅ Done — fuzzy search via `fuzzysort` |
| **History Search Input** | `components/prompt/history-search-input.tsx` | ✅ Done — inline search input |
| **Slash Suggestions** | `hooks/use-slash-suggestion.ts` (52 lines) | ✅ Done — inline ghost text for `/commands` |
| **Command Suggestions** | `components/prompt/use-command-suggestions.ts` | ✅ Done — dropdown list with navigation |
| **Prompt Input** | `components/prompt/prompt-input.tsx` (628 lines) | ✅ Substantial — modes, paste, history, suggestions |
| **Structured Diff** | `components/structured-diff.tsx` (152 lines) | ✅ Done — cached diff rendering |
| **Scroll Handler** | `components/scroll-handler.tsx` (336 lines) | ✅ Done — wheel accel, page/line/home/end |
| **Virtual Message List** | `components/virtual-message-list.tsx` (362 lines) | ✅ Done — virtualized with sticky prompt |
| **Tips** | `components/tips.tsx` (174 lines) | ✅ Done — dynamic keybind labels |

---

## Phase Dependencies

```
Phase 3.4 ──── DONE
    │
    ├── Phase 3.0 (Information Layer) ─────── standalone
    │       │
    │       └── Phase 3.1 (Message Interaction) ── depends on 3.0 token data
    │
    ├── Phase 3.2 (Active Operation UX) ──── standalone
    │
    └── Phase 3.3 (Input Productivity) ───── standalone (mostly done)
```

Phase 3.0, 3.2, and 3.3 can proceed in parallel. Phase 3.1 depends on 3.0's token/cost data for context-aware actions (e.g., compact suggestion when context is high).

---

## Cross-Cutting Concerns

### Error Handling
All new components must:
- Throw structured errors on invalid state (per mandate §5)
- Display errors in toast via `useToast()` for recoverable failures
- Log via `Log.create()` for debugging

### Performance
- `useSessionStats` must memoize aggregations — recalculate only when message list changes
- File completer must debounce filesystem reads (100ms minimum)
- Autocomplete overlay must not cause layout reflow in the main ScrollBox
- Use `useSyncExternalStore` for store-backed reactive data (not `useEffect` polling)

### Testing Strategy
- Unit tests for `use-session-stats`, `use-elapsed-time`, `use-file-completer`
- Integration tests for StatusLine rendering with mock sync data
- Scoped: `bun test test/tui/` (do NOT run full suite)

---

## Effort Summary (Updated)

| Phase | Scope | Est. Effort | Status |
|-------|-------|-------------|--------|
| 3.0 | StatusLine, session stats, cost, context %, compaction | 2 days | 🔲 Not Started |
| 3.1 | Message navigation, keyboard actions, thinking toggle | 3 days | 🔲 Not Started |
| 3.2 | Rich spinner, stall detection, tool timing, subagent tree | 2 days | 🔲 Not Started |
| 3.3 | Autocomplete overlay, file completion, @ mentions | 1 day | ⚠️ Mostly Done |
| 3.4 | Keybinding contexts, help dialog, customization | — | ✅ Complete |

**Remaining**: ~8 days

---

## Comparison References

Detailed feature-by-feature comparison against Claude Code (`D:\claude-code`) and Gemini CLI (`D:\gemini-cli\packages\cli`):
- [phase_3_comparison.md](./phase_3_comparison.md)

---

## References

- [cli_feature_gap_analysis.md](./cli_feature_gap_analysis.md) — Source gap analysis
- [excluded_features.md](./excluded_features.md) — Permanently excluded features
- [deferred_features.md](./deferred_features.md) — Deferred features & dependencies
- [deferred_readiness_analysis.md](./deferred_readiness_analysis.md) — Readiness assessment
- [ui-migration-rfc.md](./ui-migration-rfc.md) — Architecture context
