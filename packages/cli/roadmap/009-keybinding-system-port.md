# 009 — Port MVP Keybinding System

> **Status**: Complete (Undergoing Testing)  
> **Priority**: Critical — keybindings are currently non-functional  
> **Breaking**: Yes — clean break from legacy `<leader>` config format (Directive 0)
> **Last Reviewed**: 2026-05-01

## Problem

The current CLI keybinding system is architecturally broken. It uses a flat config-driven
`<leader>` key approach (`KeybindProvider` in `context/keybind.tsx`) that lacks event
propagation control. When a keybinding fires, the `PromptInput`'s `useInput` handler
**also** processes the same keystroke and inserts the character into the text field.

The MVP solves this with three mechanisms the current codebase lacks:
1. **Context-based priority resolution** — bindings scoped to contexts (Global, Chat, Select, etc.)
2. **`ChordInterceptor`** — renders before children, calls `event.stopImmediatePropagation()`
3. **`useKeybinding` / `useKeybindings` hooks** — declarative action-based registration

The Ink engine (`packages/ink`) already supports `stopImmediatePropagation()` on its
`EventEmitter` — it is simply never used by the current CLI.

## Reference

- MVP keybinding system: `C:\Users\aghassan\Documents\workspace\liteai_cli_mvp\keybindings\`
- Key files to port: `parser.ts`, `match.ts`, `resolver.ts`, `defaultBindings.ts`,
  `KeybindingContext.tsx`, `KeybindingProviderSetup.tsx`, `useKeybinding.ts`

---

## Phase 1 — Core Keybinding Infrastructure ✅

**Goal**: Port the MVP's keybinding modules as new files. Zero existing code changes.
All new files in `packages/cli/src/tui/keybindings/`.

### Tasks

- [x] **1.1** Create `types.ts`
  - `KeybindingContextName` (union of context strings)
  - `ParsedKeystroke` (`{ key, ctrl, alt, shift, meta, super }`)
  - `Chord` (`ParsedKeystroke[]`)
  - `ParsedBinding` (`{ chord, action, context }`)
  - `KeybindingBlock` (`{ context, bindings }`)

- [x] **1.2** Port `parser.ts`
  - `parseKeystroke(input: string): ParsedKeystroke`
  - `parseChord(input: string): Chord`
  - `keystrokeToString(ks): string`
  - `chordToString(chord): string`
  - `parseBindings(blocks): ParsedBinding[]`
  - Adapt from MVP `keybindings/parser.ts` — clean TypeScript, no React Compiler artifacts

- [x] **1.3** Port `match.ts`
  - `getKeyName(input, key): string | null` — maps Ink's `Key` booleans to string names
  - `matchesKeystroke(input, key, target): boolean` — modifier matching with Ink quirks
    (escape sets `meta=true`, must be ignored for escape key itself)
  - `matchesBinding(input, key, binding): boolean`
  - Adapt from MVP `keybindings/match.ts`

- [x] **1.4** Port `resolver.ts`
  - `resolveKey(input, key, activeContexts, bindings): ResolveResult`
  - `resolveKeyWithChordState(input, key, activeContexts, bindings, pending): ChordResolveResult`
  - `getBindingDisplayText(action, context, bindings): string | undefined`
  - `keystrokesEqual(a, b): boolean` — collapses alt/meta into one logical modifier
  - Chord prefix/exact matching helpers
  - Result types: `match`, `chord_started`, `chord_cancelled`, `unbound`, `none`
  - Adapt from MVP `keybindings/resolver.ts`

- [x] **1.5** Create `default-bindings.ts`
  - Port from MVP `keybindings/defaultBindings.ts`
  - Remove `bun:bundle` feature flag conditionals — include all bindings unconditionally
  - Contexts: `Global`, `Chat`, `Autocomplete`, `Confirmation`, `Help`, `Scroll`,
    `Select`, `Tabs`, `Settings`
  - Key bindings to include:
    ```
    Global:  ctrl+c → app:interrupt, ctrl+d → app:exit, ctrl+r → history:search,
             ctrl+l → app:redraw, ctrl+t → app:toggleTodos
    Chat:    escape → chat:cancel, enter → chat:submit, up → history:previous,
             down → history:next, meta+p → chat:modelPicker, meta+t → chat:thinkingToggle,
             ctrl+x ctrl+e → chat:externalEditor, ctrl+s → chat:stash
    Scroll:  pageup → scroll:pageUp, pagedown → scroll:pageDown,
             wheelup → scroll:lineUp, wheeldown → scroll:lineDown,
             ctrl+home → scroll:top, ctrl+end → scroll:bottom
    Select:  up → select:previous, down → select:next, enter → select:accept,
             escape → select:cancel, j → select:next, k → select:previous
    Confirmation: y → confirm:yes, n → confirm:no, enter → confirm:yes, escape → confirm:no
    ```
  - Platform-specific: `IMAGE_PASTE_KEY = alt+v` on Windows, `ctrl+v` elsewhere

- [x] **1.6** Typecheck — `bun typecheck` in `packages/cli`
- [x] **1.7** Lint — `bun lint:fix` in `packages/cli`

---

## Phase 2 — Context & Provider ✅

**Goal**: Create the React context, provider, chord interceptor, and consumer hooks.
Still zero changes to existing components.

### Tasks

- [x] **2.1** Create `keybinding-context.tsx`
  - `KeybindingProvider` — context value: `resolve`, `setPendingChord`, `getDisplayText`,
    `bindings`, `pendingChord`, `activeContexts`, `registerActiveContext`,
    `unregisterActiveContext`, `registerHandler`, `invokeAction`
  - `useKeybindingContext()` — throws if outside provider
  - `useOptionalKeybindingContext()` — returns undefined outside provider
  - `useRegisterKeybindingContext(context, isActive?)` — lifecycle hook
  - De-compile from MVP's React Compiler output to clean `useMemo`/`useCallback` React

- [x] **2.2** Create `keybinding-setup.tsx`
  - `KeybindingSetup` — composed provider:
    - Loads default bindings from `default-bindings.ts`
    - ~~Merges user overrides from TUI config (new block format in `keybindings` key)~~ **DEFERRED to Phase 4**
    - Manages chord state: `pendingChordRef` (synchronous) + `pendingChordState` (re-renders)
    - Chord timeout: 1000ms via `setTimeout`
    - Handler registry: `Map<string, Set<HandlerRegistration>>`
    - Active context tracking: `Set<KeybindingContextName>` via ref
  - `ChordInterceptor` — **renders before children**:
    - Uses `useInput` (no isActive gate — always intercepts)
    - Resolves every keystroke via `resolveKeyWithChordState`
    - On `chord_started`: updates pending state, calls `event.stopImmediatePropagation()`
    - On `match` (during chord): invokes handler from registry, stops propagation
    - On `chord_cancelled`/`unbound`: clears state, stops propagation
    - On `none`: no-op (lets event through to other handlers)
    - Skips wheel events when no chord is pending (performance)
  - **NOTE**: Single-key matches are not intercepted by `ChordInterceptor` — they are
    handled by individual `useKeybinding`/`useKeybindings` hooks in consumer components.
    This is a deliberate dual-resolution architecture, not a bug.

- [x] **2.3** Create `use-keybinding.ts`
  - `useKeybinding(action, handler, options?)` — single action hook:
    - Registers handler with context via `useEffect`
    - Uses `useInput` with its own resolution for non-chord single-key matches
    - Calls `event.stopImmediatePropagation()` on match
  - `useKeybindings(handlers, options?)` — multi-action hook:
    - Same pattern but `handlers` is `Record<string, () => void | false | Promise<void>>`
    - `false` return = "not consumed" (event propagates)

- [x] **2.4** Create `use-shortcut-display.ts`
  - `useShortcutDisplay(action, context, fallback?): string`
  - React hook version using `useKeybindingContext().getDisplayText()`

- [x] **2.5** Typecheck — `bun typecheck` in `packages/cli`
- [x] **2.6** Lint — `bun lint:fix` in `packages/cli`

---

## Phase 3 — Wire Provider & Migrate Consumers ✅ Complete

**Goal**: Replace the old provider in the app tree, migrate all components from
`useKeybind().match(...)` + raw `useInput` to `useKeybinding`/`useKeybindings`.

### Tasks

- [x] **3.1** Wire `KeybindingSetup` into `app.tsx`
  - Replace `<KeybindProvider>` with `<KeybindingSetup>`
  - Remove old `KeybindProvider` import
  - Position: same level (wrapping `<SDKProvider>` and below `<ThemeProvider>`)

- [x] **3.2** Migrate `routes/session/index.tsx` (SessionRoute)
  - Remove `useKeybind()` call and raw `useInput` keybinding handler
  - Add `useRegisterKeybindingContext('Chat')`
  - Add `useKeybindings({ ... }, { context: 'Chat' })` for:
    - `chat:sidebarToggle`, `chat:thinkingToggle`, `chat:newSession`,
      `chat:sessionList`, `chat:messageCopy`, `chat:retry`

- [x] **3.3** Migrate `components/scroll-handler.tsx`
  - Replace `useKeybind().match(...)` with `useKeybindings({ ... }, { context: 'Scroll' })`
  - Register `useRegisterKeybindingContext('Scroll')`

- [x] **3.4** Migrate `ui/dialog.tsx`
  - Replace `useKeybind().match(...)` with `useKeybinding('confirm:no', ...)`
  - Register `useRegisterKeybindingContext('Confirmation')`

- [x] **3.5** Migrate `ui/dialog-select.tsx`
  - Replace keybind matching with `useKeybindings({ ... }, { context: 'Select' })`
  - Register `useRegisterKeybindingContext('Select')`

- [x] **3.6** Migrate `ui/dialog-help.tsx`
  - Replace `useKeybind().all` iteration with `useKeybindingContext().bindings`
  - Register `useRegisterKeybindingContext('Help')`

- [x] **3.7** Migrate remaining dialog consumers
  - ~~`dialog-command.tsx`~~ — does not exist in current codebase
  - [x] `dialog-mcp.tsx` — migrated to `useKeybindings`
  - [x] `dialog-plugin.tsx` — migrated to `useKeybindings`
  - [x] `dialog-alert.tsx` — uses raw `useInput` for Enter; cancel delegated to `<Dialog>`. Acceptable.
  - [x] `dialog-confirm.tsx` — uses raw `useInput` for Enter/arrows; cancel delegated to `<Dialog>`. Borderline.
  - [x] `dialog-prompt.tsx` — removed raw useInput `escape` handling, delegates cancel to `<Dialog>` (fixed double-fire).
  - [x] `dialog-export-options.tsx` — uses raw `useInput` for navigation/toggles; cancel delegated to `<Dialog>`.
  - [x] `routes/session/permission.tsx` — migrated to `useKeybindings("Select")`
  - [x] `routes/session/question.tsx` — migrated options navigation to `useKeybindings("Select")`

- [x] **3.8** Migrate `components/prompt/prompt-input.tsx`
  - Keep existing `useInput` for text-level editing (not keybindings)
  - Migrate keybinding-adjacent logic (ctrl+r → history search) to
    `useKeybinding('history:search', ...)` and `chat:cancel`
  - Register `useRegisterKeybindingContext('Chat')` (already from SessionRoute parent)

- [x] **3.9** Migrate `routes/session/message.tsx`
  - Uses `useKeybindingContext().getDisplayText()` for dynamic shortcut text

- [x] **3.10** Migrate `components/tips.tsx`
  - Replace hardcoded keybind references with display text from context
  - Added dynamic `[action|context|fallback]` parsing using `getDisplayText`

- [x] **3.11** Typecheck — `bun typecheck` in `packages/cli`
- [x] **3.12** Lint — `bun lint:fix` in `packages/cli`
- [ ] **3.13** Manual smoke test — run CLI, verify bindings work

---

## Phase 4 — Cleanup & Config Migration ✅ Complete

**Goal**: Remove legacy modules, update config schema.

### Tasks

- [x] **4.1** Delete `tui/context/keybind.tsx` (old `KeybindProvider`)
- [x] **4.2** Delete `cli/util/keybind.ts` (old `Keybind` namespace)
- [x] **4.3** Update `cli/config/tui-schema.ts`
  - Remove old flat `Keybinds` z.object with 100+ entries
  - Add new `KeybindingOverrides` schema: array of `{ context, bindings }` blocks
  - Keep `keybinds` key in `TuiInfo` but point to new schema
- [x] **4.4** Update `cli/config/tui.ts`
  - Replace `Keybinds.parse(result.keybinds ?? {})` with new block-format parsing
- [x] **4.5** Remove all dead `useKeybind` imports across codebase
- [x] **4.6** Final typecheck — `bun typecheck` in `packages/cli`
- [x] **4.7** Final lint — `bun lint:fix` in `packages/cli`
- [ ] **4.8** Full regression test — verify all keybindings, dialogs, text input

---

## Architecture Notes

### Event Flow (After Migration)

```
stdin → Ink parse-keypress → EventEmitter.emit('input', InputEvent)
  │
  ├─ ChordInterceptor (useInput — registered FIRST, renders before children)
  │   └─ resolveKeyWithChordState()
  │       ├─ match (chord) → invokeHandler() + stopImmediatePropagation() ─ DONE
  │       ├─ match (single) → clears pending, NO handler invocation ──────── (hooks handle it)
  │       ├─ chord_started → setPendingChord() + stopPropagation() ──────── DONE
  │       ├─ chord_cancelled → clearChord() + stopPropagation() ─────────── DONE
  │       └─ none → event flows to next listeners ↓
  │
  ├─ useKeybindings (Chat context — SessionRoute)
  │   └─ resolve() → match → handler() + stopPropagation() ──── DONE
  │
  ├─ useKeybindings (Scroll context — ScrollHandler)
  │   └─ ...
  │
  └─ BaseTextInput useInput (isActive: props.focus)
      └─ onInput(input, key) — only reached if no binding consumed the event
```

### Key Design Decisions

1. **Clean break** — no backward compatibility with old `<leader>` config format
2. **De-compile React Compiler** — MVP code uses `_c()` / `$[]` artifacts; port to clean React
3. **No `bun:bundle` feature flags** — include all bindings unconditionally
4. **Platform detection** — retain Windows-specific `alt+v` for image paste
5. **Chord timeout** — 1000ms (MVP default), configurable via constant
6. **Dual resolution** — ChordInterceptor handles chord sequences; individual `useKeybinding`/`useKeybindings` hooks handle single-key matches. This avoids centralizing all handler logic but means each keystroke is resolved N+1 times (interceptor + N hooks).

### Known Issues

1. ~~**`dialog-prompt.tsx` double-fire**~~ — Fixed by removing redundant `escape` handling.
2. ~~**User config overrides not wired**~~ — Fixed: `KeybindingSetup` now merges config from `useTuiConfig()` and `tui-schema.ts` supports the new block format.
3. ~~**`tips.tsx` hardcoded shortcuts**~~ — Fixed: Tips now parse `[action|context|fallback]` syntax and use `useKeybindingContext().getDisplayText()` to show accurate user overrides.
