# CLI Memory Leak Fix — Task Tracker

## Phase 1: State Management Rewrite (Critical)

### Core Infrastructure
- [x] Create `tui/state/app-store.ts` — External store (createAppStore, AppStore type)
- [x] Create `tui/state/app-state.ts` — AppState type + getDefaultAppState()
- [x] Create `tui/state/app-state-events.ts` — Event handler logic (extracted from sync.tsx)
- [x] Create `tui/state/app-state-actions.ts` — bootstrap, syncSession, syncWorkspaces
- [x] Create `tui/state/app-state-context.tsx` — AppStateProvider, useAppState, useSetAppState
- [x] Create `tui/state/app-state-selectors.ts` — Common selector factories
- [x] Create `tui/state/index.ts` — Barrel export

### Consumer Migration (39 sites → useAppState selectors)
- [x] `context/session.tsx` — useSync → useAppState
- [x] `context/local.tsx` — useSync → useAppState
- [x] `routes/session/index.tsx` (×2)
- [x] `routes/session/tools.tsx` (×3)
- [x] `routes/session/sidebar.tsx`
- [x] `routes/session/parts.tsx`
- [x] `routes/session/messages.tsx`
- [x] `routes/session/message.tsx`
- [x] `routes/session/permission.tsx`
- [x] `routes/home/index.tsx`
- [x] `hooks/use-session-stats.ts`
- [x] `components/dialog-mcp.tsx` (×2)
- [x] `components/dialog-model.tsx` (×2)
- [x] `components/dialog-provider.tsx` (×5)
- [x] `components/dialog-search.tsx`
- [x] `components/dialog-session-list.tsx` (×2)
- [x] `components/dialog-status.tsx`
- [x] `components/status-line.tsx`
- [x] `components/transcript-search.tsx`
- [x] `components/virtual-message-list.tsx` (×2)
- [x] `components/prompt/prompt-input.tsx` (×3)
- [x] `components/dialog-workspace.tsx` (×4)
- [x] `components/dialog-stats.tsx`
- [x] `components/dialog-session-rename.tsx`
- [x] `components/dialog-rewind.tsx`
- [x] `components/dialog-permissions.tsx`
- [x] `components/dialog-manage-models.tsx`
- [x] `components/dialog-help-v2.tsx`
- [x] `components/dialog-diff.tsx`

### Wiring
- [x] Update `app.tsx` — Replace SyncProvider with AppStateProvider
- [x] Delete `context/sync.tsx`
- [x] Typecheck: `bun typecheck`
- [x] Lint: `bun lint:fix`

## Phase 1B: Migrate createSimpleContext Providers

All 12 remaining providers → explicit createContext + Provider component:

- [ ] `context/exit.tsx` — ExitProvider
- [ ] `context/args.tsx` — ArgsProvider
- [ ] `context/kv.tsx` — KVProvider
- [ ] `context/tui-config.tsx` — TuiConfigProvider
- [ ] `context/theme.tsx` — ThemeProvider
- [ ] `context/toast.tsx` — ToastProvider
- [ ] `context/route.tsx` — RouteProvider
- [ ] `context/prompt.tsx` — PromptRefProvider
- [ ] `context/sdk.tsx` — SDKProvider
- [ ] `context/session.tsx` — SessionProvider
- [ ] `context/local.tsx` — LocalProvider
- [ ] `context/stats.tsx` — StatsProvider
- [ ] Delete `context/helper.tsx` (createSimpleContext)
- [ ] Typecheck: `bun typecheck`
- [ ] Lint: `bun lint:fix`

## Phase 2: SSE Transport Hardening

- [ ] Add reconnection delay for normal stream completion
- [ ] Implement exponential backoff (1s → 2s → 4s → ... → 30s cap)
- [ ] Return cleanup function from useEffect SSE path
- [ ] Add startedRef guard against concurrent SSE loops
- [ ] Typecheck + Lint

## Phase 3: State Lifecycle Management

- [ ] Implement agent eviction (completed agents removed after 5min)
- [ ] Implement session-scoped cleanup on navigation
- [ ] Cap parts map (500 total, LRU eviction)
- [ ] Typecheck + Lint

## Phase 4: Render Optimization

- [ ] Create memoized selector factories in app-state-selectors.ts
- [ ] Split prompt-input.tsx to use individual selectors
- [ ] Verify render counts with useRef counters
- [ ] Typecheck + Lint

## Verification

- [ ] Memory stability test: idle 60s, RSS delta < 10 MB
- [ ] Functional test: send prompts, switch sessions, verify rendering
