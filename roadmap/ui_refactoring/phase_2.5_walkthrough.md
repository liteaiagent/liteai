# Phase 2.5 Walkthrough — Batch 1: Design System Components

## Objective
Port the 12 design system components from the MVP codebase to the new React-based CLI TUI (`packages/cli/src/tui/components/design-system/`), eliminating all `as any` technical debt and ensuring strict alignment with `@liteai/ink` component architecture and the `ThemeColors` context.

## Scope Completed
**Batch 1 only.** Batches 2–4 (rendering components, prompt input, app-specific dialogs) remain unimplemented and are tracked as future work in the Phase 2.5 implementation plan.

## Changes Made

### Design System Components (12 files)
- **Ported from MVP**: `ThemedBox`, `ThemedText`, `Tabs`, `ListItem`, `Pane`, `ProgressBar`, `StatusIcon`, `Divider`, `Byline`, `KeyboardShortcutHint`, `LoadingState`, `Ratchet`
- **Import migration**: All components updated from MVP's local ink to `@liteai/ink`
- **Theme wiring**: All color props typed as `keyof ThemeColors`, resolved via `useTheme()` context

### Type Safety Cleanup
- **Removed `as any` casts**: Purged unsafe `as any` from `Byline`, `Divider`, `ListItem`, `ProgressBar`, `StatusIcon`, `Tabs`, `dialog.tsx`, and `fuzzy-picker.tsx`
- **`ThemedText` & `ThemedBox` adoption**: Migrated legacy Ink `<Text>` and `<Box>` components to themed wrappers where theme color mappings were needed, resolving TypeScript color mapping mismatches
- **ThemeColors validation**: Cleaned up legacy color keys (e.g., `"suggestion"` → `"info"`, `"inactive"` → `"textMuted"`) to align with the `ThemeColors` interface
- **Discriminated unions**: Resolved Ink's strict mutually exclusive `bold` vs `dim` definitions in wrapper components using `as unknown as` casts (narrower than `as any`)
- **`ScrollBoxHandle` export**: Exported from `@liteai/ink` to properly type `useModalScrollRef()`
- **React Fragment types**: Restored standard `<React.Fragment key={...}>` typings

### Phase 2.4 UI Primitive Fixes (carried forward)
- **`fuzzy-picker.tsx`**: Removed residual `as any` casts, adopted `ThemedBox`/`ThemedText`
- **`dialog.tsx`**: Removed `as any`, wired to design system components (`Byline`, `KeyboardShortcutHint`, `Pane`)

## Validation
- `bun turbo typecheck --filter=@liteai/cli` — **4 successful, 4 total**, exit code 0
- `bun lint` — all 11 packages clean, full turbo cache hit
- Zero `as any` casts remaining in Phase 2.5 scope
- Zero React Compiler `$[n]` artifacts in ported code
- Zero SolidJS remnants or `@opentui/core` imports

## Remaining Work (Batches 2–4)

| Batch | Scope | Status |
|-------|-------|--------|
| Batch 2 | Rendering: `markdown.tsx`, `structured-diff.tsx`, `status-line.tsx`, `tool-use-loader.tsx` | ❌ Not started |
| Batch 3 | Prompt input: `components/prompt/`, `text-input.tsx`, `vim-text-input.tsx`, `base-text-input.tsx` | ❌ Not started |
| Batch 4 | App-specific dialogs: 13 `dialog-*.tsx` files | ❌ Not started |

## Review Findings
Reviewed 2026-04-25 — 7 issues found: 1 fixed (stale docstring in `Divider.tsx`), 2 deferred (`FuzzyPicker` callback memoization risks), 4 accepted (justified `as unknown` casts, `@ts-expect-error` suppress). Full details in `review_tracker.md`.
