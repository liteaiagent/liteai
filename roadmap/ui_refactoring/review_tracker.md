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

**Reviewed:** 2026-04-25  
**Verdict:** ⚠️ 8 issues found → 4 fixed, 1 design-acknowledged, 3 deferred

### Issues Found & Resolved

| # | Severity | File | Issue | Resolution |
|---|----------|------|-------|------------|
| C1 | ~~🔴 Critical~~ | `dialog.tsx` | No dialog stack manager (`push`/`pop`/`replace`). | ✅ **Not a defect.** Intentional design decision per approved impl plan — native React patterns (conditional rendering per consumer) replace the SolidJS stack manager. |
| C2 | 🔴 Critical | `context/toast.tsx` | Stale closure race condition: `timeoutHandle` stored as `useState` — rapid `show()` calls fail to clear previous timeout because callback captures stale value. | ✅ Fixed: replaced `useState` with `useRef` for the timeout handle. Callback now has stable `[]` deps. |
| C3 | 🟠 Major | `context/toast.tsx`, `ui/toast.tsx` | Spec requires multi-toast stacking; implementation only supports single `currentToast: T \| null`. | ⏳ Deferred — moderate scope, tracked for future enhancement. |
| M1 | 🟠 Major | `fuzzy-picker.tsx` | Despite name, no fuzzy matching algorithm. All filtering delegated to consumers via `onQueryChange`. No match highlights, no category grouping. | ⏳ Deferred — larger scope, possibly Phase 2.5. |
| M2 | 🟠 Major | `dialog-select.tsx` | Search box renders but `onQueryChange` is a no-op — typing does nothing. Dependent on M1. | ⏳ Deferred — blocked on M1. |
| M3 | 🟠 Major | `spinner.tsx` | `mode` prop destructured as `_mode` and ignored. Should drive default message text per `SpinnerMode` type. Violates mandate §3 (unused variable analysis). | ✅ Fixed: added `MODE_MESSAGES` record mapping `SpinnerMode` → default text. `mode` now drives `displayMessage` when `message` is not explicitly provided. |
| m1 | 🟡 Minor | `dialog-alert.tsx` | No Enter key handler — alert only dismissible via Escape. | ✅ Fixed: added `useInput` handler for `return` key. |
| m2 | 🟡 Minor | `dialog-help.tsx` | Static stub — hardcoded help text, doesn't list keybindings dynamically. `onCancel` is no-op. | ⏳ Deferred — Phase 2.5 scope. |
| m3 | 🟡 Minor | `ui/toast.tsx` | Toast renders inline with `marginTop={1}`, no absolute positioning. Spec says "position at bottom of terminal". | ⏳ Deferred — depends on layout architecture decisions. |
| m4 | 🟡 Minor | `ui/toast.tsx` | Color map typed as `Record<string, Color>` — loses exhaustiveness. Used `\|\|` fallback and `as Color` cast. | ✅ Fixed: changed to `Record<ToastVariant, Color>`, removed `\|\|` fallback and `as Color` cast. |

### Post-Fix File Status

| File | Status |
|------|--------|
| `src/tui/ui/dialog.tsx` | ✅ Clean (design-acknowledged) |
| `src/tui/ui/fuzzy-picker.tsx` | ⚠️ Functional but missing fuzzy matching (deferred) |
| `src/tui/ui/toast.tsx` | ✅ Fixed (type safety) |
| `src/tui/ui/spinner.tsx` | ✅ Fixed (mode wiring) |
| `src/tui/ui/dialog-alert.tsx` | ✅ Fixed (Enter handler) |
| `src/tui/ui/dialog-confirm.tsx` | ✅ Clean |
| `src/tui/ui/dialog-prompt.tsx` | ✅ Clean |
| `src/tui/ui/dialog-select.tsx` | ⚠️ Search non-functional (deferred, blocked on M1) |
| `src/tui/ui/dialog-export-options.tsx` | ✅ Clean |
| `src/tui/ui/dialog-help.tsx` | ⚠️ Stub (deferred) |
| `src/tui/context/toast.tsx` | ✅ Fixed (stale closure) |

