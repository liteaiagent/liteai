# Telemetry Logging Analysis: Gemini CLI & LiteAI2

As requested, I have analyzed the exact event logging strategies used by `gemini-cli` and `liteai2` to understand what they log, when, and how they handle huge conversational states. You are absolutely right that our problem isn't just about truncation syntax—it's about fundamentally logging the wrong shapes of data at the wrong times.

## 1. How Gemini CLI Logs (`packages/core/src/telemetry`)

**What and How they log:**
- **API Requests (`api_request`)**: The primary log body is a simple string: `"API request to ${model}."` They do *not* dump the message array into the body.
  - If (and only if) the config `telemetry_log_user_prompts_enabled` is true, they serialize the conversation history into a semantic configuration attribute `gen_ai.input.messages`. They use a budget-allocator script (`semantic.ts`) that deeply truncates properties inside the array before stringifying it, ensuring it stays valid JSON and under a strict 160KB limit.
- **API Responses (`api_response`)**: They log token counts (`input_tokens`, `cache_read_tokens`), cost, and duration.
- **Context Breakdown**: Instead of sending the full JSON prompt so the server can see what's big, they run a local `estimateContextBreakdown()` algorithm that counts tokens for: `system_instructions`, `tool_definitions`, `history`, and `tool_calls`. They send this statistical breakdown instead of the raw data.
- **Tool Calls (`tool_call`)**: They log `function_name` and the `function_args`. **Crucially, they do NOT log the raw tool output**! They only log `content_length` and structural metadata (e.g. `added_lines`, `removed_lines` from file diffs) to save space.

**Deduplication:**
- They actively check `hasToolCalls`. If the model is in a rapid tool-use loop, they *skip* calculating and sending the context breakdown for those intermediate steps to "avoid emitting redundant cumulative snapshots."

---

## 2. How LiteAI2 Logs (`src/utils/telemetry`)

**What and How they log:**
- **Standard Events (`logOTelEvent`)**: They emit structured events like `api_request` and `api_error`. The log bodies are strictly strings (e.g. `claude_code.api_request`). They only send token usages, durations, and costs. **They never log the raw `messages` array in their standard OTel event pipeline.** 
- **Tracing Spans (`startLLMRequestSpan`)**: For deep debugging (if BETA tracing is enabled), they generate OpenTelemetry Spans. 
  - The spans capture `modelOutput` (text) and `thinkingOutput`.
  - For tool executions, they capture `toolInput` and `toolResult`, but these are passed through a `truncateContent` filter before being attached as attributes. 

**Privacy & Security:** 
- A helper `redactIfDisabled` strips text down to `<REDACTED>` unless explicit `OTEL_LOG_USER_PROMPTS` rules are enabled.

---

## 3. What We Are Currently Doing Wrong in LiteAI

Comparing those systems to our `liteai` implementation exposes exactly why your dashboard looks like a wall of massive JSON blocks with warning triangles:

1. **Logging JSON as the Message Body**: Our `logLLMMessages` is blindly calling `JSON.stringify(messages)` and setting it as the `body` of the log. 
2. **Zero Deduplication (The Spam Problem)**: Our orchestrator's `queryLoop` calls `logLLMMessages` on *every single turn*. Because `messages` inherently contains the entire history, if it takes 15 tool steps to accomplish a task, we are sending the full 15-step history payload 15 separate times.
3. **No Granular Opt-Ins**: We don't respect a toggle like `telemetry_log_user_prompts_enabled`, meaning we blast maximum data implicitly.

## Proposed Strategy Shift

To fix this properly, we should move away from the "JSON truncation" band-aid and adopt the proven patterns:

1. **Purge the Raw Message Body logging**: We should remove `logLLMMessages(messages)`. The `body` of our telemetry events should just be short descriptions (e.g. `"LLM Request"`, `"API Success"`).
2. **Log Statistics, Not Payloads (By Default)**: Emit token usages, cache hits, execution duration, and tool call names/success states natively.
3. **Attribute-Based Context**: If we *do* need to log the messages for the "LiteAI Chat Trace" dashboard, they must be formatted intelligently:
   - Only log the *deltas* per turn (e.g. the specific assistant output and tool result for that single step), OR
   - Attach the full stringified (and cleanly truncated) array natively to the Tracing Span attributes (`llm_request.messages`), not the log event stream, replicating the `sessionTracing.ts` behavior from LiteAI2.

What do you think of this analysis? Should we begin refactoring `telemetry/events.ts` and `tracing.ts` to implement this structural change?
