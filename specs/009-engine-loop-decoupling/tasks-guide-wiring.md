# Task Guide: Wire Checkpointer into Loop (Phase 3–4)

**Parent**: [tasks.md](file:///d:/liteai/specs/009-engine-loop-decoupling/tasks.md)

## T009 — Add `checkpointer` parameter to `runSessionInner()`

**File**: `packages/core/src/session/engine/loop.ts` — `runSessionInner()` function (line ~369)

### Step-by-step changes:

1. **Update function signature** — add `checkpointer: Checkpointer` to the input type:
   ```typescript
   async function runSessionInner(input: {
     sessionID: SessionID
     session: Session.Info
     abort: AbortSignal
     registry: BackgroundTaskRegistry
     /** Persistence interface. Pass `NoopCheckpointer` for ephemeral sessions (FR-015). */
     checkpointer: Checkpointer  // NEW
   })
   ```

2. **Replace initial buffer load** (line 398-400):
   ```diff
   -  current: await Message.filterCompacted(Message.stream(sessionID)),
   +  current: await input.checkpointer.loadHistory(sessionID),
   ```

3. **Replace `Session.updateMessage(event.assistantMessage)`** at turn-start (line 417):
   ```diff
   -  currentAssistantMessage = (await Session.updateMessage(event.assistantMessage)) as Message.Assistant
   +  currentAssistantMessage = (await input.checkpointer.saveMessage(event.assistantMessage)) as Message.Assistant
   ```

4. **Replace `dbWriter.write(ops)` calls** (lines 456, 734) — two sites:
   ```diff
   -  await dbWriter.write(flushOps)
   +  await input.checkpointer.write(flushOps)
   ```

5. **Replace `Session.updateMessage(currentAssistantMessage)` at structured output** (line 507):
   ```diff
   -  await Session.updateMessage(currentAssistantMessage)
   +  await input.checkpointer.updateMessage(currentAssistantMessage)
   ```

6. **Replace `Session.updateMessage(currentAssistantMessage)` at structured output error** (line 524):
   ```diff
   -  await Session.updateMessage(currentAssistantMessage)
   +  await input.checkpointer.updateMessage(currentAssistantMessage)
   ```

7. **Remove `AsyncPersistenceWriter` instantiation** (line 393):
   ```diff
   -  const dbWriter = new AsyncPersistenceWriter()
   ```
   The `checkpointer.write(ops)` now replaces all `dbWriter.write(ops)` calls.

8. **Create `PromiseTracker` instance** at the top of `runSessionInner`:
   ```typescript
   const tracker = new PromiseTracker()
   ```
   For now, just instantiate — wiring comes in Phase 5 (T015).

### Files to import:
```typescript
import type { Checkpointer } from "./checkpointer"
import { PromiseTracker } from "./promise-tracker"
```

### What NOT to change yet:
- `processSubtask()` DB calls — that's T011
- `stripIncompleteThinking()` DB reads — that's T012
- `Bus.publish` calls — that's Phase 5 (T013, T014)
- Telemetry DB reads (lines 326, 352) — deferred per D8

---

## T010 — Update `loop()` to consume `SessionResult`

**File**: `packages/core/src/session/engine/loop.ts` — `loop()` function (line ~783)

### Step-by-step changes:

1. **Make `runSession()` wrapper accept and pass `checkpointer`**:
   ```typescript
   async function runSession(input: {
     sessionID: SessionID
     session: Session.Info
     abort: AbortSignal
     registry: BackgroundTaskRegistry
     checkpointer: Checkpointer  // NEW
   }) {
     // ... existing telemetry span code ...
     const result = await runSessionInner(input)
     return result  // Now returns SessionResult
   }
   ```

2. **Make `runSessionInner()` return `SessionResult`** — add return statements:
   - At all existing `return` sites in `runSessionInner`, return appropriate variant:
     - Normal completion (after for-await loop ends): `return { status: "ok", message: persister.getCompletedMessage() } as SessionResult`
     - Error pre-turn (line 726): `return { status: "error", error: event.error } as SessionResult`
     - AbortError catch (line 754): `return { status: "aborted" } as SessionResult`
     - Persister "stop" (line 539): `return { status: "error", error: currentAssistantMessage?.error, message: persister?.getCompletedMessage() } as SessionResult`
     - Loop escalation max retries (line 480): `return { status: "error", error: new Error("loop escalation: max retries reached") } as SessionResult`
     - Control "stop" (line 705): `return { status: "ok", message: persister!.getCompletedMessage() } as SessionResult`

3. **Replace DB re-query in `loop()`** (lines 808-816):
   ```diff
   -  await runSession({ sessionID, session, abort, registry })
   -
   -  for await (const item of Message.stream(sessionID)) {
   -    if (item.info.role === "user") continue
   -    const queued = state()[sessionID]?.callbacks ?? []
   -    for (const q of queued) {
   -      q.resolve(item)
   -    }
   -    return item
   -  }
   -  throw new Error("Impossible")
   +  const checkpointer = new SqliteCheckpointer()
   +  const result = await runSession({ sessionID, session, abort, registry, checkpointer })
   +
   +  const queued = state()[sessionID]?.callbacks ?? []
   +  switch (result.status) {
   +    case "ok": {
   +      for (const q of queued) q.resolve(result.message)
   +      return result.message
   +    }
   +    case "error": {
   +      const err = result.error instanceof Error ? result.error : new Error(String(result.error))
   +      for (const q of queued) q.reject(err)
   +      if (result.message) return result.message
   +      throw err
   +    }
   +    case "aborted": {
   +      const abortErr = new DOMException("Session aborted", "AbortError")
   +      for (const q of queued) q.reject(abortErr)
   +      throw abortErr
   +    }
   +  }
   ```

4. **Import `SqliteCheckpointer`**:
   ```typescript
   import { SqliteCheckpointer } from "./checkpointer"
   ```

### FR validation:
- **FR-006**: `runSession` returns typed `SessionResult` — caller does NOT re-query DB ✅
- **FR-007**: `Message.stream(sessionID)` re-query eliminated ✅
- **FR-008**: `throw new Error("Impossible")` eliminated ✅

---

## T011 — Inject `checkpointer` into `processSubtask()`

**File**: `packages/core/src/session/engine/loop.ts` — `processSubtask()` function (line ~867)

### Step-by-step changes:

1. **Add `checkpointer` to function parameter**:
   ```diff
    async function processSubtask(input: {
      task: Message.SubtaskPart
      model: Provider.Model
      lastUser: Message.User
      sessionID: SessionID
      session: Session.Info
      abort: AbortSignal
      msgs: Message.WithParts[]
      telemetryTracker?: TelemetryTracker
      telemetryBatchId?: string
   +  checkpointer: Checkpointer
    })
   ```

2. **Update call site** in `runSessionInner()` control handler (line ~596):
   ```diff
    const { subtaskAssistant, syntheticUser } = await processSubtask({
      task, model, lastUser, sessionID, session, abort, msgs,
      telemetryTracker, telemetryBatchId,
   +  checkpointer: input.checkpointer,
    })
   ```

3. **Replace 8 DB write sites** in `processSubtask()`:

   | Line | Current | Replacement |
   |------|---------|-------------|
   | 889 | `Session.updateMessage({...})` (create assistant) | `input.checkpointer.saveMessage({...})` |
   | 914 | `Session.updatePart({...})` (create tool part) | `input.checkpointer.savePart({...})` |
   | 961 | `Session.updatePart({...part, state})` (update metadata) | `input.checkpointer.savePart({...part, state})` |
   | 1018 | `Session.updateMessage(assistantMessage)` (finalize) | `input.checkpointer.updateMessage(assistantMessage)` |
   | 1020 | `Session.updatePart({...part, state})` (complete tool) | `input.checkpointer.savePart({...part, state})` |
   | 1037 | `Session.updatePart({...part, state})` (error tool) | `input.checkpointer.savePart({...part, state})` |
   | 1072 | `Session.updateMessage(summaryUserMsg)` (synthetic user) | `input.checkpointer.saveMessage(summaryUserMsg)` |
   | 1073 | `Session.updatePart({...})` (synthetic text part) | `input.checkpointer.savePart({...})` |

   **Important**: The return type from `saveMessage` and `savePart` must be cast the same way as the current `Session.updateMessage/updatePart` calls. Follow the existing `as Message.Assistant` / `as Message.ToolPart` casts.

---

## T012 — Refactor `stripIncompleteThinking()` to use in-memory buffer + checkpointer

**File**: `packages/core/src/session/engine/loop.ts` — `stripIncompleteThinking()` function (line ~832)

### Current behavior (lines 832-864):
```typescript
async function stripIncompleteThinking(input: { sessionID; message }) {
  const assistantMsg = await Message.get({ sessionID, messageID: message.id })  // DB READ
  for (const part of assistantMsg.parts) {
    if (part.type === "reasoning" && !part.time?.end && !part.metadata?.thoughtSignature) {
      await Session.removePart({ sessionID, messageID, partID: part.id })       // DB WRITE
    }
  }
}
```

### New behavior:
```typescript
async function stripIncompleteThinking(input: {
  sessionID: SessionID
  message: Message.Assistant
  msgsBuffer: { current: Message.WithParts[] }  // NEW — use buffer instead of DB
  checkpointer: Checkpointer                     // NEW — use for deletePart
}): Promise<void> {
  const { sessionID, message, msgsBuffer, checkpointer } = input

  // Read from in-memory buffer instead of DB
  const assistantMsg = msgsBuffer.current.find(
    m => m.info.id === message.id && m.info.role === "assistant"
  )
  if (!assistantMsg) return

  for (const part of assistantMsg.parts) {
    if (part.type === "reasoning" && !part.time?.end && !part.metadata?.thoughtSignature) {
      log.info("stripIncompleteThinking: removing incomplete reasoning part", {
        sessionID, messageID: message.id, partID: part.id,
      })
      // Persist deletion through checkpointer
      await checkpointer.deletePart({ sessionID, messageID: message.id, partID: part.id })
      // Update the in-memory buffer
      assistantMsg.parts = assistantMsg.parts.filter(p => p.id !== part.id)
    }
  }
}
```

### Update call sites (2 locations):
1. **Loop recovery** (line ~469):
   ```diff
    await stripIncompleteThinking({
      sessionID,
      message: currentAssistantMessage,
   +  msgsBuffer,
   +  checkpointer: input.checkpointer,
    })
   ```

2. **Plan stop-drift correction** (line ~683):
   ```diff
    await stripIncompleteThinking({
      sessionID,
      message: currentAssistantMessage,
   +  msgsBuffer,
   +  checkpointer: input.checkpointer,
    })
   ```

### FR validation:
- **FR-005**: Forward execution no longer reads from external storage ✅
- DB read (`Message.get()`) eliminated ✅
- DB write (`Session.removePart()`) routed through checkpointer ✅
