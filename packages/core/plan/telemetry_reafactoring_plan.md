# Trace Subsystem Refactor: OTel + Perfetto Native Architecture

## Background & Motivation

The current liteai trace system is a custom SQLite append-log (`TraceTable`) that is tightly coupled to the session/message layer. After studying the liteai2 codebase (`src/utils/telemetry/`), it's clear that their architecture is significantly more mature — using **OpenTelemetry (OTel) as the native tracing backbone** and **Perfetto for local performance profiling**. We should adopt this architecture rather than evolving our custom SQLite trace in isolation.

### What liteai2 Does (Brief Summary)

| Layer | Implementation | Purpose |
|---|---|---|
| **OTel Metrics** | `@opentelemetry/sdk-metrics` + `MeterProvider` | Usage counters, cost tracking, token metrics |
| **OTel Logs** | `@opentelemetry/sdk-logs` + `LoggerProvider` | Structured event logs (system prompts, tool schemas — logged once per unique hash) |
| **OTel Traces** | `@opentelemetry/sdk-trace-base` + `BasicTracerProvider` | Span-based tracing: `interaction → llm_request → tool → tool.blocked_on_user → tool.execution → hook` |
| **Perfetto** | Chrome Trace Event format → `~/.claude/traces/trace-<session>.json` | Local deep performance profiling (TTFT, TTLT, ITPS, OTPS, cache hit rate) viewable in `ui.perfetto.dev` |
| **Exporters** | OTLP (gRPC, HTTP/JSON, HTTP/Protobuf), Prometheus, Console, BigQuery | Pluggable via `OTEL_*` env vars |

### Key Architectural Decisions in liteai2

1. **Span hierarchy via `AsyncLocalStorage`** — `interactionContext` and `toolContext` use ALS to maintain parent-child span relationships without passing IDs through the call stack.
2. **Content deduplication** — System prompts and tool schemas are hashed; full content is logged once per unique hash via OTel Log events (not spans).
3. **Dual tracing** — OTel spans and Perfetto spans are emitted **in parallel** at each call site (`startToolSpan()` calls both `startToolPerfettoSpan()` and the OTel tracer).
4. **No coupling to message history** — Traces don't store message IDs. The span tree is self-contained.
5. **Graceful lifecycle** — `registerCleanup()` + `beforeExit`/`exit` handlers ensure flush even on crash.

---

## Reference Files

### liteai2 — Reference Implementation (read-only, port from here)

| File | Purpose |
|---|---|
| `c:\Users\aghassan\Documents\workspace\liteai2\src\utils\telemetry\instrumentation.ts` | OTel bootstrap: MeterProvider, TracerProvider, LoggerProvider, exporter selection, Perfetto init, shutdown lifecycle (~826 lines) |
| `c:\Users\aghassan\Documents\workspace\liteai2\src\utils\telemetry\sessionTracing.ts` | High-level span API: `startInteractionSpan`, `startLLMRequestSpan`, `startToolSpan`, `endToolSpan`, etc. Uses `AsyncLocalStorage` + `WeakRef` span registry (~928 lines) |
| `c:\Users\aghassan\Documents\workspace\liteai2\src\utils\telemetry\perfettoTracing.ts` | Chrome Trace Event format output: TTFT/TTLT/ITPS/OTPS metrics, bounded event buffer, periodic write (~1121 lines) |
| `c:\Users\aghassan\Documents\workspace\liteai2\src\utils\telemetry\betaSessionTracing.ts` | Content dedup: hash-based system prompt + tool schema tracking, `new_context` delta computation, truncation (~492 lines) |
| `c:\Users\aghassan\Documents\workspace\liteai2\src\utils\telemetry\events.ts` | OTel Log event emitter: `logOTelEvent()`, monotonic sequence counter (~76 lines) |
| `c:\Users\aghassan\Documents\workspace\liteai2\src\utils\telemetry\bigqueryExporter.ts` | Custom BigQuery metrics exporter (reference only, may not be needed) |
| `c:\Users\aghassan\Documents\workspace\liteai2\src\utils\telemetry\pluginTelemetry.ts` | Plugin-specific telemetry hooks |
| `c:\Users\aghassan\Documents\workspace\liteai2\src\utils\telemetryAttributes.ts` | Shared telemetry attribute builder |
| `c:\Users\aghassan\Documents\workspace\liteai2\src\services\api\claude.ts` | Call site: `startLLMRequestSpan`/`endLLMRequestSpan` usage in LLM call layer |
| `c:\Users\aghassan\Documents\workspace\liteai2\src\services\tools\toolExecution.ts` | Call site: `startToolSpan`/`endToolSpan` usage in tool execution |
| `c:\Users\aghassan\Documents\workspace\liteai2\src\utils\hooks.ts` | Call site: hook span integration |

