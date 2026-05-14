# Walkthrough: Settings Architecture Refactor

## Summary

This session resolved a structural crash, built a Claude Code-style tabbed settings UI, and consolidated TUI settings into the core config for cross-machine synchronization.

---

## Phase 1: Crash Fix — Context-Aware Navigation

**Problem**: `DialogModel` and `DialogMcp` called `useModalPane()` directly, but when rendered via the legacy `DialogProvider` stack (auth flows), they were outside the `ModalPaneProvider` — causing an invariant violation crash.

**Solution**: Strategy pattern via `useNavigation()` hook.

### Files Changed

| File | Change |
|------|--------|
| [modal-pane.tsx](file:///d:/liteai/packages/cli/src/tui/context/modal-pane.tsx) | Added `useOptionalModalPane()` — returns `null` instead of throwing when outside provider |
| [use-navigation.ts](file:///d:/liteai/packages/cli/src/tui/hooks/use-navigation.ts) | **[NEW]** Strategy hook that detects context and dispatches to modalPane or dialog stack |
| [dialog-model.tsx](file:///d:/liteai/packages/cli/src/tui/components/dialog-model.tsx) | Migrated from `useModalPane()` to `useNavigation()` |
| [dialog-mcp.tsx](file:///d:/liteai/packages/cli/src/tui/components/dialog-mcp.tsx) | Migrated from `useModalPane()` to `useNavigation()` |

---

## Phase 2: Tabs Component + /config Command

**Goal**: Replace the orphaned `DialogSettings` hub with a Claude Code-style tabbed settings pane.

### Files Changed

| File | Change |
|------|--------|
| [tabs.tsx](file:///d:/liteai/packages/cli/src/tui/ui/tabs.tsx) | **[NEW]** Reusable `<Tabs>` / `<Tab>` design system component with keyboard navigation |
| [dialog-config.tsx](file:///d:/liteai/packages/cli/src/tui/components/dialog-config.tsx) | **[NEW]** Tabbed settings pane with Status + Config tabs |
| [prompt-input.tsx](file:///d:/liteai/packages/cli/src/tui/components/prompt/prompt-input.tsx) | Added `/config` and `/settings` slash commands + `DialogConfig` import |
| [dialog-settings.tsx](file:///d:/liteai/packages/cli/src/tui/components/dialog-settings.tsx) | **[DELETED]** Legacy settings hub (was already orphaned) |

### Config Tab Features
- **Session**: Model picker, Provider management
- **Appearance**: Theme, Error verbosity toggle, Diff style toggle
- **Configuration**: MCP servers, Plugins
- **Diagnostics**: System status (links to Status tab)

---

## Phase 3: Settings Consolidation

**Goal**: Move portable TUI settings into core `settings.json` for cross-machine sync while keeping `tui.json` as a local override.

### Core Schema

Added `tui` namespace to [schema.ts](file:///d:/liteai/packages/core/src/config/schema.ts#L682-L710):

```typescript
tui: {
  theme: string
  keybinds: { context, bindings }[]
  errorVerbosity: "low" | "full"
  diff_style: "auto" | "stacked"
  output_file_threshold: number
}
```

### Persistence Flow

```
settings.json (core, portable)
  ↓ base layer
tui.json (local, machine-specific overrides)
  ↓ overlay
.liteai/tui.json (project-level)
  ↓ overlay
managed config (highest precedence)
```

**Writes** go to `settings.json` via `Config.updateGlobal({ tui: patch })`, with `tui.json` as a fallback.

### Files Changed

| File | Change |
|------|--------|
| [schema.ts](file:///d:/liteai/packages/core/src/config/schema.ts) | Added `tui` namespace to `Info` schema |
| [loader.ts](file:///d:/liteai/packages/core/src/config/loader.ts) | Stopped stripping `tui` key; kept legacy `theme`/`keybinds` stripping |
| [tui-schema.ts](file:///d:/liteai/packages/cli/src/cli/config/tui-schema.ts) | Removed `scroll_speed` and `scroll_acceleration` (OS-level settings) |
| [tui.ts](file:///d:/liteai/packages/cli/src/cli/config/tui.ts) | Reads from core config first, overlays local files; writes to `settings.json` |
| [tui-config.tsx](file:///d:/liteai/packages/cli/src/tui/context/tui-config.tsx) | Updated persistence comment |
| [scroll-handler.tsx](file:///d:/liteai/packages/cli/src/tui/components/scroll-handler.tsx) | Removed `useTuiConfig()` dependency; scroll speed from env only |
| [tips.tsx](file:///d:/liteai/packages/cli/src/tui/components/tips.tsx) | Replaced scroll_acceleration tip with /config tip |
| [tui.test.ts](file:///d:/liteai/packages/cli/test/config/tui.test.ts) | Updated scroll_speed → errorVerbosity assertions |

---

## Validation

| Check | Result |
|-------|--------|
| `bun typecheck` (all packages) | ✅ Pass |
| `bun lint:fix` | ✅ 4 files auto-fixed |
| `bun test test/config/tui.test.ts` | ✅ 12/12 pass |
