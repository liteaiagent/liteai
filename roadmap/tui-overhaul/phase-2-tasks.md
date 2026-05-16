# Phase 2: Migration Tasks

> Last audited: 2026-05-16T16:21 local
> Typecheck status: ✅ 14/14 (zero errors)
> Legacy `dialog-select` imports: ✅ 0 remaining

---

## ✅ DONE — SelectPane Consumer Migration (Step 5)

All 19 dialogs migrated from `DialogSelect` → `SelectPane`. Zero legacy imports.

| File | Status |
|------|--------|
| dialog-output-style.tsx | ✅ |
| dialog-manage-models.tsx | ✅ |
| dialog-mcp.tsx | ✅ |
| dialog-model.tsx | ✅ |
| dialog-skill.tsx | ✅ |
| dialog-permissions.tsx | ✅ |
| dialog-tag.tsx | ✅ |
| dialog-config.tsx | ✅ actionMap dispatch pattern |
| dialog-theme.tsx | ✅ SelectPaneRef |
| dialog-workspace.tsx | ✅ both sub-components |
| dialog-agent-list.tsx | ✅ |
| thinking-toggle.tsx | ✅ |
| dialog-plugin.tsx | ✅ useInput tab cycling → useKeybindings |
| dialog-provider.tsx | ✅ all sub-views + useProviderDisplayOptions |
| dialog-rewind-actions.tsx | ✅ |
| dialog-session-list.tsx | ✅ useKeybindings for ctrl shortcuts |
| dialog-export-options.tsx (components/) | ✅ |
| dialog-agent-list.tsx | ✅ |
| dialog-effort.tsx | ✅ (was already on new API) |

---

## 🔲 Step 6 — Delete Orphaned Legacy Files in `ui/`

All consumers have been migrated. These files have no importers from component code.

- [ ] Delete `ui/dialog-select.tsx` — ✅ zero consumers confirmed
- [ ] Delete `ui/dialog-export-options.tsx` — the old `useInput`/`Dialog`-based version; `prompt-input.tsx` already imports from `components/dialog-export-options`

> ⚠️ `ui/dialog.tsx` **cannot** be deleted yet — still consumed by:
> - `dialog-help-v2.tsx` (Dialog)
> - `dialog-rewind.tsx` (Dialog)
> - `dialog-feedback.tsx` (Dialog)
> - `dialog-diff.tsx` (Dialog)
> - `dialog-context.tsx` (Dialog)
> - `components/design-system/Tabs.tsx` (useIsInsideModal, useModalScrollRef)
> - `components/design-system/Pane.tsx` (useIsInsideModal)

---

## 🔲 Step 7 — Migrate `useInput` → `useKeybindings` in UI Primitives

These are `ui/` files still using raw `useInput`. They are not `DialogSelect` consumers but need the same keybinding modernization pass.

- [ ] `ui/dialog-alert.tsx` → replace `useInput(escape)` with `useDialogLifecycle`
- [ ] `ui/dialog-confirm.tsx` → replace `useInput` with `useKeybindings("Confirmation")`

---

## 🔲 Step 8 — Migrate `useInput` → `useKeybindings` in Components

Non-SelectPane components that still use raw `useInput` for navigation.

- [ ] `components/dialog-stats.tsx` — `useInput(escape + left/right)` → `useKeybindings("Tabs")`
- [ ] `components/dialog-rewind.tsx` — `useInput(f/r/escape)` → `useKeybindings`
- [ ] `components/dialog-plugin.tsx` (RemoveMarketplace sub-dialog) — `useInput(enter/escape)` → `useKeybindings`
- [ ] `routes/session/question.tsx` — dual `useInput` blocks → `useKeybindings`
- [ ] `components/design-system/Tabs.tsx` — dual `useInput` → `useKeybindings("Tabs")`

> `app.tsx` `useInput` is intentional (global chord interceptor) — leave as-is.
> `scroll-handler.tsx`, `base-text-input.tsx`, `prompt-input.tsx` — structural, not modal nav — out of scope.

---

## 🔲 Step 9 — FuzzyPicker Elimination

- [ ] `components/dialog-search.tsx` → rewrite using `SelectPane` (server-side search, `skipFilter=true`)
- [ ] `components/dialog-memory.tsx` → rewrite using `SelectPane`
- [ ] Delete `ui/fuzzy-picker.tsx` (after both consumers removed)

---

## 🔲 Step 10 — Feedback System Removal

The feedback system was decided to be removed (replaced by command palette in a future phase). No active consumers of `useFeedbackSurvey` outside its own definition.

- [ ] Delete `components/dialog-feedback.tsx`
- [ ] Delete `components/feedback-survey.tsx`
- [ ] Delete `hooks/use-feedback-survey.ts`
- [ ] Remove `DialogFeedback` import + render site in `components/prompt/prompt-input.tsx`

---

## 🔲 Step 11 — Delete `ui/dialog.tsx` + Migrate Its Consumers

Only unblocks after Steps 8 and 10 are complete (all `Dialog` consumers migrated).

- [ ] `dialog-help-v2.tsx` — replace `<Dialog>` wrapper with `<DialogPane>` primitive
- [ ] `dialog-rewind.tsx` — replace `<Dialog>` wrapper (Step 8 prerequisite)
- [ ] `dialog-diff.tsx` — replace `<Dialog>` wrapper with `<DialogPane>`
- [ ] `dialog-context.tsx` — replace `<Dialog>` wrapper
- [ ] `Tabs.tsx` / `Pane.tsx` — extract `useIsInsideModal` to `context/modal-context`
- [ ] Delete `ui/dialog.tsx`

---

## 🔲 Step 12 — Final Verification

- [ ] `bun typecheck` — must be 0 errors
- [ ] `bun lint:fix` — source files must be warning-free (test file `any` warnings are pre-existing)
- [ ] `bun test packages/cli/test/tui/` — scoped TUI test suite
- [ ] Manual smoke test of all migrated dialogs
