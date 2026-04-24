# Phase 2: CLI Port — New `src/tui/` (React+Ink)

Build the React+Ink TUI in a **new** `packages/cli/src/tui/` directory alongside the existing SolidJS code. Rewire entry points, validate, then delete old code.

**Branch**: `feat/cli-react`

## Strategy

```
packages/cli/src/
  cli/cmd/tui/          ← EXISTING SolidJS (stays live until Phase 2.7)
    attach.ts           ← REWIRE: import { tui } from "../../../tui/app"
    thread.ts           ← REWIRE: import { tui } from "../../../tui/app"
    worker.ts           ← UNCHANGED (framework-agnostic)
    win32.ts            ← UNCHANGED (framework-agnostic)
    flags.ts            ← MOVE to src/tui/flags.ts
  tui/                  ← NEW React+Ink TUI
    app.tsx             ← New React root (replaces old app.tsx)
    context/            ← React context providers
    components/         ← React+Ink components
    routes/             ← Session, home screens
    ui/                 ← Dialog, toast, spinner
    util/               ← Clipboard, selection, color, event emitter
    flags.ts            ← Moved from old location
```

**Why this approach**: Old TUI stays compilable on `main`. Each sub-phase produces a typecheck-clean state. Can A/B test with a flag during development. Clean `git rm` of old directory once validated.

### Dual-Source Strategy

This migration draws from **two sources** for different layers:

| Layer | Source | Rationale |
|-------|--------|-----------|
| **State/Context** (sub-phases 2.1–2.3) | **Existing SolidJS** architecture, converted to React | These contexts integrate with `@liteai/core`'s SDK, SSE events, session API. The MVP's `useReplBridge` (116KB monolith) uses a completely different backend integration that doesn't fit our architecture. |
| **Visual Components** (sub-phases 2.4–2.6) | **MVP React** codebase (`liteai_cli_mvp/`) | The MVP has 113 React components already built for `@liteai/ink` — richer features (virtual scroll, structured diffs, fuzzy picker, markdown rendering) than the old SolidJS UI. We port these and wire them to our contexts. |

> [!IMPORTANT]
> **Do NOT transliterate old SolidJS components to React.** The visual layer comes from the MVP. The existing SolidJS components in `src/cli/cmd/tui/component/` and `src/cli/cmd/tui/routes/` are only a reference for understanding what features/commands exist — the actual React code is ported from the MVP.

## Current State (Phase 1 Complete)

| Package | Status | Contents |
|---------|--------|----------|
| `packages/ink` | ✅ Done | 52 files, React Compiler pipeline, typecheck+lint clean |
| `packages/hooks` | ✅ Done | 4 hooks + utilities ported |

## Source References

> [!IMPORTANT]
> These paths are essential for the implementing session. The MVP is the primary source for porting React components. The existing SolidJS code is the reference for context/state architecture.

### Key Paths

