# Phase 1: Standard Primitives — Execution Report

> **Status**: Complete  
> **Executed**: 2026-05-16  
> **Spec**: [phase-1-primitives.md](./phase-1-primitives.md)  
> **Design Doc**: [design/decisions.md](./design/decisions.md)

---

## Decisions Made During Execution

Decisions taken during implementation that deviate from, refine, or extend the original spec. These are **locked** and apply to all downstream phases.

### D-EX-1: Digit Keys via Keybinding Protocol (Not `useInput`)

**Context**: The spec requires number key quick-select (1–9), but Decision 6 bans raw `useInput` in dialog components. The spec didn't specify *how* digits should be captured.

**Decision**: Register digit keys as formal keybinding actions (`select:digit0` through `select:digit9`) in the `Select` context of `default-bindings.ts`. Handlers are conditionally included in `useKeybindings` only when `showNumbers=true`.

**Tradeoff considered**: Using raw `useInput` gated by `isFocused && showNumbers` would have been simpler but violates the architectural protocol. The 10 extra bindings are verbose but keep digit handling under the same focus-arbitration rules as all other input.

**Impact**: `default-bindings.ts` gained 11 lines (10 digits + comment). Future digit-consuming contexts must be aware that the `Select` context captures `0-9` when active.

---

### D-EX-2: Esc Ownership — `useDialogLifecycle` Exclusively

**Context**: The spec shows both `useDialogLifecycle` and `useSelectList` accepting the `"Select"` keybinding context, which includes `select:cancel` (Esc). Ambiguity on which hook handles Esc.

**Decision**: `useDialogLifecycle` is the exclusive owner of `select:cancel`. `useSelectList` never registers a cancel handler. When `onClose` fires, the component unmounts, and `useSelectList`'s `useEffect` cleanup handles timer/buffer teardown.

**Rationale**: 
- Single responsibility — lifecycle hook manages lifecycle, selection hook manages selection.
- `preventCloseOn` guard logic has one home (no race condition between two hooks checking dirty state).
- Dialogs without selection lists (e.g., confirmation dialogs) still get Esc handling via lifecycle alone.
- Zero behavioral cost — on unmount, React cleanup fires automatically.

---

### D-EX-3: Scroll Windowing Owned by `SelectList` Component (Not Hook)

**Context**: The spec's `SelectListState` return type included `visibleItems[]` and `scrollOffset`, implying the hook manages windowing. This would require the hook to accept a `visibleCount` parameter.

