# Phase 2.5: Components Implementation Plan

This plan details the process for porting visual components from the MVP codebase (`liteai_cli_mvp`) to the new React-based CLI TUI (`packages/cli/src/tui/components/`), adhering to the requirements laid out in `phase_2.5_components.md`.

## User Review Required

> [!IMPORTANT]
> The phase document mentions porting app-specific dialogs, some of which don't have MVP equivalents (e.g., `dialog-agent.tsx`, `dialog-mcp.tsx`, `dialog-session-list.tsx`). Since this phase is massive (~30+ components), I propose we split the execution of Phase 2.5 into smaller batches to ensure stability and maintain lint/typecheck compliance at each step.

## Proposed Execution Batches

I will execute the porting in the following batches. After each batch, I will run typecheck and linting to ensure no regressions.

### Batch 1: Design System Components [DONE]
Port the 12 standalone design system components from MVP to `src/tui/components/design-system/`:
- `ThemedBox.tsx`, `ThemedText.tsx`, `Tabs.tsx`, `ListItem.tsx`, `Pane.tsx`, `ProgressBar.tsx`, `StatusIcon.tsx`, `Divider.tsx`, `Byline.tsx`, `KeyboardShortcutHint.tsx`, `LoadingState.tsx`, `Ratchet.tsx`
- *Adaptation*: Update imports to `@liteai/ink` and wire theme access to `useTheme()`.

### Batch 2: Rendering Components [DONE]
Port the Markdown and Diff rendering components:
- `components/markdown.tsx` (from MVP `Markdown.tsx`)
- `components/structured-diff.tsx` (merging/porting MVP `StructuredDiff.tsx` and `FileEditToolDiff.tsx`)
- `components/status-line.tsx` (from MVP `StatusLine.tsx`)
- `components/tool-use-loader.tsx` (from MVP `ToolUseLoader.tsx`)

### Batch 3: Prompt Input System [IN PROGRESS]
Port the prompt input directory:
- `components/prompt/` (from MVP `PromptInput/`)
- `components/text-input.tsx`, `components/vim-text-input.tsx`, `components/base-text-input.tsx`
- *Adaptation*: Wire the prompt to submit via our `useSDK()` context instead of MVP's `useReplBridge`.

### Batch 4: App-Specific Dialogs
Port the 13 app-specific dialogs:
- Dialogs with MVP equivalents: `ModelPicker`, `ThemePicker`, `QuickOpenDialog`.
- Dialogs without MVP equivalents: `dialog-agent.tsx`, `dialog-mcp.tsx`, `dialog-session-list.tsx`, etc.
- *Adaptation*: Build using Phase 2.4 primitives (`Dialog`, `FuzzyPicker`) and wire to our context hooks.

## Verification Plan

### Automated Tests
- Run `bun typecheck` after each batch to guarantee full type safety.
- Run `bun lint:fix` after each batch to ensure Biome formatting and rules compliance.
- Confirm zero React Compiler artifacts (`$[n]` patterns) in the ported code.

### Manual Verification
- Review the `src/tui/components/` directory structure to match the spec.
- Check that legacy SolidJS context patterns are not accidentally ported.

**Shall I proceed with implementing Batch 1?**
