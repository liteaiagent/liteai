# Incident Report: Session Initialization & Model Resolution Failures

> [!CAUTION]
> **SUPERSEDED** — The band-aid fixes proposed in §4 have been replaced by a proper architectural redesign in [`engine-loop-decoupling`](../engine-loop-decoupling/).
> - §4.1 Orchestrator Error Interception → [Phase 2: Self-Contained Loop](../engine-loop-decoupling/02-self-contained-loop.md) (typed `SessionResult` eliminates the "Impossible" guard entirely)
> - §4.2 Strict Promise Chaining → [Phase 3: Event Fan-Out](../engine-loop-decoupling/03-event-fan-out.md) (tracked async work replaces fire-and-forget patterns)
>
> This report remains as **historical evidence** — it was the incident that motivated the decoupling roadmap.

## 1. Executive Summary

This document details the root cause analysis, symptom reproduction, and technical breakdown of a critical failure occurring during session initialization in the `liteai` project. 

The issue manifests when the application is launched with an unconfigured or unavailable AI model (e.g., `302ai/gemini-3-pro-preview` on a fresh installation). Instead of cleanly handling the error and notifying the user, the backend orchestrator crashes internally with an `Error: Impossible` exception. This violently terminates the Server-Sent Events (SSE) streaming connection to the client Text User Interface (TUI). Consequently, the TUI is left in an unrecoverable "stuck" state where local commands (such as `/new`) fail to execute locally and are erroneously sent to the backend as standard text messages.

---

## 2. Symptoms and User Experience

1. **Initial Trigger**: The user opens the TUI and the default model (e.g., `gemini-3-pro-preview`) is selected.
2. **First Interaction**: The user types a message (e.g., "Hi") and submits.
3. **Failure State**: 
   - Two red toast notifications appear stating `Model not found: 302ai/gemini-3-pro-preview`.
   - The session halts abruptly.
   - The "processing" spinner does not render.
4. **Cascading Failure**: The user attempts to recover by typing the `/new` command (which locally resets the UI to a new session). However, the TUI does not start a new session. Instead, it passes the string `/new` as a chat message to the **existing, broken session**, causing the error toasts to duplicate.

---

## 3. Log Analysis & Technical Breakdown

### 3.1. The Sequence of Events

The failure is a multi-stage cascade across the backend's core engine, event persister, and HTTP transport layers.

**Step 1: Model Resolution Failure**
When the user sends the first message, `SessionPrompt.prompt` triggers the main async generator, `queryLoop`. The loop attempts to validate and load the selected model. Because the model is not configured, `Provider.getModel` throws a `ProviderModelNotFoundError`.

```typescript
// Location: d:\liteai\packages\core\src\session\engine\query.ts
const model = await Provider.getModel(lastUser.model.providerID, lastUser.model.modelID).catch((e) => {
    log.error("model resolution failed", { ... })
    if (Provider.ModelNotFoundError.isInstance(e)) {
        Bus.publish(Session.Event.Error, { ... })
    }
    return e as Error
})
```

**Step 2: Generator Yields Error Prematurely**
`queryLoop` correctly catches the error and yields a `BlockEvent` to the orchestrator to signal the failure.

```typescript
// Location: d:\liteai\packages\core\src\session\engine\query.ts
if (model instanceof Error) {
    yield {
        type: "error",
        kind: "stream",
        error: model,
        isAbortError: false,
    } satisfies EngineEvent.BlockEvent
    break
}
```

**Step 3: Orchestrator Ignores Error & Crashes**
The yielded error is consumed by the main orchestrator in `runSessionInner`. However, `runSessionInner` only instantiates the `EventPersister` (the component responsible for saving messages and updating session state) *after* receiving a `turn-start` event. Because the error was yielded *before* `turn-start`, `persister` is strictly `undefined`.

```typescript
// Location: d:\liteai\packages\core\src\session\engine\loop.ts
case "error":
case "finish": {
    if (persister) { // persister is UNDEFINED here
        const action = persister.handleEvent(event)
        if (action === "stop") return
    }
    break; // The error is completely ignored
}
```
Because the error is ignored, the generator loop completes without ever producing an assistant message. A final safety guard at the end of the orchestrator catches this invalid state and throws a fatal exception.

```typescript
// Location: d:\liteai\packages\core\src\session\engine\loop.ts
if (!currentAssistantMessage) {
    throw new Error("Impossible") // CRASH OCCURS HERE
}
```

**Step 4: HTTP Transport Severed**
The `Error: Impossible` exception bubbles up to the HTTP router. To prevent memory leaks, the router explicitly forces the HTTP stream to close.

```typescript
// Location: d:\liteai\packages\core\src\server\routes\session.ts
} catch (e) {
    log.error("prompt stream failed", { error: e, sessionID })
    try {
        stream.close() // TUI CONNECTION DROPPED
    } catch { /* ignore */ }
}
```

**Step 5: Client State Desynchronization**
Because the stream was closed violently, the engine never emitted the `session.idle` status event. The TUI client remains trapped in its `generating` state. When the TUI is generating, it disables or bypasses local command parsing (like `/new`), treating all subsequent keyboard inputs as raw text to be sent to the backend.

### 3.2. Unhandled Promise Rejections

Concurrent to the above sequence, the logs display multiple `CRITICAL: Unhandled Promise Rejection detected!` entries reporting `ProviderModelNotFoundError`.

This occurs because `query.ts` triggers background "fire-and-forget" tasks without strict `.catch()` chains. When `Provider.getModel` inevitably fails in these detached contexts, the rejected promises bleed into the Node.js global scope:

1. `ensureTitle()` is fired synchronously on the first turn but fails.
2. `Bus.publish(Session.Event.Error)` returns a `Promise.all()` from its subscribers. If the error bus propagation encounters a secondary failure, it results in an unhandled rejection.

```text
ERROR 2026-05-04T11:45:25 +0ms service=runtime reason=ProviderModelNotFoundError stack="ProviderModelNotFoundError... CRITICAL: Unhandled Promise Rejection detected!
```

---

## 4. Completed & Required Changes

### Phase 1: Completed Changes
We previously refactored `query.ts` to replace a hard `throw e` with a graceful `yield { type: "error" }`. 
* **Impact:** This successfully prevented the entire Node.js backend process from terminating.

### Phase 2: Pending Architectural Fixes
To resolve the `Error: Impossible` crash and TUI lockup, the following modifications must be implemented:

1. **Orchestrator Error Interception (`loop.ts`)**
   Modify the `error` event block in `runSessionInner`. If an error is received but `persister` is undefined, the orchestrator must:
   - Manually instantiate a `Message.Assistant` record in the database containing the error payload.
   - Explicitly publish a `Session.Event.Idle` event to the bus.
   - Return gracefully instead of continuing to the `!currentAssistantMessage` guard.

2. **Strict Promise Chaining (`query.ts`)**
   Audit all fire-and-forget background tasks spawned during session start (e.g., `Bus.publish`, `ensureTitle`, `SessionDescription.create`). Ensure all tasks are wrapped in isolated `.catch()` handlers that sink errors into the logger rather than the process runtime.
