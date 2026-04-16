# Loop Detection — Implementation Plan

## Status: Implemented

## Problem Statement

Gemini Flash (and occasionally Pro) enters **thinking loops** — the model generates repetitive reasoning tokens without producing actionable output (text or tool calls). The model is "stuck" paraphrasing the same plan over and over. Example:

```
Thinking
**Verifying the Execution**
I've got the file ready. Now, the next step is to run it using `bun run hello.ts`...

**Orchestrating the Run**
I'm structuring the execution now. First, it's the `sequential-thinking` step...

**Revising the Action**
I've re-examined the plan. Now, I'm going to kick off the `run_command`...
```

This is a distinct pathology from **tool call loops** (calling the same tool repeatedly) or **content chanting** (repeating output text). Thinking loops occur entirely within the reasoning phase, producing no tool calls and no visible output — the session appears permanently frozen.

### Secondary Problem: Tool Call Loops

Additionally, the engine has a basic doom-loop check (`persister.ts:DOOM_LOOP_THRESHOLD=3`) that only compares the last 3 sequential tool calls by name+input. This is fragile — it misses:
- Alternating patterns (A→B→A→B)
- Semantically identical calls with slightly different inputs
- Content chanting (repeating the same output text)

## Architecture Overview

### Reference: gemini-cli's LoopDetectionService

**Source:** `~\Documents\workspace\gemini-cli\packages\core\src\services\loopDetectionService.ts`

gemini-cli implements a multi-layered `LoopDetectionService` with three detection strategies:

| Layer | What it detects | Algorithm | Threshold |
|---|---|---|---|
| **Tool Call Loop** | Consecutive identical tool calls | SHA-256 hash of `name:JSON(args)` | 5 consecutive |
| **Content Chanting** | Repetitive streaming text | Sliding-window chunk hashing (50-char chunks, SHA-256) | 10 occurrences within `5 × chunk_size` distance |
| **LLM Diagnostic** | Broader unproductive states | Secondary LLM analyzes last 20 turns | confidence ≥ 0.9, double-checked |

**Key code references:**
- `checkToolCallLoop()` — lines 314-326: Hash-based consecutive comparison
- `checkContentLoop()` — lines 339-375: Content analysis with code-block filtering
- `analyzeContentChunksForLoop()` — lines 419-437: Sliding window hash analysis
- `isLoopDetectedForChunk()` — lines 456-504: Frequency + distance + period verification
- `truncateAndUpdate()` — lines 381-408: Bounded memory with index adjustment

**Recovery mechanism:** `~\Documents\workspace\gemini-cli\packages\core\src\core\client.ts`
- `_recoverFromLoop()` — lines 1246-1280: Aborts stream, clears detection flag, injects corrective feedback, retries recursively
- Stream integration — lines 754-798: Checks `addAndCheck()` on every stream event, breaks on detection
- Turn-level check — lines 688-705: Checks `turnStarted()` before each turn (LLM diagnostic)

### What gemini-cli does NOT handle

gemini-cli has **no thinking loop detection**. Its content chanting detector only processes `GeminiEventType.Content` (output text), not thinking/reasoning tokens. The `DEFAULT_THINKING_MODE` caps thinking at 8192 tokens, which is a blunt safety net, not a loop detector.

## Implementation Plan

### Phase 1: ThinkingLoopDetector (New Module)

> **File:** `packages/core/src/session/engine/thinking-loop-detector.ts`

A lightweight, stateful detector that monitors `reasoning-delta` events in real-time during streaming. Uses the same hash-based chunking algorithm as gemini-cli's content chanting detector, adapted for thinking tokens.

#### Algorithm

```
1. Buffer incoming reasoning-delta text
2. Every CHUNK_SIZE (100) characters, extract a chunk
3. Hash the chunk (SHA-256)
4. Track hash → [positions] in a Map
5. When a hash appears ≥ THRESHOLD (5) times within MAX_DISTANCE:
   → Verify actual content match (anti-collision)
   → Verify period consistency (≤ 3 unique periods)
   → Return LoopDetected
```

