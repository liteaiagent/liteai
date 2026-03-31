# Cleanup: Migrate HTTP/SSE Providers from `packages/ui` to `packages/web`

> **Priority:** Low — cosmetic code organization. No functional impact.
> **Prerequisite:** Phase 4 (Live VSCode Controller) should be done first.
> **Created:** 2026-03-31
> **Related:** [architecture_refactoring_plan.md](./architecture_refactoring_plan.md) — Phase 1.3

## Background

Phase 1 decoupled chat components from HTTP/SSE providers via controller interfaces:
- `ChatController` — messages, sessions, agents, config
- `SessionController` — rename, archive, delete, share
- `SelectionController` — model/agent/variant selection (added 2026-03-31)

**The shared UI is now 100% decoupled.** No chat component in `packages/ui` directly imports `useSync()`, `useSDK()`, `useLocal()`, or `usePermission()`. They only use controller hooks (`useChatController`, `useSessionController`, `useSelectionController`).

The actual provider implementations (`useSync`, `useSDK`, `GlobalSyncProvider`, etc.) remain in `packages/ui/src/panes/shared/` even though they're web-specific HTTP/SSE infrastructure. This is a code organization issue, not a functional one.

## Why This Was Deprioritized

Analysis revealed a **cascade dependency problem** that makes the migration riskier than it appears:

### The Cascade

```
server.tsx ─── global-sdk.tsx ─── sdk.tsx ─┐
                    │                       │
                    └── global-sync.tsx ─── sync.tsx ──┐
                              │                         │
                        permission.tsx          use-providers.ts ── models.tsx ── local.tsx
```

`local.tsx`, `models.tsx`, and `use-providers.ts` have hard runtime dependencies on `useSDK()`, `useSync()`, and `useGlobalSync()`. Total scope: **27 files**, not the 18 originally planned.

Since `packages/ui` cannot import from `packages/web` (circular dependency), and **chat components no longer import from these files** (they use controllers), there's nothing blocking the move except the work itself.

## Migration Plan (Simplified)

Since chat components are fully decoupled via controllers, the migration is now a straightforward move-and-update-imports operation. No interface splitting needed.

### Step 1: Move All HTTP/SSE Files → `packages/web/src/context/`

Move these files from `packages/ui/src/panes/shared/`:

| File | Import rewrites needed |
|---|---|
| `server.tsx` | `../../context` → `@liteai/ui/context`, `./persist` → `@liteai/ui/panes/shared/persist`, `./platform` → `@liteai/ui/panes/shared/platform` |
| `server-errors.ts` | None |
| `server-health.ts` | Co-located with server (no change) |
| `server-util.ts` | Co-located with server (no change) |
| `global-sdk.tsx` | `../../context` → `@liteai/ui/context`, `./platform` → `@liteai/ui/panes/shared/platform` |
| `sdk.tsx` | `../../context` → `@liteai/ui/context` |
| `global-sync.tsx` | `../../components/toast` → `@liteai/ui/toast`, `./language` → `@liteai/ui/panes/shared/language` |
| `global-sync/` (12 files) | No changes (only `@liteai/sdk` imports) |
| `sync.tsx` | `../../context` → `@liteai/ui/context`, `./project-id` → `@liteai/ui/panes/shared/project-id` |
| `permission.tsx` | `../../context` → `@liteai/ui/context`, `./pane-route` → `@liteai/ui/panes/shared/pane-route`, `./persist` → `@liteai/ui/panes/shared/persist` |
| `permission-auto-respond.ts` | `./project-id` → `@liteai/ui/panes/shared/project-id` |
| `use-providers.ts` | `./pane-route` → `@liteai/ui/panes/shared/pane-route` |
| `models.tsx` | `../../context` → `@liteai/ui/context`, `./persist` → `@liteai/ui/panes/shared/persist` |
| `local.tsx` | `../../context` → `@liteai/ui/context`, `./pane-route` → `@liteai/ui/panes/shared/pane-route`, `./persist` → `@liteai/ui/panes/shared/persist`, `./project-id` → `@liteai/ui/panes/shared/project-id` |

### Step 2: Update `packages/web` Internal Imports

Replace the existing re-export stubs in `packages/web/src/context/` (e.g., `sync.tsx`, `sdk.tsx`, `local.tsx` etc.) with the real implementations from the moved files.

Update `web-chat-controller.ts` and `web-selection-controller.ts` to use local `./` imports instead of `@liteai/ui/panes` for moved modules.

### Step 3: Clean Up `packages/ui/src/panes/index.ts`

Remove all HTTP/SSE provider exports:
- [ ] `GlobalSDKProvider`, `useGlobalSDK`
- [ ] `GlobalSyncProvider`, `useGlobalSync`
- [ ] `SDKProvider`, `useSDK`
- [ ] `SyncProvider`, `useSync`
- [ ] `ServerProvider`, `useServer`, `normalizeServerUrl`, `ServerConnection`, `serverName`
- [ ] `PermissionProvider`, `usePermission`
- [ ] `LocalProvider`, `useLocal`
- [ ] `ModelsProvider`, `useModels`
- [ ] `useProviders`
- [ ] `applyOptimisticAdd`, `applyOptimisticRemove`, `mergeOptimisticPage`
- [ ] Server health/error/util exports
- [ ] Global sync sub-module exports

Keep:
- Controller exports (`ChatController`, `SessionController`, `SelectionController`, `ModelController`)
- Controller hooks (`useChatController`, `useSessionController`, `useSelectionController`)
- Platform-agnostic exports (`LanguageProvider`, `PlatformProvider`, `PaneProviders`, etc.)

### Step 4: Delete Originals

- [ ] `server.tsx`, `server-errors.ts`, `server-health.ts`, `server-util.ts`
- [ ] `global-sdk.tsx`
- [ ] `sdk.tsx`
- [ ] `global-sync.tsx`, `global-sync/` (entire directory)
- [ ] `sync.tsx`
- [ ] `permission.tsx`, `permission-auto-respond.ts`
- [ ] `local.tsx`, `models.tsx`, `use-providers.ts`

### Step 5: Update Storybook

- [ ] `todo-panel-motion.stories.tsx` — update `useGlobalSync` import or provide mock context

### Step 6: Verify

- [ ] `bun typecheck` passes in `packages/ui`
- [ ] `bun typecheck` passes in `packages/web`
- [ ] `bun typecheck` passes in `packages/vscode`
- [ ] Web app works identically (manual smoke test)
- [ ] VSCode extension still renders

## Files That Stay in `packages/ui/src/panes/shared/`

These are truly platform-agnostic with zero HTTP/SSE dependencies:

| File | Purpose |
|---|---|
| `language.tsx` | i18n provider |
| `platform.tsx` | Platform abstraction (openLink, fetch override) |
| `settings.tsx` | Local UI preferences (localStorage) |
| `pane-route.tsx` | Route signal |
| `prompt.tsx` | Prompt state management |
| `persist.ts` | localStorage persistence |
| `pane-providers.tsx` | Slim provider tree (Platform → Language → Settings → Route) |
| `project-id.ts` | Directory ↔ projectID mapping |
| `model-variant.ts` | Model variant resolution logic |
| `file-types.ts` | File selection types |
| `uuid.ts` | UUID generation |