**Gates:** `bun typecheck` ✅ | `bun lint:fix` ✅

---

## Phase 2.5: Components (Batch 1 — Design System)

**Reviewed:** 2026-04-25  
**Verdict:** ⚠️ 7 issues found → 1 fixed, 2 deferred, 4 accepted

### Scope Discrepancy

> [!WARNING]
> The walkthrough (`phase_2.5_walkthrough.md`) claims "All batches planned in the Phase 2.5 Refactoring RFC have been successfully implemented and merged!" — **this is incorrect**. Only **Batch 1** (12 design system components) was completed. Batches 2–4 (rendering components, prompt input, app-specific dialogs) are entirely absent from the filesystem. The walkthrough must be corrected, and the remaining batches tracked as future work.

### Issues Found & Resolved

| # | Severity | File | Issue | Resolution |
|---|----------|------|-------|------------|
| D1 | 🟡 Minor | `Divider.tsx` L53 | Docstring example uses `color="suggestion"` — "suggestion" was remapped to "info" during Phase 2.5 color key cleanup. Stale doc. | ✅ Fixed: updated docstring to use `color="info"`. |
| T1 | 🟡 Info | `ThemedBox.tsx` L76 | `{...(rest as unknown as BoxProps)}` double cast. Caused by Ink's discriminated union (bold/dim) bleeding through Omit. | ✅ Accepted — structural limitation of Ink's type system. Cast is through `unknown` (not `any`), narrow scope. |
| T2 | 🟡 Info | `ThemedText.tsx` L47 | Same `as unknown as TextProps` pattern as T1. | ✅ Accepted — same rationale as T1. |
| B1 | 🟡 Info | `Byline.tsx` L49 | `@ts-expect-error - React.Fragment key is fine`. Fragment does accept `key`; suppression is from version-specific React types. | ✅ Accepted — low risk, correctly scoped suppress. |
| F1 | 🟠 Major | `fuzzy-picker.tsx` L115–118 | `useEffect` includes `onQueryChange` in deps. If consumer doesn't memoize callback, triggers infinite re-render loop. | ⏳ Deferred — requires either stable callback contract in docs or internal `useRef` stabilization. Track for Batch 2/3 integration. |
| F2 | 🟡 Minor | `fuzzy-picker.tsx` L125–127 | Same unmemoized-callback risk with `onFocus` in `useEffect` deps. | ⏳ Deferred — same class as F1. |
| F3 | 🟡 Info | `fuzzy-picker.tsx` L152 | Each list item wrapped in `<Pane>` (which adds Divider + padding). Heavyweight for a picker list, but produces correct visual output. | ✅ Accepted — visual design decision, not a bug. |

### Post-Fix File Status

| File | Status |
|------|--------|
| `components/design-system/ThemedBox.tsx` | ✅ Clean (cast accepted) |
| `components/design-system/ThemedText.tsx` | ✅ Clean (cast accepted) |
| `components/design-system/Byline.tsx` | ✅ Clean (suppress accepted) |
| `components/design-system/Divider.tsx` | ✅ Fixed (stale docstring) |
| `components/design-system/ListItem.tsx` | ✅ Clean |
| `components/design-system/LoadingState.tsx` | ✅ Clean |
| `components/design-system/ProgressBar.tsx` | ✅ Clean |
| `components/design-system/StatusIcon.tsx` | ✅ Clean |
| `components/design-system/Tabs.tsx` | ✅ Clean |
| `components/design-system/Pane.tsx` | ✅ Clean |
| `components/design-system/KeyboardShortcutHint.tsx` | ✅ Clean |
| `components/design-system/Ratchet.tsx` | ✅ Clean |
| `ui/fuzzy-picker.tsx` | ⚠️ Callback memoization risk (deferred F1, F2) |
| `ui/dialog.tsx` | ✅ Clean |
| `ui/spinner.tsx` | ✅ Clean |
| `ui/toast.tsx` | ✅ Clean |

