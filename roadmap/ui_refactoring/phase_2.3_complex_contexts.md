# Phase 2.3: Complex Contexts

**Branch**: `feat/cli-react`
**Depends on**: Phase 2.2 (foundation contexts: sdk, kv, args, exit, route, tui-config, prompt)
**Produces**: 4 complex React context providers in `src/tui/context/`

## Objective

Port the 4 most complex SolidJS contexts to React. These contain the heaviest state management and deepest reactive patterns. This is the hardest phase of the migration.

## Prerequisite: Extend `@liteai/ink`

Before starting this phase, `@liteai/ink` must expose ALL renderer APIs (per Q2 decision — no deferrals):

| API | Current Status in `@liteai/ink` | Needed By |
|-----|-------------------------------|-----------|
| `useTerminalTitle()` | ✅ Exists | `theme.tsx` |
| `useSelection()` | ✅ Exists | `keybind.tsx` |
| Focus management (`focus()`, `blur()`, `currentFocused`) | ❓ Check | `keybind.tsx` |
| `suspend()` / `resume()` | ❓ Add | `app.tsx` (phase 2.6) |
| Debug overlay | ❓ Add | `app.tsx` (phase 2.6) |
| Console toggle | ❓ Add | `app.tsx` (phase 2.6) |
| `getPalette()` (terminal background color query) | ❓ Add | `theme.tsx` |

> [!IMPORTANT]
> Audit `packages/ink/src/` for existing implementations before adding new APIs. The ink package already has 52 source files — some of these may already exist.

## SolidJS → React Cheat Sheet (Advanced)

| SolidJS | React |
|---------|-------|
| `createStore()` + `produce()` | **Zustand store** + `immer` middleware |
| `reconcile(newData)` | Immutable replace in Zustand `set()` |
| `batch(() => ...)` | Remove — React 19 auto-batches |
| `createEffect(on(dep, fn))` | `useEffect(fn, [dep])` |
| Selective signal reads | Zustand's `useStore(store, selector)` |
| `RGBA.fromHex()` | Hex string literal |
| `RGBA.fromInts(r,g,b,a)` | `color.fromInts(r,g,b,a)` from `src/tui/util/color.ts` |
| `RGBA.tint(amount)` | `color.tint(hex, amount)` from `src/tui/util/color.ts` |

## Source References

| SolidJS Source | New React Target | Lines | Key Challenge |
|---------------|-----------------|-------|---------------|
| `cli/cmd/tui/context/sync.tsx` | `tui/context/sync.tsx` | 565 | Zustand+immer store, SSE event handling, binary search mutations |
| `cli/cmd/tui/context/theme.tsx` | `tui/context/theme.tsx` | 1155 | RGBA→hex migration (~80 sites), SyntaxStyle, getPalette |
| `cli/cmd/tui/context/local.tsx` | `tui/context/local.tsx` | 408 | Agent/model selection, file persistence |
| `cli/cmd/tui/context/keybind.tsx` | `tui/context/keybind.tsx` | 104 | useKeyboard→useInput, focus management |