**Decision**: Removed `visibleItems` and `scrollOffset` from `SelectListState`. The hook returns only `activeIndex`, `setActiveIndex`, and `activeItem`. Scroll windowing is computed by the `SelectList` component at render time using the "effective scroll offset" derivation pattern (from Gemini CLI's `BaseSelectionList`).

**Rationale**:
- `visibleCount` is inherently dynamic — it depends on terminal height, other UI elements consuming vertical space, and category header presence. Forcing the hook to accept it couples a rendering concern to headless logic.
- Render-time derivation eliminates one-frame flicker (scroll offset is computed synchronously during render, not asynchronously via `useEffect`).
- The hook's contract stays clean: *"I tell you what is selected. You decide how to show it."*
- Matches Gemini CLI's actual architecture — `useSelectionList` returns `activeIndex`, `BaseSelectionList` manages scroll offset independently.

**Impact**: `SelectListOptions` has no `visibleCount`. `SelectListState` has no `visibleItems`/`scrollOffset`. The `SelectList` component accepts `visibleCount` as a prop (default: 10) and derives scroll state internally.

---

### D-EX-4: `contextName` Typed as `KeybindingContextName` (Not `string`)

**Context**: The spec defined `DialogLifecycleOptions.contextName` as `string`. The implementation initially used `as any` casts to pass the string to `useRegisterKeybindingContext`, which expects `KeybindingContextName`.

**Decision**: Changed `contextName` type from `string` to `KeybindingContextName` (the union type from `keybindings/types.ts`). Eliminated all `as any` casts.

**Rationale**: Type-safety over flexibility. If a new dialog needs a context name that doesn't exist in the union, the correct fix is to add it to `KeybindingContextName`, not to weaken the type system.

---

### D-EX-5: Reducer Architecture — Gemini CLI Pattern

**Context**: Two reference architectures were evaluated for `useSelectList` state management.

| Criterion | Embedded Viewport (Claude Code) | Separate Viewport (Gemini CLI) |
|---|---|---|
| Reducer complexity | Higher — viewport + selection coupled | Lower — pure selection |
| Testability | Needs viewport props to test selection | Pure function, test in isolation |
| Separation of concerns | Mixed | Clean — rendering logic stays in component |
| Rapid input handling | ✅ Batched via reducer | ✅ Batched via reducer |

**Decision**: Gemini CLI's `useReducer` pattern with a lean reducer managing `activeIndex`, `pendingHighlight`, `pendingSelect`, `wrapAround`, and item metadata. Reducer actions: `MOVE_UP`, `MOVE_DOWN`, `SET_ACTIVE_INDEX`, `SELECT_CURRENT`, `INITIALIZE`, `CLEAR_PENDING_FLAGS`.

---

### D-EX-6: Test Strategy — Reducer Extraction over React Rendering

**Context**: `useSelectList` uses React hooks (`useReducer`, `useRef`, `useEffect`), which cannot be called outside a React component. The project uses `bun:test` without `@testing-library/react-hooks`.

**Decision**: Mock React's `useReducer`, `useRef`, and `useEffect` at the module level to **capture the reducer function** during hook initialization. Tests then exercise the reducer as a pure function and verify keybinding handler registration via the mocked `useKeybindings`.

**Test architecture**:
```
┌─────────────────────────────────────────────────┐
│  mock.module("react", ...)                      │
│    useReducer → captures reducer + initialState │
│    useRef     → returns { current: initial }    │
│    useEffect  → no-op                           │
│                                                 │
│  mock.module("keybindings/...", ...)             │
│    useKeybindings → captures handlers + options │
│    useRegisterKeybindingContext → captures args  │
│                                                 │
│  Tests call useSelectList(...) to trigger        │
│  mock captures, then test reducer directly:      │
│    reducer(initialState, { type: "MOVE_DOWN" })  │
└─────────────────────────────────────────────────┘
```

**Coverage achieved** (37 tests, 63 assertions):
- **Reducer initialization** (6 tests): default index, provided index, empty list, disabled skip, out-of-bounds, all-disabled
- **Reducer navigation** (7 tests): move down/up with disabled skip, wrap-around, boundary stop, all-disabled no-op
- **Reducer state actions** (6 tests): SET_ACTIVE_INDEX valid/invalid/negative/same-index, SELECT_CURRENT, CLEAR_PENDING_FLAGS
- **Reducer re-initialization** (2 tests): new items, disabled skip on re-init
- **Keybinding registration** (3 tests): navigation handlers, digit exclusion, digit inclusion
- **Focus management** (4 tests): active/inactive states, empty list, context name
- **Return value** (3 tests): activeItem resolution, empty list, setActiveIndex exposure
- **Lifecycle hook** (6 tests): context registration, isActive, cancel trigger, preventCloseOn guard, context name

**What is NOT tested** (and why):
- `useEffect` side effects (onHighlight/onSelect dispatch) — these require a React render context. They'll be validated in Phase 2 integration tests when dialogs are migrated.
- Number key multi-digit timeout logic — the timeout accumulation uses `setTimeout` which is mocked away. Handler registration is verified, but the timeout state machine is not exercised. This is a known gap to cover in integration.

---

## What Was Built

### Source Files — `packages/cli/src/tui/primitives/`

| File | Size | Purpose |
|------|------|---------|
| [types.ts](../../../packages/cli/src/tui/primitives/types.ts) | 161 lines | `SelectItem<T>`, `SelectListOptions/State`, `RenderContext`, `DialogLifecycleOptions`, `DialogPaneProps`, `FooterHint` |
| [use-select-list.ts](../../../packages/cli/src/tui/primitives/use-select-list.ts) | 382 lines | Headless `useReducer`-based hook: navigation, disabled skip, wrap-around, digit quick-select, focus gating |
| [use-dialog-lifecycle.ts](../../../packages/cli/src/tui/primitives/use-dialog-lifecycle.ts) | 39 lines | Context registration + Esc cancel with `preventCloseOn` guard |
| [select-list.tsx](../../../packages/cli/src/tui/primitives/select-list.tsx) | 185 lines | Themed rendering: scroll windowing, category headers, number column, custom `renderItem`, scroll indicators |
| [dialog-pane.tsx](../../../packages/cli/src/tui/primitives/dialog-pane.tsx) | 84 lines | Bordered wrapper with title + auto-rendered footer hint bar |
| [index.ts](../../../packages/cli/src/tui/primitives/index.ts) | 15 lines | Barrel export |

### Tests — `packages/cli/test/tui/`

| File | Tests | Technique |
|------|-------|-----------|
| [use-select-list.test.ts](../../../packages/cli/test/tui/use-select-list.test.ts) | 31 | React mocked → reducer captured → pure function tests |
| [use-dialog-lifecycle.test.ts](../../../packages/cli/test/tui/use-dialog-lifecycle.test.ts) | 6 | Keybinding hooks mocked → handler capture → direct invocation |

### Modified

| File | Change |
|------|--------|
| [default-bindings.ts](../../../packages/cli/src/tui/keybindings/default-bindings.ts) | +11 lines: `select:digit0`–`select:digit9` in `Select` context |

---

## Verification Results

```
✅ bun test test/tui/     — 37 pass, 0 fail, 63 expect() calls (1.2s)
✅ bunx tsc --noEmit       — exit 0, zero type errors
✅ bun lint:fix            — no fixes applied (clean)
✅ grep useInput primitives — zero results
```

---

## Spec Deviations Summary

| Spec Element | Spec Said | Actual | Reason |
|---|---|---|---|
| `SelectListState.visibleItems` | In return type | Removed | Windowing is component's job (D-EX-3) |
| `SelectListState.scrollOffset` | In return type | Removed | Windowing is component's job (D-EX-3) |
| `DialogLifecycleOptions.contextName` | `string` | `KeybindingContextName` | Type safety (D-EX-4) |
| Test file location | `src/tui/primitives/__tests__/` | `test/tui/` | Project convention — tests live in top-level `test/` |
| Test technique | Implied React rendering | React-mocked reducer extraction | No `@testing-library/react-hooks` in project (D-EX-6) |
