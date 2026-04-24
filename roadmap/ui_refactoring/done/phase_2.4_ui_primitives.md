# Phase 2.4: UI Primitives (from MVP)

**Branch**: `feat/cli-react`
**Depends on**: Phase 2.3 (all contexts available)
**Produces**: Core UI primitives in `src/tui/ui/` — dialog, toast, fuzzy picker, spinner

## Objective

Port the foundational UI primitives from the **MVP codebase**. These are reusable building blocks that all components and dialogs in phases 2.5–2.6 depend on.

> [!IMPORTANT]
> **Source is MVP, not SolidJS.** These components come from `liteai_cli_mvp/`. The existing SolidJS `ui/` directory is only a feature reference for understanding what capabilities exist.

## Source References

**MVP codebase**: `C:\Users\aghassan\Documents\workspace\liteai_cli_mvp\`

| MVP Source | Port To | Size | Notes |
|-----------|---------|------|-------|
| `liteai_cli_mvp\components\design-system\Dialog.tsx` | `src/tui/ui/dialog.tsx` | 14KB | Modal dialog system |
| `liteai_cli_mvp\context\modalContext.tsx` | (merge into `src/tui/ui/dialog.tsx`) | 6KB | Dialog state management |
| `liteai_cli_mvp\components\design-system\FuzzyPicker.tsx` | `src/tui/ui/fuzzy-picker.tsx` | 41KB | Search/filter overlay |
| `liteai_cli_mvp\context\notifications.tsx` | `src/tui/ui/toast.tsx` | 33KB | Toast notification system |
| `liteai_cli_mvp\components\Spinner.tsx` | `src/tui/ui/spinner.tsx` | 88KB | Animation system |

**Existing SolidJS (feature reference only)**:
| SolidJS Source | Look at for | 
|---------------|-------------|
| `cli/cmd/tui/ui/dialog.tsx` | Dialog stack API shape |
| `cli/cmd/tui/ui/toast.tsx` | Toast variant types |
| `cli/cmd/tui/ui/dialog-alert.tsx` | Alert dialog pattern |
| `cli/cmd/tui/ui/dialog-confirm.tsx` | Confirm dialog pattern |
| `cli/cmd/tui/ui/dialog-select.tsx` | Select dialog pattern |

**SolidJS UI base path**: `c:\Users\aghassan\Documents\workspace\liteai\packages\cli\src\cli\cmd\tui\ui\`
**New React target path**: `c:\Users\aghassan\Documents\workspace\liteai\packages\cli\src\tui\ui\`

## Proposed Changes

### 1. [NEW] `src/tui/ui/dialog.tsx`

**Port from MVP**: `Dialog.tsx` (14KB) + `modalContext.tsx` (6KB)

Dialog/modal system. The MVP's Dialog component provides:
- Stacked modals with backdrop
- Focus trapping
- Escape-to-close
- Flexible content rendering

Wire the dialog state to a React context so any component can push/pop/replace dialogs.

**Adaptation needed**: The MVP's modal context uses its own state. Our existing SolidJS dialog context exposes `{ show, replace, close, current }`. Match this API shape for compatibility with the dialog components in phase 2.5.

### 2. [NEW] `src/tui/ui/fuzzy-picker.tsx`

**Port from MVP**: `FuzzyPicker.tsx` (41KB)

The MVP's fuzzy picker is significantly richer than the old SolidJS version. Features:
- Fuzzy string matching
- Highlighted matches
- Virtual scroll for large lists
- Keyboard navigation
- Category grouping

This is used by dialog-command, dialog-model, dialog-session-list, etc. in phase 2.5.

**Adaptation needed**: May use `@liteai/hooks` `useTypeahead` or `useVirtualScroll` if they overlap.

### 3. [NEW] `src/tui/ui/toast.tsx`

**Port from MVP**: `notifications.tsx` (33KB)

Toast notification system. Features:
- Timed auto-dismiss
- Variant styling (info, warning, error, success)
- Stack multiple toasts
- Position at bottom of terminal

Wire to a React context so any component can show toasts.

### 4. [NEW] `src/tui/ui/spinner.tsx`

**Port from MVP**: `Spinner.tsx` (88KB)

Terminal spinner/animation component. Note: this is a large file — check if it contains compiled React Compiler output and revert to source if so.

### 5. [NEW] `src/tui/ui/dialog-*.tsx` (thin wrappers)

Build these using the MVP's `Dialog` + `FuzzyPicker` primitives from above. Use the existing SolidJS dialog variants as **feature specs only**:

- `dialog-alert.tsx` — simple message alert
- `dialog-confirm.tsx` — yes/no confirmation
- `dialog-prompt.tsx` — text input dialog
- `dialog-select.tsx` — list selection dialog
- `dialog-export-options.tsx` — export format picker
- `dialog-help.tsx` — keybinding help overlay

These are thin wrappers — each ~50-100 lines.

## Verification

```powershell
cd c:\Users\aghassan\Documents\workspace\liteai
bun typecheck 2>&1 | Out-String
bun lint:fix
```

**Gate**: All UI primitives compile. Dialog and toast contexts are accessible via hooks.

## Review Checklist

- [ ] `dialog.tsx` — dialog stack API matches existing shape (`show`, `replace`, `close`)
- [ ] `fuzzy-picker.tsx` — keyboard navigation works
- [ ] `toast.tsx` — auto-dismiss timers work
- [ ] `spinner.tsx` — not compiled React Compiler output (use original source)
- [ ] All thin dialog wrappers compile
- [ ] `bun typecheck` clean
- [ ] `bun lint:fix` clean