**SolidJS base path**: `c:\Users\aghassan\Documents\workspace\liteai\packages\cli\src\cli\cmd\tui\context\`
**New React target path**: `c:\Users\aghassan\Documents\workspace\liteai\packages\cli\src\tui\context\`
**Color utility**: `c:\Users\aghassan\Documents\workspace\liteai\packages\cli\src\tui\util\color.ts` (from phase 2.1)
**Event emitter**: `c:\Users\aghassan\Documents\workspace\liteai\packages\cli\src\tui\util\event-emitter.ts` (from phase 2.1)

## Proposed Changes

### 1. [NEW] `src/tui/context/sync.tsx`

**Port from**: `cli/cmd/tui/context/sync.tsx` (565 lines)

The state management core. Holds sessions, messages, parts, permissions, questions, todos, MCP status, providers, agents, config.

**Key conversions**:
- `createStore<SyncData>` + `produce()` → **Zustand store** with `immer` middleware
- Selective subscriptions via `useStore(store, selector)` — critical for performance since SSE events fire frequently
- Event handler (`sdk.event.listen(...)`) → `useEffect` subscribing to typed emitter from sdk context
- `Binary.search` + splice patterns — pure TS, stays the same
- `batch(() => ...)` — remove entirely
- `onMount(() => bootstrap())` → `useEffect(bootstrap, [])`
- `reconcile(data)` for full-state replacement → Zustand `set(data)` (replace: true)

**State shape** (from the SolidJS `createStore`):
```typescript
interface SyncData {
  ready: boolean
  session: Session[]
  message: Record<string, Message[]>
  part: Record<string, Part[]>
  permission: Record<string, Permission[]>
  question: Record<string, Question[]>
  todo: Record<string, Todo[]>
  mcp: Record<string, McpStatus>
  provider: ProviderInfo[]
  provider_default: Record<string, string>
  agent: AgentInfo[]
  config: Record<string, unknown>
}
```

### 2. [NEW] `src/tui/context/theme.tsx`

**Port from**: `cli/cmd/tui/context/theme.tsx` (1155 lines)

Theme resolution + syntax highlighting. **Largest file in the migration.**

**Key conversions**:
- `RGBA` class (from `@opentui/core`) → **hex strings** everywhere. All theme values become `string` type.
  - `RGBA.fromHex("#abc")` → `"#abc"` (literal)
  - `RGBA.fromInts(r,g,b,a)` → `color.fromInts(r,g,b,a)` from `src/tui/util/color.ts`
  - `theme.primary.tint(0.3)` → `color.tint(theme.primary, 0.3)`
  - Gray scale generation (11 grays from background) → `color.tint()` loop
  - Contrast calculation for auto-theme detection → `color.contrast()`
- `SyntaxStyle` from `@opentui/core` → port to `@liteai/ink` or define locally
- `useRenderer().getPalette()` → implement via `@liteai/ink` (per Q2 — no deferrals)
- `createStore` → `useState`
- `createMemo` → `useMemo`
- `createEffect` → `useEffect`
- 33 theme JSON files in `cli/cmd/tui/themes/` — **unchanged**, just update import paths
- `useKV` → from phase 2.2
- `useTuiConfig` → from phase 2.2

### 3. [NEW] `src/tui/context/local.tsx`

**Port from**: `cli/cmd/tui/context/local.tsx` (408 lines)

Agent/model selection state. Manages current agent, model preferences, favorites, recent models, and model variants.

**Key conversions**:
- `createStore` for agent/model state → Zustand store (or `useState` if scope is small enough)
- `RGBA.fromHex()` in agent color resolution → hex string + `color.ts` utilities
- `createMemo` → `useMemo`
- `createEffect` for auto-model-update → `useEffect`
- `batch()` → remove
- File persistence (`Filesystem.readJson`/`writeJson` for `model.json`) — logic stays the same
- Dependencies: `useSync()` (from this phase), `useTheme()` (from this phase), `useArgs()`, `useSDK()`, `useToast()` (from phase 2.2)

### 4. [NEW] `src/tui/context/keybind.tsx`

**Port from**: `cli/cmd/tui/context/keybind.tsx` (104 lines)

Keyboard shortcut management with leader key support.

**Key conversions**:
- `useKeyboard(async (evt) => ...)` from `@opentui/solid` → `useInput((input, key) => ...)` from `@liteai/ink`
  - Note: `useInput` has a different signature than `useKeyboard`. The parsed key info may differ.
- `useRenderer().currentFocusedRenderable` → `@liteai/ink` focus API (verify availability)
- `Renderable.focus()` / `Renderable.blur()` → Ink's focus system
- `createMemo` → `useMemo`
- `createStore({ leader: false })` → `useState`
- `Keybind.parse()`, `Keybind.match()`, `Keybind.format()` — pure TS utilities from `cli/util/keybind.ts`, unchanged

## Verification

```powershell
cd c:\Users\aghassan\Documents\workspace\liteai
bun typecheck 2>&1 | Out-String
bun lint:fix
```

**Gate**: All packages pass typecheck. All 4 complex contexts compile with correct types.

## Review Checklist

- [ ] `sync.tsx` — Zustand store matches SolidJS state shape exactly
- [ ] `sync.tsx` — SSE event handlers correctly update store via immer
- [ ] `sync.tsx` — Binary search + splice logic preserved
- [ ] `theme.tsx` — Zero `RGBA` references remain — all hex strings
- [ ] `theme.tsx` — All 33 theme JSONs load correctly
- [ ] `theme.tsx` — `getPalette()` works via `@liteai/ink`
- [ ] `local.tsx` — Agent/model cycling works
- [ ] `local.tsx` — File persistence for model preferences
- [ ] `keybind.tsx` — Leader key timeout logic preserved
- [ ] `keybind.tsx` — Focus management works with `@liteai/ink`
- [ ] `bun typecheck` clean
- [ ] `bun lint:fix` clean
