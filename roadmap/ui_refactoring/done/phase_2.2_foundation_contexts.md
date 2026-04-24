# Phase 2.2: Foundation Contexts

**Branch**: `feat/cli-react`
**Depends on**: Phase 2.1 (infrastructure utilities in `src/tui/util/` and `src/tui/context/helper.tsx`)
**Produces**: 7 React context providers in `src/tui/context/`

## Objective

Build the simple React context providers that the complex contexts (phase 2.3) and all visual components depend on. Each mirrors the existing SolidJS equivalent but uses React hooks.

## SolidJS → React Cheat Sheet

| SolidJS | React |
|---------|-------|
| `createSignal()` | `useState()` |
| `createMemo()` | `useMemo()` |
| `createEffect()` | `useEffect()` |
| `onMount(() => ...)` | `useEffect(() => ..., [])` |
| `onCleanup(() => ...)` | `useEffect(() => { return () => ... })` |
| `batch(() => ...)` | Remove — React 19 auto-batches |
| `createStore()` | `useState()` or Zustand |
| `Show when={x}` | `{x && <...>}` |

## Source References

All SolidJS contexts are the **architectural reference** — they define the state shape and API that the new React code must replicate.

| SolidJS Source | New React Target | Lines | Complexity |
|---------------|-----------------|-------|------------|
| `cli/cmd/tui/context/args.tsx` | `tui/context/args.tsx` | ~30 | Simple |
| `cli/cmd/tui/context/exit.tsx` | `tui/context/exit.tsx` | ~40 | Simple |
| `cli/cmd/tui/context/kv.tsx` | `tui/context/kv.tsx` | ~50 | Medium |
| `cli/cmd/tui/context/tui-config.tsx` | `tui/context/tui-config.tsx` | ~15 | Trivial |
| `cli/cmd/tui/context/prompt.tsx` | `tui/context/prompt.tsx` | ~20 | Simple |
| `cli/cmd/tui/context/route.tsx` | `tui/context/route.tsx` | 46 | Simple |
| `cli/cmd/tui/context/sdk.tsx` | `tui/context/sdk.tsx` | 129 | Medium-High |

**Base path for SolidJS sources**: `c:\Users\aghassan\Documents\workspace\liteai\packages\cli\src\cli\cmd\tui\context\`
**Base path for new React targets**: `c:\Users\aghassan\Documents\workspace\liteai\packages\cli\src\tui\context\`

## Proposed Changes

### 1. [NEW] `src/tui/context/args.tsx`

**Port from**: `cli/cmd/tui/context/args.tsx`

Simple value context for CLI args. The SolidJS version uses `createSimpleContext` with props passthrough. React version is identical in shape — just uses the React `createSimpleContext` from phase 2.1.

### 2. [NEW] `src/tui/context/exit.tsx`

**Port from**: `cli/cmd/tui/context/exit.tsx`

Exit callback context. Key conversions:
- `onCleanup` → `useEffect` cleanup return
- Exit message state: `createSignal` → `useState`

### 3. [NEW] `src/tui/context/kv.tsx`

**Port from**: `cli/cmd/tui/context/kv.tsx`

Key-value persistent store backed by filesystem JSON. Key conversions:
- `createStore` → `useState` (the KV store is relatively simple)
- The `.signal()` helper returns a SolidJS signal pair `[accessor, setter]`. In React, return `[value, setter]` tuple from `useState`, but the getter must subscribe to the KV store's state.
- File I/O (`Filesystem.readJson`/`writeJson`) stays the same

### 4. [NEW] `src/tui/context/tui-config.tsx`

**Port from**: `cli/cmd/tui/context/tui-config.tsx`

Simple config value passthrough. Trivial — just wraps a value in context.

### 5. [NEW] `src/tui/context/prompt.tsx`

**Port from**: `cli/cmd/tui/context/prompt.tsx`

Prompt ref context. Holds a reference to the prompt component for imperative control.
- `createSignal` for ref → `useRef` + `useState`

### 6. [NEW] `src/tui/context/route.tsx`

**Port from**: `cli/cmd/tui/context/route.tsx` (46 lines)

Route state management. Key conversions:
- `createStore<Route>` → `useState<Route>`
- `setStore(route)` → `setRoute(route)`
- Types (`HomeRoute`, `SessionRoute`, `Route`) are pure TS — copy unchanged
- `useRouteData<T>` helper — copy unchanged

### 7. [NEW] `src/tui/context/sdk.tsx`

**Port from**: `cli/cmd/tui/context/sdk.tsx` (129 lines)

SDK client + typed event emitter + SSE connection management. **Most complex in this phase.**

Key conversions:
- `createGlobalEmitter()` from `@solid-primitives/event-bus` → typed emitter from `src/tui/util/event-emitter.ts` (phase 2.1)
- `batch(() => ...)` → remove (React 19 auto-batches)
- `onMount(() => connect())` → `useEffect(() => { connect(); return cleanup; }, [])`
- `onCleanup(() => disconnect())` → cleanup in the same `useEffect`
- SSE reconnection loop, ping interval, workspace tracking — logic stays the same, just wrapped in React hooks
- Event types (`message.part.updated`, etc.) — keep the same type map

## Verification

```powershell
cd c:\Users\aghassan\Documents\workspace\liteai
bun typecheck 2>&1 | Out-String
bun lint:fix
```

**Gate**: All packages pass typecheck. New contexts compile with correct types.

## Review Checklist

- [ ] All 7 contexts compile cleanly
- [ ] `bun typecheck` clean
- [ ] `bun lint:fix` clean
- [ ] Each context's public API matches the SolidJS version's shape
- [ ] `sdk.tsx` uses typed emitter from phase 2.1
- [ ] `sdk.tsx` SSE reconnection logic is preserved
- [ ] `kv.tsx` filesystem persistence works correctly
- [ ] Route types are exported for use by other contexts