| Resource | Path |
|----------|------|
| **RFC** | `c:\Users\aghassan\Documents\workspace\liteai\roadmap\ui_refactoring\ui-migration-rfc.md` |
| **MVP codebase** | `C:\Users\aghassan\Documents\workspace\liteai_cli_mvp\` |
| **Existing SolidJS TUI** | `c:\Users\aghassan\Documents\workspace\liteai\packages\cli\src\cli\cmd\tui\` |
| **Target directory** | `c:\Users\aghassan\Documents\workspace\liteai\packages\cli\src\tui\` (NEW) |
| **@liteai/ink** | `c:\Users\aghassan\Documents\workspace\liteai\packages\ink\` |
| **@liteai/hooks** | `c:\Users\aghassan\Documents\workspace\liteai\packages\hooks\` |

### MVP → New `src/tui/` Port Mapping

#### Design System (MVP → `src/tui/components/design-system/`)

| MVP Source | Port To | Size |
|-----------|---------|------|
| `liteai_cli_mvp\components\design-system\ThemeProvider.tsx` | `src/tui/context/theme.tsx` (merge with existing theme logic) | 18KB |
| `liteai_cli_mvp\components\design-system\ThemedBox.tsx` | `src/tui/components/design-system/ThemedBox.tsx` | 18KB |
| `liteai_cli_mvp\components\design-system\ThemedText.tsx` | `src/tui/components/design-system/ThemedText.tsx` | 14KB |
| `liteai_cli_mvp\components\design-system\Dialog.tsx` | `src/tui/ui/dialog.tsx` | 14KB |
| `liteai_cli_mvp\components\design-system\FuzzyPicker.tsx` | `src/tui/ui/fuzzy-picker.tsx` | 41KB |
| `liteai_cli_mvp\components\design-system\Tabs.tsx` | `src/tui/components/design-system/Tabs.tsx` | 41KB |
| `liteai_cli_mvp\components\design-system\ListItem.tsx` | `src/tui/components/design-system/ListItem.tsx` | 20KB |
| `liteai_cli_mvp\components\design-system\Pane.tsx` | `src/tui/components/design-system/Pane.tsx` | 7KB |
| `liteai_cli_mvp\components\design-system\ProgressBar.tsx` | `src/tui/components/design-system/ProgressBar.tsx` | 7KB |
| `liteai_cli_mvp\components\design-system\StatusIcon.tsx` | `src/tui/components/design-system/StatusIcon.tsx` | 8KB |
| `liteai_cli_mvp\components\design-system\Divider.tsx` | `src/tui/components/design-system/Divider.tsx` | 11KB |
| `liteai_cli_mvp\components\design-system\Byline.tsx` | `src/tui/components/design-system/Byline.tsx` | 6KB |
| `liteai_cli_mvp\components\design-system\KeyboardShortcutHint.tsx` | `src/tui/components/design-system/KeyboardShortcutHint.tsx` | 7KB |
| `liteai_cli_mvp\components\design-system\LoadingState.tsx` | `src/tui/components/design-system/LoadingState.tsx` | 6KB |
| `liteai_cli_mvp\components\design-system\Ratchet.tsx` | `src/tui/components/design-system/Ratchet.tsx` | 7KB |

#### Message Rendering (MVP → `src/tui/routes/session/`)

| MVP Source | Port To | Size |
|-----------|---------|------|
| `liteai_cli_mvp\components\Messages.tsx` | `src/tui/routes/session/messages.tsx` | 147KB |
| `liteai_cli_mvp\components\MessageRow.tsx` | `src/tui/routes/session/message-row.tsx` | 48KB |
| `liteai_cli_mvp\components\Message.tsx` | `src/tui/routes/session/message.tsx` | 79KB |
| `liteai_cli_mvp\components\Markdown.tsx` | `src/tui/components/markdown.tsx` | 28KB |
| `liteai_cli_mvp\components\StructuredDiff.tsx` | `src/tui/components/structured-diff.tsx` | 25KB |
| `liteai_cli_mvp\components\ToolUseLoader.tsx` | `src/tui/components/tool-use-loader.tsx` | 5KB |
| `liteai_cli_mvp\components\FileEditToolDiff.tsx` | `src/tui/components/file-edit-diff.tsx` | 22KB |
| `liteai_cli_mvp\components\Spinner.tsx` | `src/tui/components/spinner.tsx` | 88KB |
| `liteai_cli_mvp\components\StatusLine.tsx` | `src/tui/components/status-line.tsx` | 49KB |

#### Input (MVP → `src/tui/components/prompt/`)

| MVP Source | Port To | Size |
|-----------|---------|------|
| `liteai_cli_mvp\components\PromptInput\` | `src/tui/components/prompt/` | ~dir |
| `liteai_cli_mvp\components\TextInput.tsx` | `src/tui/components/text-input.tsx` | 21KB |
| `liteai_cli_mvp\components\VimTextInput.tsx` | `src/tui/components/vim-text-input.tsx` | 16KB |
| `liteai_cli_mvp\components\BaseTextInput.tsx` | `src/tui/components/base-text-input.tsx` | 19KB |

#### Hooks (MVP → `@liteai/hooks` or `src/tui/hooks/`)

| MVP Source | Destination | Shareable? | Size |
|-----------|-------------|-----------|------|
| `liteai_cli_mvp\hooks\useReplBridge.tsx` | Extract SSE/state → `@liteai/hooks`; stdin parts → `src/tui/hooks/` | ⚠️ Partial | 116KB |
| `liteai_cli_mvp\hooks\useCanUseTool.tsx` | `@liteai/hooks` | ✅ Yes | 40KB |
| `liteai_cli_mvp\hooks\useAssistantHistory.ts` | `@liteai/hooks` | ✅ Yes | 9KB |
| `liteai_cli_mvp\hooks\useCancelRequest.ts` | `@liteai/hooks` | ✅ Yes | 10KB |
| `liteai_cli_mvp\hooks\useLogMessages.ts` | `@liteai/hooks` | ✅ Yes | 6KB |
| `liteai_cli_mvp\hooks\useTurnDiffs.ts` | `@liteai/hooks` | ✅ Yes | 7KB |
| `liteai_cli_mvp\hooks\useTasksV2.ts` | `@liteai/hooks` | ✅ Yes | 9KB |
| `liteai_cli_mvp\hooks\useScheduledTasks.ts` | `@liteai/hooks` | ✅ Yes | 6KB |
| `liteai_cli_mvp\hooks\useManagePlugins.ts` | `@liteai/hooks` | ✅ Yes | 12KB |
| `liteai_cli_mvp\hooks\useExitOnCtrlCD.ts` | `src/tui/hooks/` (CLI-only) | ❌ No | 3KB |
| `liteai_cli_mvp\hooks\usePasteHandler.ts` | `src/tui/hooks/` (CLI-only) | ❌ No | 10KB |
| `liteai_cli_mvp\hooks\useCopyOnSelect.ts` | `src/tui/hooks/` (CLI-only) | ❌ No | 4KB |
| `liteai_cli_mvp\hooks\useVimInput.ts` | `src/tui/hooks/` (CLI-only) | ❌ No | 10KB |
| `liteai_cli_mvp\hooks\useSearchInput.ts` | Extract search logic → `@liteai/hooks`; input → `src/tui/hooks/` | ⚠️ Partial | 10KB |
| `liteai_cli_mvp\hooks\useGlobalKeybindings.tsx` | `src/tui/hooks/` (CLI-only) | ❌ No | 31KB |

#### Contexts (MVP → `src/tui/context/`)

| MVP Source | Port To | Size |
|-----------|---------|------|
| `liteai_cli_mvp\context\modalContext.tsx` | `src/tui/ui/dialog.tsx` | 6KB |
| `liteai_cli_mvp\context\overlayContext.tsx` | `src/tui/context/overlay.tsx` | 14KB |
| `liteai_cli_mvp\context\stats.tsx` | `src/tui/context/stats.tsx` | 22KB |
| `liteai_cli_mvp\context\notifications.tsx` | `src/tui/ui/toast.tsx` | 33KB |

### Existing SolidJS → New React Mapping

These files in the existing CLI are the **architectural reference** — they define the state shape, event handling, and context APIs that the new React code must replicate:

| Existing SolidJS | New React | Lines | Notes |
|-----------------|-----------|-------|-------|
| `cli/cmd/tui/context/helper.tsx` | `tui/context/helper.tsx` | 26 | `createSimpleContext` → React version |
| `cli/cmd/tui/context/sdk.tsx` | `tui/context/sdk.tsx` | 129 | Event emitter + SSE |
| `cli/cmd/tui/context/sync.tsx` | `tui/context/sync.tsx` | 565 | **Hardest** — store mutations |
| `cli/cmd/tui/context/theme.tsx` | `tui/context/theme.tsx` | 1155 | RGBA migration + 33 theme JSONs |
| `cli/cmd/tui/context/local.tsx` | `tui/context/local.tsx` | 408 | Agent/model state |
| `cli/cmd/tui/context/keybind.tsx` | `tui/context/keybind.tsx` | 104 | Keyboard → Ink useInput |
| `cli/cmd/tui/context/route.tsx` | `tui/context/route.tsx` | 46 | Simple state |
| `cli/cmd/tui/context/kv.tsx` | `tui/context/kv.tsx` | ~50 | Persistent KV |
| `cli/cmd/tui/app.tsx` | `tui/app.tsx` | 913 | Root + provider tree |

### SolidJS → React Primitive Cheat Sheet

| SolidJS | React Equivalent |
|---------|-----------------|
| `createSignal()` | `useState()` |
| `createMemo()` | `useMemo()` |
| `createEffect()` | `useEffect()` |
| `createEffect(on(dep, fn))` | `useEffect(fn, [dep])` |
| `onMount(() => ...)` | `useEffect(() => ..., [])` |
| `onCleanup(() => ...)` | `useEffect(() => { return () => ... })` |
| `batch(() => ...)` | Remove — React 19 auto-batches |
| `createStore()` + `produce()` | `useReducer()` + `immer.produce()` |
| `reconcile()` | Immutable replace in reducer |
| `Show when={x}` | `{x && <...>}` or `{x ? <...> : null}` |
| `For each={items}` | `{items.map(item => <...>)}` |
| `Switch`/`Match` | `if/else` or ternary |
| `ErrorBoundary` | React class `ErrorBoundary` |
| `@opentui/solid` `render()` | `@liteai/ink` `renderSync()` |
| `useKeyboard()` | `useInput()` from `@liteai/ink` |
| `useTerminalDimensions()` | `useTerminalViewport()` from `@liteai/ink` |
| `useRenderer()` | `useApp()` from `@liteai/ink` + custom utils |
| `<box>` / `<text>` (lowercase) | `<Box>` / `<Text>` (uppercase, from `@liteai/ink`) |
| `TextAttributes.BOLD` | `<Text bold>` |
| `RGBA.fromHex()` | Hex string literal |

## Architectural Decisions (Resolved)

| Decision | Choice | Impact |
|----------|--------|--------|
| **Q1: Theme colors** | **(A) Hex strings** — convert all `RGBA` usage to hex string literals. Clean break from `@opentui/core`. | Theme math (`tint()`, `luminance()`, contrast) must be reimplemented as hex-string utilities. ~80 call sites to convert. |
| **Q2: Renderer APIs** | **Implement ALL** — no deferrals. Extend `@liteai/ink` for every `useRenderer()` API: `setTerminalTitle`, `getSelection`/`clearSelection`, focus management, `suspend`/`resume`, debug overlay, console toggle, `getPalette`. | Requires upstream work in `packages/ink` before sub-phase 2.3. |
| **Q3: Sync store** | **(B) Zustand + immer** — external store with immer middleware. | New dependency: `zustand`. Perf benefits: selective subscriptions, no unnecessary re-renders. Store mutations via `immer.produce()` map 1:1 from SolidJS `produce`. |
| **Q4: Event system** | **(B) Typed emitter** — ~30-line utility in `src/tui/util/event-emitter.ts`. Type-safe, zero deps. | Replaces `@solid-primitives/event-bus`. |

> [!NOTE]
> **Session routes decomposition**: `routes/session/` (14 files, ~130KB) is split into 3 work units:
> 1. Layout: index + header + sidebar + utils (~42KB)
> 2. Message rendering: messages + parts + tools (~40KB)
> 3. Interactions: permission + question + commands + dialogs (~47KB)

---

## Proposed Changes

### Sub-phase 2.1: Infrastructure

#### [MODIFY] [package.json](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/cli/package.json)
Add React dependencies alongside existing SolidJS deps (both coexist until cleanup):
```diff
+ "react": "catalog:"
+ "@liteai/ink": "workspace:*"
+ "@liteai/hooks": "workspace:*"
+ "zustand": "latest"
+ "immer": "latest"
```

#### [NEW] `src/tui/util/color.ts`
Hex-string color utilities: `tint(hex, amount)`, `luminance(hex)`, `contrast(hex1, hex2)`, `fromInts(r,g,b,a)` → hex. No `RGBA` class — all functions operate on `string` (hex). ~80 lines. (Per Q1-A)

#### [NEW] `src/tui/util/event-emitter.ts`
Typed event emitter: `on<K>()`, `emit<K>()`, `off()`. ~30 lines. (Per Q4-B)

#### [NEW] `src/tui/context/helper.tsx`
React version of `createSimpleContext`: `createContext` + `useContext` + `Provider` with optional `ready` gate.

#### [MOVE] `src/cli/cmd/tui/flags.ts` → `src/tui/flags.ts`
Framework-agnostic, just relocate.

---

### Sub-phase 2.2: Foundation Contexts

Build React context providers in `src/tui/context/`. Each mirrors the SolidJS equivalent but uses React hooks.

#### [NEW] `src/tui/context/args.tsx`
Simple value context for CLI args. Props → context value.

#### [NEW] `src/tui/context/exit.tsx`
Exit callback context. `useEffect` cleanup instead of `onCleanup`.

#### [NEW] `src/tui/context/kv.tsx`
Key-value persistent store. `useState` with `.signal()` helper returning `[value, setter]` tuple.

#### [NEW] `src/tui/context/tui-config.tsx`
Config value passthrough.

#### [NEW] `src/tui/context/prompt.tsx`
Prompt ref context. `useRef` + `useState`.

#### [NEW] `src/tui/context/route.tsx`
Route state. `useState<Route>`. Types (`HomeRoute`, `SessionRoute`) unchanged.

#### [NEW] `src/tui/context/sdk.tsx`
SDK client + typed event emitter + SSE connection management.
- `createGlobalEmitter` → typed emitter from 2.1
- `batch()` → removed (React 19 auto-batches)
- `onMount`/`onCleanup` → `useEffect`

---

### Sub-phase 2.3: Complex Contexts

The hardest conversions. Large files with deep reactive patterns.

#### [NEW] `src/tui/context/sync.tsx`
~565 lines. State management core.
- `createStore` + `produce` + `reconcile` → **Zustand store** + `immer` middleware (per Q3-B)
- Selective subscriptions via Zustand's `useStore(store, selector)` — avoids re-rendering entire tree on every SSE event
- Event subscription via `useEffect` + typed emitter
- `Binary.search` + splice logic stays pure TS
- Bootstrap sequence stays the same (Promise.all pattern)

#### [NEW] `src/tui/context/theme.tsx`
~1155 lines. Theme resolution + syntax highlighting.
- `RGBA` → **hex strings** throughout (per Q1-A). All theme color values become `string` type.
- Color math (`tint`, gray scale, contrast`) uses hex utilities from `src/tui/util/color.ts`
- `SyntaxStyle` from `@opentui/core` → port to `@liteai/ink`
- `useRenderer().getPalette()` → **implement** via `@liteai/ink` API (per Q2 — no deferrals)
- `createStore`/`createMemo`/`createEffect` → `useState`/`useMemo`/`useEffect`
- 33 theme JSON files: **unchanged**

