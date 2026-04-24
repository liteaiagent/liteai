# CLI TUI Migration — Review Tracker

Post-implementation code review log for each phase of the SolidJS → React migration.

> [!NOTE]
> Each phase is reviewed after implementation against its spec, the SolidJS source, and project mandates. Fixes are applied inline before proceeding to the next phase.

---

## Phase 2.1: Infrastructure & Dependencies

**Reviewed:** 2026-04-24  
**Verdict:** ✅ CLEAN — No issues found

| File | Status | Notes |
|------|--------|-------|
| `src/tui/util/color.ts` | ✅ | All 6 functions correct. sRGB formula verified. |
| `src/tui/util/event-emitter.ts` | ✅ | TypedEmitter interface matches spec. Justified `biome-ignore`. |
| `src/tui/context/helper.tsx` | ✅ | Ready gate, `{provider, use}` shape match SolidJS. |
| `src/tui/flags.ts` | ✅ | Byte-identical copy of original. |
| `src/tui/util/color.test.ts` | ✅ | 6 tests covering all utilities. |
| `src/tui/util/event-emitter.test.ts` | ✅ | 4 tests covering subscribe/emit/off/multi. |

**Gates:** `bun typecheck` ✅ | `bun lint:fix` ✅ | `bun test src/tui/` ✅ (10/10)

---

## Phase 2.2: Foundation Contexts

**Reviewed:** 2026-04-24  
**Verdict:** ⚠️ 5 issues found → all fixed

### Issues Found & Resolved

| # | Severity | File | Issue | Fix Applied |
|---|----------|------|-------|-------------|
| 1 | 🔴 High | `exit.tsx` | Reentrancy guard used `useState` — race-prone double-exit. Two rapid calls before React re-renders would both pass the guard. | Replaced with `useRef(exitingRef)` for synchronous check. Added `messageRef` to avoid stale closure in exit callback. |
| 2 | 🔴 Medium | `sdk.tsx` | SDK client not recreated on workspace switch. SolidJS does `sdk = createSDK()` to get a fresh `AbortController`. React version reused the same instance. | Added `sdkVersion` state counter bumped on `setWorkspace()`. This triggers the `useMemo` to recreate the client with a fresh `AbortController`. |
| 3 | 🟡 Medium | `kv.tsx` | `signal()` helper captured stale closures — fundamental React vs SolidJS reactivity mismatch. | Removed `signal()` entirely (no SolidJS compat layer needed). API is now `get`/`set` only. |
| 4 | 🟡 Minor | `kv.tsx` | `.catch(() => {})` silently swallowed filesystem read errors. | Replaced with `console.error("[KV] Failed to read store:", err)`. |
| 5 | 🟡 Minor | `prompt.tsx`, `route.tsx` | Duplicate `PromptInfo` type defined in both files. | Extracted to `src/tui/types.ts`, both files now import from there. |
| 6 | 🟡 Minor | `route.tsx` | Leftover `console.log("navigate", next)` debug statement (inherited from SolidJS). | Removed. |

### Post-Fix File Status

| File | Status |
|------|--------|
| `src/tui/context/args.tsx` | ✅ Clean (no changes needed) |
| `src/tui/context/exit.tsx` | ✅ Fixed |
| `src/tui/context/kv.tsx` | ✅ Fixed |
| `src/tui/context/tui-config.tsx` | ✅ Clean (no changes needed) |
| `src/tui/context/prompt.tsx` | ✅ Fixed |
| `src/tui/context/route.tsx` | ✅ Fixed |
| `src/tui/context/sdk.tsx` | ✅ Fixed |
| `src/tui/types.ts` | ✅ New (shared types) |

**Gates:** `bun typecheck` ✅ | `bun lint:fix` ✅ | `bun test src/tui/` ✅ (10/10)

---

## Phase 2.3: Complex Contexts

**Reviewed:** 2026-04-24  
**Verdict:** ⚠️ 4 issues found → 2 fixed, 2 accepted as-is

### Issues Found & Resolved

| # | Severity | File | Issue | Fix Applied |
|---|----------|------|-------|-------------|
| 1 | 🔴 Critical | `theme.tsx`, `local.tsx` | 80+ RGBA references from `@opentui/core` remained. `ThemeColors` typed as `RGBA`, `SyntaxStyle` imported from legacy. Spec required hex strings. | Fully migrated: all colors now `string`, `SyntaxStyle` defined locally, `RGBA`/`@opentui/core` imports removed. `color.ts` utilities used for `fromInts`, `parseHex`, `tint`. |
| 2 | 🟡 Minor | `phase_2.3_task.md` | `use-renderer.ts` listed as completed but file doesn't exist (merged into `useApp()`). | Annotated task entry with strikethrough and merge note. |
| 3 | 🟡 Info | `App.tsx` | `toggleConsole` is a placeholder. | Accepted — deferred to Phase 2.6 by design. |
| 4 | 🟡 Medium | `sync.tsx` | `.catch(() => undefined)` silently swallowed workspace list errors (§5 violation). | Replaced with error-logging catch: `Log.Default.error("[tui:sync] Failed to list workspaces", ...)`. |

### Post-Fix File Status

| File | Status |
|------|--------|
| `src/tui/context/theme.tsx` | ✅ Fixed (RGBA→hex migration) |
| `src/tui/context/local.tsx` | ✅ Fixed (RGBA import removed) |
| `src/tui/context/sync.tsx` | ✅ Fixed (silent catch → logged) |
| `src/tui/context/keybind.tsx` | ✅ Clean (no changes needed) |

**Gates:** `bun typecheck` ✅ | `bun lint:fix` ✅

---

## Phase 2.4: UI Primitives

**Reviewed:** —  
**Verdict:** Pending implementation

---

## Phase 2.5: Components

**Reviewed:** —  
**Verdict:** Pending implementation

---

## Phase 2.6: Routes & App Shell

**Reviewed:** —  
**Verdict:** Pending implementation

---

## Phase 2.7: Cleanup & Validation

**Reviewed:** —  
**Verdict:** Pending implementation