### Positive Findings

- ✅ Zero `as any` casts across all Phase 2.5 scope
- ✅ Zero React Compiler `$[n]` artifacts in ported code
- ✅ Zero SolidJS remnants (`createSignal`, `@opentui/core`)
- ✅ Zero `console.log` debug statements
- ✅ Zero `@ts-ignore` directives
- ✅ Zero `biome-ignore` directives
- ✅ All 12 design system components properly import from `@liteai/ink`
- ✅ All theme colors typed as `keyof ThemeColors`
- ✅ Phase 2.4 fixes (toast `useRef`, spinner mode, dialog-alert Enter) confirmed intact

**Gates:** `bun typecheck` ✅ | `bun lint` ✅

---

## Phase 2.5: Components (Batch 2 — Rendering Components)

**Reviewed:** 2026-04-25  
**Verdict:** ⚠️ 9 issues found → 5 fixed, 4 deferred/accepted

### Issues Found & Resolved

| # | Severity | File | Issue | Resolution |
|---|----------|------|-------|------------|
| C1 | 🔴 Critical | `status-line.tsx` L27, `tool-use-loader.tsx` L20 | `as any` casts to pass theme hex colors to Ink `<Text color>`. Ink's `Color` type is `HexColor \| RGBColor \| ...` but theme values are plain `string`. | ✅ Fixed: replaced `as any` with `as Color` (imported from `@liteai/ink`). Narrow type assertion, not an escape hatch. |
| C2 | 🔴 Critical | `markdown-table.tsx` L318 | ~43KB base64 sourcemap blob (`//# sourceMappingURL=data:...`) from MVP transpilation included in source file. | ✅ Fixed: removed build artifact. |
| M1 | 🟠 Major | `structured-diff.tsx` L54 | `_gutterSpace` variable computed but never consumed. It was used for content-width constraining in word-level diff highlighting (not ported). §3 violation — prefixed with `_` without justification. | ✅ Fixed: removed dead code, added TODO comment noting deferred word-level diffing. |
| M2 | 🟠 Major | `markdown-table.tsx` L43-57 | `wrapText` function is a stub — accepts `hard` option but ignores it. Only splits on `\n`, doesn't actually wrap long text. Original MVP used `wrapAnsi()` for ANSI-aware wrapping. Tables with long cell content won't wrap. | ⏳ Deferred — needs dependency evaluation (`wrapAnsi` availability in new stack). |
| M3 | 🟠 Major | `structured-diff.tsx` L17-28 | `diffCache` is an unbounded `Map<string, Map<...>>` with no eviction policy. Long sessions will leak memory. Compare with `markdown.tsx` which has `TOKEN_CACHE_MAX = 500` with LRU. | ⏳ Deferred — pre-existing MVP pattern, not a regression. |
| m1 | 🟡 Minor | `markdown.tsx` L81,89 | Elements pushed to array in `useMemo` lacked React `key` props. Causes React reconciliation warnings. | ✅ Fixed: added `key={`ansi-${keyCounter++}`}` and `key={`table-${keyCounter++}`}` pattern. |
| m2 | 🟡 Minor | `tool-use-loader.tsx` L13 | `useTheme` import separated from main import block (line 13 instead of top). MVP port artifact. | ✅ Fixed: moved to top-level import block. |
| m3 | 🟡 Info | `status-line.tsx` L19 | Hardcoded model fallback `"claude-3-5-sonnet-20241022"`. Comment acknowledges "Dummy data fallback for MVP parity for now". | ✅ Accepted — explicitly temporary, will wire to config. |
| m4 | 🟡 Info | `markdown.tsx` L53 | Settings mock `{ syntaxHighlightingDisabled: false }` — dead conditional. | ✅ Accepted — clearly documented placeholder for config integration. |

### Post-Fix File Status

