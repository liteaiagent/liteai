# Engine Orchestration Redesign — Phased Plan

> **Scope**: `packages/core/src/session/engine/` — the files `loop.ts`, `query.ts`, `persister.ts`, `processor.ts`, `events.ts`
> **Goal**: Decompose the monolithic switch/case orchestrator into a disciplined Reactor with named handlers, typed actions, explicit branches, and single return points.
> **Design decisions**: See [iron-design.md](./iron-design.md) for finalized patterns, code discipline rules, and execution strategy.
> **Execution**: Each phase ships as a **separate PR** for incremental review.

---

## Table of Contents

1. [Problem Statement](#problem-statement)
2. [Design Patterns Applied](#design-patterns-applied)
3. [Architecture Overview](#architecture-overview)
4. [Core Types](#core-types)
5. [Phase 0: Foundation](#phase-0-foundation-types--error-classifier)
6. [Phase 1: EngineReactor](#phase-1-enginereactor)
7. [Phase 2: Persister Simplification](#phase-2-persister-simplification)
8. [Phase 3: Processor Retirement](#phase-3-processor-retirement--turnrunner)
9. [Phase 4: Polish & Hardening](#phase-4-polish--hardening)
10. [File Inventory](#file-inventory)
11. [Risk Assessment](#risk-assessment)
12. [Verification Plan](#verification-plan)

---

## Problem Statement

### What's broken

The current engine has three interleaved concerns in a single 1100-line `loop.ts`:

1. **Event consumption** (for-await over the generator)
2. **Business logic** (structured output, compaction, loop recovery, subtasks)
3. **Flow control** (break vs return confusion, persister returning magic strings)

`persister.ts` (465 lines) conflates two responsibilities:
1. **Database writing** (its actual job)
2. **Error classification + retry orchestration** (misplaced — includes `await sleep()` inside a DB writer)

The error pipeline uses a **throw-self-catch** anti-pattern where `handleEvent()` re-throws stream errors (`throw event.error`, line 317) into its own catch block (line 328). This makes control flow fragile and was the direct root cause of the abort data loss bug — partial reasoning tokens were not persisted because the `throwIfAborted()` guard couldn't be safely bypassed.

`processor.ts` (191 lines) duplicates 80% of the orchestrator's logic for single-turn compaction use. Fixes applied to `loop.ts` don't propagate to `processor.ts`, creating a persistent bug surface.

### What works well

- **query.ts** as a pure async generator is excellent. Zero DB writes, clean event protocol, clear separation. **No structural changes needed.**
- **events.ts** discriminated union is type-safe and extensible. **Minimal changes.**
- **persister.ts** part accumulation and `flush()` logic is solid when restricted to persistence.
- The overall **Producer-Consumer** pattern through async generators is fundamentally sound.

---

## Design Patterns Applied

| Pattern | Where | Purpose |
|---------|-------|---------|
| **Reactor** | `EngineReactor` class | Named dispatch table mapping event types to handler methods. Replaces the 300-line switch/case. |
| **Producer-Consumer** | `queryLoop` → `EngineReactor` | Generator produces typed events; reactor consumes through `for await`. Clean decoupling via async channel. |
| **Strategy** | `SessionErrorClassifier` | Pure, injectable function that classifies raw errors into orchestration actions. No side effects. |
| **State Machine** | `TurnContext` lifecycle | Turn state transitions: `idle → streaming → flushing → (retrying|stopped|continuing)`. Explicit lifecycle. |
| **Single Responsibility** | All modules | Persister persists. Classifier classifies. Reactor orchestrates. Producer produces. |
| **Open-Closed** | Handler registration | Adding new event types requires only adding a new handler method — existing handlers don't change. |

---

## Architecture Overview

### Current
```
queryLoop (query.ts)
  ↓ yields EngineEvent.Any
runSessionInner (loop.ts)  ← 1100 lines, massive switch/case
  ↓ routes to
EventPersister (persister.ts)  ← also classifies errors, retries with sleep
  ↓
SQLite
```

### Target
```
queryLoop (query.ts)         ← UNCHANGED (Producer)
  ↓ yields EngineEvent.Any
EngineReactor (reactor.ts)   ← NEW (Reactor + State Machine)
  ├─ handleTurnStart()       ← named handler, returns EngineAction
  ├─ handleTurnEnd()         ← named handler, returns EngineAction
  ├─ handleStreamEvent()     ← named handler, returns EngineAction
  └─ handleControl()         ← named handler, returns EngineAction
       ├─ handleSubtask()
       ├─ handleCompaction()
       └─ handleLoopRecovery()
  ↓ delegates persistence to
EventPersister (persister.ts) ← SIMPLIFIED (pure DB writer)
  ↓
SQLite

Error classification:
SessionErrorClassifier (error-classifier.ts) ← NEW (Strategy, pure function)

runSessionInner (loop.ts)    ← SIMPLIFIED to ~50 lines
  for await (event of generator) {
    const action = await reactor.dispatch(event)
    // 4-way switch on action.type — that's it
  }
```

### Data flow diagram

```
┌─────────────┐    events     ┌────────────────┐    EngineAction    ┌──────────┐
│  queryLoop  │──────────────→│ EngineReactor  │───────────────────→│  loop.ts │
│ (Producer)  │  async gen    │   (Reactor)    │  typed result      │(Consumer)│
└─────────────┘               │                │                    │          │
                              │ dispatch()     │                    │ switch:  │
                              │  ├ turnStart   │                    │ continue │
                              │  ├ turnEnd     │                    │ stop     │
                              │  ├ streamEvent │                    │ compact  │
                              │  └ control     │                    │ retry    │
                              │                │                    └──────────┘
                              │    ↓ persist   │
                              │ EventPersister │
                              │ (pure writer)  │
                              │    ↓ classify  │
                              │ ErrorClassifier│
                              │ (pure fn)      │
                              └────────────────┘
```

---

## Core Types

### `engine-types.ts`

```typescript
/**
 * Typed result returned by every reactor handler.
 * Replaces all stringly-typed returns ("stop" | "continue" | "compact").
 *
 * Each variant carries exactly the data the orchestrator needs to act.
 * No optional fields, no ambiguity.
 */
export type EngineAction =
  | { type: "continue" }
  | { type: "stop"; reason: "abort" | "fatal" | "blocked" | "complete" }  
  | { type: "compact"; lastUser: Message.User }
  | { type: "retry"; attempt: number; delay: number; message: string }

/**
 * Shared mutable state for one LLM turn.
 * Created in handleTurnStart, consumed in handleTurnEnd,
 * destroyed after flush. This is the State Machine node.
 */
export type TurnContext = {
  persister: EventPersister
  assistantMessage: Message.Assistant
  model: Provider.Model
  streamResult?: unknown
}
```

### Error Classification

```typescript
// error-classifier.ts
export namespace SessionErrorClassifier {
  export type Classification =
    | { action: "stop"; reason: "abort" }
    | { action: "stop"; reason: "fatal"; error: ReturnType<NamedError["toObject"]> }
    | { action: "compact" }
    | { action: "retry"; message: string; delay: number; attempt: number }

  /**
   * Pure function. Zero side effects. No Bus publishes, no DB writes.
   * Takes a raw error + context, returns a classification.
   */
  export function classify(input: {
    error: unknown
    providerID: string
    attempt: number
  }): Classification {
    // AbortError → stop/abort
    if (error instanceof DOMException && error.name === "AbortError") {
      return { action: "stop", reason: "abort" }
    }
    
    const parsed = Message.fromError(error, { providerID })
    
    // ContextOverflow → compact
    if (Message.ContextOverflowError.isInstance(parsed)) {
      return { action: "compact" }
    }
    
    // Retryable → retry with delay
    const retryMessage = SessionRetry.retryable(parsed)
    if (retryMessage !== undefined) {
      const nextAttempt = attempt + 1
      return {
        action: "retry",
        message: retryMessage,
        delay: SessionRetry.delay(nextAttempt, parsed.name === "APIError" ? parsed : undefined),
        attempt: nextAttempt,
      }
    }
    
    // Fatal → stop
    return { action: "stop", reason: "fatal", error: parsed }
  }
}
```

---

## Phase 0: Foundation (Types & Error Classifier)

**Goal**: Introduce the new type system and error classifier without any behavioral changes.

**Files:**
| Action | File | Lines |
|--------|------|-------|
| NEW | `engine/engine-types.ts` | ~30 |
| NEW | `engine/error-classifier.ts` | ~70 |
| NEW | `test/session/engine/error-classifier.test.ts` | ~100 |

**Details:**

### `engine-types.ts`
- `EngineAction` discriminated union (4 variants)
- `TurnContext` interface
- No imports from loop.ts/persister.ts — this is a leaf module

### `error-classifier.ts`
- `SessionErrorClassifier.classify()` — logic extracted verbatim from `persister.ts` lines 328–354
- Imports only: `Message` (for error types), `SessionRetry` (for retryable check + delay calc)
- Zero dependency on `Bus`, `SessionStatus`, `Session.Event`, `Config`

### Tests
- AbortError → `{ action: "stop", reason: "abort" }`
- ContextOverflowError → `{ action: "compact" }`
- Retryable APIError → `{ action: "retry", ... }` with correct delay
- Non-retryable APIError → `{ action: "stop", reason: "fatal" }`
- Unknown error → `{ action: "stop", reason: "fatal" }`

**Validation**: `bun typecheck` passes. Unit tests pass. No behavioral changes.

---

## Phase 1: EngineReactor

**Goal**: Introduce the Reactor class with named handlers. Wire it into `loop.ts`.

**Files:**
| Action | File | Est. Lines |
|--------|------|------------|
| NEW | `engine/reactor.ts` | ~400 |
| MODIFY | `engine/loop.ts` | −300, +50 |

**Details:**

### `engine/reactor.ts` — The Reactor Class

```typescript
export class EngineReactor {
  private turnCtx?: TurnContext
  private loopDetectionCount = 0
  private pendingLoopRecovery?: LoopDetectionResult

  constructor(
    private readonly sessionID: SessionID,
    private readonly session: Session.Info,
    private readonly abort: AbortSignal,
    private readonly msgsBuffer: { current: Message.WithParts[] },
    private readonly registry: BackgroundTaskRegistry,
  ) {}

  // ── Reactor dispatch ────────────────────────────────────
  async dispatch(event: EngineEvent.Any): Promise<EngineAction> {
    switch (event.type) {
      case "turn-start":  return this.handleTurnStart(event as EngineEvent.TurnStartEvent)
      case "turn-end":    return this.handleTurnEnd(event as EngineEvent.TurnEndEvent)
      case "control":     return this.handleControl(event as EngineEvent.GeneratorResultEvent)
      default:            return this.handleStreamEvent(event)
    }
    // Note: no fallthrough — every branch returns explicitly.
  }
}
```

#### Handler Design Rules

Every handler method follows these invariants:

1. **Explicit else** — Every `if` has an `else`. Every `switch` has a `default`.
2. **Single return point** — One `let result: EngineAction` at the top, one `return result` at the bottom.
3. **No break/return confusion** — Handlers are methods that `return`, not cases that `break`.

Example — `handleTurnStart`:

```typescript
private async handleTurnStart(event: TurnStartEvent): Promise<EngineAction> {
  let result: EngineAction = { type: "continue" }

  // Persist the assistant message to DB
  const assistantMessage = (await Session.updateMessage(
    event.assistantMessage
  )) as Message.Assistant

  // Create fresh persister for this turn
  const persister = new EventPersister(
    assistantMessage, this.sessionID, event.model, this.abort
  )
  this.turnCtx = { persister, assistantMessage, model: event.model }

  SessionStatus.set(this.sessionID, { type: "busy" })

  // Fire-and-forget title summarization
  const lastUser = event.streamInput.user
  if (lastUser) {
    SessionSummary.summarize({
      sessionID: this.sessionID,
      messageID: lastUser.id,
    })
  }
  // else: no user message — skip summary (explicit)

  return result
}
```

Example — `handleStreamEvent` (critical path for abort fix):

```typescript
private async handleStreamEvent(event: EngineEvent.Any): Promise<EngineAction> {
  let result: EngineAction = { type: "continue" }
  
  const ctx = this.turnCtx
  if (!ctx) {
    // No active turn — discard event
    return result
  }

  // Delegate to persister for DB writes
  await ctx.persister.handleEvent(event)

  // Check if persister captured a stream error during processing
  if (ctx.persister.streamError) {
    // Don't classify yet — wait for turn-end to flush partial work first.
    // The producer (queryLoop) will yield turn-end next.
    result = { type: "continue" }
  } else if (ctx.persister.needsCompaction) {
    // Overflow detected during normal step-end processing
    result = { type: "continue" } // flush at turn-end will return "compact"
  } else {
    result = { type: "continue" }
  }

  return result
}
```

Example — `handleTurnEnd` (the critical integration point):

```typescript
private async handleTurnEnd(event: TurnEndEvent): Promise<EngineAction> {
  let result: EngineAction = { type: "continue" }

  const ctx = this.turnCtx
  if (!ctx) {
    return result
  }

  ctx.streamResult = event.streamResult

  // ── Step 1: Classify any captured stream error ──
  if (ctx.persister.streamError) {
    const classification = SessionErrorClassifier.classify({
      error: ctx.persister.streamError,
      providerID: ctx.model.providerID,
      attempt: ctx.persister.attempt,
    })

    switch (classification.action) {
      case "stop":
        if (classification.reason === "abort") {
          log.info("reactor: stream aborted", { sessionID: this.sessionID })
          // Don't set assistantMessage.error — abort is not a fault
        } else {
          ctx.assistantMessage.error = classification.error
          Bus.publish(Session.Event.Error, {
            sessionID: this.sessionID,
            error: classification.error,
          })
        }
        break
      case "compact":
        ctx.persister.needsCompaction = true
        Bus.publish(Session.Event.Error, { ... })
        break
      case "retry":
        ctx.persister.attempt = classification.attempt
        result = {
          type: "retry",
          attempt: classification.attempt,
          delay: classification.delay,
          message: classification.message,
        }
        break
      default:
        break // explicit else for exhaustive handling
    }
  }
  // else: no stream error — normal completion

  // ── Step 2: Flush persister (ALWAYS, even on abort) ──
  const flushResult = await ctx.persister.flush(ctx.streamResult)
  ctx.streamResult = undefined

  // Update in-memory buffer
  this.msgsBuffer.current = [
    ...this.msgsBuffer.current,
    ctx.persister.getCompletedMessage(),
  ]

  // ── Step 3: If retry was determined, return it now ──
  if (result.type === "retry") {
    return result
  }

  // ── Step 4: Handle loop recovery ──
  if (this.pendingLoopRecovery) {
    result = await this.handleLoopRecovery(ctx)
    return result
  }

  // ── Step 5: Structured output ──
  if (event.structuredOutput !== undefined) {
    ctx.assistantMessage.structured = event.structuredOutput
    ctx.assistantMessage.finish = ctx.assistantMessage.finish ?? "stop"
    await Session.updateMessage(ctx.assistantMessage)
    result = { type: "stop", reason: "complete" }
    return result
  }

  // ── Step 6: Map flush result to action ──
  if (flushResult === "stop") {
    if (ctx.assistantMessage.error) {
      result = { type: "stop", reason: "fatal" }
    } else {
      result = { type: "stop", reason: "blocked" }
    }
  } else if (flushResult === "compact") {
    const lastUser = this.findLastUser()
    if (lastUser) {
      result = { type: "compact", lastUser }
    } else {
      result = { type: "stop", reason: "fatal" }
    }
  } else {
    // flushResult === "continue"
    await this.injectTaskNotifications()
    await InstructionPrompt.clear(ctx.assistantMessage.id)
    result = { type: "continue" }
  }

  return result
}
```

### `loop.ts` — Simplified Orchestrator

```typescript
async function runSessionInner(input: {
  sessionID: SessionID
  session: Session.Info
  abort: AbortSignal
  registry: BackgroundTaskRegistry
}) {
  const { sessionID, session, abort } = input

  const msgsBuffer = {
    current: await Message.filterCompacted(Message.stream(sessionID)),
  }

  const reactor = new EngineReactor(sessionID, session, abort, msgsBuffer, input.registry)
  const generator = queryLoop({ sessionID, session, abort, msgsBuffer, backgroundTaskRegistry: input.registry })

  try {
    for await (const event of generator) {
      const action = await reactor.dispatch(event)

      switch (action.type) {
        case "continue":
          break

        case "stop":
          log.info("runSession: stopped", { sessionID, reason: action.reason })
          return

        case "compact": {
          const { markerWithParts } = await SessionCompaction.create({
            sessionID,
            agent: action.lastUser.agent,
            model: action.lastUser.model,
            auto: true,
          })
          msgsBuffer.current = [...msgsBuffer.current, markerWithParts]
          break
        }

        case "retry":
          SessionStatus.set(sessionID, {
            type: "retry",
            attempt: action.attempt,
            message: action.message,
            next: Date.now() + action.delay,
          })
          await SessionRetry.sleep(action.delay, abort).catch(() => {})
          break

        default: {
          // Exhaustive check — TypeScript will error if a new action type is added
          const _exhaustive: never = action
          throw new Error(`Unknown action: ${JSON.stringify(_exhaustive)}`)
        }
      }
    }
  } catch (e: unknown) {
    if (e instanceof DOMException && e.name === "AbortError") {
      log.info("runSession: caught AbortError in event loop", { sessionID })
    } else {
      throw e
    }
  }

  // Post-loop cleanup
  SessionCompaction.prune({ sessionID }).catch((e: unknown) => {
    if (!(e instanceof DOMException && e.name === "AbortError")) {
      log.error("runSession: prune failed", { error: e, sessionID })
    }
  })
}
```

**Benefit**: `runSessionInner` goes from ~300 lines of switch/case nesting to ~50 lines of pure dispatch.

**Validation**: `bun typecheck`, existing integration tests, manual abort/retry/compaction testing.

---

## Phase 2: Persister Simplification

**Goal**: Strip error classification and retry logic from `EventPersister`. Make it a pure DB writer.

**Files:**
| Action | File | Delta |
|--------|------|-------|
| MODIFY | `engine/persister.ts` | −50 lines |
| MODIFY | `test/session/engine/persister.test.ts` | update assertions |

**Details:**

### Removals from `persister.ts`
1. **Delete the entire `catch (e: unknown)` block** (current lines 328–355)
2. **Delete `throw event.error`** in the `case "error"` / `kind === "stream"` branch (line 317)
3. **Remove imports**: `SessionRetry`, `SessionStatus`, `Bus`, `Session.Event.Error`

### Additions
```typescript
// New private field
private _streamError: unknown

// New public getter
get streamError(): unknown {
  return this._streamError
}
```

### Modified `"error"` case

**Before:**
```typescript
case "error": {
  // ...tool error handling...
  } else if (event.kind === "stream") {
    throw event.error  // ← self-throw anti-pattern
  }
  break
}
```

**After:**
```typescript
case "error": {
  // ...tool error handling (unchanged)...
  } else if (event.kind === "stream") {
    this._streamError = event.error  // ← store, don't throw
  }
  break
}
```

### handleEvent return type change

**Before:** `Promise<"stop" | "continue" | "compact" | undefined>`
**After:** `Promise<"compact" | undefined>`

`handleEvent()` can only return `"compact"` (when `needsCompaction` is set by normal step-end processing) or `undefined`. It never returns `"stop"` or `"continue"` — those decisions move to the reactor.

### `throwIfAborted()` reversion

The conditional bypass we added (`if (event.type !== "turn-end" && event.type !== "error")`) can be **reverted to the simple unconditional form**:

```typescript
this.abort.throwIfAborted()
```

Wait — actually, with the error path now storing instead of throwing, `throwIfAborted()` at the top of `handleEvent()` will still throw AbortError for any event processed after abort. But the reactor won't route events to the persister after a stream error is captured. Let me think about this...

Actually, the correct approach: **Remove `throwIfAborted()` from `handleEvent()` entirely.** The abort check belongs in the reactor (orchestration layer), not in the persister (data layer). The reactor already checks `abort.aborted` in the producer and won't invoke the persister when it shouldn't.

However, there's a subtle edge case: the for-await loop in queryLoop might still yield a few events between the abort signal firing and the generator's `finally` block running. These events could flow to `handleEvent()` after abort. The persister should still handle them gracefully (write partial data). So: **remove `throwIfAborted()` from `handleEvent()` and let events flow through normally during teardown.** This is exactly what we want — partial data persistence.

### flush() changes

`flush()` stays mostly as-is. The only change:
- The `reason: this.abort.aborted ? "abort" : "error"` differentiation we already implemented stays.
- `flush()` return type stays `"compact" | "stop" | "continue"`.

### Test updates

The existing test asserts `handleEvent()` returns `"stop"` on AbortError. After this change:
- `handleEvent()` on an aborted signal doesn't throw and doesn't return `"stop"` — it simply stores the error.
- New assertion: `persister.streamError instanceof DOMException` after processing on aborted signal.

**Validation**: `bun test test/session/engine/persister.test.ts`, `bun typecheck`.

---

## Phase 3: Processor Retirement, TurnRunner & stream.ts

**Goal**: Eliminate `processor.ts` by creating a lightweight `TurnRunner` for single-turn LLM calls. Extract `streamGenerator()` into a dedicated `stream.ts` adapter module. Currently the only consumer of `SessionProcessor.create()` is `compaction.ts`.

**Files:**  
| Action | File | Lines |
|--------|------|-------|
| NEW | `engine/stream.ts` | ~120 (extracted from processor.ts) |
| NEW | `engine/turn-runner.ts` | ~80 |
| MODIFY | `engine/query.ts` | ~2 lines (import path change) |
| MODIFY | `tasks/compaction.ts` | ~30 lines changed |
| DELETE | `processor.ts` | 191 lines removed |

### `turn-runner.ts` — Lightweight Single-Turn Executor

```typescript
/**
 * Runs a single LLM turn: stream → persist → flush.
 *
 * Unlike the full EngineReactor (which handles multi-turn loops,
 * subtasks, loop detection, etc.), TurnRunner is a minimal adapter
 * for single-shot LLM calls like compaction summaries.
 *
 * Follows the Producer-Consumer pattern:
 * - Producer: SessionProcessor.streamGenerator()
 * - Consumer: EventPersister.handleEvent()
 * - Error classification: SessionErrorClassifier.classify()
 */
export async function runSingleTurn(input: {
  assistantMessage: Message.Assistant
  sessionID: SessionID
  model: Provider.Model
  abort: AbortSignal
  streamInput: LLM.StreamInput  
}): Promise<{
  action: EngineAction
  message: Message.Assistant
  resolvedSystem?: string[]
}> {
  let resolved: string[] | undefined
  let result: EngineAction = { type: "continue" }

  // Retry loop (equivalent to processor.ts's while(true))
  while (true) {
    const persister = new EventPersister(
      input.assistantMessage, input.sessionID, input.model, input.abort
    )
    let streamResult: LLM.StreamOutput | undefined

    const generator = SessionProcessor.streamGenerator(
      input.streamInput,
      (s) => { resolved = s },
      (r) => { streamResult = r },
    )

    for await (const event of generator) {
      await persister.handleEvent(event)

      if (persister.streamError) {
        break // exit stream loop, handle error below
      }
    }

    // Classify stream error if any
    if (persister.streamError) {
      const classification = SessionErrorClassifier.classify({
        error: persister.streamError,
        providerID: input.model.providerID,
        attempt: persister.attempt,
      })

      if (classification.action === "retry") {
        persister.attempt = classification.attempt
        SessionStatus.set(input.sessionID, {
          type: "retry",
          attempt: classification.attempt,
          message: classification.message,
          next: Date.now() + classification.delay,
        })
        await SessionRetry.sleep(classification.delay, input.abort).catch(() => {})
        continue // retry the while loop
      }

      // For stop/compact, flush and return
      await persister.flush(streamResult)
      if (classification.action === "stop") {
        if (classification.reason === "fatal") {
          input.assistantMessage.error = classification.error
        }
        result = { type: "stop", reason: classification.reason === "abort" ? "abort" : "fatal" }
      } else {
        result = { type: "compact", lastUser: {} as Message.User }
      }
      break
    }

    // Normal completion
    const flushResult = await persister.flush(streamResult)
    if (flushResult === "compact") {
      result = { type: "compact", lastUser: {} as Message.User }
    } else if (flushResult === "stop") {
      result = { type: "stop", reason: input.assistantMessage.error ? "fatal" : "blocked" }
    } else {
      result = { type: "continue" }
    }
    break
  }

  return { action: result, message: input.assistantMessage, resolvedSystem: resolved }
}
```

### `compaction.ts` changes

Replace:
```typescript
import { SessionProcessor } from "../processor"
// ...
const processor = SessionProcessor.create({
  assistantMessage: msg,
  sessionID: input.sessionID,
  model,
  abort: input.abort,
})
const result = await processor.process(streamInput)
```

With:
```typescript
import { runSingleTurn } from "../engine/turn-runner"
// ...
const { action, message } = await runSingleTurn({
  assistantMessage: msg,
  sessionID: input.sessionID,
  model,
  abort: input.abort,
  streamInput,
})
const result = action.type === "compact" ? "compact"
  : action.type === "stop" ? "stop"
  : "continue"
```

### Extract `streamGenerator()` → `engine/stream.ts`

`streamGenerator()` is the pure adapter that converts the Vercel AI SDK's `fullStream` into our `EngineEvent.Any` protocol. It belongs in its own module because it's consumed by two distinct producers:

- `query.ts` — multi-turn loops
- `turn-runner.ts` — single-turn compaction

Clean layering:
```
stream.ts      → SDK → EngineEvent  (adapter)
query.ts       → uses stream.ts     (multi-turn producer)
turn-runner.ts → uses stream.ts     (single-turn producer)
reactor.ts     → consumes events    (consumer)
```

The extraction is a straight cut-paste — no logic changes, just a new file and updated import paths.

### Delete `processor.ts`
After compaction.ts is migrated and `streamGenerator()` is extracted: `git rm processor.ts`

Verify no remaining imports:
```bash
grep -r "SessionProcessor" --include="*.ts" | grep -v test
# Expected: zero results
grep -r "from.*processor" --include="*.ts" src/
# Expected: zero results
```

**Validation**: `bun test test/session/`, `bun typecheck`, manual compaction test.

---

## Phase 4: Polish & Hardening

**Goal**: Apply the disciplinary code rules across all reactor handlers. Add integration tests.

### 4a. Explicit Else Audit

Every `if` in a handler method must have an explicit `else`:

```typescript
// ❌ Implicit fallthrough
if (event.kind === "reasoning") {
  // handle reasoning
}

// ✅ Explicit else
if (event.kind === "reasoning") {
  // handle reasoning
} else {
  // no-op: other event kinds handled elsewhere
}
```

For switch statements, every one must have a `default`:

```typescript
switch (action) {
  case "subtask":     return this.handleSubtask(payload)
  case "compaction":  return this.handleCompaction(payload)
  default:            return { type: "continue" }  // ← always present
}
```

### 4b. Single Return Point Audit

Every handler method uses the pattern:

```typescript
async handleFoo(event): Promise<EngineAction> {
  let result: EngineAction = { type: "continue" } // default
  
  // ... mutation of `result` ...
  
  return result // single exit
}
```

No early `return` statements. No `break` + `return` confusion.

### 4c. Exhaustive Type Checking

Use TypeScript's `never` type to enforce exhaustive dispatch:

```typescript
switch (action.type) {
  case "continue": break
  case "stop":     return
  case "compact":  // ...
  case "retry":    // ...
  default: {
    const _: never = action
    throw new Error(`Unhandled action: ${JSON.stringify(_)}`)
  }
}
```

### 4d. Logging Alignment

All reactor handlers log under `session.engine`:
```typescript
const log = Log.create({ service: "session.engine" })
```

Persister logs under `session.persister` (unchanged).
Error classifier logs under `session.error-classifier`.

### 4e. Integration Tests

New test file: `test/session/engine/reactor.test.ts`
- Dispatch turn-start → verify persister created
- Dispatch stream events → verify accumulation
- Dispatch turn-end → verify flush called
- Dispatch abort scenario → verify reasoning persisted + step-finish with reason "abort"
- Dispatch retryable error → verify EngineAction type "retry" returned
- Dispatch overflow → verify EngineAction type "compact" returned
- Dispatch loop-detected → verify recovery injection

---

## File Inventory

### New Files
| File | Lines | Purpose | Phase |
|------|-------|---------|-------|
| `engine/engine-types.ts` | ~30 | `EngineAction`, `TurnContext` types | 0 |
| `engine/error-classifier.ts` | ~70 | `SessionErrorClassifier.classify()` — pure strategy | 0 |
| `engine/reactor.ts` | ~400 | `EngineReactor` class — named handlers, state machine | 1 |
| `engine/stream.ts` | ~120 | LLM SDK → EngineEvent adapter (extracted from processor.ts) | 3 |
| `engine/turn-runner.ts` | ~80 | Single-turn executor for compaction | 3 |
| `test/.../error-classifier.test.ts` | ~100 | Classifier unit tests | 0 |
| `test/.../reactor.test.ts` | ~150 | Reactor integration tests | 1 |

### Modified Files
| File | Change | Impact | Phase |
|------|--------|--------|-------|
| `engine/loop.ts` | −300, +50 | Delegated to reactor | 1 |
| `engine/persister.ts` | −50 | Error classification removed | 2 |
| `engine/query.ts` | ~2 lines | Import path: `processor` → `stream` | 3 |
| `tasks/compaction.ts` | ~30 | Use TurnRunner | 3 |
| `test/.../persister.test.ts` | ~20 | Updated assertions | 2 |

### Deleted Files
| File | Lines | Reason | Phase |
|------|-------|--------|-------|
| `processor.ts` | 191 | Replaced by stream.ts + TurnRunner | 3 |

### Unchanged Files
| File | Reason |
|------|--------|
| `engine/events.ts` | Event types still valid |
| `engine/pipeline.ts` | Pre-processing pipeline is independent |
| `engine/streaming-tool-executor.ts` | Monitoring layer is independent |
| `engine/loop-detection.ts` | Detection logic is independent |

### Net Impact
~850 lines added, ~540 lines removed. Architecture is fundamentally cleaner with no behavioral regressions.

---

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Reactor becomes God object | Medium | Handler methods are scoped to single event types. Shared state (TurnContext) is the legitimate reason for encapsulation. |
| Retry timing changes slightly | Low | Retry sleep moves from inside `handleEvent()` to the orchestrator loop. Behavioral effect is identical — sleep happens between events. |
| processor.ts consumers missed | Low | `grep -r "SessionProcessor" --include="*.ts"` — only compaction.ts uses `create()`. `streamGenerator()` is used by query.ts and stays. |
| Loop recovery state split | Medium | Loop detection count and pending recovery stay in reactor. No split — reactor owns the full state machine. |
| Compaction path regression | Medium | TurnRunner is tested against the same scenarios. Manual compaction testing required. |

---

## Verification Plan

### Per-Phase
- **Phase 0**: `bun typecheck`, `bun test test/session/engine/error-classifier.test.ts`
- **Phase 1**: `bun typecheck`, `bun test test/session/engine/reactor.test.ts`, manual abort test
- **Phase 2**: `bun typecheck`, `bun test test/session/engine/persister.test.ts`, existing abort test still passes
- **Phase 3**: `bun typecheck`, `bun test test/session/`, manual compaction test
- **Phase 4**: Full `bun typecheck`, scoped `bun test test/session/engine/`

### Manual Verification Matrix
| Scenario | Expected |
|----------|----------|
| Normal completion | `step-finish` with `reason: "stop"` |
| Abort mid-reasoning | Reasoning text persisted, `step-finish` with `reason: "abort"` |
| Abort mid-tool | Tool marked `"error"`, `step-finish` with `reason: "abort"` |
| Rate limit (retryable) | Status shows retry countdown, session resumes |
| Context overflow | Compaction triggered automatically |
| Loop detection | Corrective message injected, session continues |
| Compaction summary | Summary generated, buffer reset |

---

## Execution Order

```
PR #1          PR #2          PR #3          PR #4          PR #5
Phase 0  ─→  Phase 1  ─→  Phase 2  ─→  Phase 3  ─→  Phase 4
 types      reactor      persister     stream.ts      polish
 classifier              simplified    turn-runner
                                       processor ✗
```

Each phase ships as a **separate PR** for incremental review:

| PR | Phase | Branch Name | Scope |
|----|-------|-------------|-------|
| 1 | Phase 0 | `engine/foundation-types` | Additive only — new types + classifier. Zero behavioral change. |
| 2 | Phase 1 | `engine/reactor` | EngineReactor + loop.ts simplification. Major structural change. |
| 3 | Phase 2 | `engine/persister-simplify` | Persister stripped to pure writer. |
| 4 | Phase 3 | `engine/retire-processor` | stream.ts extraction, TurnRunner, processor.ts deletion. |
| 5 | Phase 4 | `engine/polish` | Explicit-else audit, single-return audit, integration tests. |

Each phase is independently deployable and testable. Rollback is safe at any phase boundary.
