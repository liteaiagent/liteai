# Phase 2: Migration Tasks

> Last audited: 2026-05-16T16:39 local
> Typecheck: ✅ 14/14 (zero errors)
> Lint: ✅ 0 production errors (7 pre-existing test-file warnings in use-select-list.test.ts)

---

## ✅ DONE — Steps 1–5: SelectPane Consumer Migration
All 19 dialogs migrated from `DialogSelect` → `SelectPane`. Zero legacy imports.

## ✅ DONE — Step 6: Delete Orphaned Legacy `ui/` Files
- [x] Deleted `ui/dialog-select.tsx`
- [x] Deleted `ui/dialog-export-options.tsx` (old useInput/Dialog version)

## ✅ DONE — Step 7: `ui/dialog-alert` + `ui/dialog-confirm` → `useKeybindings`
- [x] `ui/dialog-alert.tsx` → `useKeybindings("Confirmation")` confirm:yes
- [x] `ui/dialog-confirm.tsx` → `useKeybindings("Confirmation")` confirm:yes/no/previous/next

## ✅ DONE — Step 8: Remaining `useInput` → `useKeybindings` in Components
- [x] `components/dialog-stats.tsx` → `useKeybindings("Tabs")` tab cycle + `r` → `select:cycleRange`
- [x] `components/dialog-rewind.tsx` → `useKeybindings("Select")` f/r direct-action shortcuts
- [x] `components/dialog-plugin.tsx` (RemoveMarketplace) → `useKeybindings("Confirmation")`
- [x] `routes/session/question.tsx` → `useKeybindings("Tabs"/"Select")` mode switching
- [x] `components/design-system/Tabs.tsx` → `useKeybindings("Tabs")` both header + content opt-in blocks

## ✅ DONE — Step 9: FuzzyPicker Elimination
- [x] `components/dialog-search.tsx` → `SelectPane` with `skipFilter=true` + `onFilter` (server-side search)
- [x] `components/dialog-memory.tsx` → `SelectPane` with built-in fuzzysort filter
- [x] Deleted `ui/fuzzy-picker.tsx`

## ✅ DONE — Step 10: Feedback System Removal
- [x] Deleted `components/dialog-feedback.tsx`
- [x] Deleted `components/feedback-survey.tsx`
- [x] Deleted `hooks/use-feedback-survey.ts`
- [x] Removed `DialogFeedback` import + `feedback:` interceptor from `prompt/prompt-input.tsx`

## ✅ DONE — Step 11: ModalContext Unification + `Dialog` Consumer Migration

### ModalContext
- [x] `context/modal-context.ts` — canonical source (pre-existing, now the single definition)
- [x] `session-layout.tsx` — removed duplicate local `ModalContext`; now imports from `context/modal-context`
- [x] `Pane.tsx` — import updated to `context/modal-context`
- [x] `Tabs.tsx` — import updated to `context/modal-context`; fixed `RefObject<ScrollBoxHandle | null>` type

### Dialog consumers → Pane
- [x] `components/dialog-help.tsx` *(renamed from dialog-help-v2)* — `<Pane>` + `help:dismiss` keybinding
- [x] `components/dialog-diff.tsx` — `<Pane>` + existing `diff:dismiss` keybinding
- [x] `components/dialog-context.tsx` — `<Pane>` + `useKeybinding("confirm:no")`
- [x] `components/dialog-rewind.tsx` — `<Pane>` + existing `select:cancel` keybinding

### ui/dialog.tsx
- Intentionally retained for `dialog-alert` + `dialog-confirm` (confirm/cancel chrome with auto `confirm:no` registration).
- ModalContext re-exported from `context/modal-context` — zero duplicate definitions.
- `prompt-input.tsx` updated: `DialogHelpV2` → `DialogHelp`, `dialog-help-v2` → `dialog-help`

---

## 🔲 Step 12 — Final Verification
- [ ] `bun test packages/cli/test/tui/` — scoped TUI test suite
- [ ] Manual smoke test: SelectPane dialogs, question prompt, rewind, search, memory, help, diff, context
