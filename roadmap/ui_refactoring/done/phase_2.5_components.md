# Phase 2.5: Components (from MVP)

**Branch**: `feat/cli-react`
**Depends on**: Phase 2.4 (UI primitives: dialog, fuzzy picker, toast, spinner)
**Produces**: Design system components, prompt input, markdown renderer, dialogs in `src/tui/components/`

## Objective

Port the visual components from the **MVP codebase**. These are the building blocks used by the routes in phase 2.6. This phase covers design-system components, the prompt input system, markdown rendering, and app-specific dialogs.

> [!IMPORTANT]
> **Source is MVP, not SolidJS.** Port from `liteai_cli_mvp/`. MVP components contain React Compiler output — always check for `$[n]` patterns and revert to original source logic.

## Source References

**MVP codebase**: `C:\Users\aghassan\Documents\workspace\liteai_cli_mvp\`

### Design System Components (MVP → `src/tui/components/design-system/`)

| MVP Source | Port To | Size |
|-----------|---------|------|
| `liteai_cli_mvp\components\design-system\ThemedBox.tsx` | `components/design-system/ThemedBox.tsx` | 18KB |
| `liteai_cli_mvp\components\design-system\ThemedText.tsx` | `components/design-system/ThemedText.tsx` | 14KB |
| `liteai_cli_mvp\components\design-system\Tabs.tsx` | `components/design-system/Tabs.tsx` | 41KB |
| `liteai_cli_mvp\components\design-system\ListItem.tsx` | `components/design-system/ListItem.tsx` | 20KB |
| `liteai_cli_mvp\components\design-system\Pane.tsx` | `components/design-system/Pane.tsx` | 7KB |
| `liteai_cli_mvp\components\design-system\ProgressBar.tsx` | `components/design-system/ProgressBar.tsx` | 7KB |
| `liteai_cli_mvp\components\design-system\StatusIcon.tsx` | `components/design-system/StatusIcon.tsx` | 8KB |
| `liteai_cli_mvp\components\design-system\Divider.tsx` | `components/design-system/Divider.tsx` | 11KB |
| `liteai_cli_mvp\components\design-system\Byline.tsx` | `components/design-system/Byline.tsx` | 6KB |
| `liteai_cli_mvp\components\design-system\KeyboardShortcutHint.tsx` | `components/design-system/KeyboardShortcutHint.tsx` | 7KB |
| `liteai_cli_mvp\components\design-system\LoadingState.tsx` | `components/design-system/LoadingState.tsx` | 6KB |
| `liteai_cli_mvp\components\design-system\Ratchet.tsx` | `components/design-system/Ratchet.tsx` | 7KB |

### Prompt Input (MVP → `src/tui/components/prompt/`)

| MVP Source | Port To | Size |
|-----------|---------|------|
| `liteai_cli_mvp\components\PromptInput\` | `components/prompt/` | ~dir |
| `liteai_cli_mvp\components\TextInput.tsx` | `components/text-input.tsx` | 21KB |
| `liteai_cli_mvp\components\VimTextInput.tsx` | `components/vim-text-input.tsx` | 16KB |
| `liteai_cli_mvp\components\BaseTextInput.tsx` | `components/base-text-input.tsx` | 19KB |

### Rendering Components (MVP → `src/tui/components/`)

| MVP Source | Port To | Size |
|-----------|---------|------|
| `liteai_cli_mvp\components\Markdown.tsx` | `components/markdown.tsx` | 28KB |
| `liteai_cli_mvp\components\StructuredDiff.tsx` | `components/structured-diff.tsx` | 25KB |
| `liteai_cli_mvp\components\FileEditToolDiff.tsx` | `components/file-edit-diff.tsx` | 22KB |
| `liteai_cli_mvp\components\StatusLine.tsx` | `components/status-line.tsx` | 49KB |
| `liteai_cli_mvp\components\ToolUseLoader.tsx` | `components/tool-use-loader.tsx` | 5KB |

### App-Specific Dialogs (MVP + existing SolidJS feature reference)

| MVP Source (where exists) | Feature Reference (SolidJS) | Port To |
|--------------------------|---------------------------|---------|
| `liteai_cli_mvp\components\ModelPicker.tsx` (54KB) | `cli/cmd/tui/component/dialog-model.tsx` | `components/dialog-model.tsx` |
| `liteai_cli_mvp\components\ThemePicker.tsx` (36KB) | `cli/cmd/tui/component/dialog-theme-list.tsx` | `components/dialog-theme.tsx` |
| `liteai_cli_mvp\components\QuickOpenDialog.tsx` (29KB) | `cli/cmd/tui/component/dialog-command.tsx` | `components/dialog-command.tsx` |
| — | `cli/cmd/tui/component/dialog-agent.tsx` | `components/dialog-agent.tsx` |
| — | `cli/cmd/tui/component/dialog-mcp.tsx` | `components/dialog-mcp.tsx` |
| — | `cli/cmd/tui/component/dialog-session-list.tsx` | `components/dialog-session-list.tsx` |
| — | `cli/cmd/tui/component/dialog-session-rename.tsx` | `components/dialog-session-rename.tsx` |
| — | `cli/cmd/tui/component/dialog-provider.tsx` | `components/dialog-provider.tsx` |
| — | `cli/cmd/tui/component/dialog-plugin.tsx` | `components/dialog-plugin.tsx` |
| — | `cli/cmd/tui/component/dialog-skill.tsx` | `components/dialog-skill.tsx` |
| — | `cli/cmd/tui/component/dialog-stash.tsx` | `components/dialog-stash.tsx` |
| — | `cli/cmd/tui/component/dialog-status.tsx` | `components/dialog-status.tsx` |
| — | `cli/cmd/tui/component/dialog-workspace-list.tsx` | `components/dialog-workspace.tsx` |

**All paths relative to**: `c:\Users\aghassan\Documents\workspace\liteai\packages\cli\src\tui\`
**SolidJS feature reference base**: `c:\Users\aghassan\Documents\workspace\liteai\packages\cli\src\cli\cmd\tui\component\`

## Proposed Changes

### 1. [NEW] `src/tui/components/design-system/` (12 files)

Port directly from MVP. These are already React+Ink components. Adaptations:
- Update imports to use `@liteai/ink` instead of MVP's local ink
- Wire theme access to our `useTheme()` context (from phase 2.3)
- Check for React Compiler output (`$[n]` patterns) and revert to source

### 2. [NEW] `src/tui/components/prompt/` + input components

Port from MVP's `PromptInput/` directory + text input components.

**Adaptation needed**: The MVP prompt submits via `useReplBridge`. Our prompt must submit via `useSDK()` context (from phase 2.2). The visual rendering stays the same.

### 3. [NEW] `src/tui/components/markdown.tsx`

Port from MVP's `Markdown.tsx` (28KB). Already React.

### 4. [NEW] `src/tui/components/structured-diff.tsx`

Port from MVP's `StructuredDiff.tsx` (25KB) + `FileEditToolDiff.tsx` (22KB). Merge or keep separate as needed.

### 5. [NEW] `src/tui/components/status-line.tsx`

Port from MVP's `StatusLine.tsx` (49KB). Wire to our contexts for session/model/agent data.

### 6. [NEW] `src/tui/components/dialog-*.tsx` (~13 files)

App-specific dialogs. For dialogs with MVP equivalents (model picker, theme picker, command palette), port from MVP. For dialogs without MVP equivalents, build using:
- `FuzzyPicker` from phase 2.4
- `Dialog` from phase 2.4
- Design system components from this phase
- Feature spec from existing SolidJS dialog files

Each dialog wires to our contexts (`useSync`, `useLocal`, `useSDK`, `useTheme`) for data access.

## Verification

```powershell
cd c:\Users\aghassan\Documents\workspace\liteai
bun typecheck 2>&1 | Out-String
bun lint:fix
```

**Gate**: All components compile. No missing context dependencies.

## Review Checklist

- [ ] All 12 design system components compile
- [ ] Prompt input system compiles and wires to `useSDK()` for submission
- [ ] Markdown renderer compiles
- [ ] Diff components compile
- [ ] All 13 dialog components compile
- [ ] No React Compiler artifacts (`$[n]` patterns) in ported code
- [ ] `bun typecheck` clean
- [ ] `bun lint:fix` clean
