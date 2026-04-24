# Phase 2.3: Complex Contexts — Code Review

**Reviewed:** 2026-04-24
**Build Status:** ✅ `bun typecheck` clean | ✅ `bun lint` clean

---

## Executive Summary

Phase 2.3 is **functionally complete**. All 4 complex contexts (`sync`, `theme`, `local`, `keybind`) are implemented and compile clean. The `@liteai/ink` extensions (FocusContext, AppContext APIs, useFocus hook) are solid. However, there is **one critical spec deviation**: theme.tsx and local.tsx still use `RGBA` and `SyntaxStyle` from `@opentui/core` instead of migrating to hex strings as explicitly required by the implementation plan.

---

## Checklist Evaluation

| # | Checklist Item | Status | Details |
|---|---------------|--------|---------|
| 1 | `sync.tsx` — Zustand store matches SolidJS state shape | ✅ | Zustand+immer at L103. State shape expanded beyond SolidJS with `session_diff`, `lsp`, `mcp_resource`, `formatter`, `vcs`, `workspaceList`, `path` |
| 2 | `sync.tsx` — SSE event handlers correctly update store via immer | ✅ | 16 event types handled in massive switch at L266-457. All use `store.setState((state) => ...)` immer pattern |
| 3 | `sync.tsx` — Binary search + splice logic preserved | ✅ | `Binary.search` used at 11+ sites (permissions, questions, sessions, messages, parts) with correct insert/update/delete splice patterns |
| 4 | `theme.tsx` — Zero RGBA references remain | 🔴 **FAIL** | **80+ RGBA references remain.** `RGBA` and `SyntaxStyle` still imported from `@opentui/core` (L7). All `ThemeColors` typed as `RGBA`. All color resolution uses `RGBA.fromHex()`, `RGBA.fromInts()`. See detailed analysis below. |
| 5 | `theme.tsx` — All 33 theme JSONs load correctly | ✅ | 33 JSON files present in `src/tui/context/theme/`. All imported with `with { type: "json" }`. `DEFAULT_THEMES` map at L138-172 covers all 33. |
| 6 | `theme.tsx` — `getPalette()` works via `@liteai/ink` | ✅ | Uses `useApp().getPalette()` at L270, L282. `clearPaletteCache()` used at L319. |
| 7 | `local.tsx` — Agent/model cycling works | ✅ | `cycle()` at L251, `cycleFavorite()` at L267, `move()` at L212. All use proper index wrapping. |
| 8 | `local.tsx` — File persistence for model preferences | ✅ | `saveModel()` at L95 writes to `model.json`. `useEffect` at L105 loads on mount. Covers `recent`, `favorite`, `variant`. |
| 9 | `keybind.tsx` — Leader key timeout logic preserved | ✅ | 2000ms timeout at L34-36. Blur on leader activate, restore focus on deactivate. Timeout cleared on manual deactivation. |
| 10 | `keybind.tsx` — Focus management works with `@liteai/ink` | ✅ | Uses `useFocus()` from `@liteai/ink` at L2,15. `focus()`, `blur()`, `activeElement` all utilized. |
| 11 | `bun typecheck` clean | ✅ | Full turbo cache hit — all 14 tasks successful |
| 12 | `bun lint:fix` clean | ✅ | All 11 packages clean — no fixes needed |

---

## Issues Found

### 🔴 Issue 1: RGBA / SyntaxStyle still from `@opentui/core` (CRITICAL — Spec Deviation)

**Files:** [theme.tsx](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/cli/src/tui/context/theme.tsx), [local.tsx](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/cli/src/tui/context/local.tsx)

The implementation plan explicitly states:
> ⚠️ `theme.tsx` is being refactored to use **hex strings** instead of the `RGBA` class

The spec's SolidJS → React cheat sheet maps:
- `RGBA.fromHex()` → hex string literal
- `RGBA.fromInts()` → `color.fromInts()` from `src/tui/util/color.ts`
- `RGBA.tint()` → `color.tint()` from `src/tui/util/color.ts`

**Current state:**
- `theme.tsx` L7: `import { RGBA, SyntaxStyle } from "@opentui/core"` — **both legacy deps retained**
- `ThemeColors` interface (L46-99): all 53 color fields typed as `RGBA` instead of `string`
- `resolveColor()` (L176): returns `RGBA` instances via `RGBA.fromHex()`, `RGBA.fromInts()`
- `tint()` function (L379): takes and returns `RGBA` instead of hex strings
- `generateGrayScale()` (L477): uses `RGBA.fromInts()` for gray generation
- `SyntaxStyle.fromTheme()` (L529,534): uses `@opentui/core`'s SyntaxStyle class

