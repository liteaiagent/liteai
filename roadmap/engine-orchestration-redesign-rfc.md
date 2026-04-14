# RFC: Engine Orchestration Redesign

> **Status**: Proposed
> **Author**: @aghassan
> **Date**: 2026-04-14
> **Scope**: `packages/core/src/session/engine/` — `loop.ts`, `query.ts`, `persister.ts`, `processor.ts`, `events.ts`

---

## 1. Context & Problem Statement

The session engine is the core orchestrator for multi-turn LLM streaming in liteai. It manages event consumption, business logic (structured output, compaction, loop recovery, subtasks), and flow control across ~1,800 lines of tightly coupled code. Several structural deficiencies have created a persistent bug surface and make the codebase resistant to safe modification.

### 1.1 Root Cause: Abort Data Loss Bug

The immediate trigger for this RFC is an abort data loss bug where reasoning tokens were not persisted when a user cancelled mid-stream. The root cause is a **throw-self-catch anti-pattern** in `persister.ts`:

```
// persister.ts handleEvent() — the problematic pattern
case "error":
  if (event.kind === "stream") {
    throw event.error          // ← re-throws into own catch block
  }
  break;
}
// ...
} catch (e: unknown) {
  // catches the re-thrown error from 9 lines above
  // classifies: AbortError → "stop", Overflow → compact, Retryable → sleep+continue
}
```

This pattern causes:
1. Error classification embedded inside a DB writer class (SRP violation)
2. Retry logic with `await SessionRetry.sleep()` blocking the persistence layer
3. The `throwIfAborted()` guard cannot be selectively bypassed without fragile type-checks — directly causing the abort data loss when `turn-end` events are swallowed

### 1.2 Structural Problems

| Problem | Location | Impact |
|---------|----------|--------|
| **Monolithic switch/case** | `loop.ts` (1,100 lines) | Three interleaved concerns: event consumption, business logic, flow control. `break` vs `return` confusion. |
| **Conflated responsibilities** | `persister.ts` (465 lines) | Mixes DB writing with error classification and retry orchestration (includes `await sleep()` in a DB writer). |
| **Duplicated orchestration** | `processor.ts` (191 lines) | 80% duplication with `loop.ts` for single-turn compaction. Fixes don't propagate — persistent bug surface. |
| **Stringly-typed returns** | `persister.handleEvent()` | Returns `"stop" | "continue" | "compact" | undefined"` — magic strings with no payload. |

### 1.3 What Works Well (Preserved)

- **`query.ts`** as a pure async generator — clean event protocol, zero DB writes. **No structural changes needed.**
- **`events.ts`** discriminated union — type-safe and extensible. **Minimal changes.**
- **`persister.ts`** part accumulation and `flush()` logic — solid when restricted to persistence.
- The overall **Producer-Consumer** pattern through async generators — fundamentally sound.

---

## 2. Decision Drivers

1. **Safety**: Eliminate the class of bugs caused by the throw-self-catch anti-pattern
2. **Single Responsibility**: Each module does exactly one thing
3. **Type Safety**: Replace magic strings with typed discriminated unions
4. **Extensibility**: Adding new event types requires only a new handler, not modifying existing logic
5. **Testability**: Pure functions (classifier), focused classes (reactor), clear boundaries
6. **Zero Duplication**: Retire the `processor.ts` shadow copy of orchestration logic

---

## 3. Evaluated Design Alternatives

### Option A: In-place Refactoring

Refactor `loop.ts` switch/case to extract helper functions. Keep the same control flow structure.

- **Pros**: Smallest diff, lowest risk
- **Cons**: Does not address SRP violations. Persister still owns error classification. Magic strings remain. `processor.ts` duplication persists.

### Option B: Reactor Pattern (Selected)

Introduce an `EngineReactor` class with named dispatch handlers, extract error classification into a pure Strategy function, and unify single-turn execution through a `TurnRunner`.

- **Pros**: Full SRP decomposition. Typed actions. Extensible handler registration. Eliminates throw-self-catch. Retires `processor.ts`.
- **Cons**: Larger diff (~850 added, ~540 removed). Risk of reactor becoming a God object (mitigated by handler scoping).

### Option C: Effect-based Pipeline

