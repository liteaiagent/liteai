# Telemetry Event Logging Refactoring Plan

## Background
Currently, the telemetry system in `liteai` (`packages/core/src/telemetry/events.ts` and `tracing.ts`) logs massive raw conversational arrays (`messages`) using `JSON.stringify` natively in the log stream bodies. Furthermore, standard string slicing abruptly truncates the JSON, leading to repeated `JSONParserErr` issues in Loki dashboards and completely losing the most critical recent messages from the payload.

We will align with the mature telemetry patterns established in `gemini-cli` and `liteai2`:
1. **Reduce spam**: Decouple raw conversational payloads from repetitive iterative events.
2. **Structural tracking**: Use semantic log records or trace attributes for granular metrics (duration, counts).
3. **AST-safe truncation**: Maintain JSON validity when object truncation is required for debugging.

## Architectural Changes

### 1. Purge Spammy Log Dumps
**Reference**: `liteai2` (`src/utils/telemetry/logging.ts`) — strictly logs tokens, cost, and duration in standard OTel `api_request` streams instead of raw request bodies on standard telemetry pipelines.
- **Action**: Remove `logLLMMessages(messages)` completely from `packages/core/src/telemetry/events.ts`.
- **Action**: Update `queryLoop` (in `src/session/engine/query.ts`) to immediately stop emitting `logLLMMessages` per turn. We do not need a massive cumulative JSON buffer blasting out of the orchestrator on every iterative step. 
- We will rely purely on structured `Metrics.llmRequests` counters and proper OTel trace Spans to observe LLM usage.

### 2. Valid Structured Truncation
**Reference**: `gemini-cli` (`src/telemetry/semantic.ts`) — utilizes custom budget allocation algorithms (`limitTotalLength`) *before* applying stringification. This guarantees the emitted output is 100% valid JSON instead of `substring` destroying the JSON tree boundary.
- **Action**: Implement a structural `safeDeepTruncate` function in `tracing.ts`.
- When an object like the `messages` history array is processed:
  - Iteratively traverse the JSON AST to aggressively remove or trim *older* historical string elements while keeping the newer/tail message structures completely intact.
  - Recursively limit string lengths on internal blocks.
  - Return the processed AST for safe `JSON.stringify()`.

### 3. Attribute-Only Deep Inspection
**Reference**: `liteai2` (`sessionTracing.ts`) — outputs generative content/data strings *only* via injected attributes on OTel trace spans (e.g., `modelOutput`, `toolInput`), bypassing standard log bodies entirely.
- **Action**: Refactor `truncateForTelemetry` in `tracing.ts` to utilize the new `safeDeepTruncate` utility.
- Ensure `startLLMRequestSpan` natively injects the validated JSON payload directly into the Span attribute `llm_request.messages`.
- Prevent Loki from misinterpreting pure-text properties by prefixing abruptly sliced pure strings (like system configurations) with `[TRUNCATED_TEXT]`.

### 4. Optimize Tool Interaction Noise
**Reference**: `gemini-cli` (`src/telemetry/types.ts` via `ToolCallEvent`) — actively tracks `content_length` and contextual stats but refuses to dump massive tool output bodies (like huge shell traces) into OTel.
- **Action**: Add dedicated tool tracing structural endpoints in `events.ts` (e.g., `logOTelToolExecution`). Record tool invocations, duration, success flags, and byte lengths exclusively, keeping the log payload lightweight and noise-free.

## Verification
- Verify `JSONParserErr` vanishes entirely in your Grafana deployment as `safeDeepTruncate()` promises syntax-perfect JSON.
- Verify the main conversational log noise is fully eliminated from standard Log views on iterative loop checks.

---

The goals of this refactor are:
1. Purge the repetitive `logLLMMessages` logic to stop spamming the standard log bodies.
2. Implement robust AST-aware JSON truncation in `tracing.ts` (`safeDeepTruncate`) that prevents standard array slicing from destroying JSON syntax, while aggressively prioritizing new messages over older history.
3. Migrate granular payload viewing entirely to OpenTelemetry Span attributes (e.g. `llm_request.messages`), eliminating standard log-stream overlap.
4. Optimize our tool telemetry footprint to emit durations and structural bytes/success metrics natively, instead of massive bodies of raw plugin output payload text.

Please review the implementation plan. You may create task tracking artifacts if you wish, and then jump straight into implementing the changes in `events.ts`, `query.ts`, and `tracing.ts` as specified.
