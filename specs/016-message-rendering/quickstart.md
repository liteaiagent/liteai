# Quickstart: Message Rendering & Error Resilience

**Date**: 2026-05-21
**Branch**: `016-message-rendering`

## Implementation Order

### Step 1: Bug Fixes (Prerequisites)
Fix critical bugs before any rendering changes to establish a stable testing baseline.

1. **Fix `plan_enter` model resolution** — `packages/core/src/tool/plan.ts:220-234`
   - Add `ctx.extra.model` fallback (matches `agent.ts:77-89` pattern)
   - Currently fails with "Could not determine parent model" because in-flight message isn't in the list
2. **Fix `onSessionError` shape** — `packages/cli/src/tui/state/app-state-context.tsx:144`
   - Change `err?.data?.message` → `err?.message`
3. **Fix thinking collapse arrow** — `packages/cli/src/tui/routes/session/parts.tsx:76`
   - Change `▼` → `▶` for collapsed state
4. **Fix `todowrite` null render** — `packages/cli/src/tui/routes/session/parts.tsx:159-160`
   - Remove `return null`, let it fall through to the unified renderer

### Step 2: Foundation Components
New components that don't modify any existing rendering.

1. **Tool status constants** — `packages/cli/src/tui/constants/tool-status.ts`
2. **Display status mapper** — `packages/cli/src/tui/utils/tool-display-status.ts`
3. **ToolStatusIndicator** — `packages/cli/src/tui/components/tool-status-indicator.tsx`
4. **ErrorMessage / WarningMessage** — `packages/cli/src/tui/components/error-message.tsx`, `warning-message.tsx`

### Step 3: Toast Overhaul
Replace bordered-box toast with inline text.

1. **Modify toast context** — `packages/cli/src/tui/context/toast.tsx` (single-toast, replace not stack)
2. **Modify toast renderer** — `packages/cli/src/tui/ui/toast.tsx` (remove borders, inline text)

### Step 4: Tool Rendering Overhaul (Core)
The major refactor — unified DenseToolMessage.

1. **Rewrite `tools.tsx`** — Replace `InlineTool`/`BlockTool` + 17 per-tool components with:
   - `DenseToolMessage` unified component
   - Per-tool `getViewParts()` formatter functions
2. **Update `parts.tsx`** — Simplify `ToolPartView` dispatch to use `DenseToolMessage` for all tools

### Step 5: Group & Status Polish
Final visual polish.

1. **Update `collapsed-group-view.tsx`** — Status indicators + summary count
2. **Update `status-line.tsx`** — Clean model name

## Verification

```bash
bun typecheck 2>&1 | Out-String
bun lint:fix
bun test test/tui       # if TUI tests exist
```

Manual: Run the TUI, trigger 5+ different tool types, verify unified rendering.
