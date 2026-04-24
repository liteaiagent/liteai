# Phase 2.4 UI Primitives Implementation Plan

This plan details the full, clean-slate porting of core UI primitives from the MVP codebase to the new React-based CLI TUI, strictly adhering to the "Zero Backward Compatibility" and "Clean Code Paradigm" mandates.

## User Review Required

> [!IMPORTANT]
> To comply with the mandate against adapter code and shims, I have abandoned the previous proposal to wrap the MVP Dialog to match the legacy SolidJS API. 
> 
> Instead, I will port the MVP Dialog components (`Dialog.tsx`, `modalContext.tsx`, etc.) natively as clean React implementations. We will NOT create a shim `DialogContext` (with `push`/`replace`/`pop`). When we migrate Phase 2.5/2.6 components, we will refactor them to use the new native React modal/dialog patterns rather than trying to preserve the old SolidJS stack manager.
> 
> Is this clean-slate porting approach approved?

## Proposed Changes

### `packages/cli`

#### [NEW] src/tui/ui/dialog.tsx
- Port `Dialog.tsx` and `modalContext.tsx` from MVP.
- Integrate them cleanly as React primitives without legacy API shims.

#### [NEW] src/tui/ui/toast.tsx
- Port `notifications.tsx` from MVP.
- Cleanly adapt its Toast API as a pure React implementation.

#### [NEW] src/tui/ui/fuzzy-picker.tsx
- Port `FuzzyPicker.tsx` from MVP cleanly without attempting to shoehorn legacy hook compatibility unless it naturally aligns with the modern hooks.

#### [NEW] src/tui/ui/spinner.tsx
- Port `Spinner.tsx` from MVP, extracting from source to avoid React Compiler artifacts.

#### [NEW] src/tui/ui/dialog-*.tsx (Native Ports)
- Port the legacy `dialog-alert.tsx`, `dialog-confirm.tsx`, `dialog-prompt.tsx`, etc., as *native React components* built directly on top of the newly ported MVP `Dialog` primitive. These will be modern implementations, not thin backward-compatible wrappers.

## Verification Plan

### Automated Tests
- `bun typecheck` to ensure full type safety.
- `bun lint:fix` to ensure Biome formatting and rules compliance.

### Manual Verification
- Visual inspection of the code to confirm it is not the React Compiler output (for `Spinner.tsx`).
- Ensure all context hooks (`useDialog`, `useToast`) are exported correctly.
