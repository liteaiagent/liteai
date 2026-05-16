# Phase 2: Component Migration

> **Status**: Completed  
> **Depends On**: Phase 1 (Standard Primitives)  
> **Estimated Effort**: Medium-High (~1-2 weeks)

---

## Agent Context

Load these files before starting implementation.

### Roadmap Docs
- `d:\liteai\roadmap\tui-overhaul\phase-2-migration.md` — this file (migration table, wave order)
- `d:\liteai\roadmap\tui-overhaul\design\root-cause-analysis.md` — raw `useInput` audit (18 files)

### LiteAI Source (primitives built in Phase 1)
- `d:\liteai\packages\cli\src\tui\primitives\index.ts` — barrel export of all primitives
- `d:\liteai\packages\cli\src\tui\primitives\use-select-list.ts` — headless selection hook
- `d:\liteai\packages\cli\src\tui\primitives\use-dialog-lifecycle.ts` — lifecycle hook
- `d:\liteai\packages\cli\src\tui\primitives\select-list.tsx` — selection rendering
- `d:\liteai\packages\cli\src\tui\primitives\dialog-pane.tsx` — dialog chrome

### LiteAI Source (migration targets — load per wave)

**Wave 1 (Critical Path):**
- `d:\liteai\packages\cli\src\tui\ui\dialog-select.tsx` — main refactor target
- `d:\liteai\packages\cli\src\tui\routes\session\question.tsx` — question tool
- `d:\liteai\packages\cli\src\tui\ui\dialog-confirm.tsx` — simple confirm
- `d:\liteai\packages\cli\src\tui\ui\dialog-alert.tsx` — simple alert

**Wave 2 (Settings & Navigation):**
- `d:\liteai\packages\cli\src\tui\components\dialog-session-list.tsx`
- `d:\liteai\packages\cli\src\tui\components\dialog-stats.tsx`
- `d:\liteai\packages\cli\src\tui\components\dialog-plugin.tsx`
- `d:\liteai\packages\cli\src\tui\components\dialog-rewind.tsx`
- `d:\liteai\packages\cli\src\tui\components\design-system\Tabs.tsx`
- `d:\liteai\packages\cli\src\tui\app.tsx`

**Wave 3 (Remaining):**
- `d:\liteai\packages\cli\src\tui\components\dialog-feedback.tsx`
- `d:\liteai\packages\cli\src\tui\components\dialog-export-options.tsx`
- `d:\liteai\packages\cli\src\tui\ui\fuzzy-picker.tsx`
- `d:\liteai\packages\cli\src\tui\components\feedback-survey.tsx`

### Reference (not required — primitives are built)
No external reference files needed. Primitives from Phase 1 are the implementation target.


## Goal

Migrate all existing dialog components from ad-hoc `useInput`/inline selection logic to the standard primitives built in Phase 1. By the end of this phase, every dialog uses `useSelectList`, `useDialogLifecycle`, and `DialogPane`.

---

## The Migration

### Raw `useInput` Audit (18 Files)

These files bypass the keybinding system with raw `useInput`. Each is a potential input conflict:

| File | Current Pattern | Migration Target | Priority |
|------|----------------|-----------------|----------|
| `prompt-input.tsx` | `useInput` for all input processing | **Keep** — character-level input, not a dialog | Exception |
| `base-text-input.tsx` | `useInput` for text editing | **Keep** — low-level text input primitive | Exception |
| `keybinding-setup.tsx` | `useInput` as interceptor | **Keep** — routes keys to context system | Exception |
| `scroll-handler.tsx` | `useInput` for scroll events | **Keep** — low-level scroll handling | Exception |
| `dialog-confirm.tsx` | `useInput` for enter/esc | → `useDialogLifecycle` + simple keybinding | P1 |
| `dialog-alert.tsx` | `useInput` for any key dismiss | → `useDialogLifecycle` | P1 |
| `question.tsx` | `useInput` for tab/up/esc | → `useSelectList` + `useDialogLifecycle` | P1 |
| `dialog-session-list.tsx` | `useInput` for enter/esc | → `useSelectList` + `useDialogLifecycle` | P2 |
| `dialog-stats.tsx` | `useInput` for esc | → `useDialogLifecycle` | P2 |
| `dialog-plugin.tsx` | `useInput` for navigation | → `useSelectList` | P2 |
| `dialog-rewind.tsx` | `useInput` for navigation | → `useSelectList` | P2 |
| `dialog-feedback.tsx` | `useInput` for number keys | → `useSelectList` | P3 |
| `dialog-export-options.tsx` | `useInput` for navigation | → `useSelectList` | P3 |
| `Tabs.tsx` | `useInput` for tab/arrows | → `useKeybindings` with `"Tabs"` context | P2 |
| `fuzzy-picker.tsx` | `useInput` for arrows/enter | → `useSelectList` | P3 |
| `feedback-survey.tsx` | `useInput` for selection | → `useSelectList` | P3 |
| `dialog-select.tsx` | `useInput` in embedded TextInput | → Split into `useSelectList` + `SelectList` | P1 |
| `app.tsx` | `useInput` for global keys | → `useKeybindings` with `"App"` context | P2 |

