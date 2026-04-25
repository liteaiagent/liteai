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

### Batch 3: Prompt Input System [DONE]
Port the prompt input directory:
- `components/prompt/` (from MVP `PromptInput/`)
- `components/text-input.tsx`, `components/vim-text-input.tsx`, `components/base-text-input.tsx`
- *Adaptation*: Wire the prompt to submit via our `useSDK()` context instead of MVP's `useReplBridge`.
- *Docs*: Implementation plan, task list, and sub-batch 3.4 plan archived to `done/`.

### Batch 4: App-Specific Dialogs [DONE]
Port the 13 app-specific dialogs from existing **SolidJS source** (`cli/cmd/tui/component/dialog-*.tsx`):
- **Simple dialogs:** `dialog-agent`, `dialog-theme`, `dialog-session-rename`, `dialog-skill`
- **Medium dialogs:** `dialog-model`, `dialog-session-list`, `dialog-stash`, `dialog-status`, `dialog-command`
- **Complex dialogs:** `dialog-mcp`, `dialog-provider`, `dialog-plugin`, `dialog-workspace`
- *Adaptation*: Convert SolidJS reactivity (createSignal/createMemo/createResource) to React (useState/useMemo/useEffect+state). Replace `@opentui/core`/`@opentui/solid` with `@liteai/ink`. Wire to existing TUI contexts.
- *See*: `phase_2.5_b4_implementation_plan.md` for detailed plan.

## Verification Plan

### Automated Tests
- Run `bun typecheck` after each batch to guarantee full type safety.
- Run `bun lint:fix` after each batch to ensure Biome formatting and rules compliance.
- Confirm zero React Compiler artifacts (`$[n]` patterns) in the ported code.

### Manual Verification
- Review the `src/tui/components/` directory structure to match the spec.
- Check that legacy SolidJS context patterns are not accidentally ported.

**Shall I proceed with implementing Batch 1?**
