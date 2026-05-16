# Root Cause Analysis & Problem Taxonomy

> **Consolidated from**: `settings-ui-overhaul/02-root-cause-analysis.md` + `tui-architecture/01-current-problems.md`

---

## Problem Taxonomy

Every TUI bug falls into one of four categories:

### Category 1: Missing Handlers (Cheapest to Fix)

Components that render UI hints (e.g., "press Esc to close") but never register the corresponding handler.

| Component | Symptom | Root Cause |
|-----------|---------|------------|
| `AutoMethod` in `dialog-provider.tsx` | Esc doesn't work | No `useKeybindings` call |
| Several dialog sub-views | Esc closes wrong thing | Handler on parent, not current view |

**Cost**: Minutes per instance. No architecture change needed.

### Category 2: Input Conflicts (Systemic — Needs Protocol)

Multiple components register `useInput` or `useKeybindings` simultaneously, and the wrong one wins.

| Scenario | Symptom | Root Cause |
|----------|---------|------------|
| Modal open + PromptInput mounted | Keystrokes go to prompt | PromptInput's `useInput` has no `isFocused` gate |
| `/` suggestions visible + up/down | Arrows don't navigate suggestions | PromptInput's handler fires first |
| Question tool + global keybindings | Tab key conflicts | Raw `useInput` bypasses context system |

**Cost**: Requires enforcing the keybinding context protocol.

### Category 3: Layout Slot Misuse (Moderate)

Components rendering in the wrong slot, causing visual overlap or clipping.

| Scenario | Symptom | Root Cause |
|----------|---------|------------|
| Modal pane overlaps prompt | Prompt visible behind modal | Modal uses absolute positioning |
| Auth URL wraps incorrectly | Spaces when copy-pasting | `<Text>` wraps long strings |

**Cost**: Slot assignment change + `wrap="truncate"`.

### Category 4: Missing Standard Components (Investment)

Each dialog reinvents selection/navigation/chrome:

| Pattern | Current Implementations |
|---------|------------------------|
| Select list (up/down/enter) | `DialogSelect`, `PermissionPrompt`, `QuestionPrompt`, `Tabs`, `FuzzyPicker` (5+) |
| Dialog chrome (border, title, footer) | `ThemedBox`, `Pane`, inline `<Box>` (3+ patterns) |
| Esc-to-close lifecycle | Manual `useKeybindings` in each component |

**Cost**: Build 3-4 shared components + migrate.

---

## Structural Defects (Detailed)

### Bug #1: BlankSession Modal Void ✅ FIXED

`BlankSession` had no consumer of `modalPane.content`. Modal stored in context but never rendered to DOM. **Status: Fixed** in conversation `3c7f0cae`.

### Bug #2: Dual `useInput` Conflict ⚠️ PARTIALLY FIXED

`DialogSelect` has both `TextInput` (with `useInput`) AND `useKeybindings` processing the same keys.

**Partially fixed**: `inputFilter` blocks navigation keys from TextInput (conversation `5d1cd26f`). But two hooks still register — the fix is a filter, not structural elimination.

**Full fix**: Phase 2 refactors `DialogSelect` to compose primitives (one `useKeybindings` call, no competing `useInput`).

### Bug #3: `j`/`k`/`space` Keybinding Conflicts ✅ FIXED

Vim navigation bindings (`j`/`k`) conflicted with typing in filter input. `space` triggered `select:accept` while user was searching.

**Status: Fixed** — `j`/`k` removed from Select context in conversation `5d1cd26f`.

### Bug #4: `useNavigation.replace` Race Condition ⚠️ OPEN

```typescript
replace: (content) => {
  modalPane.closeModal()      // setState(null)  
  modalPane.openModal(content) // setState(content)
}
```

React may not batch in all async paths → focus flicker. **Fix**: Phase 3 introduces atomic `replaceTop`.

### Bug #5: Escape Deadlock in Nested Dialogs ⚠️ OPEN

When `DialogConfig` → opens `DialogModel`:
- Both bind Escape in different contexts
- Which fires first is non-deterministic
- Result: Escape may close everything, or close the wrong thing

**Fix**: Phase 3 introduces modal stack with push/pop semantics.

---

## Raw `useInput` Audit (18 Files)

Files bypassing the keybinding system:

```
packages/cli/src/tui/
├── components/base-text-input.tsx          ← EXCEPTION: character-level input
├── components/prompt/prompt-input.tsx      ← EXCEPTION: main prompt input
├── components/scroll-handler.tsx           ← EXCEPTION: low-level scroll
├── components/feedback-survey.tsx          ← MIGRATE to useSelectList
├── components/dialog-stats.tsx             ← MIGRATE to useDialogLifecycle
├── components/dialog-plugin.tsx            ← MIGRATE to useSelectList
├── components/dialog-rewind.tsx            ← MIGRATE to useSelectList
├── components/dialog-feedback.tsx          ← MIGRATE to useSelectList
├── components/dialog-session-list.tsx      ← MIGRATE to useSelectList
├── components/design-system/Tabs.tsx       ← MIGRATE to useKeybindings
├── routes/session/question.tsx             ← MIGRATE to useSelectList + useDialogLifecycle
├── ui/fuzzy-picker.tsx                     ← MIGRATE to useSelectList
├── ui/dialog-select.tsx                    ← SPLIT into hook + component
├── ui/dialog-export-options.tsx            ← MIGRATE to useSelectList
├── ui/dialog-confirm.tsx                   ← MIGRATE to useDialogLifecycle
├── ui/dialog-alert.tsx                     ← MIGRATE to useDialogLifecycle
├── keybinding-setup.tsx                    ← EXCEPTION: keybinding interceptor
├── app.tsx                                 ← MIGRATE to useKeybindings
```

**Summary**: 4 exceptions (legitimate raw input), 14 migrations needed.

---

## Assessment

> **Categories 1 + 3**: Mostly fixed in prior sessions.  
> **Category 2**: Partially fixed (inputFilter). Full fix in Phase 2-3.  
> **Category 4**: This is the real investment — Phase 1 delivers the shared primitives.
