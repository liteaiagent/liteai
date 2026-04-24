# Phase 1: Foundation — `packages/ink` + `packages/hooks`

**RFC**: [ui-migration-rfc.md](file:///c:/Users/aghassan/Documents/workspace/liteai/roadmap/ui_refactoring/ui-migration-rfc.md) §6
**MVP Source**: `C:\Users\aghassan\Documents\workspace\liteai_cli_mvp`

---

## User Review Required

> [!WARNING]
> **React Compiler Strategy — Elaborated**
>
> The MVP files contain **React Compiler output** — an automated build transform that rewrites your React components to add fine-grained memoization. Here's what it looks like in practice:
>
> **Original source code (what a developer wrote):**
> ```tsx
> export const Ansi = React.memo(function Ansi({ children, dimColor }) {
>   if (typeof children !== "string") {
>     return dimColor ? <Text dim>{String(children)}</Text> : <Text>{String(children)}</Text>;
>   }
>   // ... rest of component
> });
> ```
>
> **After React Compiler transform (what's in the MVP files today):**
> ```tsx
> import { c as _c } from "react/compiler-runtime";
> export const Ansi = React.memo(function Ansi(t0) {
>   const $ = _c(12);  // allocate 12-slot memoization cache
>   const { children, dimColor } = t0;
>   if (typeof children !== "string") {
>     let t1;
>     if ($[0] !== children || $[1] !== dimColor) {  // manual cache check
>       t1 = dimColor ? <Text dim>{String(children)}</Text> : <Text>{String(children)}</Text>;
>       $[0] = children; $[1] = dimColor; $[2] = t1;  // store in cache
>     } else {
>       t1 = $[2];  // return cached result
>     }
>     return t1;
>   }
> ```
>
> The compiler output is **functional but unreadable** — variable names are mangled (`t0`, `t1`, `$`), all memoization is explicit cache-slot manipulation, and every component is restructured. **12 files** in `ink/` have this transform applied.
>
> **Two options:**
> 1. **Strip & re-enable via build plugin** — Manually revert the 12 files to clean source (using embedded source maps as reference), then configure `babel-plugin-react-compiler` in the package so the transform re-applies at build time. Result: clean maintainable source + same perf.
> 2. **Strip & ship clean** — Revert to clean source. Don't re-enable the compiler. Use manual `useMemo`/`useCallback` where needed. Simpler setup, but loses auto-memoization.
>
> **Recommendation**: Option 1 is ideal long-term, but adds build complexity in Phase 1. **I propose Option 2 for Phase 1** (get clean source, validate the port), then re-enable the compiler as a follow-up task once the package is stable. The 12 affected files are mostly components (`Ansi.tsx`, `Box.tsx`, etc.) where manual memoization is straightforward.

---

## Resolved Questions (from Research)

### Yoga Layout → Pure TypeScript Port (No WASM)

The MVP uses a **pure-TypeScript reimplementation** of Yoga, located at `native-ts/yoga-layout/` (2 files, ~86KB). The comment in the source reads:

> *"The TS yoga-layout port is synchronous — no WASM loading, no linear memory growth, so no preload/swap/reset machinery is needed."*

This means:
- **No `yoga-wasm-web` or `yoga-layout` npm package needed**
- The pure-TS port must be **copied into `packages/ink/src/layout/`** alongside the existing `yoga.ts` adapter
- Zero native/WASM dependencies — fully portable

### React Version → Latest via `bun add`

Will use `bun add react@latest react-reconciler@latest` instead of pinning in the catalog. This ensures we get the absolute latest stable versions.

### Hybrid Hooks → Extract Now (Phase 1b)

Per user direction, the hybrid hooks (`useReplBridge`, `useTypeahead`, `useSearchInput`, `useArrowKeyHistory`) will have their shareable logic extracted in Phase 1b, not deferred to Phase 2.

---

## Proposed Changes

### Monorepo Infrastructure

#### [MODIFY] [package.json](file:///c:/Users/aghassan/Documents/workspace/liteai/package.json)

Add React types to workspace catalog (runtime deps added via `bun add` per package):

```diff
  "catalog": {
+   "@types/react": "^19.0.0",
+   "@types/react-dom": "^19.0.0",
    "@biomejs/biome": "2.4.4",
```

---

### Component 1a: `packages/ink` — Forked Ink Renderer

#### Source Inventory (from MVP)

| Directory | Files | Total Size | Key Files |
|-----------|-------|-----------|-----------|
| `ink/` (root) | 35 files | ~560KB | `ink.tsx` (252KB), `screen.ts` (49KB), `selection.ts` (35KB), `render-node-to-output.ts` (63KB) |
| `ink/components/` | 16 files | ~260KB | `App.tsx` (98KB), `ScrollBox.tsx` (32KB), `Box.tsx` (22KB) |
| `ink/hooks/` | 12 files | ~24KB | `use-input.ts`, `use-selection.ts`, `use-terminal-viewport.ts` |
| `ink/events/` | 10 files | ~24KB | `click-event.ts`, `keyboard-event.ts`, `dispatcher.ts` |
| `ink/layout/` | 4 files | ~14KB | `yoga.ts` (7.4KB), `node.ts` (4.3KB) |
| `ink/termio/` | 9 files | ~65KB | `osc.ts` (17KB), `parser.ts` (12KB), `tokenize.ts` (9KB) |
| `components/design-system/` | 16 files | ~227KB | `Tabs.tsx` (41KB), `FuzzyPicker.tsx` (41KB), `ListItem.tsx` (20KB) |
| `native-ts/yoga-layout/` | 2 files | ~86KB | `index.ts` (83KB — pure TS yoga impl) |
| **Total** | **~104 files** | **~1.26MB** | |

#### External Dependencies (audited from imports)

| Dependency | Used By | Action |
|-----------|---------|--------|
| `react`, `react-reconciler` | Core renderer | `bun add react@latest react-reconciler@latest` |
| `strip-ansi` | String width, output | `bun add strip-ansi` |
| `chalk` | Color output | `bun add chalk` |
| `cli-boxes` | Border rendering | `bun add cli-boxes` |
| `indent-string` | Output formatting | `bun add indent-string` |
| `wrap-ansi` | Text wrapping | `bun add wrap-ansi` |
| `code-excerpt` | Error display | `bun add code-excerpt` |
| `auto-bind` | Class method binding | `bun add auto-bind` |
| `signal-exit` | Cleanup on exit | `bun add signal-exit` |
| `emoji-regex` | String width calc | `bun add emoji-regex` |
| `get-east-asian-width` | CJK char width | `bun add get-east-asian-width` |
| `bidi-js` | RTL text support | `bun add bidi-js` |
| `stack-utils` | Error formatting | `bun add stack-utils` |
| `figures` | Design system icons | `bun add figures` |
| `lodash-es` (noop, throttle) | ink.tsx | Replace with inline implementations (2 trivial functions) |
| `usehooks-ts` | 1 hook only | Inline the specific hook used |
| `@alcalzone/ansi-tokenize` | ANSI parsing | `bun add @alcalzone/ansi-tokenize` |
| `type-fest` | Type utilities | `bun add -d type-fest` |

#### MVP Internal Imports to Sever (4 total)

| Import | Resolution |
|--------|-----------|
| `src/native-ts/yoga-layout/index.js` | Copy into `packages/ink/src/layout/yoga-impl/` |
| `src/bootstrap/state.js` | Extract only the used function (`flushInteractionTime`). Stub or inline. |
| `src/utils/debug.js` | Replace with local `debug.ts` utility (simple conditional logger) |
| `src/utils/log.js` | Replace with local `log.ts` utility (simple error logger) |

#### React Compiler Files to Strip (12 files)

Files containing `import { c as _c } from "react/compiler-runtime"`:
- `Ansi.tsx`, plus ~11 component/hook files in `ink/` and `ink/components/`
- Action: Manually revert to clean source. Ship without compiler for Phase 1.

#### New Files

| File | Purpose |
|------|---------|
| `packages/ink/package.json` | Package manifest — `@liteai/ink` |
| `packages/ink/tsconfig.json` | TS config — `jsx: "react-jsx"`, **no DOM lib** |
| `packages/ink/biome.json` | Linting — `noRestrictedImports` blocks `react-dom` |
| `packages/ink/src/index.ts` | Public API barrel — re-exports render, Box, Text, hooks, events, design-system |
| `packages/ink/src/layout/yoga-impl/` | Pure-TS yoga port (copied from `native-ts/yoga-layout/`) |
| `packages/ink/src/util/debug.ts` | Local replacement for `src/utils/debug.js` |
| `packages/ink/src/util/log.ts` | Local replacement for `src/utils/log.js` |

---

### Component 1b: `packages/hooks` — Shared React Hooks

#### Hook Classification (93 files audited)

**Shareable — Port directly (~21 hooks):**

| Hook | Size | External Deps (non-react) |
|------|------|--------------------------|
| `useAssistantHistory.ts` | 9KB | `crypto` (Node built-in) |
| `useLogMessages.ts` | 6KB | `crypto` |
| `useDeferredHookMessages.ts` | 1.5KB | — |
| `useTurnDiffs.ts` | 7KB | `diff` |
| `useDiffData.ts` | 3KB | `diff` |
| `usePrStatus.ts` | 3KB | — |
| `useTasksV2.ts` | 9KB | `fs` (Node built-in) |
| `useElapsedTime.ts` | 1.2KB | — |
| `useMinDisplayTime.ts` | 1KB | — |
| `useMainLoopModel.ts` | 1.5KB | — |
| `useDynamicConfig.ts` | 0.7KB | — |
| `useSettings.ts` | 0.6KB | — |
| `useManagePlugins.ts` | 12KB | — |
| `useMergedClients.ts` | 0.7KB | `lodash-es/uniqBy` → replace with `remeda` |
| `useMergedTools.ts` | 1.6KB | — |
| `useScheduledTasks.ts` | 6KB | — |
| `useTaskListWatcher.ts` | 7KB | `fs` |
| `useCancelRequest.ts` | 10KB | `src/services/analytics/*`, `src/state/AppState` → sever |
| `useQueueProcessor.ts` | 2.5KB | — |
| `useCommandQueue.ts` | 0.5KB | — |
| `useCanUseTool.tsx` | 40KB | `@anthropic-ai/sdk`, `src/services/analytics/*` → sever + refactor |

**Hybrid — Extract shareable logic (~4 hooks):**

| Hook | Total Size | Shareable Logic | CLI-Only Logic |
|------|-----------|----------------|---------------|
| `useReplBridge.tsx` | 116KB | SSE connection, message state, tool approval flow | stdin handling, Ink-specific rendering |
| `useTypeahead.tsx` | 213KB | Search/filter/ranking algorithms | Input handling, `src/ink.js` rendering, notification context |
| `useSearchInput.ts` | 10KB | Search state machine, debouncing | — (mostly shareable) |
| `useArrowKeyHistory.tsx` | 34KB | History traversal, persistence | Input mode detection (`src/components/PromptInput/inputModes`) |

**Skip — CLI-only (stay in MVP, port in Phase 2):**
`useTerminalSize`, `useVirtualScroll`, `useVimInput`, `useInput`, `useExitOnCtrlCD`, `usePasteHandler`, `useCopyOnSelect`, `useTextInput`, `useVoice*`, `useIDE*`, `useGlobalKeybindings`, `useCommandKeybindings`, `useInboxPoller`, `useRemoteSession`, `useSSHSession`, and all notification hooks (~50+ hooks)

#### MVP Internal Imports to Sever (in shareable hooks)

| `src/` Import | Hooks Using It | Resolution |
|--------------|---------------|-----------|
| `src/services/analytics/*` | `useCanUseTool`, `useCancelRequest` | Remove analytics calls. Define a `AnalyticsPort` interface for consumers to inject. |
| `src/state/AppState.js` | `useCancelRequest` | Extract relevant state types into `packages/hooks/src/types.ts` |
| `src/context/notifications.js` | `useTypeahead`, `useArrowKeyHistory` | Define a `NotificationPort` interface — consumers provide the implementation |
| `src/ink.js` | `useTypeahead` | This is the Ink reference — must be fully severed in the shareable extraction |
| `src/components/PromptInput/inputModes.js` | `useArrowKeyHistory` | Extract input mode types into shared types |
| `bun:bundle` | `useReplBridge`, `useCanUseTool` | Remove — these are MVP build artifacts |

#### New Files

| File | Purpose |
|------|---------|
| `packages/hooks/package.json` | Package manifest — deps: `react`, `@liteai/sdk`, `diff`, `remeda` |
| `packages/hooks/tsconfig.json` | TS config — `jsx: "react-jsx"`, **no DOM lib** |
| `packages/hooks/biome.json` | Linting — blocks `react-dom`, `@liteai/ink`, `@liteai/core` imports |
| `packages/hooks/src/index.ts` | Public API barrel |
| `packages/hooks/src/types.ts` | Shared port interfaces (`AnalyticsPort`, `NotificationPort`, `AppState` subset) |
| `packages/hooks/src/session/` | Session hooks (5 files) |
| `packages/hooks/src/data/` | Data hooks (4 files) |
| `packages/hooks/src/permissions/` | Permission hooks (refactored `useCanUseTool`) |
| `packages/hooks/src/config/` | Config hooks (3 files) |
| `packages/hooks/src/plugins/` | Plugin hooks (3 files) |
| `packages/hooks/src/scheduling/` | Scheduling hooks (2 files) |
| `packages/hooks/src/control/` | Control hooks (3 files) |
| `packages/hooks/src/bridge/` | Extracted shareable logic from `useReplBridge` |
| `packages/hooks/src/search/` | Extracted search/filter logic from `useTypeahead`, `useSearchInput` |
| `packages/hooks/src/history/` | Extracted history logic from `useArrowKeyHistory` |
| `packages/hooks/test/` | Unit tests for core hooks |

---

## Execution Order

```
1. Workspace catalog update
   └── Add @types/react to root package.json catalog

2. packages/ink (Phase 1a) ── Branch: feat/ink
   ├── 2.1  Create package scaffold (package.json, tsconfig.json, biome.json)
   ├── 2.2  Copy native-ts/yoga-layout/ → src/layout/yoga-impl/
   ├── 2.3  Copy ink/ → src/ (35 root + components + hooks + events + layout + termio)
   ├── 2.4  Copy components/design-system/ → src/design-system/
   ├── 2.5  Strip React Compiler output from 12 files
   ├── 2.6  Sever 4 src/ imports (yoga path, bootstrap/state, utils/debug, utils/log)
   ├── 2.7  Replace lodash-es with inline implementations
   ├── 2.8  Fix all internal import paths (relative)
   ├── 2.9  Create src/index.ts public API barrel
   ├── 2.10 bun install → bun typecheck → bun lint:fix
   └── 2.11 Basic render test

3. packages/hooks (Phase 1b) ── Branch: feat/hooks  (parallel with 2)
   ├── 3.1  Create package scaffold
   ├── 3.2  Define port interfaces in src/types.ts (AnalyticsPort, NotificationPort, etc.)
   ├── 3.3  Port 21 directly-shareable hooks into domain directories
   ├── 3.4  Extract shareable logic from 4 hybrid hooks
   ├── 3.5  Sever all src/ imports — replace with port interfaces or @liteai/sdk types
   ├── 3.6  Replace lodash-es/uniqBy with remeda equivalent
   ├── 3.7  Refactor useCanUseTool (40KB → composable permission hooks)
   ├── 3.8  Create barrel exports (per-domain + root)
   ├── 3.9  bun install → bun typecheck → bun lint:fix
   └── 3.10 Unit tests for core hooks

4. Integration verification
   └── Workspace-level bun typecheck (all packages compile together)
```

---

## Verification Plan

| Check | Command | Pass Criteria |
|-------|---------|--------------|
| Ink types clean | `cd packages/ink && bun typecheck` | Zero errors, zero DOM references |
| Hooks types clean | `cd packages/hooks && bun typecheck` | Zero errors, zero DOM/Ink references |
| Ink lint clean | `cd packages/ink && bun lint:fix` | Zero violations |
| Hooks lint clean | `cd packages/hooks && bun lint:fix` | Zero violations |
| Ink render test | `cd packages/ink && bun test` | `<Box><Text>Hello</Text></Box>` → correct terminal output |
| Hooks unit tests | `cd packages/hooks && bun test` | Core hooks pass: useSession, useMessageStream, useCanUseTool |
| No production breakage | `bun typecheck` (workspace root) | Existing packages unaffected |
| No production breakage | `bun dev` | CLI still starts |
| Layer enforcement | biome `noRestrictedImports` | Ink can't import react-dom; Hooks can't import react-dom, @liteai/ink, @liteai/core |
