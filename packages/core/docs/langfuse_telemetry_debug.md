# Telemetry and Langfuse Observability Debugging Summary

## The Problem
When running the LiteAI agent using Vercel AI SDK and Langfuse's OpenTelemetry pipeline, the traces inside Langfuse were appearing inconsistently. The typical signature of the failure was:
- The UI displaying a single trace titled **"Unnamed trace"**.
- `null` appearing in the Input / Output fields.
- Child AI model generations (`LiteAI:ai.streamText`) appending themselves as orphans under this Unnamed trace with no identifiable parent or agent context.

When trying to strip the custom `@opentelemetry/api` wrapper entirely, the system correctly dropped the shared context but then fragmented the session into multiple completely isolated traces per tool call (e.g. 1 session becoming 3 unassociated traces).

## Root Causes & Fixes

### 1. Langfuse Spam Filtering on Custom Root Spans
**Cause:** The custom agent wrapper (`tracer.startActiveSpan("LiteAI")` in `loop.ts`) was functionally correct and properly passing OpenTelemetry `TraceId` context down natively to the Vercel AI inner calls. However, as `@langfuse/otel` ingests spans, it applies an internal spam-filter specifically looking for LLM attributes (`gen_ai.*`). Because our Root Span acts as a logical workflow container (and not an LLM invocation), Langfuse incorrectly categorized it as non-essential "noise" and silently dropped it while keeping all of its children.
**Fix:** We explicitly bound the `langfuse.internal.as_root: true` attribute to the root span configuration in `loop.ts`. This serves as an official workaround/override for Langfuse, forcing the processor to retain the custom wrapper as the explicit True Root of the Trace.

### 2. Nullish Coalescing vs Logical OR (Empty Strings)
**Cause:** In `loop.ts`, the root trace name and the `input.value` attribute were configured using a nullish coalescing operator (`firstUserText ?? "liteai.session"`). If a user message lacked native markdown text content, `firstUserText` evaluated to a literal blank string `""`. Because `""` is falsy but not null/undefined, the operator evaluated to `""`. Langfuse then correctly ingested the span but could not display a blank trace name, defaulting the UI text back to "Unnamed trace" and an empty input.
**Fix:** Switched `??` to a standard logical OR (`|| "No user input"`). Now, if `firstUserText` is empty, it securely defaults to a readable string format to ensure Langfuse UI rendering integrity.

### 3. Premature CLI Process Exits Bypassing Telemetry Flush
**Cause:** When the AI successfully finished completing its task and running its tool calls via the CLI, the orchestrator finished synchronously, and `packages/cli/src/index.ts` aggressively killed the OS process using `process.exit()`. This hard-exit skips Node's standard `beforeExit` event loops.
Because the inner LLM executions (`ai.streamText`) ran for 15+ seconds, Langfuse's background 5000ms `flushInterval` had plenty of time to natively sync those spans. However, the overarching Root Span completes exactly one millisecond before `process.exit()` is executed, entirely depriving the OpenTelemetry exporter of the time required to flush the Root Span's `span.end()` payload across the network.
**Fix:** Injected a dynamic, synchronous invocation of `await shutdownTelemetry()` directly into the terminal `finally { ... }` block inside `packages/cli/src/index.ts`. This forces a blocking telemetry batch export, guaranteeing that the `LiteAI` root span has fully landed in the Langfuse backend before the CLI drops the execution process.

## Bonus: Raw HTTP Payload Logging
For deep framework debugging or when developing standalone providers (such as the custom Google Code Assist implementation), the raw HTTP Request/Response cycle generated internally by Vercel AI SDK is intercepted and logged within `packages/core/src/provider/sdk.ts`.
By supplying a heavily wrapped, custom `fetch` interceptor during AI instantiation, all outbound API requests, headers, and token payloads are tracked by a specialized `Log.create({ service: "http" })` instance. These logs can be reviewed locally in `.gemini/liteai/logs/` or exposed directly to stdout by running the LiteAI CLI with the `--print-logs` argument.