### liteai — Files to Modify

| File | Change |
|---|---|
| `c:\Users\aghassan\Documents\workspace\liteai\packages\core\src\session\engine\loop.ts` | Replace `Trace.record()` (L517-537) + tool result re-query (L491-514) with OTel spans |
| `c:\Users\aghassan\Documents\workspace\liteai\packages\core\src\session\processor.ts` | Emit `startToolSpan`/`endToolSpan` inline during stream processing |
| `c:\Users\aghassan\Documents\workspace\liteai\packages\core\src\hook\hook.ts` | Replace `Trace.addHooks()` (L216-224) with hook span emission |
| `c:\Users\aghassan\Documents\workspace\liteai\packages\core\src\session\llm.ts` | Remove inline `experimental_telemetry` (L250-256), use centralized config |
| `c:\Users\aghassan\Documents\workspace\liteai\packages\core\src\agent\agent.ts` | Remove inline `experimental_telemetry` (L238-243), use centralized config |
| `c:\Users\aghassan\Documents\workspace\liteai\packages\core\src\main.ts` | Add `initializeTelemetry()` at bootstrap, `shutdownTelemetry()` at cleanup |
| `c:\Users\aghassan\Documents\workspace\liteai\packages\core\src\trace\trace.ts` | Deprecate: stop writing, keep read-only for backward compat |
| `c:\Users\aghassan\Documents\workspace\liteai\packages\core\src\trace\trace.sql.ts` | Deprecate: stop writing new rows |
| `c:\Users\aghassan\Documents\workspace\liteai\packages\core\src\trace\schema.ts` | Deprecate alongside trace.ts |
| `c:\Users\aghassan\Documents\workspace\liteai\packages\core\src\server\routes\trace.ts` | Keep for now (reads from old TraceTable), eventually migrate to OTel source |
| `c:\Users\aghassan\Documents\workspace\liteai\packages\core\src\config\schema.ts` | `experimental.openTelemetry` flag (L654-657) — deprecate in favor of env vars |

### liteai — New Files to Create

| File | Purpose |
|---|---|
| `c:\Users\aghassan\Documents\workspace\liteai\packages\core\src\telemetry\instrumentation.ts` | OTel bootstrap (port from liteai2) |
| `c:\Users\aghassan\Documents\workspace\liteai\packages\core\src\telemetry\tracing.ts` | High-level span API (port from liteai2) |
| `c:\Users\aghassan\Documents\workspace\liteai\packages\core\src\telemetry\perfetto.ts` | Perfetto Chrome Trace output (port from liteai2) |
| `c:\Users\aghassan\Documents\workspace\liteai\packages\core\src\telemetry\events.ts` | OTel Log events (port from liteai2) |

---

## Proposed Architecture for LiteAI

### Design Philosophy

**Replace the custom `TraceTable`-based system with a proper OTel-native tracing layer**, while keeping the existing SQLite trace for backward-compatible read-only access during migration.

### Layer Diagram