#### [NEW] `src/tui/context/local.tsx`
~408 lines. Agent/model selection.
- `createStore` → Zustand store (or `useState` if scope is small enough)
- `RGBA.fromHex()` → hex string literal + `color.ts` utilities

#### [NEW] `src/tui/context/keybind.tsx`
~104 lines.
- `useKeyboard` → `useInput` from `@liteai/ink`
- Focus management → `@liteai/ink` focus API (per Q2)

---

### Sub-phase 2.4: UI Primitives (from MVP)

**Source**: MVP's `components/design-system/` + `context/`

#### [NEW] `src/tui/ui/dialog.tsx`
**Port from**: `liteai_cli_mvp/components/design-system/Dialog.tsx` (14KB) + `liteai_cli_mvp/context/modalContext.tsx` (6KB). Wire to our React context system.

#### [NEW] `src/tui/ui/fuzzy-picker.tsx`
**Port from**: `liteai_cli_mvp/components/design-system/FuzzyPicker.tsx` (41KB). The MVP's fuzzy picker is significantly richer than the old SolidJS version.

#### [NEW] `src/tui/ui/toast.tsx`
**Port from**: `liteai_cli_mvp/context/notifications.tsx` (33KB). Toast/notification system.

#### [NEW] `src/tui/ui/spinner.ts`
**Port from**: `liteai_cli_mvp/components/Spinner.tsx` (88KB). Full animation system.

