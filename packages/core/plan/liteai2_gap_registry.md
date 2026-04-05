# LiteAI ↔ LiteAI2 Gap Registry

**Status:** Post Phase 3 (queryLoop async generator complete)  
**Last updated:** 2026-04-05

---

## Architectural Context (Read First)

LiteAI2 is a **CLI process** — it lives for one conversation. `queryLoop` receives
`messages: Message[]` loaded from `~/.history.jsonl` once on startup. Everything runs
in-memory for the lifetime of the process. Zero DB. Old session = read JSONL on launch.

LiteAI is a **persistent HTTP daemon** — it serves multiple simultaneous sessions and
must survive restarts. SQLite is the source of truth. Old session = load from DB on
demand. This is **not a bug** — the models are fundamentally different by design.

**Implication:** A full LiteAI2-style in-memory refactor would also require:
- Removing the server/daemon model
- Moving session storage to per-process JSONL (losing multi-client support)
- Breaking the VS Code extension's SSE streaming model

That is out of scope unless we decide to fundamentally change the product architecture.

---

## Gap Items

### HIGH IMPACT — Next Phases

#### G1: Streaming Tool Execution (Phase 4)
**What LiteAI2 does:** `StreamingToolExecutor` parses tool JSON arguments *live* from
the token stream. Tools start executing before the full argument block is received.
This means a file-write tool begins its I/O while the model is still generating the
filename. Drastically reduces latency for sequential tool chains.

**What we do:** Buffer the full tool call block, then execute. Tools only fire after
`end/tool` event — full round-trip latency per tool.

**How to close:** Port `StreamingToolExecutor` from LiteAI2. It requires hooking into
the Vercel AI SDK stream at the `delta/tool` event level to accumulate and parse JSON
incrementally. Will need a JSON streaming parser (e.g. `@streamparser/json`).

**Files:** New `src/session/engine/streaming-executor.ts`, modify `processor.ts`.

---

#### G2: Reactive Compaction (Phase 4 extension)
**What LiteAI2 does:** If the API returns a 413 / "prompt too long" error mid-stream,
LiteAI2 immediately fires a "reactive compact" — summarizes context and retries
without surfacing the error to the user. Transparent recovery.

**What we do:** Surface a `ContextOverflowError` to the user. No transparent retry.

**How to close:** Add a retry branch in the `tombstone` handler in `runSession()`. On
`ContextOverflowError`, create a compaction task and re-fire the same user turn.
Add `hasAttemptedReactiveCompact` guard (LiteAI2 pattern) to prevent infinite loops.

**Files:** `loop.ts` (runSession tombstone handler), `persister.ts`.

---

#### G3: Micro-Compact / Tool Result Pruning (Phase 4 extension)
**What LiteAI2 does:** Has 5 compaction stages in order of escalation:
1. snipCompact — removes dead branches (already implemented)
2. applyToolResultBudget — shrinks fat tool outputs (already implemented)
3. microCompact — creates summarized tool-use summary messages inline
4. contextCollapse — collapses historical turns into a summary block
5. reactiveCompact — full session summarization triggered by 413

**What we do:** Stages 1-2 only (pipeline.ts). Stages 3-5 missing.

**How to close:** Implement `microCompact` as a new pipeline stage. It generates a
compact tool-use summary and injects it as a synthetic message, then removes the
original tool call/result pairs from context. Port from LiteAI2's
`generateToolUseSummary` + `createToolUseSummaryMessage`.

**Files:** `pipeline.ts`, new `src/session/engine/micro-compact.ts`.

---

#### G4: Named Transition Types for Loop Iterations
**What LiteAI2 does:** Each loop `continue` site records the reason in a typed
`transition: Continue` field on `State`. Test code can assert transition type
without inspecting message content. Precise test coverage.

**What we do:** String `action` on control events. No structured reason tracking.

**How to close:** Add a `transition` field to `QueryLoopParams` type, yielded back
on `turn-end`. Useful for testing + telemetry, low urgency vs. G1-G3.

---

### MEDIUM IMPACT — Performance

#### G5: Write-Through In-Memory Message Cache
**What LiteAI2 does:** Messages accumulate in `state.messages` — never re-read from
disk. The loop grows its own state.

**What we do:** Re-read all messages from SQLite at the top of every iteration via
`Message.filterCompacted(Message.stream(...))`. On a 200-turn session this is a linear
scan per turn.

**How to close (without removing the server model):**
Add a `SessionMessageCache` — a `Map<SessionID, Message.WithParts[]>` singleton that:
- Is populated on first read per session (cache miss -> SQLite -> warm cache)
- Is updated on every `Session.updateMessage` / `Session.updatePart` call (write-through)
- Is invalidated when a session is loaded from cold (old session open)

The `queryLoop` reads from the cache instead of SQLite. The orchestrator writes to
both SQLite and the cache atomically. Old session loading is just a cache miss —
same as a new session on first iteration.

**Estimated gain:** ~5-15ms per turn on long sessions. Low priority until sessions
regularly exceed 50+ turns.

**Files:** New `src/session/cache.ts`, modify `index.ts` write paths, `query.ts`.

---

#### G6: Per-Turn Write Batching (Single Transaction)
**What we do now:** Each `persister.handleEvent()` call is a separate `Database.use()`
transaction. A 30-event turn (reasoning + text + tools + finish) = 30 commits.

**How to close:** Accumulate events in a `pending: EngineEvent.Any[]` array and flush
all in a single `BEGIN/COMMIT` transaction in `persister.flush()`. Already partially
set up since flush is the synchronization point.

**Estimated gain:** ~10x write throughput per turn, reduces WAL pressure significantly.

**Files:** `persister.ts`.

---

### LOW IMPACT / Quality

#### G7: maxOutputTokens Recovery Loop
**What LiteAI2 does:** When a model hits its `max_output_tokens` limit mid-response,
LiteAI2 retries with a continuation prompt up to 3 times before surfacing the error.
`OutputLengthError` is a last resort.

**What we do:** Surface `OutputLengthError` immediately.

**Files:** `persister.ts` finish handler, new retry logic.

---

#### G8: Sleep Tool Integration
LiteAI2 has a `SleepTool` that lets the model pause between tool calls to avoid
rate limits. Minor quality-of-life for agents with tight API quotas.

---

#### G9: Post-Sampling Hooks
**What LiteAI2 does:** `executePostSamplingHooks` and `executeStopFailureHooks` run
after each API response. Allows external tools to react to specific model outputs.

**What we do:** `Stop` hook only (at end of full session). Per-step hooks missing.

---

## Deferred / Won't Do

| Item | Reason |
|---|---|
| Async SQLite write queue (Bun Worker) | Writes are not the bottleneck; G5 (cache) solves the read coupling correctly |
| Full in-memory session model (LiteAI2-style) | Requires removing the server/daemon model |
| LMAX Disruptor ring buffer | Correct tool, wrong problem |

---

## Priority Order

```
G1  Streaming tool execution     <- biggest latency win, Phase 4
G2  Reactive compaction          <- user-visible: removes "context too long" errors
G3  Micro-compact                <- extends sessions that hit token limits
G6  Transaction batching         <- quick win, low risk
G5  Message cache                <- performance, defer until sessions are long
G4  Named transitions            <- testing quality, low urgency
G7  maxOutputTokens retry        <- polish
G8  Sleep tool                   <- minor
G9  Post-sampling hooks          <- extensibility
```
