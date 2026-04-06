# Post-Mortem: Agentic Loop Abort Crash & UI Hang

## The Issue

When a user clicked "Stop" while the Code Assist provider was in the "thinking/reasoning" phase, two failures occurred:

1. **Server Crash**: The Node/Bun process crashed with `exit code 1` due to unhandled promise rejections.
2. **UI Hang**: Even when the crash was mitigated, the frontend froze permanently in the "thinking" state.

Both failures are specific to **reasoning/thinking** because that phase holds the stream open for 10–60 seconds with no text output, making an in-flight abort far more likely than during normal text generation.

---

## Root Cause Analysis

### 1. Server Crash — Unhandled Promise Rejections

The Vercel AI SDK's `DefaultStreamTextResult` (returned by `streamText`) exposes several `DelayedPromise` properties: `usage`, `text`, `finishReason`, `warnings`, `steps`. These properties use a **lazy getter** — the underlying `Promise` object is only created on first access.

When abort fires during reasoning:
- The internal stream pipeline closes with no completed step
- The SDK's `eventProcessor.flush()` detects `recordedSteps.length === 0` and calls `_finishReason.reject(new NoOutputGeneratedError(...))` etc. on all three
- If `.catch()` handlers were not attached **before** those rejections fire, Node.js raises `unhandledRejection` and crashes

The fix is to access all exposed promise properties immediately after `LLM.stream()` returns, forcing the lazy getter to create the actual Promise objects and thread `.catch(() => {})` onto them **before** the async reject can fire.

### 2. Residual Error Log — Internal `recordSpan` Floating Promise

Even after Fix 1, a single error log still appears. This comes from **inside the Vercel AI SDK**, not from any exposed property.

In `DefaultStreamTextResult`'s constructor, `recordSpan({ name: "ai.streamText", ... })` is called fire-and-forget with no `.catch()`:

```typescript
// Vercel AI SDK internals (ai/dist/index.mjs ~line 4897)
recordSpan({
  name: "ai.streamText",
  endWhenDone: false,
  fn: async (rootSpanArg) => {
    // ... all async work: doStream, pipeline processing ...
  }
})
// ← returned Promise is dropped — no .catch()
```

When abort fires and the pipeline errors, this floating promise rejects with `NoOutputGeneratedError`. There is no way for user code to catch it — it is an internal SDK promise never surfaced on the result object.

The global `unhandledRejection` handler in `main.ts` converts this from a process crash into a logged warning. The log is expected noise from an upstream SDK limitation.

### 3. UI Hang — Skipped Persister Flush

When the stream terminated on abort, `SessionProcessor.streamGenerator` mapped the error to an event `{ type: "error", kind: "stream" }`. The `queryLoop` forwarded this event outward; `runSession` passed it to the persister, which returned `action: "stop"`, triggering an early `return`.

That early `return` bypassed `persister.flush()`, which is responsible for stamping `assistantMessage.time.completed` in the database. The frontend polls for this field — without it, the UI spun forever in the "thinking" state.

---

## Fixes Applied

### Fix 1: Defuse AI SDK Promises (`src/session/processor.ts`)

Access all lazy promise properties immediately after the stream is created so their `.catch()` handlers are registered before any async rejection can fire:

```typescript
const stream = await LLM.stream({ ...streamInput, onSystem })

// Attach .catch() to all exposed DelayedPromise properties before any
// async abort can reject them. Without this, abort during reasoning
// triggers unhandledRejection and crashes the process.
stream.text?.catch(() => {})
stream.usage?.catch(() => {})
stream.finishReason?.catch(() => {})
stream.warnings?.catch(() => {})
stream.steps?.catch(() => {})
```

### Fix 2: Safe Tear-down via Tombstone (`src/session/engine/query.ts`)

Re-throw stream error events inside `queryLoop` so execution enters the local `catch` block, which yields a `tombstone`. The orchestrator handles `tombstone` by running the full flush path, stamping `time.completed`, and ending the frontend poll:

```typescript
for await (const event of generator) {
  toolExecutor.processEvent(event)

  if (event.type === "error" && event.kind === "stream") {
    throw event.error  // forces entry into catch → tombstone → flush
  }

  yield event
} catch (streamError: unknown) {
  toolExecutor.discard()
  log.error("queryLoop: stream error", { error: streamError, sessionID })
  yield {
    type: "tombstone",
    messageID: assistantMessage.id,
    reason: streamError instanceof Error ? streamError.message : String(streamError),
  } satisfies EngineEvent.TombstoneEvent
}
```

### Fix 3: Global Unhandled Rejection Guard (`src/main.ts`)

Converts any future unhandled rejections from process crashes into logged warnings. Filters expected abort noise so it does not pollute error alerting:

```typescript
process.on("unhandledRejection", (reason, _promise) => {
  const isExpectedAbort =
    (reason instanceof Error && reason.name === "AbortError") ||
    (reason instanceof Error && reason.name === "AI_NoOutputGeneratedError")

  if (isExpectedAbort) {
    log.info("Stream aborted (internal SDK promise)", { reason: reason.message })
    return
  }

  log.error("Unhandled Promise Rejection", {
    reason: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  })
})
```

---

## Why Reasoning Is Special

| Scenario | Abort window | Stream has text before abort? | Outcome |
|---|---|---|---|
| Text generation | < 1s | Usually yes | SDK step completes; no `NoOutputGeneratedError` |
| Thinking phase | 10–60s | No (only `reasoning-delta` parts) | `recordedSteps.length === 0` → `NoOutputGeneratedError` |

The SDK's abort path (`NoOutputGeneratedError`) only triggers when zero steps completed before the abort. Reasoning phases always produce zero completed steps because the model emits no `finish-step` event until *after* thinking concludes and the actual response begins.

---

## Remaining Limitation

`ai.usage.reasoningTokens` is set correctly in the Vercel AI SDK OTel span attributes (verified at `ai/dist/index.mjs` lines 4824, 7718, 7737) — the SDK does emit this field. However, if abort fires before the `finish` event is emitted, no usage data is captured at all for that interaction, and LangFuse shows zero tokens for aborted reasoning sessions. This is expected behaviour and not a bug.