#### [NEW] `src/tui/ui/dialog-*.tsx` (9 files)
**Port from**: Existing SolidJS dialog variants as **feature reference only** — build with MVP's `Dialog` + `FuzzyPicker` primitives from above. These are thin wrappers specific to our command palette.

---

### Sub-phase 2.5: Components (from MVP)

**Source**: MVP's `components/` and `components/design-system/`

#### [NEW] `src/tui/components/design-system/`
**Port from MVP** — these are already React components for `@liteai/ink`:
- `ThemedBox.tsx` ← `liteai_cli_mvp/components/design-system/ThemedBox.tsx` (18KB)
- `ThemedText.tsx` ← `liteai_cli_mvp/components/design-system/ThemedText.tsx` (14KB)
- `Tabs.tsx` ← `liteai_cli_mvp/components/design-system/Tabs.tsx` (41KB)
- `ListItem.tsx` ← `liteai_cli_mvp/components/design-system/ListItem.tsx` (20KB)
- `Pane.tsx` ← `liteai_cli_mvp/components/design-system/Pane.tsx` (7KB)
- `ProgressBar.tsx` ← `liteai_cli_mvp/components/design-system/ProgressBar.tsx` (7KB)
- `StatusIcon.tsx` ← `liteai_cli_mvp/components/design-system/StatusIcon.tsx` (8KB)
- `Divider.tsx` ← `liteai_cli_mvp/components/design-system/Divider.tsx` (11KB)
- `Byline.tsx`, `KeyboardShortcutHint.tsx`, `LoadingState.tsx`, `Ratchet.tsx`