#### Interface

```typescript
export class ThinkingLoopDetector {
  // Feed reasoning text as it streams in
  addReasoningDelta(text: string): ThinkingLoopResult

  // Reset for a new turn
  reset(): void

  // Get current buffer stats (for telemetry)
  getStats(): { bufferLength: number; uniqueHashes: number; detected: boolean }
}

export type ThinkingLoopResult =
  | { detected: false }
  | { detected: true; detail: string; chunkCount: number }
```

#### Constants (tuned for thinking patterns)

| Constant | Value | Rationale |
|---|---|---|
| `CHUNK_SIZE` | 100 | Larger than gemini-cli's 50 because thinking paragraphs are wordier |
| `THRESHOLD` | 5 | Same as gemini-cli tool call threshold — 5 repetitions is conclusive |
| `MAX_DISTANCE_FACTOR` | 5 | Max average distance = `CHUNK_SIZE × 5` |
| `MAX_PERIOD_VARIETY` | 3 | Allows minor variations in repeated blocks |
| `MAX_BUFFER_LENGTH` | 10000 | Memory cap — truncate oldest with index adjustment |

### Phase 2: LoopDetectionService (Unified Service)

> **File:** `packages/core/src/session/engine/loop-detection.ts`

Replicates gemini-cli's `LoopDetectionService` adapted for LiteAI's event system, consolidating all three detection layers plus the new thinking detector.

#### Event Routing

Maps LiteAI's `EngineEvent.Any` types to detection checks:

| Event Type | Detection Layer |
|---|---|
| `{ type: "delta", part: "reasoning" }` | ThinkingLoopDetector |
| `{ type: "delta", part: "text" }` | Content Chanting (hash-based) |
| `{ type: "call", kind: "tool" }` | Tool Call Loop (hash-based) |
| Turn boundary (`turn-start`) | Turn counter for LLM diagnostic (future) |

#### Interface

```typescript
export class LoopDetectionService {
  constructor(sessionID: string)

  // Process any engine event — routes to appropriate detector
  check(event: EngineEvent.Any): LoopDetectionResult

  // Called at turn boundaries
  turnStarted(): LoopDetectionResult

  // Reset all detectors (new prompt)
  reset(): void

  // Clear detection flag (allow recovery turn)
  clearDetection(): void
}

export interface LoopDetectionResult {
  count: number         // 0 = no loop, 1 = first detection, 2+ = repeated
  type?: LoopType
  detail?: string
}

export enum LoopType {
  THINKING_LOOP = "thinking_loop",
  TOOL_CALL_LOOP = "tool_call_loop",
  CONTENT_CHANTING = "content_chanting",
}
```

### Phase 3: Stream Integration

> **File:** `packages/core/src/session/engine/query.ts` (modify)

Wire the detector into the streaming loop (lines 368-378) where events flow through.

```typescript
// In queryLoop(), before the streaming for-await:
const loopDetector = new LoopDetectionService(sessionID)

for await (const event of generator) {
  toolExecutor.processEvent(event)

  // ── Loop detection ──
  const loopResult = loopDetector.check(event)
  if (loopResult.count > 0) {
    yield {
      type: "control",
      action: "loop-detected",
      payload: { loopResult },
    } satisfies EngineEvent.GeneratorResultEvent
    break  // Exit streaming loop
  }

  yield event
}
```

#### Events Extension

Add `"loop-detected"` to `EngineEvent.GeneratorResultEvent.action`:

```typescript
// events.ts
action: "continue" | "compact" | "stop" | "subtask" | "compaction-task" | "overflow" | "loop-detected"
```

### Phase 4: Recovery Mechanism

> **File:** `packages/core/src/session/engine/loop.ts` (modify)

Handle the `loop-detected` control event in `runSessionInner()`:

