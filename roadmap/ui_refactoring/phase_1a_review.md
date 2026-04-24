# Phase 1 Review: Script-Modified Files & Remaining Issues

## Summary

The completed tasks (2.1–2.8, 2.10) are in solid shape. The React Compiler stripping, dependency decoupling, and type safety work landed cleanly. **However, the automated scripts left several residual issues** that need attention before Phase 1a can be considered truly complete.

---

## ✅ Verified Clean

| Area | Status | Notes |
|------|--------|-------|
| React Compiler runtime | ✅ Clean | No `react/compiler-runtime` imports, no `const $ = _c(N)`, no `$[N]` cache slots, no `t0`/`t1` mangled params |
| Compiler source maps | ✅ Recovered | `Ansi.tsx` confirmed clean — human-readable named params, `React.memo` wrapping intact |
| `lodash-es` removal | ✅ Clean | Only a stale **comment** reference in `ink.tsx:823` (harmless) |
| `execa` removal | ✅ Clean | Zero references — replaced with `node:child_process` in `osc.ts` |
| `devtools` stripping | ✅ Clean | Zero dynamic `import('./devtools.js')` references |
| MVP `src/` imports severed | ✅ Clean | Only 1 **commented-out** reference (`ink.tsx:19` — `// import { flushInteractionTime }`) |
| `design-system/` removed | ✅ Clean | Directory does not exist on disk |

---

## ⚠️ Issues Found

### 1. **Dead `package.json` export — ghost `design-system` path**

[package.json](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/ink/package.json) line 13 exports:
```json
"./design-system": "./src/design-system/index.ts"
```
But `src/design-system/` was **intentionally deleted** (task 2.4 notes confirm). This is a broken export map entry — any consumer importing `@liteai/ink/design-system` will get a resolution error at build time.

> [!WARNING]
> **Fix:** Remove the `"./design-system"` entry from `exports` in `package.json`.

---

### 2. **`usehooks-ts` not inlined — live dependency retained**

The implementation plan (task 2.7 scope) stated `usehooks-ts` should be inlined, and `package.json` lists it as a direct dependency (`"usehooks-ts": "3.1.1"`). However:

