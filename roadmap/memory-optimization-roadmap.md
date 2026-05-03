# CLI Memory Optimization — Roadmap

> **Goal:** Reduce idle memory footprint from ~1,200 MB to ~200–350 MB (Claude Code parity), without regressing any runtime functionality. Targets the three dominant contributors: dual-process architecture, absence of production bundling, and eager dependency loading.

---

## Diagnosis Summary

| CLI | Idle RAM | Process Count | Bundled? | AI Providers Loaded |
|-----|----------|---------------|----------|---------------------|
| **liteai** | ~1,221 MB | 2 (main + Worker) | ❌ raw `bun run` | 22 (all eager) |
| Claude Code | ~316 MB | 1 | ✅ ESBuild | 1 |
| Gemini CLI | ~67 MB | 1 | ✅ ESBuild | 1 |

Root causes (ordered by impact):

1. **Dual-process architecture** — Worker thread loads the entire `@liteai/core` surface; main thread loads React/Ink + partial core. Two V8 heaps, two module caches.
2. **No production bundle** — Running from source (`bun run ./src/index.ts`): no tree-shaking, no dead-code elimination, no module concatenation.
3. **Eager provider loading** — [`bundled.ts`](../packages/core/src/provider/loaders/bundled.ts) statically imports all 22 AI SDK providers at module evaluation time.
4. **Eager telemetry loading** — [`instrumentation.ts`](../packages/core/src/telemetry/instrumentation.ts) imports the full OpenTelemetry SDK at boot, even when disabled.
5. **Core leaking into TUI thread** — 12 TUI files import from `@liteai/core` (Global, Provider, Snapshot types), pulling partial core into the main thread alongside the Worker's full copy.
6. **Eager static imports** — 33 theme JSONs, all 57 dialog/component files, and `highlight.js` (all grammars) loaded at startup.

---

## Dependency Chain

```
Phase 1: Production Bundle Pipeline
        │
        ├──> Phase 2: Lazy Provider Loading  (can start in parallel)
        │
        ├──> Phase 3: Lazy Telemetry         (can start in parallel)
        │
        ▼
Phase 4: Core/TUI Boundary Decoupling
        │
        ▼
Phase 5: Single-Process Mode (local)
        │
        ▼
Phase 6: Eager Import Audit
```

Phases 1–3 are independent and can be executed in parallel. Phase 4 depends on Phase 1 (bundle must exist to measure its tree-shaking effectiveness). Phase 5 depends on Phase 4 (TUI must not import core directly). Phase 6 is a polish pass.

---

## Phase 1: Production Bundle Pipeline

> **Est. savings:** 400–600 MB (tree-shaking + module consolidation)

### Context

Both Claude Code and Gemini CLI use ESBuild to produce a single bundled JS entry point. The bundle step eliminates dead code, concatenates modules (removing per-module overhead), and enables V8 to allocate a tighter heap.

Currently, `bun run ./src/index.ts` resolves and transpiles every `.ts` file at runtime, materializing the entire dependency graph into memory — including all unused exports.

### What to Implement

1. **Build script** — Extend existing `script/build.ts` with a `--bundle` mode (or create `script/bundle.ts`) that uses `Bun.build()` or ESBuild to produce:
   - `dist/cli.js` — Main thread entry point (CLI + TUI)
   - `dist/worker.js` — Worker thread entry point (core + server)
   
2. **Entry point splitting** — Two explicit entry points to preserve the Worker boundary:
   - `src/index.ts` → `dist/cli.js`
   - `src/cli/cmd/tui/worker.ts` → `dist/worker.js`
   
3. **External markers** — Mark native bindings as external (not bundled):
   - `@parcel/watcher` (native C++ addon)
   - `bun-pty` (native PTY)
   - `better-sqlite3` / Bun's built-in SQLite
   - `web-tree-sitter` + `.wasm` files
   
4. **Dev vs Prod mode** — `bun dev` continues running from source; `bun start` / `bun run dist/cli.js` runs the bundle. The `$0` (default) command in `thread.ts` must resolve `worker.js` from the `dist/` directory when bundled.

5. **Bundle size + module count tracking** — Add a CI step or local script that reports the bundle size and module count, similar to Gemini CLI's `scripts/build.js`.

### Files Affected

