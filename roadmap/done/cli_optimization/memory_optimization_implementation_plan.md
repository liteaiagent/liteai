# CLI Memory Optimization Execution Plan

This plan details the implementation of Phase 2, Phase 3, and Phase 5 from the `memory-optimization-roadmap.md` to drastically reduce the idle memory footprint of the CLI.

## Proposed Changes

### Phase 2: Lazy Provider Loading
**Goal:** Prevent all 22 AI SDK packages (and their massive transitive dependencies) from loading eagerly at startup.

#### [MODIFY] [bundled.ts](file:///d:/liteai/packages/core/src/provider/loaders/bundled.ts)
- Replace static imports for all providers with dynamic `import()` closures.
- Change `BUNDLED_PROVIDERS` from a record of factory functions to a record of async loader functions: `Record<string, () => Promise<(options: any) => SDK>>`.

#### [MODIFY] [sdk.ts](file:///d:/liteai/packages/core/src/provider/sdk.ts)
- Update `getSDK()` to correctly `await` the execution of the lazy loader from `BUNDLED_PROVIDERS` before invoking the factory.

---

### Phase 3: Lazy Telemetry Initialization
**Goal:** Prevent the heavy `@opentelemetry/sdk-node` stack from parsing and loading into memory unless telemetry is strictly enabled.

#### [MODIFY] [instrumentation.ts](file:///d:/liteai/packages/core/src/telemetry/instrumentation.ts)
- Move all `@opentelemetry/sdk-*`, `@langfuse/otel`, and exporter imports *inside* the `if (telemetryEnabled)` block within `initializeTelemetry()`.
- Convert these imports to dynamic `await import(...)` calls.
- Only lightweight `@opentelemetry/api` imports will remain static at the top of the file for component access.

#### [MODIFY] [factories.ts](file:///d:/liteai/packages/core/src/telemetry/factories.ts)
- Exporters like `ConsoleMetricExporter` and `ConsoleLogRecordExporter` from the SDK packages must also be dynamically imported inside their respective factory functions to ensure they do not eagerly evaluate.

---

### Phase 5: Single-Process Mode (Local) / Worker Teardown
**Goal:** Eliminate the secondary Worker thread (and its duplicate V8 heap) entirely for local CLI usage, running the server in-process alongside the TUI.

#### [MODIFY] [thread.ts](file:///d:/liteai/packages/cli/src/cli/cmd/tui/thread.ts)
- Implement conditional worker spawning:
  - If `--port` or external server flags are present, spawn the worker thread as usual to prevent render blocking.
  - If local-only (default), invoke `Runtime.boot()` and instantiate `Server.Default()` directly in the main thread.
- Bypass the `createWorkerFetch` RPC bridge in local mode, using a direct in-process fetch adapter.

#### [NEW] [local-server.ts](file:///d:/liteai/packages/cli/src/cli/cmd/tui/local-server.ts)
- Create the adapter for in-process server booting and event bus routing to replace the RPC worker bridge logic.

## Verification Plan

### Automated Tests
- Run `bun typecheck` to ensure no async typing regressions in `getSDK()`.
- Run `bun test test/provider` to verify providers still instantiate correctly via dynamic imports.

### Manual Verification
- Start the CLI without interacting and inspect `process.memoryUsage().rss`. It should drop significantly from ~1.2GB closer to the ~300MB target.
- Verify `liteai` boots successfully in single-process mode and basic chat functionality works.

> [!IMPORTANT]
> **User Review Required:** Phase 5 (Single-Process Mode) will boot the core backend directly into the main thread. Since we just decoupled the TUI state, this is much safer now. However, I want to confirm if you want me to tackle all 3 phases in one sequence, or if you prefer me to do Phase 2 and 3 first, measure, and *then* do Phase 5?