Model the entire engine as an Effect pipeline with typed errors and retries as Effect combinators.

- **Pros**: Maximal type safety. Retry/abort as first-class effects.
- **Cons**: Requires rewriting `query.ts` generator protocol. Very large scope. Effect patterns may conflict with the existing async generator model.

### Decision

**Option B (Reactor Pattern)** — it directly addresses all decision drivers with a manageable scope. The async generator protocol in `query.ts` is preserved unchanged. Each phase ships independently and is rollback-safe.

---

## 4. Architecture

### 4.1 Current Architecture

```
queryLoop (query.ts)
  ↓ yields EngineEvent.Any
runSessionInner (loop.ts)  ← 1100 lines, massive switch/case
  ↓ routes to
EventPersister (persister.ts)  ← also classifies errors, retries with sleep
  ↓
SQLite
```

### 4.2 Target Architecture

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

### 4.3 Data Flow

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

### 4.4 Module Layering (Post-Redesign)

```
stream.ts      → SDK → EngineEvent  (adapter)
query.ts       → uses stream.ts     (multi-turn producer)
turn-runner.ts → uses stream.ts     (single-turn producer)
reactor.ts     → consumes events    (consumer)
```

---

## 5. Design Patterns

| Pattern | Applied To | Rationale |
|---------|-----------|-----------|
| **Reactor** | `EngineReactor` class | Named dispatch table mapping event types to handler methods. Replaces the 300-line switch/case. |
| **Producer-Consumer** | `queryLoop` → `EngineReactor` | Async generator produces typed events; reactor consumes through `for await`. Clean decoupling via async channel. |
| **Strategy** | `SessionErrorClassifier` | Pure, injectable function that classifies raw errors into orchestration actions. Zero side effects. |
| **State Machine** | `TurnContext` lifecycle | Explicit turn state transitions: `idle → streaming → flushing → (retrying|stopped|continuing)`. |
| **Single Responsibility** | All modules | Persister persists. Classifier classifies. Reactor orchestrates. Producer produces. |
| **Open-Closed** | Handler registration | Adding new event types requires only adding a new handler method — existing handlers don't change. |

---

## 6. Core Types

### 6.1 `EngineAction` — Typed Orchestration Result

Replaces all stringly-typed returns (`"stop" | "continue" | "compact"`).

```typescript
export type EngineAction =
  | { type: "continue" }
  | { type: "stop"; reason: "abort" | "fatal" | "blocked" | "complete" }
  | { type: "compact"; lastUser: Message.User }
  | { type: "retry"; attempt: number; delay: number; message: string }
```

### 6.2 `TurnContext` — Per-Turn State Machine Node

```typescript
export type TurnContext = {
  persister: EventPersister
  assistantMessage: Message.Assistant
  model: Provider.Model
  streamResult?: unknown
}
```

### 6.3 `SessionErrorClassifier.Classification`

```typescript
export namespace SessionErrorClassifier {
  export type Classification =
    | { action: "stop"; reason: "abort" }
    | { action: "stop"; reason: "fatal"; error: ReturnType<NamedError["toObject"]> }
    | { action: "compact" }
    | { action: "retry"; message: string; delay: number; attempt: number }

  export function classify(input: {
    error: unknown
    providerID: string
    attempt: number
  }): Classification
}
```

Classification logic (extracted verbatim from `persister.ts` lines 328–354):
- `AbortError` → `{ action: "stop", reason: "abort" }`
- `ContextOverflowError` → `{ action: "compact" }`
- `SessionRetry.retryable()` → `{ action: "retry", message, delay, attempt }`
- Fallthrough → `{ action: "stop", reason: "fatal", error }`

---

## 7. Code Discipline Rules

These rules apply to every handler method in the reactor and are enforced during the Phase 4 audit.

### 7.1 Explicit Else

Every `if` must have an `else`. Every `switch` must have a `default`. No implicit fallthroughs.

```typescript
// ❌ Implicit
if (event.kind === "reasoning") { handle() }

// ✅ Explicit
if (event.kind === "reasoning") {
  handle()
} else {
  // no-op: other event kinds handled elsewhere
}
```

### 7.2 Single Return Point Per Handler

One `let result` at the top, one `return result` at the bottom. No early returns.

