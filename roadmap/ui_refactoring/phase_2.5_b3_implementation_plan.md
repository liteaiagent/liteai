# Phase 2.5 Batch 3: Full Prompt Input System Migration

Port the **complete** prompt input system from the MVP codebase to the new React-based CLI TUI, mapping all dependencies to the existing TUI context system.

## Context: Why the Full Port is Correct

The new TUI already has rich state management that directly maps to the MVP's `AppState`:

| MVP Dependency | New TUI Equivalent |
|---|---|
| `useAppState(s => s.tasks/sessions/messages)` | `useSync()` — Zustand store with SSE-synced backend state |
| `useAppState(s => s.mainLoopModel)` | `useLocal().model.current()` |
| `useAppState(s => s.agents)` | `useLocal().agent` / `useSync().agent` |
| `useReplBridge / onSubmit` | `useSDK().client` — submit via SDK |
| `useKeybinding / useKeybindings` | `useKeybind()` — keybind context |
| `useTheme` (MVP ink) | `useTheme()` — theme context |
| `useNotifications / addNotification` | `useToast()` — toast context |
| `getGlobalConfig()` | `useSync().config` |
| `PromptRef` (focus/submit control) | `usePromptRef()` — already exists in `context/prompt.tsx` |

There is **no reason** to strip AppState — it's already here, just decomposed into purpose-built contexts.

## User Review Required

> [!IMPORTANT]
> The MVP `PromptInput.tsx` is **2,339 lines** with ~120 imports. Due to massive scope, I propose splitting Batch 3 into **4 sequential sub-batches**, each passing `bun typecheck` + `bun lint:fix` before advancing.

> [!WARNING]
> MVP files contain **React Compiler artifacts** (`_c()`, `$[n]` patterns). All ported code will be recovered from the embedded sourcemaps (base64 in each file) to produce clean, idiomatic React source code.

## Open Questions

> [!IMPORTANT]
> **Feature flags to exclude:** The MVP uses `feature('VOICE_MODE')`, `feature('BUDDY')`, `feature('KAIROS')`, `feature('ULTRAPLAN')`, `feature('TOKEN_BUDGET')` — compile-time constants from `bun:bundle`. These are MVP-specific build features. **I propose excluding all feature-flagged code** and porting only the non-flagged baseline. Confirm?

> [!IMPORTANT]
> **Typeahead/autocomplete (`useTypeahead.tsx`, 212KB):** This is a massive hook providing slash-command, file-path, and context suggestions. Should it be ported in this batch, or deferred to a dedicated Batch 3.5? Porting it means the prompt is fully functional; deferring means basic input works but no autocomplete.

## Proposed Changes

### Sub-batch 3.1: Foundation (Types + Utilities) [DONE]

Self-contained utilities with zero context dependencies. These compile independently.