```typescript
case "loop-detected": {
  const { loopResult } = event.payload
  log.warn("loop detected", { sessionID, type: loopResult.type, detail: loopResult.detail })

  // 1. Flush current persister to save partial work
  if (persister) await persister.flush(currentStreamResult)

  // 2. Strip the incomplete thinking block from the last assistant message
  //    (critical for Code Assist API — partial thought blocks without
  //    thoughtSignature cause 400 errors on retry)
  await stripIncompleteThinking(sessionID, currentAssistantMessage)

  // 3. Inject corrective synthetic user message
  const hint = loopResult.type === "thinking_loop"
    ? "Do not over-plan. Take action immediately using the available tools."
    : `Potential loop detected: ${loopResult.detail}. Step back and rethink your approach.`

  await injectCorrectionMessage({
    sessionID,
    lastUser,
    text: `<system-correction>${hint}</system-correction>`,
    msgsBuffer,
  })

  // 4. Continue the generator loop (next iteration picks up corrective message)
  break
}
```

#### Escalation Strategy (for thinking loops)

| Retry | Action |
|---|---|
| 1st detection | Inject corrective hint: "Take action immediately" |
| 2nd detection | Reduce thinking budget to 1024 tokens |
| 3rd detection | Signal `stop` — end the turn with an error message |

### Phase 5: Thinking History Cleanup

> **File:** `packages/core/src/session/engine/loop.ts` (new helper)

The Code Assist API requires valid `thoughtSignature` on all thinking parts in history. When we abort mid-thinking, the partial block has no signature, which causes 400 errors on retry.

```typescript
async function stripIncompleteThinking(
  sessionID: SessionID,
  message?: Message.Assistant
): Promise<void> {
  if (!message) return
  // Remove reasoning parts that have no end time (incomplete)
  // and don't have a valid thoughtSignature in metadata
  const parts = await Session.getParts(message.id)
  for (const part of parts) {
    if (part.type === "reasoning" && !part.time?.end) {
      await Session.deletePart(part.id)
    }
  }
}
```

## File Manifest

| File | Action | Description |
|---|---|---|
| `session/engine/thinking-loop-detector.ts` | **Create** | Hash-based thinking repetition detector |
| `session/engine/loop-detection.ts` | **Create** | Unified loop detection service (tool + content + thinking) |
| `session/engine/query.ts` | **Modify** | Wire detector into streaming loop |
| `session/events.ts` | **Modify** | Add `loop-detected` control action |
| `session/engine/loop.ts` | **Modify** | Handle recovery, strip thinking, inject correction |
| `session/engine/persister.ts` | **Modify** | Remove legacy `DOOM_LOOP_THRESHOLD` (superseded) |

## Testing Strategy

Tests should be scoped to the modified domains only (`bun test test/session/engine`).

1. **ThinkingLoopDetector unit tests**
   - Feed repeated 100-char blocks → detects at threshold 5
   - Feed varied content → no false positive
   - Buffer truncation preserves detection across boundary
   - Reset clears all state

2. **LoopDetectionService unit tests**
   - Tool call event routing → detects consecutive identical calls
   - Reasoning delta routing → delegates to ThinkingLoopDetector
   - Text delta routing → content chanting detection
   - `clearDetection()` allows recovery turn

3. **Integration tests**
   - Mock stream that emits repeated reasoning deltas → engine emits `loop-detected` control event
   - Recovery path: corrective message appears in buffer after detection

## Dependencies

- `node:crypto` (SHA-256 hashing) — already used in the codebase
- No new npm packages required

## Open Questions

1. **Should we expose loop detection config to the user?** (e.g., disable per-session, adjust thresholds)
   - Recommendation: Not in v1. Add a `Flag.LITEAI_DISABLE_LOOP_DETECTION` for internal use.

2. **Should we add LLM-based diagnostic checks?** (like gemini-cli's `checkForLoopWithLLM`)
   - Recommendation: Defer to Phase 2. The algorithmic detectors cover the critical cases. LLM checks add latency and cost.

3. **Telemetry**: Should loop detection events be sent to Langfuse?
   - Recommendation: Yes. Add a span attribute `loop.detected` with type and detail for observability.
