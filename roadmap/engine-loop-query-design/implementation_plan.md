# Engine Error Pipeline Refactoring

Extract error classification from `EventPersister.handleEvent()` into the orchestrator layer, eliminating the `throw`-self-`catch` anti-pattern that caused the abort data loss bug.

## Background & Root Cause

The abort data loss bug (reasoning tokens not persisted on abort) was caused by a control flow anti-pattern in `persister.ts`:

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
  // classifies: AbortError → "stop", Overflow → compact, Retryable → sleep+continue, Fatal → set error
}
```

This self-throw pattern means:
1. Error classification is embedded inside a DB writer class (SRP violation)
2. Retry logic with `await SessionRetry.sleep()` runs inside the persister (blocking the persistence layer)
3. The `throwIfAborted()` guard at the top of `handleEvent()` cannot be selectively bypassed without fragile type-checks — which is exactly what caused the abort data loss when `turn-end` events were swallowed

## User Review Required

> [!IMPORTANT]
> **`processor.ts` Legacy Path**: `SessionProcessor.create()` (used by `compaction.ts`) also consumes `EventPersister.handleEvent()` return values inside its own `while(true)` loop. The refactoring must maintain backward compatibility here. The plan proposes adapting `processor.ts` to use the new classifier inline. 
> 
> **Please confirm** this is acceptable, or if you prefer to also refactor `processor.ts` to use the generator-based architecture (larger scope change that would be a separate task).

> [!WARNING]
> **Retry sleep relocation**: Currently, retry sleep (`SessionRetry.sleep(delay, this.abort)`) runs inside persister. Moving it to `loop.ts` means the retry delay now runs inside the `for await` loop of `runSessionInner`. This is architecturally correct (retry is orchestration, not persistence) but changes the timing slightly — the sleep now happens between the `handleEvent` return and the next generator pull, rather than inside `handleEvent` itself. The behavioral effect is identical.

## Proposed Changes

### Error Classification Utility

#### [NEW] [error-classifier.ts](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/session/engine/error-classifier.ts)

Pure, stateless utility that classifies a raw stream error into an orchestration action. Zero side effects — no DB writes, no Bus publishes, no status updates.

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

Logic extracted verbatim from `persister.ts` lines 328–354:
- `AbortError` → `{ action: "stop", reason: "abort" }`
- `ContextOverflowError` → `{ action: "compact" }`
- `SessionRetry.retryable()` → `{ action: "retry", message, delay, attempt }`
- Fallthrough → `{ action: "stop", reason: "fatal", error }`

---

### EventPersister Simplification

#### [MODIFY] [persister.ts](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/session/engine/persister.ts)

**Removals (~45 lines):**
- Delete the entire `catch (e: unknown)` block (lines 328–355)
- Delete `throw event.error` in the `"error"/"stream"` case (line 317)
- Remove imports: `SessionRetry`, `SessionStatus`, `Bus`, `Session.Event.Error`

**Additions:**
- New private field: `private _streamError: unknown`
- New public getter: `get streamError(): unknown`
- In `case "error"` / `kind === "stream"`: store the error instead of throwing: `this._streamError = event.error`
- `handleEvent()` return type simplifies to `"compact" | undefined` (only returns `"compact"` when `needsCompaction` is true at line 327)

**No changes to:**
- `flush()` — stays exactly as-is (returns `"compact" | "stop" | "continue"`)
- Part accumulation logic (start/delta/end/call/result)
- `throwIfAborted()` guard — can be reverted to the unconditional form since stream errors no longer re-throw. The `turn-end` / `error` bypass we added earlier becomes unnecessary.

---

### Orchestrator Error Handling

#### [MODIFY] [loop.ts](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/session/engine/loop.ts)

**In the `default:` case (line 645-657), after `persister.handleEvent(event)`:**

Add error classification block:

```typescript
default: {
  if (persister) {
    const action = await persister.handleEvent(event)
    if (action === "compact") {
      // persister detected overflow during normal event processing
      // (e.g. step-end with overflow tokens)
      break // will be handled by flush → "compact" path
    }

    // Check if a stream error was captured during event processing
    const streamError = persister.streamError
    if (streamError) {
      const classification = SessionErrorClassifier.classify({
        error: streamError,
        providerID: persister.model.providerID,
        attempt: persister.attempt,
      })

      switch (classification.action) {
        case "stop":
          if (classification.reason === "abort") {
            log.info("runSession: stream aborted", { sessionID })
          } else {
            currentAssistantMessage!.error = classification.error
            Bus.publish(Session.Event.Error, { sessionID, error: classification.error })
          }
          return // exit runSessionInner

        case "compact":
          persister.needsCompaction = true
          Bus.publish(Session.Event.Error, { sessionID, error: ... })
          break

        case "retry":
          persister.attempt = classification.attempt
          SessionStatus.set(sessionID, {
            type: "retry",
            attempt: classification.attempt,
            message: classification.message,
            next: Date.now() + classification.delay,
          })
          await SessionRetry.sleep(classification.delay, abort).catch(() => {})
          break // continue to next generator pull
      }
    }
  }
  break
}
```

---

### Legacy Path Adaptation

#### [MODIFY] [processor.ts](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/session/processor.ts)

`processor.ts`'s `process()` method (lines 145–186) currently relies on `handleEvent()` returning `"stop"` / `"continue"`. With the refactoring:

- After `handleEvent()`, check `persister.streamError`
- Use `SessionErrorClassifier.classify()` inline
- Map classification results to the existing action strings the method returns

This is ~15 lines of added logic, maintaining the same external contract (`process()` still returns `"stop" | "continue" | "compact"`).

---

### Test Updates

#### [MODIFY] [persister.test.ts](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/test/session/engine/persister.test.ts)

Update the existing test: `handleEvent()` on an aborted signal no longer returns `"stop"` — instead it stores the error in `streamError`. The test should verify:
1. `persister.streamError` is set after processing a delta event on an aborted signal
2. `assistantMessage.error` remains `undefined` (persister doesn't classify anymore)

#### [NEW] [error-classifier.test.ts](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/test/session/engine/error-classifier.test.ts)

Unit tests for the pure classifier function:
- AbortError → `{ action: "stop", reason: "abort" }`
- ContextOverflowError → `{ action: "compact" }`
- Retryable APIError → `{ action: "retry", ... }` with correct delay calculation
- Fatal unknown error → `{ action: "stop", reason: "fatal", error: ... }`

## Open Questions

> [!IMPORTANT]
> **Scope of `processor.ts` refactoring**: Should we inline the classifier into `processor.ts` (minimal change, keeps it working), or should we also refactor `processor.ts` to drop its own `while(true)` loop and use the generator pattern? The latter is a larger scope item that could go on the roadmap instead.

## Verification Plan

### Automated Tests
```bash
# Run scoped tests for the affected modules
bun test test/session/engine/persister.test.ts
bun test test/session/engine/error-classifier.test.ts

# Typecheck
bun typecheck
```

### Manual Verification
1. Start a session, let it stream reasoning + text → verify normal `step-finish` with `reason: "stop"`
2. Abort mid-reasoning → verify:
   - Reasoning text is persisted (non-empty)
   - `step-finish` part has `reason: "abort"` and zero tokens
   - No crash / exit code 1
3. Trigger a retryable error (e.g., rate limit) → verify retry backoff works correctly
4. Trigger context overflow → verify compaction is triggered