```typescript
async handleFoo(event): Promise<EngineAction> {
  let result: EngineAction = { type: "continue" }
  // ... logic mutates `result` ...
  return result  // single exit
}
```

### 7.3 Named Handler Functions

Each event type maps to a named method returning a typed `EngineAction`. The orchestrator dispatches uniformly:

```typescript
async dispatch(event): Promise<EngineAction> {
  switch (event.type) {
    case "turn-start":  return this.handleTurnStart(event)
    case "turn-end":    return this.handleTurnEnd(event)
    case "control":     return this.handleControl(event)
    default:            return this.handleStreamEvent(event)
  }
}
```

### 7.4 Exhaustive Type Checking

TypeScript's `never` type ensures all action variants are handled:

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

---

## 8. Key Design Decisions

### 8.1 `throwIfAborted()` Removed from Persister

Abort detection belongs in the orchestration layer (reactor), not the data layer (persister). With the error path now storing instead of throwing, events can flow through the persister normally during teardown — this is exactly what enables partial data persistence and fixes the abort data loss bug.

### 8.2 `flush()` Return Type Preserved

`flush()` returning `"compact" | "stop" | "continue"` stays — it's a clean terminal checkpoint that already works correctly.

### 8.3 `processor.ts` Retired, Not Adapted

Rather than adapting `processor.ts` to use the new classifier inline (minimal change), we retire it entirely. Only `compaction.ts` consumed `SessionProcessor.create()`. A lightweight `TurnRunner` replaces it, reusing `stream.ts` and `SessionErrorClassifier` — zero duplication.

### 8.4 Retry Sleep Relocation

Retry sleep moves from inside `persister.handleEvent()` to the orchestrator loop (`loop.ts`). The sleep now happens between the `handleEvent` return and the next generator pull, rather than inside `handleEvent` itself. The behavioral effect is identical.

---

## 9. Implementation Phases

Each phase ships as a **separate PR** for incremental review. Each is independently deployable and rollback-safe.

```
PR #1          PR #2          PR #3          PR #4          PR #5
Phase 0  ─→  Phase 1  ─→  Phase 2  ─→  Phase 3  ─→  Phase 4
 types      reactor      persister     stream.ts      polish
 classifier              simplified    turn-runner
                                       processor ✗
```

### Phase 0: Foundation (Types & Error Classifier)

**Branch**: `engine/foundation-types`
**Goal**: Introduce the new type system and error classifier without any behavioral changes. Additive only.

| Action | File | Lines |
|--------|------|-------|
| NEW | `engine/engine-types.ts` | ~30 |
| NEW | `engine/error-classifier.ts` | ~70 |
| NEW | `test/session/engine/error-classifier.test.ts` | ~100 |

- `EngineAction` discriminated union (4 variants)
- `TurnContext` interface
- `SessionErrorClassifier.classify()` — logic extracted verbatim from `persister.ts`
- Unit tests: AbortError, ContextOverflowError, retryable APIError, fatal unknown error

**Validation**: `bun typecheck`, unit tests pass. Zero behavioral change.

### Phase 1: EngineReactor

**Branch**: `engine/reactor`
**Goal**: Introduce the Reactor class with named handlers. Wire into `loop.ts`.

| Action | File | Est. Lines |
|--------|------|------------|
| NEW | `engine/reactor.ts` | ~400 |
| MODIFY | `engine/loop.ts` | −300, +50 |
| NEW | `test/session/engine/reactor.test.ts` | ~150 |

Key handlers:
- `handleTurnStart()` — creates TurnContext, persists assistant message, fires title summarization
- `handleStreamEvent()` — delegates to persister, captures stream errors without classification
- `handleTurnEnd()` — the critical integration point: classifies captured errors, flushes persister, handles loop recovery, structured output, maps flush result to `EngineAction`
- `handleControl()` — dispatches subtask, compaction, loop recovery

`runSessionInner` reduces from ~300 lines to ~50 lines of pure dispatch.

**Validation**: `bun typecheck`, reactor tests, manual abort/retry/compaction testing.

### Phase 2: Persister Simplification

**Branch**: `engine/persister-simplify`
**Goal**: Strip error classification and retry logic from `EventPersister`. Make it a pure DB writer.