| File | Action |
|---|---|
| `packages/cli/script/bundle.ts` | **New** — Bun.build / ESBuild bundle configuration |
| `packages/cli/package.json` | **Modify** — add `"start": "bun run dist/cli.js"`, `"bundle": "bun run script/bundle.ts"` |
| `packages/cli/src/cli/cmd/tui/thread.ts` | **Modify** — `target()` function must prefer `dist/worker.js` when available |
| `packages/cli/tsconfig.json` | **Modify** — ensure `outDir` doesn't conflict with bundle output |

### Verification

- Bundle produces two valid JS files
- `bun run dist/cli.js` boots to TUI successfully
- Memory at idle is measurably lower than unbundled (target: ≥40% reduction)

---

## Phase 2: Lazy Provider Loading

> **Est. savings:** 100–200 MB

### Context

[`bundled.ts`](../packages/core/src/provider/loaders/bundled.ts) statically imports all 22 AI SDK factory functions at the top level. These imports execute at module evaluation time, pulling each provider's full dependency tree into memory. Many of these (e.g., `@ai-sdk/amazon-bedrock` → `@aws-sdk/credential-providers`, `@ai-sdk/google-vertex` → `google-auth-library`) have massive transitive dependency trees.

At idle, zero providers are needed. Even during a session, only 1–2 providers are active.

### What to Implement

1. **Lazy provider registry** — Replace static imports in `bundled.ts` with a registry of `{ npm: string, loader: () => Promise<SDK> }` entries. Each loader uses dynamic `import()`:

   ```typescript
   export const BUNDLED_PROVIDERS: Record<string, () => Promise<(options: any) => SDK>> = {
     "@ai-sdk/anthropic": () => import("@ai-sdk/anthropic").then(m => m.createAnthropic),
     "@ai-sdk/openai": () => import("@ai-sdk/openai").then(m => m.createOpenAI),
     // ...
   }
   ```

2. **Cache resolved providers** — `getSDK()` in `sdk.ts` already caches SDK instances by key. The lazy loader must cache the resolved factory function after first `import()` so subsequent calls don't re-import.

3. **Preload on session start** — When a session starts and the model is known, fire the `import()` for the active provider. This hides the async import behind the session creation latency.

4. **Bundle compatibility** — Ensure the bundler (Phase 1) does NOT inline dynamic `import()` targets. Mark provider packages as `external` in the bundle config, or use code-splitting.

### Files Affected

| File | Action |
|---|---|
| `packages/core/src/provider/loaders/bundled.ts` | **Major rewrite** — static imports → lazy registry |
| `packages/core/src/provider/sdk.ts` | **Modify** — `getSDK()` must `await` the lazy loader |
| `packages/core/src/provider/loaders/types.ts` | **Modify** — update `BundledProviders` type |
| `packages/cli/script/bundle.ts` | **Modify** — mark provider packages as external or split chunks |

### Verification

- `bun typecheck` passes
- Existing provider tests pass (scoped: `bun test test/provider`)
- At idle, no `@ai-sdk/*` module appears in V8 heap snapshot
- First model call completes successfully (lazy load + cache hit on second call)

---

## Phase 3: Lazy Telemetry Initialization

> **Est. savings:** 50–80 MB

### Context

[`instrumentation.ts`](../packages/core/src/telemetry/instrumentation.ts) imports the full OpenTelemetry SDK stack at the top level:
- `@opentelemetry/sdk-node` (heavy — includes all instrumentations)
- `@opentelemetry/sdk-trace-base`, `@opentelemetry/sdk-metrics`, `@opentelemetry/sdk-logs`
- 6 OTLP exporters (HTTP + Proto variants for traces, metrics, logs)
- `@langfuse/otel` (LangfuseSpanProcessor)

All of these are imported even when `LITEAI_TELEMETRY_DISABLED=1`. The `isTelemetryEnabled()` check happens *after* the imports have already evaluated.

### What to Implement

1. **Move all OTEL imports behind `isTelemetryEnabled()`** — The top-level imports in `instrumentation.ts` must become dynamic `import()` calls inside `initializeTelemetry()`, gated by the telemetry check:

   ```typescript
   export async function initializeTelemetry() {
     const config = await loadTelemetryConfig()
     applyConfigToEnv(config)
     
     if (!isTelemetryEnabled()) {
       initializePerfettoTracing(config?.perfetto)
       return // Zero OTEL modules loaded
     }
     
     const { NodeSDK } = await import("@opentelemetry/sdk-node")
     const { BatchSpanProcessor } = await import("@opentelemetry/sdk-trace-base")
     // ...
   }
   ```