- [use-input.ts:2](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/ink/src/hooks/use-input.ts#L2) has a live import: `import { useEventCallback } from 'usehooks-ts'`
- The comment in `use-interval.ts:39` also references `usehooks-ts` (documentation only, no import)

`useEventCallback` is a trivial ~10-line hook. This dependency should be inlined per the plan.

> [!IMPORTANT]
> **Fix:** Inline `useEventCallback` and drop `usehooks-ts` from `package.json`.

---

### 3. **`osc.ts` — `any` types from script modification**

The `execFileNoThrow` wrapper and its call chain use `any` in 4 places:

| Location | Pattern | Risk |
|----------|---------|------|
| [osc.ts:10](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/ink/src/termio/osc.ts#L10) | `opts: any` | Masks that `execFile` doesn't accept `useCwd`/`input` — these are dead properties |
| [osc.ts:199](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/ink/src/termio/osc.ts#L199) | `(r: any)` | Script-injected — return type is `{ code: number }`, fully known |
| [osc.ts:204](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/ink/src/termio/osc.ts#L204) | `(r2: any)` | Same pattern |
| [osc.ts:209](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/ink/src/termio/osc.ts#L209) | `(r3: any)` | Same pattern |

The `opts: any` on line 10 hides a subtle bug: `execFile` (Node's `child_process.execFile`) does **not** accept `useCwd` or `input` as options. These were `execa`-specific options that survived the replacement. The `input` property exists on `spawn` options via `child_process.execFileSync` but not `promisify(execFile)`. This means:
- **`input: text` is silently ignored** — clipboard writes on Linux/macOS/Windows may not actually be writing anything to `pbcopy`/`wl-copy`/`xclip`/`xsel`/`clip`
- **`useCwd: false`** is an `execa` option, not a Node option — silently ignored

> [!CAUTION]
> **Fix:** Type `opts` properly with `ExecFileOptions & { input?: string }` or use `execFileSync`/`spawn` with stdin piping. The `any` cast on `r`/`r2`/`r3` should also be removed — the return type is `{ code: number }`.

---

### 4. **`ScrollBox.tsx:219` — `ref={(el: any)` cast**

[ScrollBox.tsx:219](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/ink/src/components/ScrollBox.tsx#L219) uses `(el: any)` as a ref callback type cast. This likely exists because the custom `ink-box` JSX intrinsic element type doesn't properly declare its ref type. This should be typed via the `env.d.ts` intrinsic element declarations instead of using `any`.

> [!NOTE]
> **Low priority.** The `env.d.ts` intrinsic element types would need to declare the ref callback signature. Can be fixed when creating the barrel export (task 2.9).

---

### 5. **Remaining `@ts-expect-error` directives (2)**

| File | Line | Reason |
|------|------|--------|
| [ink.tsx:332](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/ink/src/ink.tsx#L332) | `// @ts-expect-error statically replaced` | **Justified** — `'production' === 'development'` is intentionally dead code. The `@ts-expect-error` suppresses the "condition is always false" error. This is correct — it preserves the dev-tools injection as an opt-in path that tree-shaking removes in production. |
| [bidi.ts:17](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/ink/src/bidi.ts#L17) | `// @ts-expect-error` | **Needs investigation** — suppresses the `bidi-js` import. Likely `bidi-js` doesn't ship type declarations. Should add a `declare module 'bidi-js'` in `env.d.ts` instead. |

---

### 6. **Biome lint failures (from user's terminal output)**

The user ran `bun lint:fix` and `bun lint:fix --unsafe` — both exit code 1 with:
- `bidi.ts:34-35`: `useLiteralKeys` — `process.env['WT_SESSION']` → `process.env.WT_SESSION` (auto-fixable but Biome reports "some errors were emitted while applying fixes")
- `bidi.ts:75,89,92`: `noNonNullAssertion` — `levels[offset]!`, `charLevels[i]!`, `charLevels[j]!` (not auto-fixable)
- `ScrollBox.tsx:94` reference in the error trace — likely a formatting conflict

The `useLiteralKeys` errors appear to have been auto-fixed (the current `bidi.ts` on disk uses dot notation), but the `noNonNullAssertion` errors persist because Biome's `recommended` ruleset flags `!` assertions and there's no safe auto-fix.

> [!IMPORTANT]
> **Fix options:**
> - Add proper bounds checks (preferred) — e.g., guard with `if (offset < levels.length)` before indexing
> - Or disable `noNonNullAssertion` in `biome.json` rules for this package (less ideal, it's a perf-sensitive path)

---

### 7. **Missing `LITEAI_*` env var documentation**

The renderer references 3 `LITEAI_*` environment variables as configuration knobs:
- `LITEAI_DEBUG_INK` — enables debug repaint logging
- `LITEAI_ACCESSIBILITY` — disables mouse tracking, skips certain visual-only features
- `LITEAI_DISABLE_MOUSE` — skips mouse click handler registration

These are **not MVP-specific** — they're valid renderer configuration. But they're undocumented and hardcoded as string comparisons (replacing the old `isEnvTruthy()` wrapper). This is fine for now but should be mentioned in the barrel export documentation.

---

## Incomplete Tasks (Acknowledged in task.md)

| Task | Status | Notes |
|------|--------|-------|
| 2.9 — `src/index.ts` barrel | ❌ Not started | `src/index.ts` does not exist |
| 2.11 — Basic render test | ❌ Not started | No test files |

---

## Verdict

The **script-modified files** are in acceptable shape for the compiler stripping (`fix-rx-types.ts` and `fix-ts-expect-error.ts` did their jobs cleanly — no `rx: any`, no orphaned `@ts-expect-error` en masse). The `osc.ts` `any` types are the most concerning finding — **the clipboard `input` piping may be silently broken** because `execFileAsync` doesn't support `input` as an option. This needs verification before Phase 1b proceeds.