#### [NEW] `src/tui/components/prompt/`
**Port from**: `liteai_cli_mvp/components/PromptInput/` (directory) + `liteai_cli_mvp/components/TextInput.tsx` (21KB) + `liteai_cli_mvp/components/VimTextInput.tsx` (16KB) + `liteai_cli_mvp/components/BaseTextInput.tsx` (19KB). Wire to our SDK/sync contexts for submission.

#### [NEW] `src/tui/components/markdown.tsx`
**Port from**: `liteai_cli_mvp/components/Markdown.tsx` (28KB). Already React.

#### [NEW] `src/tui/components/structured-diff.tsx`
**Port from**: `liteai_cli_mvp/components/StructuredDiff.tsx` (25KB) + `liteai_cli_mvp/components/FileEditToolDiff.tsx` (22KB).

#### [NEW] `src/tui/components/status-line.tsx`
**Port from**: `liteai_cli_mvp/components/StatusLine.tsx` (49KB).

#### [NEW] `src/tui/components/dialog-*.tsx` (~13 dialog components)
These are **app-specific** dialogs (model picker, session list, MCP manager, etc.). Port visual structure from MVP equivalents where they exist (`liteai_cli_mvp/components/ModelPicker.tsx` 54KB, `liteai_cli_mvp/components/ThemePicker.tsx` 36KB, etc.). Wire to our sync/local/sdk contexts.

