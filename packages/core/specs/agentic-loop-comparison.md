# Agentic ReAct Loop Comparison: LiteAI vs LiteAI2

This document compares the main agentic loop (ReAct loop) implementations between the current **LiteAI** (`packages/core/src/session`) architecture and the **LiteAI2** (`liteai2/src/query.ts`) architecture.

## Overview

The agentic loop represents the core orchestration mechanism that decides how the model runs, interprets tools, processes context limits, and sequences successive inference steps. 

- **LiteAI Core** separates its loop into a stateful turn-orchestrator (`engine/loop.ts`) and a specialized stream-event processor (`processor.ts`) tightly coupled to SQLite representations.
- **LiteAI2** implements its loop as a deeply modular async generator (`queryLoop` inside `query.ts`) that yields generic stream events to external consumers, leaning heavily on pipelined context mutation functions rather than direct database updates.

---

## 1. Loop Orchestration & Execution

### LiteAI Core
- **Outer Loop (`loop.ts`)**: Iterates based on identifying the most recent "user" intention or pending subtasks (`subtask`, `compaction`). Driven by sequential Promises and state tracked dynamically in memory per `sessionID`.
- **Inner Loop (`processor.ts`)**: 
  - Iterates over chunks from `LLM.stream()`.
  - Performs direct I/O to a SQLite database on practically every delta (e.g., `Session.updatePartDelta`).
  - Hardcodes a **doom loop detector** (breaks if 3 identical tool calls occur) asking for explicitly granted `DOOM_LOOP` permission.
  - Vercel AI SDK abstractions manage actual tool running, pushing `tool-result` back to the loop. 
- **Return Type**: Yields final Message object but operates through `Bus.publish` and DB observations to power real-time UX.

### LiteAI2 
- **Async Generator**: The `queryLoop` is an `async function*` yielding explicitly defined events (`StreamEvent`, `RequestStartEvent`, `Message`, `TombstoneMessage`).
- **Feature-driven Execution**: Large chunks of logic are decoupled and dynamically loaded using `feature('FLAG_NAME')` checks (e.g. `HISTORY_SNIP`, `REACTIVE_COMPACT`, `CONTEXT_COLLAPSE`). Ensures strict tree-shaking for experimental features.
- **Tool Orchestration**:
  - Contains a `StreamingToolExecutor` that actively begins running tools dynamically while the model is still streaming its response, leading to heavily overlapping network bounds.
  - API fallbacks are handled gracefully via "Tombstones" which wipe UI state if a stream silently fails or resets.

---

## 2. Context Management Pipeline

Context overflow and size preservation are treated distinctly in both implementations.

### LiteAI Core
- **Reactive Checking**: Context overflow limits are calculated **after the stream** by tracking token usage via `SessionCompaction.isOverflow()`. 
- **Subtask Injection**: If compaction is forced, it kicks over to a specialized `SessionCompaction.process()` state on the next `loop.ts` iteration.
- **Plan Reminder wrap**: Re-inserts instructions explicitly via `<system-reminder>` inside the context array as text parts before firing the chat completion.

### LiteAI2
Pipelined array mapping functions aggressively prune data **before** every request gets to the model:
1. **`applyToolResultBudget`**: Limits maximum payload size for tools, overwriting parts if too long.
2. **`snipCompact`**: Checks and snips out irrelevant branch histories (e.g., previous turn corrections that are completed).
3. **`microcompact`**: Lossless/Lossy size reduction localized to specific tool contexts constraints.
4. **`contextCollapse`**: Collapses multi-turn context into semantic summaries projecting a specific read-time view over history.
5. **`autocompact`**: Performs global, LLM-driven summarizations if the threshold is still exceeded.

---

## 3. Resilience and Error Recovery

### LiteAI Core
- Uses `SessionRetry.retryable()` mapping in `processor.ts` to implement retry delay sleeps strictly for connectivity regressions or basic provider errors.
- Fails the loop and publishes error events directly to the message queue.

### LiteAI2
- Integrates continuous metric and budget tracking inside the generator (`task_budget.remaining` from Anthropic implementations).
- Handles `max_output_tokens` explicit recovery seamlessly inside the stream by evaluating if `maxOutputTokensRecoveryCount` limits are tripped.
- Can transparently pivot to a **fallback model** mid-loop if a catastrophic stream parsing fault is encountered, emitting `Tombstone` blocks over previously yielded text to delete half-written blocks from the UI context.

---

## Conclusion & Target Architecture Takeaways

**LiteAI2** provides a highly battle-tested, resilient, pure-function focused context pipeline. If merging features back to **LiteAI**, the following paradigm shifts would be highly valuable:

1. **Decouple Database I/O from Stream Events**: `processor.ts` couples streaming directly to SQLite writes. Moving towards an event-sourcing `yield` based loop handles failures and tombstoning much cleaner.
2. **Pre-Processing Context Pipeline**: Abstract the context resizing (auto-compaction) to a segmented pipeline *before* the API call just like LiteAI2 (budgeting -> snip -> microcompact -> collapse). Operations are currently too heavily dependent on the LLM explicitly failing/overflowing to trigger compaction.
3. **Streaming Tool Exection**: Using a streaming tool driver over waiting for unified Vercel SDK resolution decreases round-trip latency overhead for the planner.
