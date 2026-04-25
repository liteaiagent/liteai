# Phase 2.5 Batch 3: Prompt Input System

## Sub-batch 3.1: Foundation (Types + Utilities)
- `[x]` Port `textInputTypes.ts` → `src/tui/types/text-input.ts`
- `[x]` Port `utils/Cursor.ts` → `src/tui/util/cursor.ts`
- `[x]` Port `vim/` directory → `src/tui/util/vim/`
- `[x]` Port `utils/textHighlighting.ts` → `src/tui/util/text-highlighting.ts`
- `[x]` Port `hooks/useDoublePress.ts` → `src/tui/hooks/use-double-press.ts`
- `[x]` Port `hooks/usePasteHandler.ts` — **DEFERRED** (depends on imagePaste, clipboard)
- `[x]` Port `hooks/renderPlaceholder.ts` → `src/tui/hooks/render-placeholder.ts`
- `[x]` Port `utils/intl.ts` → `src/tui/util/intl.ts`
- `[x]` Export `wrapAnsi` from `@liteai/ink`
- `[x]` Run `bun typecheck` — ✅ PASS
- `[x]` Run `bun lint:fix` — ✅ PASS

## Sub-batch 3.2: Core Input Hooks
- `[x]` Port `hooks/useTextInput.ts` → `src/tui/hooks/use-text-input.ts`
- `[x]` Port `hooks/useVimInput.ts` → `src/tui/hooks/use-vim-input.ts`
- `[x]` Port `hooks/useArrowKeyHistory.tsx` → `src/tui/hooks/use-arrow-key-history.ts`
- `[x]` Port `hooks/useHistorySearch.ts` — **DEFERRED** to 3.4 (depends on keybinding system, feature flags)
- `[x]` Run `bun typecheck` — ✅ PASS
- `[x]` Run `bun lint:fix` — ✅ PASS

## Sub-batch 3.3: Input Components
- `[x]` Port `BaseTextInput.tsx` → `src/tui/components/base-text-input.tsx`
- `[x]` Port `TextInput.tsx` → `src/tui/components/text-input.tsx`
- `[x]` Port `VimTextInput.tsx` → `src/tui/components/vim-text-input.tsx`
- `[x]` Run `bun typecheck` — ✅ PASS
- `[x]` Run `bun lint:fix` — ✅ PASS

## Sub-batch 3.4: PromptInput Orchestrator
- `[ ]` Port `PromptInput/PromptInput.tsx` → `src/tui/components/prompt/prompt-input.tsx`
- `[ ]` Port `PromptInput/PromptInputFooter.tsx` → `src/tui/components/prompt/prompt-input-footer.tsx`
- `[ ]` Port `PromptInput/PromptInputModeIndicator.tsx` → `src/tui/components/prompt/prompt-input-mode-indicator.tsx`
- `[ ]` Port `PromptInput/Notifications.tsx` → `src/tui/components/prompt/notifications.tsx`
- `[ ]` Port `PromptInput/inputModes.ts` → `src/tui/components/prompt/input-modes.ts`
- `[ ]` Port `PromptInput/utils.ts` → `src/tui/components/prompt/utils.ts`
- `[ ]` Run `bun typecheck` — gate
- `[ ]` Run `bun lint:fix` — gate
