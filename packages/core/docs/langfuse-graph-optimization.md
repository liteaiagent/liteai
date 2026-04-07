# Langfuse Agent Graph Optimization

> Session summary for continuity. Created 2026-04-07.

## Problem Statement

LiteAI traces in Langfuse rendered as flat, fragmented span lists instead of clean
agent execution graphs. The Langfuse "Graph" tab showed either no graph or a messy
timing-based inference rather than the clean `__start__` → `build` → `code` → `__end__`
visualization that LangGraph users see.

## Root Cause

Langfuse's Clickhouse query for agent graph data (`getAgentGraphData`) explicitly reads:
```sql
metadata['langgraph_node']
metadata['langgraph_step']
```
from the observations table. Without these keys, Langfuse falls back to a timing-based
inference (Path A), which produces poor results with the Vercel AI SDK's span structure.

## What Was Done

### 1. Fixed Langfuse Graph Metadata Keys ✅

**Files changed:**
- `packages/core/src/session/llm.ts` — Added `step?: number` to `StreamInput` type and
  injected `langgraph_node` and `langgraph_step` into `experimental_telemetry.metadata`.
- `packages/core/src/session/engine/query.ts` — Passed the `step` counter from the query
  loop into `streamInput` for dynamic step tracking.

**Key design decision:** The metadata keys use **bare names** (`langgraph_node`, NOT
`langfuse.observation.metadata.langgraph_node`). This is because:

1. The AI SDK wraps metadata as `ai.telemetry.metadata.<key>`
2. Langfuse's `extractMetadata()` strips the `ai.telemetry.metadata.` prefix
3. Final stored key is just `<key>`
4. Clickhouse query reads `metadata['langgraph_node']` — needs bare key to match

The old prefixed approach (`langfuse.observation.metadata.langgraph_step`) was confirmed
broken via the user's Langfuse UI screenshots showing the full prefix persisted as-is.

### 2. Added Tests ✅

**File:** `test/session/llm-telemetry.test.ts` — 2 tests verifying:
- Bare keys are used (no `langfuse.observation.metadata.` prefix)
- `step` defaults to 1 when not provided

All tests pass (2 new + 10 existing in `llm.test.ts`).

### 3. Analyzed Reasoning Token Support ✅

**Finding:** Reasoning token **counts** already work automatically via the AI SDK's
`ai.usage.reasoningTokens` OTel attribute → Langfuse maps to `output_reasoning_tokens`.

**Finding:** Reasoning **text** is NOT included in AI SDK OTel spans. The AI SDK only sets
`ai.response.text` (final answer). Langfuse's `ThinkingBlock` UI only renders when the
output contains a structured `thinking` array (OpenAI Responses API, Anthropic, Gemini
native format) — not from the AI SDK's generic OTel output.

### 4. Analyzed Abort Behavior ✅

**Finding:** When the user stops mid-conversation:
- Root "LiteAI" span: ✅ Always sent (via `finally` block in `loop.ts:345`)
- AI SDK generation spans: ⚠️ Sent but incomplete (missing `ai.response.text`,
  `ai.usage.*`, `finishReason`)
- Reasoning token counts: ❌ Lost (AI SDK sets usage only at stream completion)
- Graph node: ⚠️ Appears but with incomplete data

The `LangfuseSpanProcessor` flush mechanism works correctly for the web server (process
stays alive). CLI mode depends on `shutdownTelemetry()` being called.

## What's Next

### Priority 1: Patch AI SDK for Reasoning Text in OTel Spans

**Goal:** Add an `ai.response.reasoningText` attribute to the AI SDK's OTel span so
Langfuse can display reasoning content.

**Approach:** Create a patch file (like the existing
`patches/@openrouter%2Fai-sdk-provider@1.5.4.patch`) targeting the `ai` package's
`streamText` telemetry recording code.

**Where to look in the AI SDK source (`C:\Users\aghassan\Documents\workspace\ai`):**
- `packages/ai/src/generate-text/stream-text.ts` — Main streamText function
- `packages/ai/src/telemetry/` — Telemetry integration system
- Search for where `ai.response.text` is set as a span attribute — that's where we'd add
  `ai.response.reasoningText` alongside it
- The AI SDK accumulates reasoning text via `reasoning` stream parts; we need to capture
  that accumulated text and set it as an attribute on span end

**Important:** First determine the installed `ai` package version (check `bun.lock` or
the resolved version in `node_modules`). The AI SDK source at
`C:\Users\aghassan\Documents\workspace\ai` is the latest code — diffs may be needed if
patching an older installed version.

**Alternative:** Instead of patching, consider upgrading to the latest AI SDK version if
it's close to what's installed, and submit a PR upstream to add the attribute natively.

### Priority 2: Improve Abort Span Quality (Optional)

Add explicit status and metadata to the root span on abort:
```typescript
// In loop.ts catch block for AbortError:
sessionSpan.setStatus({ code: SpanStatusCode.ERROR, message: "User cancelled" })
sessionSpan.setAttribute("session.aborted", true)
```

This makes aborted sessions easily filterable in Langfuse.

### Priority 3: Verify Graph Rendering (Requires Deploy)

Deploy the metadata changes and check the Langfuse UI:
- Graph tab should show clean nodes (`__start__` → agent name → `__end__`)
- Each query loop step should appear as a separate step in the graph

## Key Files Reference

| File | Purpose |
|------|---------|
| `src/session/llm.ts:227-251` | Telemetry metadata (langgraph_node, langgraph_step) |
| `src/session/engine/query.ts:319-325` | Step counter passed to LLM stream |
| `src/session/engine/loop.ts:304-349` | Root span management + abort handling |
| `src/telemetry/instrumentation.ts` | LangfuseSpanProcessor + flush/shutdown |
| `test/session/llm-telemetry.test.ts` | Tests for metadata key format |

## Langfuse Source Reference

The Langfuse source is available at `C:\Users\aghassan\Documents\workspace\langfuse`.
Key files for graph rendering:

| File | Purpose |
|------|---------|
| `web/src/features/trace-graph-view/types.ts` | `LANGGRAPH_NODE_TAG`, `LANGGRAPH_STEP_TAG` |
| `web/src/features/trace-graph-view/buildStepData.ts` | Step assignment logic |
| `packages/shared/src/server/otel/OtelIngestionProcessor.ts:2313-2382` | Reasoning token extraction from OTel |
| `packages/shared/src/server/otel/OtelIngestionProcessor.ts:1506-1545` | AI SDK output extraction (no reasoning text) |

## AI SDK Patch Reference

Existing patches live in `patches/` at the monorepo root. The patch format is
`@scope%2Fname@version.patch` with standard unified diff format against `dist/` files.
The `@openrouter%2Fai-sdk-provider@1.5.4.patch` is a good template.