| File | Status |
|------|--------|
| `components/markdown.tsx` | ✅ Fixed (React keys) |
| `components/markdown-table.tsx` | ⚠️ Fixed (sourcemap removed), wrapText stub deferred |
| `components/structured-diff.tsx` | ✅ Fixed (dead variable removed), cache eviction deferred |
| `components/status-line.tsx` | ✅ Fixed (`as any` → `as Color`) |
| `components/tool-use-loader.tsx` | ✅ Fixed (`as any` → `as Color`, import consolidated) |
| `util/cliHighlight.ts` | ✅ Clean |
| `util/diff.ts` | ✅ Clean |
| `util/hash.ts` | ✅ Clean |
| `util/markdown.ts` | ✅ Clean |
| `hooks/useBlink.ts` | ✅ Clean |

### Positive Findings

- ✅ Zero `as any` casts remaining (2 removed this review)
- ✅ Zero `biome-ignore` directives remaining (2 removed this review)
- ✅ Zero SolidJS remnants (`createSignal`, `@opentui/core`)
- ✅ Zero React Compiler `$[n]` artifacts
- ✅ Zero `console.log` debug statements
- ✅ Zero `@ts-ignore` directives
- ✅ `Suspense` + `use()` for async highlight loading is clean
- ✅ `memo()` on StatusLine is appropriate
- ✅ Token LRU cache in markdown.tsx has bounded size
- ✅ All components correctly import from `@liteai/ink` and use `useTheme()`

**Gates:** `bun typecheck` ✅ | `bun lint` ✅

---

## Phase 2.5: Components (Batch 3 — Prompt Input System)

**Reviewed:** 2026-04-25  
**Verdict:** ✅ CLEAN — No blocking issues

### Scope

Ported the prompt input subsystem from MVP to React/Ink:
- `components/prompt/` (8 files: `prompt-input.tsx`, `prompt-input-footer.tsx`, `prompt-input-footer-left-side.tsx`, `prompt-input-mode-indicator.tsx`, `notifications.tsx`, `input-modes.ts`, `input-paste.ts`, `utils.ts`)
- `components/text-input.tsx`, `components/vim-text-input.tsx`, `components/base-text-input.tsx`
- Hooks: `hooks/useTextInput.ts`, `hooks/useVimInput.ts`, `hooks/useArrowKeyHistory.ts`

### Key Adaptations

- MVP's `useReplBridge` submission → wired to `useSDK()` context
- Feature-flag-free architecture (no MVP feature gates ported)
- Decoupled footer/mode/paste subsystems as composable components

### Deferred Features (documented in `deferred_features.md`)

| # | Feature | Reason |
|---|---------|--------|
| 1 | Autocomplete/Suggestions Panel | Requires overlay + fuzzy infrastructure |
| 2 | Help Menu | Standalone overlay, no prompt core dependency |
| 3 | History Search (Ctrl+R) | Basic arrow history included; interactive search deferred |
| 4 | Stashed Prompt / dialog-stash.tsx | Niche feature, blocked on `usePromptStash()` |
| 5 | Queued Commands | Requires message queue infrastructure |
| 7 | Prompt Editor ($EDITOR) | Requires process spawning |
| 8 | Text Highlighting (Slash/Chips) | Requires highlight span rendering |

### Post-Review File Status

| File | Status |
|------|--------|
| `components/prompt/prompt-input.tsx` | ✅ Clean |
| `components/prompt/prompt-input-footer.tsx` | ✅ Clean |
| `components/prompt/prompt-input-footer-left-side.tsx` | ✅ Clean |
| `components/prompt/prompt-input-mode-indicator.tsx` | ✅ Clean |
| `components/prompt/notifications.tsx` | ✅ Clean |
| `components/prompt/input-modes.ts` | ✅ Clean |
| `components/prompt/input-paste.ts` | ✅ Clean |
| `components/prompt/utils.ts` | ✅ Clean |
| `components/text-input.tsx` | ✅ Clean |
| `components/vim-text-input.tsx` | ✅ Clean |
| `components/base-text-input.tsx` | ✅ Clean |