```
┌─────────────────────────────────────────────────────────┐
│                    liteai Application                    │
│                                                         │
│  loop.ts           processor.ts          hook.ts        │
│     │                   │                   │           │
│     │  startInteraction │  startLLMRequest  │           │
│     ▼                   ▼                   ▼           │
│  ┌──────────────────────────────────────────────────┐   │
│  │           src/telemetry/tracing.ts                │   │
│  │  (High-level API: startInteractionSpan, etc.)    │   │
│  │  Uses AsyncLocalStorage for span context          │   │
│  └────────────┬──────────────────┬──────────────────┘   │
│               │                  │                       │
│    ┌──────────▼──────┐  ┌───────▼────────┐              │
│    │   OTel Spans    │  │  Perfetto      │              │
│    │ @opentelemetry/ │  │  Chrome Trace  │              │
│    │ sdk-trace-base  │  │  Events JSON   │              │
│    └────────┬────────┘  └───────┬────────┘              │
│             │                   │                        │
│    ┌────────▼────────┐  ┌──────▼──────────┐             │
│    │   Exporters     │  │   File Output   │             │
│    │ OTLP/Console/   │  │ ~/.liteai/      │             │
│    │ Custom          │  │ traces/*.json   │             │
│    └─────────────────┘  └─────────────────┘             │
│                                                         │
│  ┌──────────────────────────────────────────────────┐   │
│  │        src/telemetry/events.ts                    │   │
│  │  OTel Log events (system prompts, tool schemas)  │   │
│  │  Hash-based dedup — emit full content once/hash  │   │
│  └──────────────────────────────────────────────────┘   │
│                                                         │
│  ┌──────────────────────────────────────────────────┐   │
│  │     src/telemetry/instrumentation.ts              │   │
│  │  Bootstrap: MeterProvider, TracerProvider,        │   │
│  │  LoggerProvider, Perfetto init, exporter config   │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

---

## Proposed Changes

### Phase 1: New Telemetry Foundation (COMPLETED)

#### [NEW] `src/telemetry/instrumentation.ts`
Bootstrap OTel providers. Adapted from liteai2 but simplified for our server architecture (no CLI/TUI concerns):

- `initializeTelemetry()` — creates `MeterProvider`, `TracerProvider`, `LoggerProvider` based on env vars
- Exporter selection via `OTEL_*` env vars (OTLP, Console)
- Dynamic lazy-import of protocol-specific exporters to avoid startup cost
- `shutdownTelemetry()` — graceful flush with timeout
- `initializePerfettoTracing()` — optional, enabled via `LITEAI_PERFETTO_TRACE=1`

Key env vars:
```
LITEAI_ENABLE_TELEMETRY=1          # Master switch
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_EXPORTER_OTLP_ENDPOINT=...
OTEL_METRICS_EXPORTER=otlp
OTEL_LOGS_EXPORTER=otlp
OTEL_TRACES_EXPORTER=otlp
LITEAI_PERFETTO_TRACE=1            # Optional local profiling
```

#### [NEW] `src/telemetry/tracing.ts`
High-level span API (ported from liteai2's `sessionTracing.ts`):

```ts
export function startInteractionSpan(userPrompt: string): Span
export function endInteractionSpan(): void
export function startLLMRequestSpan(model: string, context?: LLMRequestNewContext): Span
export function endLLMRequestSpan(span?: Span, metadata?: LLMResponseMetadata): void
export function startToolSpan(toolName: string, input?: string): Span
export function endToolSpan(toolResult?: string, resultTokens?: number): void
export function startHookSpan(hookEvent: string): Span
export function endHookSpan(span: Span, result?: HookResult): void
```

- Uses `AsyncLocalStorage<SpanContext>` for `interactionContext` and `toolContext`
- Automatically parents tool spans under interaction spans
- `WeakRef`-based span registry with TTL cleanup (30 min, matching liteai2)
- Perfetto spans emitted in parallel at each call site

#### [NEW] `src/telemetry/perfetto.ts`
Chrome Trace Event format output (ported from liteai2's `perfettoTracing.ts`):

- `startLLMRequestPerfettoSpan()` / `endLLMRequestPerfettoSpan()` with derived metrics (TTFT, TTLT, ITPS, OTPS, cache hit rate)
- `startToolPerfettoSpan()` / `endToolPerfettoSpan()`
- `startInteractionPerfettoSpan()` / `endInteractionPerfettoSpan()`
- File output to `~/.liteai/traces/trace-<session>.json`
- Bounded event buffer (100K events, half-eviction)
- Periodic write option via `LITEAI_PERFETTO_WRITE_INTERVAL_S`

#### [NEW] `src/telemetry/events.ts`
OTel Log-based events (ported from liteai2's `events.ts` + `betaSessionTracing.ts`):

```ts
export function logOTelEvent(eventName: string, metadata: Record<string, string>): void
```

- Hash-based content deduplication for system prompts and tool schemas
- Content logged once per unique hash per session
- Truncation to 60KB (Honeycomb-safe)

---

### Phase 2: Integration Points (COMPLETED)

#### [MODIFY] [loop.ts](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/session/engine/loop.ts)

The main loop becomes the primary integration point:

```ts
import { startInteractionSpan, endInteractionSpan, startLLMRequestSpan, endLLMRequestSpan } from '@/telemetry/tracing'

// At interaction start:
const interactionSpan = startInteractionSpan(userText)

// Before LLM call:
const llmSpan = startLLMRequestSpan(model.id, {
  systemPrompt: resolvedSystem.join('\n\n'),
  querySource: agent.name,
  tools: JSON.stringify(toolSchemas),
})