---

### Sub-phase 2.6: Routes & App Entry (MVP visuals + existing architecture)

#### [NEW] `src/tui/routes/home.tsx`
Home screen. Use existing SolidJS `routes/home.tsx` as feature reference; build with MVP design-system components.

#### [NEW] `src/tui/routes/session/` — split into 3 work units:

**Work unit 1: Layout** (`index.tsx`, `header.tsx`, `sidebar.tsx`, `utils.ts`, `ctx.tsx`)
- Layout structure from existing SolidJS (scrollbox + sidebar + header arrangement)
- Visual primitives from MVP (ThemedBox, Pane, Tabs)
- Wire to our sync/route/local contexts

**Work unit 2: Message rendering** (`messages.tsx`, `parts.tsx`, `tools.tsx`)
- **Port from MVP**: `liteai_cli_mvp/components/Messages.tsx` (147KB), `MessageRow.tsx` (48KB), `Message.tsx` (79KB)
- These are the MVP's richest components — virtual scroll, markdown, diffs, tool progress
- Adapt data access: MVP reads from `useReplBridge` → our code reads from `sync.data.message[sessionID]` + `sync.data.part[messageID]`

**Work unit 3: Interactions** (`permission.tsx`, `question.tsx`, `commands.tsx`, `dialog-*.tsx`)
- Permission/question prompts: use existing SolidJS as feature spec, build with MVP primitives
- Command palette: port from `liteai_cli_mvp/components/QuickOpenDialog.tsx` (29KB) or existing command registration pattern

