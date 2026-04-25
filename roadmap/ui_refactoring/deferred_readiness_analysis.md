# Deferred Features — Readiness Analysis

Assessment of all 21 deferred items from `deferred_features.md` and `review_tracker.md` against current codebase state (post-Batch 4 completion).

---

## ✅ Already Done (Resolved)

| # | Feature | Evidence |
|---|---------|----------|
| **#6** | Model Picker / Fast Mode Picker | `dialog-model.tsx` exists (5.9KB), fully ported in Batch 4. |
| **#11** | DialogSelect Search | `dialog-select.tsx` fully rewritten in Batch 4 with `fuzzysort`. |
| **#14** | FuzzyPicker Callback Memoization | Implemented `useRef` stabilization in `fuzzy-picker.tsx`. |
| **#15** | Markdown Table `wrapText` Stub | Swapped stub with `wrapAnsi` from `@liteai/ink`. |
| **#16** | Diff Cache Unbounded | Added strict LRU bounds in `structured-diff.tsx`. |
| **#9** | Multi-Toast Stacking | Refactored `ToastProvider` and `ui/toast.tsx` to handle an array of active toasts. |
| **#10** | FuzzyPicker Fuzzy Matching | Integrated `fuzzysort` via `getSearchString` prop. |
| **#12 / #2** | DialogHelp Dynamic Keybindings / Help Menu | Replaced hardcoded text in `dialog-help.tsx` with dynamic keybind registry. |

---

## 🟡 Ready to Implement Now (Moderate Scope)

Dependencies satisfied. Require more substantial work but no blockers.

| # | Feature | Effort | Why Ready |
|---|---------|--------|-----------|
| **#3** | History Search (Ctrl+R) | ~3-4 hr | `useArrowKeyHistory` hook already exists. Build interactive search on top with `fuzzysort` + inline input. |

---

## 🟠 Feasible but Larger Scope

Could start now, but require more planning/effort.

| # | Feature | Effort | Notes |
|---|---------|--------|-------|
| **#1** | Autocomplete / Suggestions Panel | ~1-2 days | `fuzzysort` available, overlay patterns proven by dialog-select. Needs custom positioning relative to cursor and command registry integration. |
| **#8** | Text Highlighting (Slash/Chips) | ~1-2 days | Requires custom rendering pass in `base-text-input.tsx` to support highlight spans. Non-trivial but no external blockers. |
| **#7** | Prompt Editor ($EDITOR) | ~1 day | Requires `child_process.spawn` with `stdio: 'inherit'` + Ink's `exitTemporarily()` pattern to suspend TUI. Feasible but touches process lifecycle. |
| **#19** | Prompt Suggestion / Speculation | ~1-2 days | Needs streaming suggestion source + custom text rendering for greyed-out predicted text. |

---

## 🔴 Still Blocked

External dependencies not yet satisfied.

| # | Feature | Blocker |
|---|---------|---------|
| **#4** | Stashed Prompt | `usePromptStash()` hook doesn't exist. Needs design + implementation. |
| **#5** | Queued Commands | Message queue infrastructure (`messageQueueManager`) not ported. |
| **#13** | Toast Positioning | Blocked on Phase 2.6 layout architecture. Ink lacks native absolute positioning — need App Shell to define toast placement zone. |
| **#17** | Permission Mode Cycling UI | Blocked on **#18** (core API change). |
| **#18** | Permission Mode Set via API | Requires `packages/core` change (`session.prompt()` or `session.update()` field). Separate PR scope per mandate §4. |

---

## ⛔ Permanently Blocked (Excluded Dependencies)

These depend on features listed in `excluded_features.md` and will never be implemented:

| # | Feature | Reason |
|---|---------|--------|
| **#20** | Footer Pill Navigation | Individual pill features are excluded (Bridge, Tmux, Swarms) or not relevant. The layout pattern may be reused later but the MVP pills themselves are dead. |
| **#21** | Agent Color / Teammate View Routing | Depends on Agent Swarms + Coordinator (both permanently excluded). |

---

## Recommended Priority Order

If you want to start implementing now, here's the suggested order:

1. **#3** — History search (3-4 hr)
2. **#1** — Autocomplete (1-2 days)
3. **#8** — Text Highlighting (1-2 days)