// After LLM call:
endLLMRequestSpan(llmSpan, {
  inputTokens: usage.tokens.input,
  outputTokens: usage.tokens.output,
  cacheReadTokens: usage.tokens.cache.read,
  cacheCreationTokens: usage.tokens.cache.write,
  success: !processor.message.error,
  ttftMs: timeToFirstToken,
})

// At interaction end:
endInteractionSpan()
```

**Critically**, this replaces the current `Trace.record({...})` call (lines 517-537) and the tool result re-query from DB (lines 491-514).

#### [MODIFY] [processor.ts](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/session/processor.ts)

Emit tool spans inline during stream processing:

```ts
case "tool-call": {
  const toolSpan = startToolSpan(value.toolName, JSON.stringify(value.input))
  // ... existing processing ...
}
case "tool-result": {
  endToolSpan(value.output.output, resultTokens)
  // ... existing processing ...
}
```

#### [MODIFY] [hook.ts](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/hook/hook.ts)

Replace `Trace.addHooks()` side-effect with direct span emission:

```ts
// Remove:
Trace.addHooks(ctx.session_id, invocations.map(...))

// Add:
for (const invocation of invocations) {
  const hookSpan = startHookSpan(invocation.event)
  endHookSpan(hookSpan, { type: invocation.type, context: invocation.context })
}
```

#### [MODIFY] [llm.ts](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/session/llm.ts)

- Remove inline `experimental_telemetry` block
- The `experimental_telemetry` on the Vercel AI SDK `streamText` call gets its config from the new `Telemetry` module
- Accept `traceID` to correlate OTel spans with Vercel AI SDK spans

#### [MODIFY] [agent.ts](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/agent/agent.ts)

- Replace inline `experimental_telemetry` block in `generate()` with centralized config

#### [MODIFY] [main.ts](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/main.ts)

- Call `initializeTelemetry()` during server bootstrap
- Register `shutdownTelemetry()` in cleanup

---

### Phase 3: Deprecate Old Trace System (COMPLETED)

#### [DEPRECATE] `src/trace/trace.ts`

Mark as deprecated. Keep for read-only backward compatibility (existing trace viewer UI). **Do not add new writes.**

Eventually:
- `Trace.record()` — remove all call sites
- `Trace._pendingHooks` / `addHooks()` / `flushHooks()` — remove entirely
- `TraceTable` — keep for historical data, stop writing new rows
- Server routes (`/api/trace`) — can eventually source data from OTel span exporter instead

---

## Dependencies to Add

```json
{
  "@opentelemetry/api": "^1.x",
  "@opentelemetry/api-logs": "^0.x",
  "@opentelemetry/resources": "^1.x",
  "@opentelemetry/sdk-logs": "^0.x",
  "@opentelemetry/sdk-metrics": "^1.x",
  "@opentelemetry/sdk-trace-base": "^1.x",
  "@opentelemetry/semantic-conventions": "^1.x"
}
```

Optional (lazy-loaded based on `OTEL_EXPORTER_OTLP_PROTOCOL`):
```json
{
  "@opentelemetry/exporter-metrics-otlp-proto": "^0.x",
  "@opentelemetry/exporter-trace-otlp-http": "^0.x",
  "@opentelemetry/exporter-logs-otlp-http": "^0.x"
}
```

---

## Migration Strategy

### Parallel Write Phase (CANCELLED)
> *Note: We decided to skip parallel writes to avoid dual overhead and jump directly to cut-over. Old SQLite files act purely as read-only historical archives now.*
1. Add new `src/telemetry/` module
2. Instrument `loop.ts`, `processor.ts`, `hook.ts` to emit OTel spans **alongside** existing `Trace.record()` calls
3. Both systems write simultaneously — OTel for new observability, SQLite for backward compat
4. Validate OTel output using Console exporter

### Cut-Over Phase (COMPLETED)
1. Remove `Trace.record()` calls from `loop.ts`
2. Remove `Trace.addHooks()`/`flushHooks()` from `hook.ts` and `trace.ts`
3. Update `/api/trace` routes to read from OTel (or keep SQLite as read-only archive)
4. Remove `contextIDs` dependency

### Cleanup Phase (COMPLETED)
1. Remove `Trace._pendingHooks` global state
2. Consider removing `TraceTable` writes entirely
3. Deprecate the `experimental.openTelemetry` config flag (now always-on via env vars)

---

## Open Questions (RESOLVED)

> [!IMPORTANT]
> **Q1: Bun compatibility with `@opentelemetry/sdk-*` packages?**  
> liteai runs on Bun, not Node.js. The OTel SDK packages use some Node-specific APIs (`AsyncLocalStorage` from `async_hooks`, `process` events). Bun supports `AsyncLocalStorage` and most `process` events. We need to verify compatibility before committing. Should I run a proof-of-concept first?
> **Resolution:** We utilized node:async_hooks which is fully compatible with Bun. No proof of concept was needed, integration worked out of the box.

> [!IMPORTANT]
> **Q2: Perfetto — developer-only or general availability?**  
> In liteai2, Perfetto is ant-only (stripped from external builds via `feature('PERFETTO_TRACING')`). For liteai, do you want it available to all users or gated behind a dev flag?

> [!WARNING]
> **Q3: Trace viewer UI migration**  
> The existing web/vscode trace viewer reads from `/api/trace` which queries `TraceTable`. Migrating it to read OTel data is a separate piece of work. During the parallel write phase, the old viewer continues working. Should we plan the viewer migration now or defer?

> [!NOTE]
> **Q4: BigQuery / custom exporter needs?**  
> liteai2 has a `BigQueryMetricsExporter` for enterprise customers. Do we need any custom exporters, or is OTLP sufficient for now?

> [!NOTE]
> **Q5: Vercel AI SDK `experimental_telemetry` integration**  
> The Vercel AI SDK already emits OTel spans when `experimental_telemetry.isEnabled = true`. Once we have our own `TracerProvider`, those spans will automatically route through our exporter pipeline. Should we still pass `metadata` (sessionId, agent, etc.) into the SDK telemetry, or let our higher-level spans contain that context?

---

## Verification Plan

### Phase 1 Verification
- Add `OTEL_TRACES_EXPORTER=console` and run a session — verify span output in logs
- Verify span hierarchy: `interaction → llm_request → tool`
- Enable Perfetto, run a session, open `trace-<id>.json` in `ui.perfetto.dev` — verify timeline visualization

### Phase 2 Verification (CANCELLED)
- Run with both old `Trace.record()` and new OTel spans active
- Compare: old SQLite traces vs OTel Console spans for same session
- Verify hook spans appear correctly under tool spans
> *Note: Cancelled because parallel writes were skipped.*

### Phase 3 Verification (COMPLETED)
- Remove old `Trace.record()` calls
- Verify `/api/trace` routes still return data (from archive)
- Confirm no regressions in session flow

### Phase 4: Legacy Code Purge
Completely destroy the legacy footprint.
1. **Database Migration**: Write a SQL migration to `DROP TABLE trace` and `DROP TABLE trace_content`, permanently removing them from user machines to save disk space.
2. **Code Deletion**: Delete `src/trace/` completely.
3. **API Deletion**: Delete `src/server/routes/trace.ts` and remove its registration from the server.
4. **Schema Deletion**: Remove `TraceTable` and `TraceContentTable` constructs from Drizzle schema setups.

---

## Next Steps (Upcoming Phases)

### Phase 5: Validating & Expanding Test Suite
Since legacy `src/trace/` tests were reliant on SQLite trace tracking (which has been sunset), we have entirely removed `test/trace/`. Before we refactor the loop engine, we must adequately test the new telemetry architecture:
1. **Mock End-to-End Traces (`test/telemetry/tracing.test.ts`)**: 
   - Guarantee `AsyncLocalStorage` hierarchy safely tracks parents across asynchronous yields.
   - Validate that `isTelemetryEnabled` controls the output successfully.
2. **Mock Perfetto Outputs (`test/telemetry/perfetto.test.ts`)**:
   - Validate that dummy sessions dump Chrome Trace correctly without failing out or missing timestamps.

### Phase 6: The Agentic (ReAct) Loop Rewrite
Once test coverage is adequately established on the telemetry pipeline, we pivot to structurally overhauling how LiteAI routes state logic (currently heavily recursive via `loop.ts`).
1. **Goal**: Rip out the rigid inner `processSubtask(...)` inside `loop.ts` and restructure it mathematically to resemble the pure event-driven finite-state engine found in `liteai2`.
2. **Context Fragmentation**: The new ReAct loop will drastically improve sub-agent transitions, leveraging OTel explicitly to trace internal thoughts without disjointing them into random UI message ids.
3. **Concurrent Execution**: Enable parallel tool dispatch properly via structured state progression.