2. **Keep `@opentelemetry/api` static** — The lightweight API package (~50KB) can remain a static import since it's used for span/meter access throughout the codebase. Only the heavy SDK/exporter packages should be lazy.

3. **Lazy Langfuse** — `@langfuse/otel` is only needed when Langfuse keys are configured. Gate its import behind the `langfusePublicKey` check.

### Files Affected

| File | Action |
|---|---|
| `packages/core/src/telemetry/instrumentation.ts` | **Major rewrite** — lazy OTEL imports |
| `packages/core/src/telemetry/factories.ts` | **Modify** — lazy exporter imports |

### Verification

- `bun typecheck` passes
- With `LITEAI_TELEMETRY_DISABLED=1`, no `@opentelemetry/sdk-*` modules in heap
- With telemetry enabled, traces/metrics still export correctly (manual verification against Langfuse dashboard or OTEL collector)

---

## Phase 4: Core/TUI Boundary Decoupling

> **Est. savings:** Indirect (enables Phase 5; reduces main-thread core surface)

### Context

12 TUI files in `packages/cli/src/tui/` import directly from `@liteai/core`:
- `context/local.tsx` → `Global`, `Provider`
- `context/theme.tsx` → `Global`
- `context/kv.tsx` → `Global`
- `context/sync.tsx` → `Snapshot` types
- `routes/session/tools.tsx` → core types
- `hooks/use-turn-diffs.ts` → `Snapshot` types
- `components/prompt/utils/command-suggestions.ts` → core types
- etc.

These imports pull partial `@liteai/core` modules into the main thread, duplicating data structures that already exist in the Worker's memory.

### What to Implement

1. **Audit each import** — Classify as:
   - **Type-only** — Can be replaced with `import type { ... }` (zero runtime cost)
   - **Constant/path** — Replace with SDK-provided equivalents or pass via props/context
   - **Function** — Must be proxied through the Worker RPC or moved to a shared `@liteai/util` package

2. **Extract shared types** — Move `Snapshot.FileDiff`, `Provider.parseModel`, etc. into `@liteai/sdk` or a new lightweight `@liteai/types` package that both TUI and core can import without pulling in heavy implementation.

3. **Proxy `Global.Path`** — The TUI thread uses `Global.Path.state` and `Global.Path.config` for local file access. These should be resolved once in the Worker and passed to the TUI via the bootstrap RPC call, not resolved by importing `@liteai/core/global/index`.

### Files Affected

| File | Action |
|---|---|
| 12 files in `packages/cli/src/tui/` | **Modify** — replace core imports with types/SDK/props |
| `packages/sdk/` (or new `@liteai/types`) | **Modify** — export shared type definitions |
| `packages/cli/src/cli/cmd/tui/thread.ts` | **Modify** — pass resolved paths via RPC |
| `packages/cli/src/cli/cmd/tui/worker.ts` | **Modify** — expose path info via RPC |

### Verification

- `bun typecheck` passes across all packages
- `grep -r "@liteai/core" packages/cli/src/tui/` returns zero results (excluding `import type`)
- TUI renders correctly with all dialogs functional

---

## Phase 5: Single-Process Mode (Local)

> **Est. savings:** 200–300 MB (eliminates duplicate V8 heap)

### Context

The Worker exists to keep the Hono HTTP server responsive while Ink renders the TUI. But in local-only mode (no `--port`, no `--mdns`, no `--hostname`), there is no external HTTP server — all requests go through the in-process `createWorkerFetch()` RPC bridge.

Claude Code proves that a single-process architecture with React/Ink + backend is viable at ~300 MB. The Worker adds a second V8 heap with its own module cache, GC pressure, and memory overhead.

### What to Implement

1. **In-process server mode** — When no external server flags are set, run `Runtime.boot()` and `Server.Default()` directly in the main thread instead of spawning a Worker. The existing `createWorkerFetch()` bridge becomes a direct function call.

2. **Preserve Worker mode for `--port`/`--mdns`** — External server mode continues to use the Worker to avoid Ink render blocking on request handling.

3. **Conditional Worker spawn** — In `thread.ts`, check for external server flags *before* creating the Worker:

   ```typescript
   const external = process.argv.includes("--port") || ...
   
   if (external) {
     // Existing Worker + RPC path
   } else {
     // In-process: boot core directly
     await Runtime.boot({ printLogs: ... })
     const server = Server.Default()
     // ... direct fetch, direct events
   }
   ```