**Target: 4 exceptions, 14 migrations.**

---

## Migration Waves

### Wave 1: Critical Path (Blocks Other Work)

These components are used most frequently and cause the most visible bugs.

#### `DialogSelect` → Split Architecture

The most impactful migration. `DialogSelect` is a 323-line monolith that combines input handling, filtering, navigation, AND rendering.

**Before:**
```tsx
// DialogSelect.tsx — 323 lines, monolith
function DialogSelect({ items, onSelect, onEscape, ... }) {
  // inline useInput for navigation
  // inline useKeybindings for selection
  // inline TextInput for filtering
  // inline rendering
}
```

**After:**
```tsx
// Thin wrapper that composes primitives
function DialogSelect({ items, onSelect, onEscape, ... }) {
  useDialogLifecycle({ contextName: "Select", onClose: onEscape })
  const selection = useSelectList({ items, onSelect })
  
  return (
    <DialogPane title={title} footerHints={hints}>
      {filterable && <FilterInput value={filter} onChange={setFilter} />}
      <SelectList items={filteredItems} activeIndex={selection.activeIndex} />
    </DialogPane>
  )
}
```

`DialogSelect` becomes a backward-compatible wrapper (~50 lines) that delegates to primitives. Existing consumers don't need to change their call sites.

#### `PermissionPrompt` → `useSelectList`

Replace inline selection logic (Allow/Reject/Allow Always) with `useSelectList`.

#### `QuestionPrompt` → `useSelectList` + `useDialogLifecycle`

Replace inline `useInput` with standard hooks. Critical for the Question Tool UX.

---

### Wave 2: Settings & Navigation Dialogs

#### `dialog-session-list.tsx`
Replace `useInput(enter/esc)` with `useSelectList` for session navigation + `useDialogLifecycle` for Esc.

#### `dialog-stats.tsx`
Replace `useInput(esc)` with `useDialogLifecycle`.

#### `dialog-plugin.tsx`, `dialog-rewind.tsx`
Replace inline navigation with `useSelectList`.

#### `Tabs.tsx`
Migrate from raw `useInput` to `useKeybindings` with `"Tabs"` context. This is a shared component used by `dialog-config.tsx` and others.

#### `app.tsx`
Migrate global `useInput` handlers to `useKeybindings` with `"App"` context.

---

### Wave 3: Remaining Dialogs

#### `dialog-feedback.tsx`, `feedback-survey.tsx`
Replace number-key selection with `useSelectList` (which already handles 1-9 quick select).

#### `dialog-export-options.tsx`
Replace navigation with `useSelectList`.

#### `fuzzy-picker.tsx`
Refactor to compose with `useSelectList` for arrow/enter handling, keeping fuzzy search logic separate.

---

## Migration Protocol

For each component:

1. **Audit**: Identify all `useInput` calls and what they handle
2. **Map**: Determine which primitive replaces each behavior
3. **Implement**: Swap `useInput` for primitive hooks
4. **Test**: Run scoped tests (`bun test test/tui/<component>`)
5. **Verify**: Manual smoke test of the dialog
6. **Typecheck**: `bun typecheck 2>&1 | Out-String`
7. **Lint**: `bun lint:fix`

### Backward Compatibility Rule

Existing component APIs (props) should not change during migration. The refactoring is **internal** — consumers don't need to update their call sites. If an API change is needed, it must be called out explicitly.

---

## Provider Flow (Special Case)

The provider authentication dialog (`dialog-provider.tsx`) is the most complex case — 4+ screens deep with conditional branching. It already uses the correct ViewState pattern:

```typescript
type ViewState =
  | { type: "list" }
  | { type: "select-method"; providerID: string; methods: AuthMethod[] }
  | { type: "method"; providerID: string; method: AuthMethod }
  | { type: "connecting"; providerID: string }
  | { type: "error"; providerID: string; error: string }
```

**Migration approach**: Keep ViewState, add `useDialogLifecycle` to each sub-view, replace inline selection with `useSelectList`:

```tsx
function ProviderListView({ onClose, onNavigate }) {
  useDialogLifecycle({ contextName: "ProviderList", onClose })
  const selection = useSelectList({ items: providers, onSelect: handleSelect })
  
  return (
    <DialogPane title="Providers" footerHints={[...]}>
      <SelectList items={providers} activeIndex={selection.activeIndex} />
    </DialogPane>
  )
}
```

---

## Acceptance Criteria

- [ ] Zero raw `useInput` in dialog components (14 files migrated)
- [ ] 4 documented exceptions with inline justification comments
- [ ] `DialogSelect` refactored to compose primitives (~50 lines vs current 323)
- [ ] All existing dialog APIs (props) preserved — no consumer changes
- [ ] `bun typecheck` passes
- [ ] `bun lint:fix` passes
- [ ] Manual smoke test: all 18 slash commands functional in both BlankSession and SessionRoute