- `local.tsx` L7: `import { RGBA } from "@opentui/core"` — `agent.color()` returns `RGBA`

**Impact:** This blocks the removal of `@opentui/core` from CLI dependencies (a Phase 4 requirement). It also means all downstream consumers of `useTheme()` must work with RGBA objects, not hex strings.

**Decision required:**
- **Option A:** Fix now before proceeding to Phase 2.4 (estimated ~2-3 hours: refactor ThemeColors to string, update resolveColor → color.ts functions, port SyntaxStyle locally)
- **Option B:** Defer to a dedicated RGBA→hex migration task between Phase 2.3 and 2.4 (isolate the breaking change)
- **Option C:** Accept as-is until Phase 2.7 cleanup (risky — components in Phases 2.4-2.6 will build on RGBA, creating more migration surface)

---

### 🟡 Issue 2: `use-renderer.ts` — Listed as completed but doesn't exist

**Task list** marks `[x] Create packages/ink/src/hooks/use-renderer.ts` but no file exists in `packages/ink/src/hooks/`.

**Assessment:** This is **not a real issue**. The `use-renderer` hook's responsibilities from the SolidJS world (`getPalette()`, `suspend()`, `resume()`) have been correctly absorbed into the existing `useApp()` → `AppContext` pattern. The task was correctly marked done because the functionality exists, just via a different hook name.

**Recommendation:** Remove the phantom task entry or add a note that it was merged into `useApp()`.

---

### 🟡 Issue 3: `toggleConsole` is a placeholder

**File:** [App.tsx](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/ink/src/components/App.tsx) L579-581

```typescript
toggleConsole = (): void => {
  // Placeholder - console overlay not yet implemented in @liteai/ink
}
```

**Assessment:** Acceptable. The spec table notes this is "Needed By: `app.tsx` (phase 2.6)". The API surface is wired; implementation deferred to Phase 2.6.

---

### 🟡 Issue 4: `sync.tsx` silent catch on workspace list

**File:** [sync.tsx](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/cli/src/tui/context/sync.tsx) L140-147

```typescript
const result = await sdk.client.project.experimental.workspace
  .list({ projectID: sdk.projectID })
  .catch(() => undefined)
if (!result?.data) return
```

This silently swallows workspace list errors. Per core mandates §5 (No Silent Fallbacks), this should at minimum log the error. The same pattern was flagged and fixed in Phase 2.2 review for `kv.tsx`.

---

## `@liteai/ink` Extension Review

All ink extensions are **clean and well-implemented**:

| File | Status | Notes |
|------|--------|-------|
| [FocusContext.ts](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/ink/src/components/FocusContext.ts) | ✅ | Clean readonly type. Provides FocusManager, activeElement, focusNext, focusPrevious. |
| [AppContext.ts](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/ink/src/components/AppContext.ts) | ✅ | All 6 new APIs typed. Clean noop defaults. Well-documented with JSDoc. |
| [App.tsx](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/ink/src/components/App.tsx) | ✅ | getPalette (L530) uses OSC queries via TerminalQuerier. clearPaletteCache (L561). suspend (L473) with proper raw mode save/restore. toggleDebugOverlay (L572). FocusContext.Provider wired at L218-227. |
| [use-focus.ts](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/ink/src/hooks/use-focus.ts) | ✅ | Clean hook. useMemo-wrapped return. Proper null checks on focusManager. |
| [index.ts](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/ink/src/index.ts) | ✅ | All new exports present: FocusContext (L12), useFocus (L32), TerminalColors type (L8). |

---

## Readiness Assessment

| Criterion | Status |
|-----------|--------|
| All task items complete | ⚠️ (use-renderer merged into useApp — acceptable) |
| Build passes | ✅ |
| Lint passes | ✅ |
| Spec compliance | 🔴 RGBA migration not done |
| API surface correct | ✅ |
| Ready for Phase 2.4? | **Conditional** — depends on RGBA decision |

> [!WARNING]
> Phase 2.4 (UI Primitives) will consume `useTheme()` extensively. If the theme API surfaces `RGBA` objects, all Phase 2.4 components will be built against `RGBA`, **multiplying the migration surface** when `@opentui/core` is eventually removed. Recommend resolving Issue 1 before proceeding.