#### [NEW] `src/tui/types/text-input.ts`
- Ported from [textInputTypes.ts](file:///C:/Users/aghassan/Documents/workspace/liteai_cli_mvp/types/textInputTypes.ts).
- Adapted: Remove `ContentBlockParam` (anthropic SDK), `PermissionResult`, `AssistantMessage`, `AgentId` references. Retain core types: `BaseTextInputProps`, `VimTextInputProps`, `BaseInputState`, `TextInputState`, `VimInputState`, `VimMode`, `InlineGhostText`, `PromptInputMode`, `QueuedCommand`.
- `Key` type → imported from `@liteai/ink` instead of MVP `ink.js`.

#### [NEW] `src/tui/util/cursor.ts`
- Ported from [Cursor.ts](file:///C:/Users/aghassan/Documents/workspace/liteai_cli_mvp/utils/Cursor.ts) (46KB).
- Self-contained text editing engine. Kill ring, yank, cursor movement, text wrapping, viewport windowing.
- Import adaptation: `stringWidth` from `@liteai/ink` instead of MVP.

#### [NEW] `src/tui/util/vim/` directory (5 files)
- Ported from [vim/](file:///C:/Users/aghassan/Documents/workspace/liteai_cli_mvp/vim/).
- `motions.ts`, `operators.ts`, `textObjects.ts`, `transitions.ts`, `types.ts`.
- Self-contained vim state machine. Dependencies: only `Cursor` from util.

#### [NEW] `src/tui/util/text-highlighting.ts`
- Ported from `MVP/utils/textHighlighting.ts`.
- `TextHighlight` type and any highlight utilities used by input components.

#### [NEW] `src/tui/hooks/use-double-press.ts`
- Ported from [useDoublePress.ts](file:///C:/Users/aghassan/Documents/workspace/liteai_cli_mvp/hooks/useDoublePress.ts).
- Simple double-press detection hook. Self-contained.

#### [NEW] `src/tui/hooks/use-paste-handler.ts`
- Ported from [usePasteHandler.ts](file:///C:/Users/aghassan/Documents/workspace/liteai_cli_mvp/hooks/usePasteHandler.ts).
- Paste detection and handling. Image paste, large text paste, bracketed paste.

#### [NEW] `src/tui/hooks/render-placeholder.ts`
- Ported from [renderPlaceholder.ts](file:///C:/Users/aghassan/Documents/workspace/liteai_cli_mvp/hooks/renderPlaceholder.ts).
- Placeholder text rendering logic.

---

### Sub-batch 3.2: Core Input Hooks [DONE]

These hooks use the foundation from 3.1 and wire into our TUI contexts.

#### [NEW] `src/tui/hooks/use-text-input.ts`
- Ported from [useTextInput.ts](file:///C:/Users/aghassan/Documents/workspace/liteai_cli_mvp/hooks/useTextInput.ts) (530 lines).
- Dependencies: `Cursor`, `useDoublePress`, `Key` from `@liteai/ink`.
- **Adaptation:** `useNotifications` → `useToast()`, `addToHistory` → wire to our prompt history (or inline for now).

#### [NEW] `src/tui/hooks/use-vim-input.ts`
- Ported from [useVimInput.ts](file:///C:/Users/aghassan/Documents/workspace/liteai_cli_mvp/hooks/useVimInput.ts) (317 lines).
- Dependencies: `useTextInput`, `Cursor`, `vim/` state machine.
- Clean port — no context dependencies beyond `useTextInput`.

#### [NEW] `src/tui/hooks/use-arrow-key-history.ts`
- Ported from [useArrowKeyHistory.tsx](file:///C:/Users/aghassan/Documents/workspace/liteai_cli_mvp/hooks/useArrowKeyHistory.tsx) (34KB).
- **Adaptation:** MVP reads history from `getHistory()` (file-based). Map to `useSync().sessions` + `useSync().message` for session-based history.

#### [NEW] `src/tui/hooks/use-history-search.ts`
- Ported from [useHistorySearch.ts](file:///C:/Users/aghassan/Documents/workspace/liteai_cli_mvp/hooks/useHistorySearch.ts) (9.5KB).
- History search with fuzzy matching. Wire to our session/message data.

---

### Sub-batch 3.3: Input Components [DONE]

The visual components that render the text input.

#### [NEW] `src/tui/components/base-text-input.tsx`
- Ported from [BaseTextInput.tsx](file:///C:/Users/aghassan/Documents/workspace/liteai_cli_mvp/components/BaseTextInput.tsx).
- **Strip React Compiler artifacts** — recover original source from embedded sourcemap.
- Imports: `Ansi`, `Box`, `Text`, `useInput` from `@liteai/ink`; `useDeclaredCursor` from `@liteai/ink`.
- Props: `BaseInputState`, cursor rendering, viewport windowing, highlight filtering.

#### [NEW] `src/tui/components/text-input.tsx`
- Ported from [TextInput.tsx](file:///C:/Users/aghassan/Documents/workspace/liteai_cli_mvp/components/TextInput.tsx).
- **Exclude:** `feature('VOICE_MODE')` — voice waveform cursor, audio levels, animation frame.
- **Keep:** Standard cursor invert (`chalk.inverse`), `useTextInput` wiring, theme text color.
- Imports: `@liteai/ink` hooks (`useTerminalFocus`), `useTheme()` from our context.

#### [NEW] `src/tui/components/vim-text-input.tsx`
- Ported from [VimTextInput.tsx](file:///C:/Users/aghassan/Documents/workspace/liteai_cli_mvp/components/VimTextInput.tsx).
- Clean port. Uses `useVimInput`, `BaseTextInput`, `@liteai/ink`.

---

### Sub-batch 3.4: PromptInput Orchestrator [IN PROGRESS]

The main prompt component and its supporting sub-components.

#### [NEW] `src/tui/components/prompt/prompt-input.tsx`
- Ported from [PromptInput.tsx](file:///C:/Users/aghassan/Documents/workspace/liteai_cli_mvp/components/PromptInput/PromptInput.tsx) (2339 lines).
- **Major adaptation required.** Context rewiring:
  - `useAppState` → `useSync()` + `useLocal()`
  - `onSubmit(input, helpers)` → `useSDK().client.project.session.chat(...)` or equivalent
  - `useIsModalOverlayActive` → TUI route context or local state
  - `useCommandQueue` → local state or new hook
  - `useKeybinding / useKeybindings` → `useKeybind()`
- **Exclude feature-flagged blocks:** `feature('VOICE_MODE')`, `feature('BUDDY')`, `feature('KAIROS')`, `feature('ULTRAPLAN')`, `feature('TOKEN_BUDGET')`.
- **Exclude MVP-specific integrations:** IDE integration, teleport, bridge dialog, auto-updater, teams/swarm navigation, coordinator tasks.
- **Keep core functionality:** Input management, cursor tracking, history navigation, basic footer, model/permission display, vim mode toggle, paste handling (text + image), slash command highlighting.

#### [NEW] `src/tui/components/prompt/prompt-input-footer.tsx`
- Ported from `MVP/PromptInput/PromptInputFooter.tsx` (33KB).
- Simplified footer showing: model name, session status, keybinding hints.
- Wire to `useLocal().model.parsed()` for model display.

#### [NEW] `src/tui/components/prompt/prompt-input-mode-indicator.tsx`
- Ported from `MVP/PromptInput/PromptInputModeIndicator.tsx`.
- Shows vim mode (INSERT/NORMAL) and prompt mode indicator.

#### [NEW] `src/tui/components/prompt/notifications.tsx`
- Ported from `MVP/PromptInput/Notifications.tsx`.
- Inline prompt notifications (escape-to-clear, stash hints). Wire to `useToast()`.

#### [NEW] `src/tui/components/prompt/input-modes.ts`
- Ported from `MVP/PromptInput/inputModes.ts`.
- Mode character detection utility.

#### [NEW] `src/tui/components/prompt/utils.ts`
- Ported from `MVP/PromptInput/utils.ts`.
- Vim mode detection, utility helpers.

## File Inventory Summary

| Sub-batch | New Files | Estimated LOC | Dependencies |
|---|---|---|---|
| 3.1 Foundation | ~10 files | ~3,500 | None (self-contained) |
| 3.2 Input Hooks | 4 files | ~2,500 | 3.1 + TUI contexts |
| 3.3 Input Components | 3 files | ~600 | 3.1 + 3.2 + `@liteai/ink` |
| 3.4 PromptInput | ~6 files | ~2,000 | 3.1–3.3 + all TUI contexts |

## Verification Plan

### Automated Tests
- `bun typecheck` after **each sub-batch** — zero tolerance for type errors.
- `bun lint:fix` after **each sub-batch** — Biome compliance.
- Confirm zero React Compiler artifacts (`$[n]`, `_c()` patterns) in ported code.
- Confirm zero `as any` casts.

### Manual Verification
- Verify no legacy MVP imports remain (`../ink.js`, `src/state/AppState`, `../utils/config.js`).
- Verify all `@liteai/ink` prop types are used correctly (no `key` prop on custom components).
- Verify `useSDK()` is the sole submission path (no `useReplBridge` remnants).

**Shall I proceed with implementation starting at Sub-batch 3.1?**