**Gates:** `bun typecheck` ✅ | `bun lint` ✅

---

## Phase 2.5: Components (Batch 4 — App-Specific Dialogs)

**Reviewed:** 2026-04-25  
**Verdict:** ✅ CLEAN — All 4 sub-batches complete

### Scope

Ported 12 app-specific dialogs from SolidJS source + 2 infrastructure files:

**Sub-batch 4.1 — Infrastructure:**
- `context/dialog.tsx` (DialogProvider stack manager with push/pop/replace/clear)
- `ui/dialog-select.tsx` (full rewrite: fuzzy search, categories, keybinds, scroll, current marker)

**Sub-batch 4.2 — Simple Dialogs:**
- `dialog-agent.tsx`, `dialog-theme.tsx`, `dialog-session-rename.tsx`, `dialog-skill.tsx`

**Sub-batch 4.3 — Medium Dialogs:**
- `dialog-model.tsx`, `dialog-session-list.tsx`, `dialog-status.tsx`, `dialog-command.tsx` (incl. `CommandProvider`)

**Sub-batch 4.4 — Complex Dialogs:**
- `dialog-mcp.tsx` (3 sub-components: list/detail/tools)
- `dialog-provider.tsx` (5 sub-components: OAuth multi-step wizard)
- `dialog-plugin.tsx` (7 sub-components: 4-tab plugin manager)
- `dialog-workspace.tsx` (2 sub-components: workspace list + create)

### Key Adaptations

- SolidJS `createSignal/createMemo/createResource/createStore` → React `useState/useMemo/useEffect+state`
- `@opentui/core` RGBA → hex strings via `useTheme()`
- `useKeyboard` → `useInput` from `@liteai/ink`
- `ScrollBoxRenderable` → `@liteai/ink` ScrollBox
- `fuzzysort` added as dependency for fuzzy search

### Deferred

| Item | Reason |
|------|--------|
| `dialog-stash.tsx` | Blocked on `usePromptStash()` — see deferred_features.md #4 |

### Post-Review File Status

| File | Status |
|------|--------|
| `context/dialog.tsx` | ✅ Clean |
| `ui/dialog-select.tsx` | ✅ Clean (full rewrite from 37-line skeleton) |
| `components/dialog-agent.tsx` | ✅ Clean |
| `components/dialog-theme.tsx` | ✅ Clean |
| `components/dialog-session-rename.tsx` | ✅ Clean |
| `components/dialog-skill.tsx` | ✅ Clean |
| `components/dialog-model.tsx` | ✅ Clean |
| `components/dialog-session-list.tsx` | ✅ Clean |
| `components/dialog-status.tsx` | ✅ Clean |
| `components/dialog-command.tsx` | ✅ Clean |
| `components/dialog-mcp.tsx` | ✅ Clean |
| `components/dialog-provider.tsx` | ✅ Clean |
| `components/dialog-plugin.tsx` | ✅ Clean |
| `components/dialog-workspace.tsx` | ✅ Clean |

### Positive Findings

- ✅ Zero `as any` casts across all Batch 4 scope
- ✅ Zero SolidJS remnants (`createSignal`, `createMemo`, `@opentui/core`, `@opentui/solid`)
- ✅ Zero React Compiler `$[n]` artifacts
- ✅ Zero `console.log` debug statements
- ✅ All dialogs properly import from `@liteai/ink` and use `useTheme()`
- ✅ `dialog-stash.tsx` correctly deferred with documentation
- ✅ Cross-dialog dependencies verified (dialog-model → dialog-provider, dialog-workspace → dialog-session-list)

**Gates:** `bun typecheck` ✅ (14/14 tasks) | `bun lint` ✅ (11/11 tasks)

---

## Phase 2.6: Routes & App Shell

**Reviewed:** —  
**Verdict:** Pending implementation

---

## Phase 2.7: Cleanup & Validation

**Reviewed:** —  
**Verdict:** Pending implementation
