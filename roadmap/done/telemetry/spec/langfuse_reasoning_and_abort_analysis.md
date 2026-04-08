# Langfuse Reasoning Tokens & Abort Behavior Analysis

## 1. Can Langfuse Render Reasoning Tokens?

### Answer: **Yes, partially — token counts automatically; reasoning text requires specific output format.**

#### Token Counts (✅ Automatic — No Changes Needed)

Langfuse's `OtelIngestionProcessor` ([OtelIngestionProcessor.ts:2313-2382](file:///C:/Users/aghassan/Documents/workspace/langfuse/packages/shared/src/server/otel/OtelIngestionProcessor.ts#L2313-L2382)) already handles reasoning token counts from the AI SDK:

```
Source 1: ai.usage.reasoningTokens → usageDetails["output_reasoning_tokens"]
Source 2: ai.response.providerMetadata → openaiMetadata["reasoningTokens"]
```

The AI SDK emits `ai.usage.reasoningTokens` as an OTel span attribute ([streamText docs](https://github.com/vercel/ai): `usage.reasoningTokens`). These are automatically picked up by Langfuse and displayed in the usage breakdown.

**Status**: Already working — no changes needed on our side.

#### Reasoning Text Content (⚠️ Depends on Output Format)

Langfuse renders reasoning/thinking text via a `ThinkingBlock` UI component ([ThinkingBlock.tsx](file:///C:/Users/aghassan/Documents/workspace/langfuse/web/src/components/trace2/components/IOPreview/components/ThinkingBlock.tsx)). This is shown when the **observation output** contains a ChatML-structured message with a `thinking` array:

```json
{
  "role": "assistant",
  "content": "Final answer text...",
  "thinking": [
    { "type": "thinking", "content": "Step 1: Let me analyze...", "summary": "..." }
  ]
}
```

The detection chain:
1. [chat-message-utils.ts:87-88](file:///C:/Users/aghassan/Documents/workspace/langfuse/web/src/components/trace2/components/IOPreview/components/chat-message-utils.ts#L87-L88): `hasThinkingContent()` checks for `message.thinking` array
2. [ChatMessage.tsx:161-175](file:///C:/Users/aghassan/Documents/workspace/langfuse/web/src/components/trace2/components/IOPreview/components/ChatMessage.tsx#L161-L175): Renders thinking blocks before main content

**However**, the Vercel AI SDK's OTel output for the `ai.streamText.doStream` span stores output as just `ai.response.text` (plain string) — it does **NOT** include reasoning content in the output attribute. The reasoning text is streamed as separate `reasoning` events in the `fullStream` but is not persisted into the OTel span output.

Looking at [OtelIngestionProcessor.ts:1516-1543](file:///C:/Users/aghassan/Documents/workspace/langfuse/packages/shared/src/server/otel/OtelIngestionProcessor.ts#L1516-L1543), the Vercel AI SDK output extraction reads:
- `ai.response.text` → plain text output
- `ai.response.toolCalls` → tool calls
- NO attribute for reasoning text

**Conclusion**: Reasoning **text** from the AI SDK does NOT appear in Langfuse's "Output" preview as a ThinkingBlock. The ThinkingBlock rendering only works for:
- **OpenAI Responses API** (via [openai.ts adapter](file:///C:/Users/aghassan/Documents/workspace/langfuse/packages/shared/src/utils/chatml/adapters/openai.ts#L66-L128): `type: "reasoning"`)
- **Anthropic** (via [pydantic-ai.ts adapter](file:///C:/Users/aghassan/Documents/workspace/langfuse/packages/shared/src/utils/chatml/adapters/pydantic-ai.ts#L25-L78): `type: "thinking"`)
- **Gemini** (via [gemini.ts adapter](file:///C:/Users/aghassan/Documents/workspace/langfuse/packages/shared/src/utils/chatml/adapters/gemini.ts#L71-L85): `thought: true`)

These adapters parse the **raw provider response** format (when it appears as structured JSON in the output field). The AI SDK's OTel integration doesn't include reasoning text in its span attributes.

### What We Could Do (Not Recommended Now)

We could manually add reasoning text to the LiteAI root span's `output.value` attribute, but this would:
- Require buffering reasoning text in the event loop (we already receive `reasoning-delta` events in [processor.ts:40-48](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/session/processor.ts#L40-L48))
- Only affect the root "LiteAI" span, not the per-model generation span
- Not match the ChatML format Langfuse expects for ThinkingBlock rendering

**Recommendation**: This is a known limitation of the AI SDK's OTel integration. Reasoning token **counts** already work. Reasoning **text** rendering would require the AI SDK to add an `ai.response.reasoning` attribute — which is an upstream feature request.

---

## 2. What Happens When You Stop During Reasoning Tokens?

### Answer: **The status IS still sent to Langfuse, but with important caveats.**

#### The Abort Flow

When the user stops the conversation:

1. **AbortSignal fires** → The `AbortController` in [loop.ts:165](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/session/engine/loop.ts#L165) signals abort
2. **Stream terminates** → The `streamText` call catches the `AbortError` in [llm.ts:189](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/session/llm.ts#L189)
3. **Processor catches it** → [processor.ts:116-123](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/session/processor.ts#L116-L123) emits a `stream.error` event with `isAbortError: true`
4. **Loop catches it** → [loop.ts:573-574](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/session/engine/loop.ts#L573-L574): `"runSession: caught AbortError in event loop"`
5. **Root span ends** → [loop.ts:345](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/session/engine/loop.ts#L345): `sessionSpan.end()` is always called in the `finally` block

#### What Langfuse Receives

| Component | On Abort | Notes |
|---|---|---|
| **Root "LiteAI" span** | ✅ Always sent | `finally` block ensures `sessionSpan.end()` runs |
| **AI SDK `ai.streamText` span** | ⚠️ Likely incomplete | The AI SDK's internal OTel span may end with an error status. Attributes like `ai.response.text`, `ai.usage.*`, `ai.response.finishReason` may be **missing or empty** since the stream was interrupted |
| **`ai.streamText.doStream` (GENERATION)** | ⚠️ Partial | Same as above — model-level info may be incomplete |
| **Tool call spans** | ❌ Not emitted | If abort happens during reasoning (before tool calls), no tool spans exist |
| **Reasoning tokens/text** | ❌ Lost | Since reasoning is streamed incrementally, an abort during reasoning means no `ai.usage.reasoningTokens` attribute is set — the AI SDK sets usage only at stream completion |

#### The Key Risk: Span Flush

The `LangfuseSpanProcessor` ([instrumentation.ts:182-193](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/telemetry/instrumentation.ts#L182-L193)) uses `flushAt: 10` and `flushInterval: 5s`. When abort fires:

1. The `sessionSpan.end()` triggers the span processor's `onEnd()` callback
2. The AI SDK's internal spans are also ended (with error/incomplete status)
3. The `LangfuseSpanProcessor` buffers these spans and flushes them at the next flush interval

**But**: If the process exits quickly after abort (e.g., CLI mode), spans may be lost! The `shutdownTelemetry()` function ([instrumentation.ts:212-233](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/telemetry/instrumentation.ts#L212-L233)) calls `globalNodeSdk.shutdown()` which triggers a final flush. This is called from the `beforeExit` handler.

**In the web server mode**, this isn't an issue — the process stays alive and the flush interval handles it. In **CLI mode**, ensure `shutdownTelemetry()` is called in the exit path.

#### Summary of Abort Behavior

```
User stops during reasoning tokens:
  ├─ Root "LiteAI" span: ✅ Sent (always, via finally block)
  ├─ ai.streamText span: ⚠️ Sent, but may lack output/usage attributes
  ├─ ai.streamText.doStream: ⚠️ Sent, but likely incomplete
  ├─ finishReason: ❌ Missing (or "error")
  ├─ usage.reasoningTokens: ❌ Missing (not set until stream completes)
  ├─ output text: ❌ Partial or empty
  └─ Graph visualization: ⚠️ Node appears but with incomplete data
```

### Potential Improvement

If you want to ensure the abort is clearly visible in Langfuse:

1. **Set status**: Add `sessionSpan.setStatus({ code: SpanStatusCode.OK })` for normal completion and `SpanStatusCode.ERROR` for abort in the root span
2. **Add abort attribute**: Set `sessionSpan.setAttribute("session.aborted", true)` in the catch block so it's filterable in Langfuse

These are minor quality-of-life improvements, not critical.
