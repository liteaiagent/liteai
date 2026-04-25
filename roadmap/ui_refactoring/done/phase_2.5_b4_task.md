# Phase 2.5 Batch 4: App-Specific Dialogs

- `[x]` Sub-batch 4.1: DialogSelect + useDialog Infrastructure
  - `[x]` Check/add `fuzzysort` dependency
  - `[x]` Create `src/tui/context/dialog.tsx` (Context provider, push/pop/replace stack manager)
  - `[x]` Rewrite `src/tui/ui/dialog-select.tsx` (Port full SolidJS API: fuzzy search, categories, keybinds, scrolling)
  - `[x]` Update `src/tui/ui/dialog.tsx` to tie into the context
  - `[x]` Verify typecheck and lint

- `[x]` Sub-batch 4.2: Simple Dialogs
  - `[x]` Create `src/tui/components/dialog-agent.tsx`
  - `[x]` Create `src/tui/components/dialog-theme.tsx`
  - `[x]` Create `src/tui/components/dialog-session-rename.tsx`
  - `[x]` Create `src/tui/components/dialog-skill.tsx`
  - `[x]` Verify typecheck and lint

- `[x]` Sub-batch 4.3: Medium Dialogs
  - `[x]` Create `src/tui/components/dialog-model.tsx`
  - `[x]` Create `src/tui/components/dialog-session-list.tsx`
  - `[x]` Create `src/tui/components/dialog-status.tsx`
  - `[x]` Create `src/tui/components/dialog-command.tsx` (Including `CommandProvider` context)
  - `[x]` Verify typecheck and lint

- `[x]` Sub-batch 4.4: Complex Dialogs
  - `[x]` Create `src/tui/components/dialog-mcp.tsx`
  - `[x]` Create `src/tui/components/dialog-provider.tsx`
  - `[x]` Create `src/tui/components/dialog-plugin.tsx`
  - `[x]` Create `src/tui/components/dialog-workspace.tsx`
  - `[x]` Verify typecheck and lint