#### [NEW] `src/tui/app.tsx`
New React root. Structure:
- `renderSync()` from `@liteai/ink` (replaces `@opentui/solid` `render()`)
- React class `ErrorBoundary` (replaces SolidJS `ErrorBoundary`)
- Provider tree mirrors existing architecture (SDK → Sync → Theme → Local → Keybind → Dialog → App)
- `useInput()` from `@liteai/ink` (replaces `useKeyboard`)
- `useTerminalViewport()` from `@liteai/ink` (replaces `useTerminalDimensions`)

#### [MODIFY] [attach.ts](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/cli/src/cli/cmd/tui/attach.ts)
Rewire import: `import { tui } from "../../../tui/app"`. ~2-line change.

#### [MODIFY] [thread.ts](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/cli/src/cli/cmd/tui/thread.ts)
Rewire import: `import { tui } from "../../../tui/app"`. ~2-line change.

---

### Sub-phase 2.7: Cleanup & Validation

#### [DELETE] Old SolidJS TUI files
```
git rm -r src/cli/cmd/tui/app.tsx
git rm -r src/cli/cmd/tui/component/
git rm -r src/cli/cmd/tui/context/
git rm -r src/cli/cmd/tui/routes/
git rm -r src/cli/cmd/tui/ui/
git rm -r src/cli/cmd/tui/util/
git rm    src/cli/cmd/tui/event.ts
```
Keep: `attach.ts`, `thread.ts`, `worker.ts`, `win32.ts` (framework-agnostic).

#### [MODIFY] [package.json](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/cli/package.json)
Remove SolidJS deps:
```diff
- "@opentui/core": "0.1.87"
- "@opentui/solid": "0.1.87"
- "@solid-primitives/event-bus": "1.1.2"
- "@solid-primitives/scheduled": "1.5.2"
- "solid-js": "catalog:"
- "opentui-spinner": "0.0.6"
```

---

## Verification Plan

### Per Sub-phase Gates

| Sub-phase | Command | Gate |
|-----------|---------|------|
| 2.1–2.6 | `bun typecheck` (workspace) | All packages pass (old + new coexist) |
| 2.6 | `bun lint:fix` | No errors in `src/tui/` |
| 2.7 | `bun typecheck` (workspace) | Passes after SolidJS deletion |
| 2.7 | `cd packages/cli && bun test test/` | Existing CLI tests pass |

### Manual Verification (Sub-phase 2.7)

| Scenario | Expected |
|----------|----------|
| `liteai serve` | Server starts — works unchanged |
| `liteai thread` | React+Ink TUI renders in terminal |
| `liteai thread` → type → stream response | SSE streaming, messages, tool calls |
| `liteai thread` → Ctrl+C | Clean exit |
| `liteai attach http://...` | Attaches to remote, TUI renders |
| Non-TUI commands | Work unchanged |
