# CLI Memory Leak Fix — Task Tracker

## Phase 1: State Management Rewrite (Critical) ✅ COMPLETE

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

---

## Memory Optimization Roadmap Phases ✅ COMPLETE

### Phase 2: Lazy Provider Loading
- [x] Rewrite `bundled.ts` — 22 static imports → dynamic `import()` closures
- [x] Update `sdk.ts` — `getSDK()` awaits lazy loader before invoking factory
- [x] Verify: SDK cache (`s.sdk` Map) prevents repeated dynamic imports

### Phase 3: Lazy Telemetry Initialization
- [x] Move `@opentelemetry/sdk-node` behind `isTelemetryEnabled()` check
- [x] Move `@opentelemetry/sdk-metrics` behind telemetry gate
- [x] Move `@opentelemetry/sdk-logs` behind telemetry gate
- [x] Move `@opentelemetry/sdk-trace-base` behind telemetry gate
- [x] Gate `@langfuse/otel` behind Langfuse key check
- [x] Convert all exporter imports in `factories.ts` to dynamic
- [x] Early return in `getOtlpReaders()` when no exporters configured
- [x] Keep `@opentelemetry/api` static (lightweight, used everywhere)

### Phase 5: Single-Process Mode
- [x] Implement conditional Worker spawn in `thread.ts` (external vs local)
- [x] Create `local-server.ts` — in-process boot + direct fetch + GlobalBus events
- [x] Create `LocalRpcApi` interface for type-safe RPC without module evaluation
- [x] Dynamic `import("./local-server")` — @liteai/core modules only load in local mode
- [x] Typecheck + Lint: both packages clean

---

## Phase 1B: Migrate createSimpleContext Providers

> **Priority: Low.** These providers hold small, infrequently-changing state.
> The `createSimpleContext` pattern re-executes `init()` per render, but unlike
> the old `SyncProvider`, none of these cause render cascades at scale.

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

> **Priority: Medium.** Without backoff, a misconfigured or offline backend
> causes tight reconnection loops generating rapid `setState` calls. The new
> `useAppState` architecture limits blast radius (no full-tree re-renders),
> but CPU/network cost of rapid reconnects remains.

- [ ] Add reconnection delay (1s) for normal stream completion
- [ ] Implement exponential backoff (1s → 2s → 4s → ... → 30s cap)
- [ ] Reset backoff on successful connection
- [ ] Return cleanup function from useEffect SSE path
- [ ] Add `startedRef` guard against concurrent SSE loops
- [ ] Typecheck + Lint

## Phase 3: State Lifecycle Management

> **Priority: Low-Medium.** Prevents slow memory creep in long-running
> sessions with heavy tool use. Not a crisis for typical usage.

- [ ] Implement agent eviction (completed agents removed after 5min)
- [ ] Implement session-scoped cleanup on navigation (clear diff/todo/parts for inactive sessions)
- [ ] Cap `part` map (500 total, LRU eviction by oldest message)
- [ ] Typecheck + Lint

## Phase 4: Render Optimization

> **Priority: Low.** Further reduces intermediate allocations in hot render paths.

- [ ] Create memoized selector factories in `app-state-selectors.ts`
- [ ] Split `prompt-input.tsx` to use individual selectors per consumed field
- [ ] Verify render counts with `useRef` counters (PromptInput stays at 0 during streaming)
- [ ] Typecheck + Lint

---

## Memory Optimization Roadmap — Remaining Phases

### Phase 4 (Roadmap): Core/TUI Boundary Decoupling

> **Priority: Low (recontextualized).** With single-process mode as default,
> the duplication problem no longer applies to the common case. Only relevant
> for `--port`/`--mdns` (Worker mode).

- [ ] Audit TUI imports from `@liteai/core` — classify as type-only / constant / function
- [ ] Replace runtime imports with `import type` where possible
- [ ] Extract shared types to `@liteai/sdk` or `@liteai/types`
- [ ] Proxy `Global.Path` via bootstrap RPC instead of direct import
- [ ] Verify: `grep -r "@liteai/core" packages/cli/src/tui/` returns zero runtime imports

### Phase 6 (Roadmap): Eager Import Audit

> **Priority: Low.** Est. savings 10-30MB. Polish pass.

- [ ] Lazy theme loading — replace 33 static JSON imports with on-demand `Bun.file().json()`
- [ ] Lazy `highlight.js` grammars — switch to `highlight.js/lib/core` + on-demand registration
- [ ] Evaluate dialog lazy registration (code-split 30+ dialogs, load on first open)
- [ ] Typecheck + Lint

---

## Verification

- [ ] Memory stability test: idle 60s, RSS delta < 10 MB
- [ ] Functional test: send prompts, switch sessions, verify rendering
- [ ] Baseline measurement: RSS ≤ 350 MB (post all phases)
