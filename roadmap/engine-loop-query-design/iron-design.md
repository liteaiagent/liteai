# Engine Redesign — Design Decisions

> Finalized decisions for the engine orchestration redesign.
> Full phased plan: [plan.md](./plan.md)

---

## Design Patterns

| Pattern | Applied To | Rationale |
|---------|-----------|-----------|
| **Reactor** | `EngineReactor` class | Named dispatch table mapping event types to handler methods. Replaces the 300-line switch/case in `loop.ts`. |
| **Producer-Consumer** | `queryLoop` → `EngineReactor` | Async generator produces typed events; reactor consumes through `for await`. Clean decoupling via async channel. |
| **Strategy** | `SessionErrorClassifier` | Pure, injectable function that classifies raw errors into orchestration actions. Zero side effects. |
| **State Machine** | `TurnContext` lifecycle | Explicit turn state transitions: `idle → streaming → flushing → (retrying\|stopped\|continuing)`. |

---

## Code Discipline Rules

### 1. Explicit else
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

### 2. Single return point per handler
One `let result` at the top, one `return result` at the bottom. No early returns.

```typescript
async handleFoo(event): Promise<EngineAction> {
  let result: EngineAction = { type: "continue" }
  // ... logic mutates `result` ...
  return result  // single exit
}
```

### 3. Named handler functions
Each event type maps to a named method that returns a typed `EngineAction`. The orchestrator dispatches uniformly via a 4-way switch.

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

### 4. Exhaustive type checking
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

## Key Decisions

### `EngineAction` typed result (replaces magic strings)
```typescript
type EngineAction =
  | { type: "continue" }
  | { type: "stop"; reason: "abort" | "fatal" | "blocked" | "complete" }
  | { type: "compact"; lastUser: Message.User }
  | { type: "retry"; attempt: number; delay: number; message: string }
```

### `streamGenerator()` → `stream.ts`
The LLM SDK adapter lives in `engine/stream.ts` — consumed by both `query.ts` (multi-turn) and `turn-runner.ts` (single-turn). Clean layering:
```
stream.ts      → SDK → EngineEvent  (adapter)
query.ts       → uses stream.ts     (multi-turn producer)
turn-runner.ts → uses stream.ts     (single-turn producer)
reactor.ts     → consumes events    (consumer)
```

### `processor.ts` → retired
Replaced by `turn-runner.ts`. Only `compaction.ts` consumed `SessionProcessor.create()`.

### `flush()` return type preserved
`flush()` returning `"compact" | "stop" | "continue"` stays — it's a clean terminal checkpoint.

### `throwIfAborted()` removed from persister
Abort detection belongs in the orchestration layer (reactor), not the data layer (persister).

---

## Execution Strategy

Each phase is a **separate PR** for incremental review:

| PR | Phase | Scope |
|----|-------|-------|
| 1 | Phase 0 | Foundation types + error classifier (additive, no behavioral change) |
| 2 | Phase 1 | EngineReactor + loop.ts simplification |
| 3 | Phase 2 | Persister simplification |
| 4 | Phase 3 | Processor retirement + TurnRunner + stream.ts extraction |
| 5 | Phase 4 | Polish, explicit-else audit, integration tests |