| Action | File | Delta |
|--------|------|-------|
| MODIFY | `engine/persister.ts` | −50 lines |
| MODIFY | `test/session/engine/persister.test.ts` | update assertions |

Removals:
- Delete entire `catch (e: unknown)` block (lines 328–355)
- Delete `throw event.error` in the `"error"`/`"stream"` case (line 317)
- Remove imports: `SessionRetry`, `SessionStatus`, `Bus`, `Session.Event.Error`

Additions:
- `private _streamError: unknown` + `get streamError(): unknown`
- Stream errors are stored, not thrown: `this._streamError = event.error`
- `handleEvent()` return type simplifies to `"compact" | undefined`
- `throwIfAborted()` removed entirely — abort detection belongs in the reactor

**Validation**: `bun typecheck`, persister tests, existing abort test still passes.

### Phase 3: Processor Retirement + TurnRunner + stream.ts

**Branch**: `engine/retire-processor`
**Goal**: Eliminate `processor.ts` by creating a lightweight `TurnRunner` and extracting `streamGenerator()`.

| Action | File | Lines |
|--------|------|-------|
| NEW | `engine/stream.ts` | ~120 (extracted from processor.ts) |
| NEW | `engine/turn-runner.ts` | ~80 |
| MODIFY | `engine/query.ts` | ~2 lines (import path change) |
| MODIFY | `tasks/compaction.ts` | ~30 lines changed |
| DELETE | `processor.ts` | 191 lines removed |

- `stream.ts` — pure adapter converting Vercel AI SDK `fullStream` into `EngineEvent.Any` protocol
- `turn-runner.ts` — minimal single-turn executor: stream → persist → flush, using classifier for errors
- `compaction.ts` migrated from `SessionProcessor.create()` to `runSingleTurn()`
- `processor.ts` deleted after migration verified

**Validation**: `bun typecheck`, `bun test test/session/`, manual compaction test.

### Phase 4: Polish & Hardening

**Branch**: `engine/polish`
**Goal**: Apply code discipline rules across all reactor handlers. Add integration tests.

- Explicit else audit (every `if` → `else`, every `switch` → `default`)
- Single return point audit (no early returns in handlers)
- Exhaustive type checking with `never`
- Logging alignment: reactor → `session.engine`, persister → `session.persister`, classifier → `session.error-classifier`
- Integration tests in `test/session/engine/reactor.test.ts`

**Validation**: Full `bun typecheck`, scoped `bun test test/session/engine/`.

---

## 10. File Inventory

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

~850 lines added, ~540 removed. Architecture is fundamentally cleaner with no behavioral regressions.

---

## 11. Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Reactor becomes God object | Medium | Handler methods are scoped to single event types. Shared state (TurnContext) is the legitimate reason for encapsulation. |
| Retry timing changes slightly | Low | Retry sleep moves from inside `handleEvent()` to the orchestrator loop. Behavioral effect is identical — sleep happens between events. |
| `processor.ts` consumers missed | Low | `grep -r "SessionProcessor" --include="*.ts"` — only `compaction.ts` uses `create()`. `streamGenerator()` is extracted. |
| Loop recovery state split | Medium | Loop detection count and pending recovery stay in reactor. No split — reactor owns the full state machine. |
| Compaction path regression | Medium | TurnRunner is tested against the same scenarios. Manual compaction testing required. |

---

## 12. Verification Plan

### Per-Phase Automated Tests

| Phase | Command | Scope |
|-------|---------|-------|
| 0 | `bun typecheck && bun test test/session/engine/error-classifier.test.ts` | Types + classifier |
| 1 | `bun typecheck && bun test test/session/engine/reactor.test.ts` | Reactor + loop |
| 2 | `bun typecheck && bun test test/session/engine/persister.test.ts` | Persister |
| 3 | `bun typecheck && bun test test/session/` | All session tests |
| 4 | `bun typecheck && bun test test/session/engine/` | Full engine suite |

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

## 13. References

- Source design documents: `roadmap/engine-loop-query-design/`
  - `plan.md` — Full phased plan with code examples
  - `iron-design.md` — Finalized design decisions
  - `implementation_plan.md` — Error pipeline refactoring detail
