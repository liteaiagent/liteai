# Task Guide: Side-Effects & Polish (Phase 5–7)

**Parent**: [tasks.md](file:///d:/liteai/specs/009-engine-loop-decoupling/tasks.md)

## T013 — Remove `Bus.publish` from `query.ts`

**File**: `packages/core/src/session/engine/query.ts` — model resolution error (line ~169)

### Current behavior (lines 161-178):
```typescript
const model = await Provider.getModel(...).catch((e) => {
  log.error("model resolution failed", { ... })
  if (Provider.ModelNotFoundError.isInstance(e)) {
    Bus.publish(Session.Event.Error, {    // ← SIDE EFFECT IN GENERATOR
      sessionID,
      error: new NamedError.Unknown({ message: `Model not found: ...` }).toObject(),
    }).catch(...)
  }
  return e as Error
})
```

### New behavior — remove Bus.publish, keep error propagation:
```typescript
const model = await Provider.getModel(...).catch((e) => {
  log.error("model resolution failed", { ... })
  return e as Error
})
```

The generator already yields `{ type: "error", kind: "stream", error: model }` on line 182-188. The orchestrator (`runSessionInner`) handles this in the pre-turn error block (line 720-727). Error notification to the client is now the orchestrator's responsibility — it gets the error via `SessionResult.error` and the caller (`loop()`) publishes the notification.

### Add error notification in `loop()` (after T010's SessionResult switch):
```typescript
case "error": {
  // Publish error notification to client — moved FROM query.ts generator
  if (result.error) {
    const errorObj = result.error instanceof Error
      ? new NamedError.Unknown({ message: result.error.message }).toObject()
      : result.error
    await Bus.publish(Session.Event.Error, { sessionID, error: errorObj })
  }
  // ... existing reject/throw logic from T010 ...
}
```

### Also remove unused imports from query.ts:
```diff
-import { Bus } from "../../bus"
```
(Verify no other Bus usage remains in query.ts first — `Bus` is only used at line 169.)

### FR validation:
- **FR-009**: Generator does NOT publish Bus events ✅
- **FR-012**: Bus publish is tracked (not fire-and-forget) ✅

---

## T014 — Remove `Bus.publish` from `persister.ts`

**File**: `packages/core/src/session/engine/persister.ts` — error handlers (lines 393, 409)

### Current behavior (lines 390-411):
```typescript
} catch (e: unknown) {
  // ...
  const error = Message.fromError(e, { providerID: model.providerID })
  if (Message.ContextOverflowError.isInstance(error)) {
    this.needsCompaction = true
    Bus.publish(Session.Event.Error, { sessionID, error })      // ← LINE 393
  } else {
    // ...
    assistantMessage.error = error
    Bus.publish(Session.Event.Error, { sessionID, error: assistantMessage.error })  // ← LINE 409
  }
}
```

### New behavior — remove both Bus.publish calls:

**Line 393** (context overflow):
```diff
  if (Message.ContextOverflowError.isInstance(error)) {
    this.needsCompaction = true
-   Bus.publish(Session.Event.Error, { sessionID, error })
  }
```
The overflow triggers `return "compact"` on line 383, which the orchestrator handles. No error notification needed — compaction is a recovery mechanism, not a user-facing error.

**Line 409** (fatal error):
```diff
    assistantMessage.error = error
-   Bus.publish(Session.Event.Error, { sessionID, error: assistantMessage.error })
```
The error is stored on `assistantMessage.error`. The orchestrator reads it via `SessionResult.error` (from T010) and publishes the notification. This was already a duplicate — the error is surfaced through the result chain.

### Remove unused import:
```diff
-import { Bus } from "@/bus"
```
(Verify no other Bus usage in persister.ts — it's only used at lines 393 and 409.)

### FR validation:
- **FR-009**: Persister does NOT publish Bus events ✅
- **FR-013**: Event classification (persister) separated from notification (orchestrator) ✅

---

## T015 — Wire `PromiseTracker` into loop cleanup

**File**: `packages/core/src/session/engine/loop.ts`

### Changes in `runSessionInner()`:

1. **Track checkpointer writes** — wrap all `checkpointer.write(ops)` calls with tracker:
   ```diff
   -  await input.checkpointer.write(flushOps)
   +  tracker.track(input.checkpointer.write(flushOps))
   ```
   Apply to both write sites (turn-end flush at line ~456, and stream event drain at line ~734).

2. **Track Bus publishes from orchestrator** — if T013 added Bus.publish in loop(), track it:
   ```diff
   -  await Bus.publish(Session.Event.Error, { sessionID, error: errorObj })
   +  tracker.track(Bus.publish(Session.Event.Error, { sessionID, error: errorObj }))
   ```

3. **Add `tracker.flush()` to cleanup** — at end of `runSessionInner()`, before returning:
   ```typescript
   // After the for-await loop and post-loop cleanup, before returning SessionResult:
   try {
     await tracker.flush()
   } catch (flushError) {
     log.error("runSessionInner: tracked promise failures during cleanup", {
       sessionID,
       error: flushError,
     })
     // Don't override the session result — just log. The errors were already
     // tracked individually (e.g., DB write failures). AggregateError surfaces all.
   }
   ```

### FR validation:
- **FR-011**: All async work tracked via PromiseTracker ✅
- **FR-012**: No `Database.effect()` fire-and-forget Bus publishes ✅
- **SC-004**: After cleanup, zero tracked promises remain pending ✅

---

## T016 — Deprecate/remove `AsyncPersistenceWriter`

**File**: `packages/core/src/session/engine/persistence-writer.ts`

After T009 replaced all `dbWriter.write(ops)` calls with `checkpointer.write(ops)`, the `AsyncPersistenceWriter` class is no longer used.

### Steps:
1. **Verify no remaining usages**:
   ```bash
   # Search for AsyncPersistenceWriter references
   grep -r "AsyncPersistenceWriter" packages/core/src/
   ```
   Expected: only the class definition and the old import in loop.ts (which T009 already removed).

2. **Remove the class** from `persistence-writer.ts`:
   - Keep the `PersistenceOp` type (it's still used by `EventPersister` and `Checkpointer`)
   - Delete the `AsyncPersistenceWriter` class and its imports (`Session`)
   - Update the file docstring

3. **Final `persistence-writer.ts`**:
   ```typescript
   import type { Message } from "../message"
   import type { MessageID, PartID, SessionID } from "../schema"

   /**
    * Discriminated union representing a deferred database write operation.
    * ...existing docstring...
    */
   export type PersistenceOp =
     | { type: "upsert-part"; part: Message.Part }
     | { type: "delta-part"; sessionID: SessionID; messageID: MessageID; partID: PartID; field: string; delta: string }
     | { type: "upsert-message"; message: Message.Assistant }
   ```

4. **Remove import from loop.ts** (if not already done in T009):
   ```diff
   -import { AsyncPersistenceWriter } from "./persistence-writer"
   ```

---

## T017 — Update `persister.test.ts` for Bus.publish removal

**File**: `packages/core/test/session/engine/persister.test.ts`

### Changes:
1. **Remove Bus mock** — the persister no longer calls `Bus.publish`:
   ```diff
   -mock.module("../../bus", () => ({
   -  Bus: { publish: mock() },
   -}))
   ```

2. **Add test verifying no Bus dependency**:
   ```typescript
   test("persister does not call Bus.publish on error", () => {
     // ... create persister with abort, model, etc (existing setup) ...
     // Feed a stream error event
     const res = persister.handleEvent({
       type: "error",
       kind: "stream",
       error: new Error("test fatal"),
       isAbortError: false,
     })
     // Error should be stored on assistantMessage, NOT published
     expect(assistantMessage.error).toBeDefined()
     // No Bus.publish mock needed — if persister tried to call it, it would throw
   })
   ```

---

## T018 — Run verification suite

**Commands** (from `packages/core/`):

```bash
# New tests
bun test test/session/engine/checkpointer.test.ts
bun test test/session/engine/promise-tracker.test.ts

# Modified tests
bun test test/session/engine/persister.test.ts

# Existing regression tests
bun test test/session/engine/pipeline.test.ts

# Type checking
bun typecheck
```

### Success criteria validation:
- **SC-001**: MemoryCheckpointer tests pass — zero DB file operations ✅
- **SC-003**: Existing tests pass without modification (except persister.test.ts Bus mock removal) ✅
- **SC-006**: `grep -r "Session\.updateMessage\|Session\.updatePart" packages/core/src/session/engine/loop.ts` returns zero matches ✅

---

## T019 — Run lint:fix

```bash
bun lint:fix
```

Ensure all new/modified files pass formatting compliance.
