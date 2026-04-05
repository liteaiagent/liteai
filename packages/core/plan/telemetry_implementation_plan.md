# Implementation Execution Plan: Telemetry Subsystem First

As discussed, we will execute the Telemetry subsystem refactor *before* we refactor the agentic loop. This guarantees we have baseline performance metrics (using OTel and Perfetto) to validate the eventual loop architecture changes against. It also ensures the foundational telemetry API is in place when we migrate LiteAI2 loop code later.

This document serves as the absolute source of truth for the new session, containing all required context, goals, and absolute file paths needed to execute without relying on conversational history.

---

## 1. Goal

Port the OpenTelemetry and Perfetto trace infrastructure from `liteai2` into `liteai/packages/core`.
We will replace the existing SQLite `TraceTable`-based system (`Trace.record()`) linearly within the *current* agentic loop implementation (`loop.ts` & `processor.ts`), without structurally altering the agent loop yet.

---

## 2. Dependency Installation

The first action in the new session should be installing the requisite telemetry dependencies into the core package (`c:\Users\aghassan\Documents\workspace\liteai\packages\core`).

```bash
# Core OTel
bun add @opentelemetry/api @opentelemetry/api-logs @opentelemetry/resources @opentelemetry/sdk-logs @opentelemetry/sdk-metrics @opentelemetry/sdk-trace-base @opentelemetry/semantic-conventions

# Optional/Exporters
bun add @opentelemetry/exporter-metrics-otlp-proto @opentelemetry/exporter-trace-otlp-http @opentelemetry/exporter-logs-otlp-http
```

---

## 3. Execution Phases

### Phase 1: Porting Telemetry Foundation (COMPLETED)
Create the new `src/telemetry/` directory and populate it by carefully porting logic from `liteai2`. Adjust paths, strip out UI/CLI specific noise, and ensure Bun compatibilities.

**Source Files (LiteAI2 - READ ONLY):**
- Bootstrap/Init: `C:\Users\aghassan\Documents\workspace\liteai2\src\utils\telemetry\instrumentation.ts`
- Spans & Context: `C:\Users\aghassan\Documents\workspace\liteai2\src\utils\telemetry\sessionTracing.ts`
- Perfetto Tracing: `C:\Users\aghassan\Documents\workspace\liteai2\src\utils\telemetry\perfettoTracing.ts`
- Deduped Events: `C:\Users\aghassan\Documents\workspace\liteai2\src\utils\telemetry\betaSessionTracing.ts` and `C:\Users\aghassan\Documents\workspace\liteai2\src\utils\telemetry\events.ts`
- Example Call Sites: `C:\Users\aghassan\Documents\workspace\liteai2\src\services\api\claude.ts` (LLM Spans), `C:\Users\aghassan\Documents\workspace\liteai2\src\services\tools\toolExecution.ts` (Tool Spans)

**Target Files (LiteAI Core - TO CREATE):**
- `c:\Users\aghassan\Documents\workspace\liteai\packages\core\src\telemetry\instrumentation.ts` (Handles MeterProvider, TracerProvider, LoggerProvider initialization + shutdown)
- `c:\Users\aghassan\Documents\workspace\liteai\packages\core\src\telemetry\tracing.ts` (High-level exported functions like `startInteractionSpan`, `startLLMRequestSpan`, `startToolSpan`, built on top of `AsyncLocalStorage`)
- `c:\Users\aghassan\Documents\workspace\liteai\packages\core\src\telemetry\perfetto.ts` (Chrome Trace event writer buffering/writing logic)
- `c:\Users\aghassan\Documents\workspace\liteai\packages\core\src\telemetry\events.ts` (OTel structured log emitting with prompt/schema hashing deduplication)

### Phase 2: Integrating the Backbone
Wire the new `src/telemetry` system into the application lifecycle and existing orchestration files. The ALC (AsyncLocalStorage) context is extremely important since spans rely on it for parenting.