4. **Event source adapter** — In single-process mode, the `EventSource` wires directly to `GlobalBus.on("event", ...)` instead of going through the RPC bridge.

### Dependencies

- **Phase 4** — TUI must not import `@liteai/core` directly (to avoid double-loading when core is in-process).

### Files Affected

| File | Action |
|---|---|
| `packages/cli/src/cli/cmd/tui/thread.ts` | **Major rewrite** — conditional Worker vs in-process |
| `packages/cli/src/cli/cmd/tui/worker.ts` | **Modify** — extract bootable server logic into shared module |
| *(new)* `packages/cli/src/cli/cmd/tui/local-server.ts` | **New** — in-process server adapter |

### Verification

- `liteai` (default, no flags) starts in single-process mode
- `liteai --port 9000` starts in Worker mode
- Memory at idle (single-process) is ≤ 400 MB
- All TUI features work identically in both modes

---

## Phase 6: Eager Import Audit (Polish)

> **Est. savings:** 10–30 MB (minor but removes architectural smell)

### What to Implement

1. **Lazy theme loading** — Replace 33 static `import ... with { type: "json" }` in [`theme.tsx`](../packages/cli/src/tui/context/theme.tsx#L31-L63) with on-demand `Bun.file().json()`. Only load the active theme + `system` at boot.

2. **Lazy highlight.js grammars** — `cli-highlight` loads all language grammars. Either:
   - Switch to `highlight.js/lib/core` + register grammars on demand
   - Or replace with `shiki` (WASM-based, loads grammars lazily)

3. **Dialog lazy registration** — Evaluate whether the 30+ dialog components can be code-split and loaded on first open rather than at TUI boot.

### Files Affected

| File | Action |
|---|---|
| `packages/cli/src/tui/context/theme.tsx` | **Modify** — lazy theme loading |
| `packages/cli/src/tui/components/markdown.tsx` | **Modify** — lazy highlight.js |
| `packages/cli/src/tui/context/dialog.tsx` | **Modify** — evaluate lazy dialog loading |

### Verification

- Theme switching still works (lazy load on switch)
- Markdown rendering still highlights all languages
- Memory delta measurable via heap snapshot

---

## Projected Impact

| Phase | Est. Savings | Cumulative | Risk |
|---|---|---|---|
| Phase 1: Bundle Pipeline | 400–600 MB | ~650 MB | Low — well-understood tooling |
| Phase 2: Lazy Providers | 100–200 MB | ~500 MB | Low — isolated change in `bundled.ts` |
| Phase 3: Lazy Telemetry | 50–80 MB | ~430 MB | Low — gated behind existing flag |
| Phase 4: Core/TUI Decoupling | ~0 (indirect) | ~430 MB | Medium — cross-package refactor |
| Phase 5: Single-Process Mode | 200–300 MB | ~200 MB | Medium — architecture change |
| Phase 6: Eager Import Audit | 10–30 MB | ~180 MB | Low — incremental cleanup |

**Target idle footprint: 180–350 MB** (Claude Code parity or better).

---

## Execution Order

```
1. Phase 1: Bundle Pipeline           ← highest ROI, unblocks measurement
2. Phase 2: Lazy Providers            ← can run in parallel with Phase 1
3. Phase 3: Lazy Telemetry            ← can run in parallel with Phase 1
4. Measure: Heap snapshot after 1+2+3 ← validate savings before architecture work
5. Phase 4: Core/TUI Decoupling       ← prerequisite for Phase 5
6. Phase 5: Single-Process Mode       ← biggest architecture change
7. Phase 6: Eager Import Audit        ← polish pass
8. Final measurement: idle RAM ≤ 350 MB
```

---

## Measurement Protocol

Each phase must be validated with a consistent measurement:

1. Start the CLI: `bun run dist/cli.js` (or `bun dev` for unbundled baseline)
2. Wait 10 seconds (let bootstrap + SSE connection settle)
3. Do NOT interact (no session, no keypress)
4. Record RSS from Task Manager or `process.memoryUsage().rss`
5. Compare against baseline and previous phase

Heap snapshots (via `--inspect` + Chrome DevTools) should be used for Phases 2–3 to verify specific modules are not loaded.