**Target Files (LiteAI Core - TO MODIFY):**
1. **Server/Extension Bootstrap:** `c:\Users\aghassan\Documents\workspace\liteai\packages\core\src\main.ts` (and possibly entrypoints)
   - *Add:* Call `initializeTelemetry()` on server spin-up and register `shutdownTelemetry()` logic on exit/cleanup.

2. **Main State/Loop Orchestrator:** `c:\Users\aghassan\Documents\workspace\liteai\packages\core\src\session\engine\loop.ts`
   - *Interaction Span:* In `prompt(...)` or at the outer wrapper of `loop(...)`, call `startInteractionSpan(userText)` to cover the entire resolution cycle until a terminal state is met, then call `endInteractionSpan()`.
   - *LLM Request Span:* Around line 467 before `processor.process()`, call `startLLMRequestSpan(...)`. After `processor.process()` finishes, collect metrics (tokens, tool call presence) and invoke `endLLMRequestSpan()`.
   - *Remove Legacy:* Strip the `Trace.record()` loop collection (lines 491-537).
   - *Subtasks:* Inside `processSubtask()` (line ~601), wrap the subagent tool execution in a subtask LLM span and remove its `Trace.record()` (lines 789-800).

3. **Stream Delta Processor:** `c:\Users\aghassan\Documents\workspace\liteai\packages\core\src\session\processor.ts`
   - *Add:* Emit `startToolSpan` on `tool-call` stream chunks and `endToolSpan` on `tool-result` stream chunks.
   - *Caution:* Ensure the `processor` correctly runs within the parent ALC context from `loop.ts` so tools parent correctly to the LLM Request.

4. **Hook Execution:** `c:\Users\aghassan\Documents\workspace\liteai\packages\core\src\hook\hook.ts`
   - *Replace:* `Trace.addHooks(...)` side-effects with ALC-driven `startHookSpan`/`endHookSpan` calls tightly around the hook dispatch.

### Phase 3: Cleanup & Deprecation
Strip the old tracking systems to prevent dual-writing overhead, while keeping the SQLite DB structurally intact for old read traces if explicitly needed.

**Target Files (LiteAI Core - TO MODIFY/DEPRECATE):**
1. **Vercel AI SDK Integration:** `c:\Users\aghassan\Documents\workspace\liteai\packages\core\src\session\llm.ts` & `c:\Users\aghassan\Documents\workspace\liteai\packages\core\src\agent\agent.ts`
   - Look for any local overriding of `experimental_telemetry` and remove them. We will rely on our global TracerProvider to automatically capture Vercel SDK hooks alongside our custom contexts.
2. **Old Trace Module:** `c:\Users\aghassan\Documents\workspace\liteai\packages\core\src\trace\trace.ts`
   - Formally stub/deprecate `Trace.record(...)`. It should no longer write to SQLite.
3. **Schemas/SQL:** `c:\Users\aghassan\Documents\workspace\liteai\packages\core\src\trace\trace.sql.ts` & `schema.ts`
   - Document as deprecated.
4. **Config:** `c:\Users\aghassan\Documents\workspace\liteai\packages\core\src\config\schema.ts`
   - Remove/deprecate explicit `experimental.openTelemetry` schema property; OTel will now be controlled strictly via `LITEAI_ENABLE_TELEMETRY` and standard `OTEL_*` environment variables.

---

## 4. Verification Checkpoints

Before moving the user to the agentic loop rewrite, the new session must demonstrate:
- `tracing.ts` correctly establishes parent-child span hierarchy natively utilizing Bun's `AsyncLocalStorage`.
- Starting an agent flow successfully outputs Perfetto span `.json` files inside `~/.liteai/traces/`.
- Enabling an OTLP Console exporter logs structured hierarchical blocks spanning from interaction -> LLM block -> tool usage -> hook firing.

> **Next Steps for next session**: Read this plan, `npm install` the dependencies, and commence Phase 1 code porting from LiteAI2 to LiteAI core.
