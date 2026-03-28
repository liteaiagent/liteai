# Step Pause & Step Back — Implementation Plan

> **Status**: Todo
> **Depends on**: Trace First-Class (✅ Done)
> **Risk**: Medium — touches loop orchestration, session status, API routes, and frontend UI

---

## Goal

Add two complementary features to the agent loop:

1. **Step Pause** — Execute one LLM step at a time, pausing between iterations so the user can inspect results, inject guidance, or decide to continue.
2. **Step Back** — Revert the conversation to a prior user message boundary (snapshot + message deletion) and re-execute from that point.

Together, these create a **"debugger for agent behavior"** — pause, inspect, rewind, and re-execute.

---

## UI Overview

### Step Pause — Pause Dock

When the session is paused between steps, a new `SessionPauseDock` appears in the composer region (same pattern as `PermissionDock`):

```
┌──────────────────────────────────────────────────────────────┐
│ ⏸ Paused after step 2 · Read 3 files, wrote 1 file          │
│                                                              │
│              [Step Back]    [Continue ⏵]    [Resume All ▶]   │
└──────────────────────────────────────────────────────────────┘
│  [prompt input — user can type guidance before continuing]    │
```

- **Continue** → executes one more LLM step, pauses again
- **Resume All** → disables step mode, runs to completion
- **Step Back** → reverts to previous step boundary, re-enters paused state
- The prompt input stays active underneath — user can type additional guidance that gets injected before the next step

**Entering step mode**: A modifier on the submit action:
- Keyboard: `Ctrl+Shift+Enter` (or `Cmd+Shift+Enter` on macOS) = "Submit in step mode"
- Button: A secondary action on the send button (dropdown or toggle)

### Step Back — Return Icon on User Messages

In **normal conversation mode** (not step-pause), each user message in the timeline gets a new "return" icon button alongside the existing Fork and Revert buttons:

```
                                   Agent · GPT-5 · 2:14 PM  [↩] [⑂] [↺] [📋]
                                                              ↑    ↑    ↑    ↑
                                                         step-back fork revert copy
```

**Behavior**: Clicking the return icon on a user message:
1. If the session is busy → blocked (disabled)
2. Shows a confirmation (optional — could be instant like fork)
3. Deletes all messages **after** that user message
4. Restores file state to the snapshot **at that user message boundary**
5. **Does not re-prompt** — leaves the session idle at that point so the user can retype or modify their prompt

This differs from `revert` (which only undoes file changes without deleting messages) and `fork` (which creates a new session). Step-back is destructive but stays in the same session — it's a "go back and try again."

---

## Phase 1: Backend — `paused` Session Status

**Risk**: Low — additive schema change
**Files**: [status.ts](../../src/session/status.ts)

### 1.1 Add `paused` variant to `SessionStatus.Info`

```typescript
export const Info = z
  .union([
    z.object({ type: z.literal("idle") }),
    z.object({ type: z.literal("retry"), attempt: z.number(), message: z.string(), next: z.number() }),
    z.object({ type: z.literal("busy") }),
    z.object({ type: z.literal("paused"), step: z.number() }),  // NEW
  ])
  .meta({ ref: "SessionStatus" })
```

### 1.2 Regenerate SDK types

The `SessionStatus` type is auto-generated into `packages/liteai-sdk/js/src/gen/types.gen.ts` via the OpenAPI spec. After changing the Zod schema, regenerate with the standard codegen flow.

### 1.3 Verify

- SDK `SessionStatus` type includes `{ type: "paused"; step: number }`
- Frontend `SessionStatus` import in `@liteai-ai/sdk` includes the new variant
- Existing `idle` / `busy` / `retry` behavior unchanged

---

## Phase 2: Backend — Step Mode in the Loop

**Risk**: Medium — modifying the core loop orchestration
**Files**: [loop.ts](../../src/session/engine/loop.ts)

### 2.1 Add `stepMode` to `PromptInput`

```typescript
export const PromptInput = z.object({
  sessionID: SessionID.zod,
  // ... existing fields ...
  stepMode: z.boolean().optional(),  // NEW — execute one step at a time
})
```

### 2.2 Add step mode state to loop

The loop needs to track whether it's in step mode. This state must survive across pause/resume cycles, so store it in the session state map:

```typescript
type SessionState = Record<
  string,
  {
    abort: AbortController
    callbacks: { resolve(input: Message.WithParts): void; reject(reason?: unknown): void }[]
    stepMode?: boolean       // NEW
    pauseResolve?: () => void // NEW — resolves when user resumes
  }
>
```

### 2.3 Modify `prompt()` to pass step mode

```typescript
export const prompt = fn(PromptInput, async (input) => {
  const session = await Session.get(input.sessionID)
  await SessionRevert.cleanup(session)
  const message = await createUserMessage(input)
  await Session.touch(input.sessionID)
  if (input.noReply === true) return message
  return loop({ sessionID: input.sessionID, stepMode: input.stepMode })
})
```

### 2.4 Modify `LoopInput` and `loop()` to support pausing

```typescript
export const LoopInput = z.object({
  sessionID: SessionID.zod,
  resume_existing: z.boolean().optional(),
  stepMode: z.boolean().optional(),  // NEW
})
```

In the `loop()` function, after `Trace.record()` and before checking `result`, add the pause logic:

```typescript
// After Trace.record() call (currently around line 480):

Trace.record({ ... })

// NEW: Step-mode pause point
const sessionState = state()[sessionID]
if (sessionState?.stepMode && result !== "stop") {
  SessionStatus.set(sessionID, { type: "paused", step })
  // Wait for resume signal
  await new Promise<void>((resolve) => {
    sessionState.pauseResolve = resolve
  })
  // After resume, check if still active
  if (abort.aborted) break
  // Clear the pause resolve
  sessionState.pauseResolve = undefined
}
```

**Important**: The pause must happen **after** `Trace.record()` (so the trace panel shows the completed step) but **before** the `result` check that decides whether to `continue`, `stop`, or `compact`.

### 2.5 Initialize step mode from LoopInput

In the `loop()` function, when creating the session state in `start()`, store the step mode flag:

```typescript
export function start(sessionID: SessionID, stepMode?: boolean) {
  const s = state()
  if (s[sessionID]) { ... }
  const controller = new AbortController()
  s[sessionID] = {
    abort: controller,
    callbacks: [],
    stepMode: stepMode ?? false,  // NEW
  }
  return controller.signal
}
```

### 2.6 Verify

- Normal prompt flow (without `stepMode`) works identically to before
- With `stepMode: true`, the loop pauses after each `Trace.record()` and sets status to `paused`
- The pause is a clean await — no busy-waiting

---

## Phase 3: Backend — Resume & Step Back APIs

**Risk**: Medium — new API endpoints
**Files**: [loop.ts](../../src/session/engine/loop.ts), [session.ts](../../src/server/routes/session.ts)

### 3.1 Add `resumeStep()` function

```typescript
export function resumeStep(sessionID: SessionID, options?: { disableStepMode?: boolean }) {
  const s = state()
  const match = s[sessionID]
  if (!match) throw new Error("Session not active")
  if (!match.pauseResolve) throw new Error("Session not paused")
  
  // Optionally disable step mode for "Resume All"
  if (options?.disableStepMode) {
    match.stepMode = false
  }
  
  match.pauseResolve()
}
```

### 3.2 Add `stepBack()` function

This is the core step-back orchestration. It needs to:
1. Find the target message boundary
2. Restore the file snapshot
3. Delete messages after the boundary
4. Leave the session idle

```typescript
export const StepBackInput = z.object({
  sessionID: SessionID.zod,
  messageID: MessageID.zod,     // The user message to go back to
})

export const stepBack = fn(StepBackInput, async (input) => {
  const { sessionID, messageID } = input
  
  // If session is paused, cancel the current pause
  const s = state()
  const match = s[sessionID]
  if (match) {
    match.abort.abort()
    if (match.pauseResolve) match.pauseResolve()
    delete s[sessionID]
  }
  
  SessionStatus.set(sessionID, { type: "busy" })
  
  try {
    // 1. Find the step-start snapshot at or before this message boundary
    const msgs = await Session.messages({ sessionID })
    const targetIndex = msgs.findIndex((m) => m.info.id === messageID)
    if (targetIndex < 0) throw new Error("Message not found")
    
    // Find the snapshot to restore to.
    // Walk backwards from the target to find the last step-start snapshot
    // BEFORE the next assistant message after target
    let snapshotHash: string | undefined
    for (let i = targetIndex; i >= 0; i--) {
      for (const part of msgs[i].parts) {
        if (part.type === "step-start" && part.snapshot) {
          snapshotHash = part.snapshot
          break
        }
      }
      if (snapshotHash) break
    }
    
    // 2. Restore file state
    if (snapshotHash) {
      await Snapshot.restore(snapshotHash)
    }
    
    // 3. Delete all messages after the target user message
    for (const msg of msgs) {
      if (msg.info.id > messageID) {
        await Session.removeMessage(msg.info.id)
      }
    }
    
    // 4. Clear any revert state
    await Session.clearRevert(sessionID)
    
  } finally {
    SessionStatus.set(sessionID, { type: "idle" })
  }
})
```

> [!NOTE]
> `stepBack()` does **not** re-enter the loop. It brings the session to an idle state at the target message boundary. The user can then:
> - Send a new/modified prompt (start fresh from that point)
> - Use the same prompt with step mode

### 3.3 Add API routes

In [session.ts](../../src/server/routes/session.ts):

```typescript
// POST /session/:id/resume
app.post("/:id/resume", async (c) => {
  const sessionID = SessionID.parse(c.req.param("id"))
  const body = await c.req.json()
  SessionPrompt.resumeStep(sessionID, { disableStepMode: body?.resumeAll })
  return c.json({ ok: true })
})

// POST /session/:id/step-back
app.post("/:id/step-back", async (c) => {
  const sessionID = SessionID.parse(c.req.param("id"))
  const body = await c.req.json()
  await SessionPrompt.stepBack({ sessionID, messageID: body.messageID })
  return c.json({ ok: true })
})
```

### 3.4 Add SDK client methods

After regenerating the OpenAPI spec and SDK, the SDK should expose:
- `client.session.resume({ sessionID, resumeAll? })`
- `client.session.stepBack({ sessionID, messageID })`

### 3.5 Verify

- `resumeStep()` unblocks a paused loop, continues to next step
- `resumeStep({ disableStepMode: true })` unblocks and disables step mode
- `stepBack()` restores snapshot, deletes messages, leaves session idle
- `stepBack()` while paused properly cancels the pause first

---

## Phase 4: Frontend — Pause Dock Component

**Risk**: Low — follows existing dock patterns exactly
**Files**: `packages/liteai-app/src/pages/session/composer/`

### 4.1 Create `session-pause-dock.tsx`

New component following the [SessionPermissionDock](../../../liteai-app/src/pages/session/composer/session-permission-dock.tsx) pattern:

```tsx
import { Button } from "@liteai/ui/button"
import { DockPrompt } from "@liteai/ui/dock-prompt"
import { Icon } from "@liteai/ui/icon"
import { useLanguage } from "@/context/language"

export function SessionPauseDock(props: {
  step: number
  responding: boolean
  onContinue: () => void
  onResumeAll: () => void
  onStepBack: () => void
}) {
  const language = useLanguage()

  return (
    <DockPrompt
      kind="pause"
      header={
        <div data-slot="pause-row" data-variant="header">
          <span data-slot="pause-icon">
            <Icon name="pause" size="normal" />
          </span>
          <div data-slot="pause-header-title">
            {language.t("session.pause.title", { step: props.step })}
          </div>
        </div>
      }
      footer={
        <>
          <div />
          <div data-slot="pause-footer-actions">
            <Button
              variant="ghost"
              size="normal"
              onClick={props.onStepBack}
              disabled={props.responding || props.step <= 1}
            >
              {language.t("session.pause.stepBack")}
            </Button>
            <Button
              variant="secondary"
              size="normal"
              onClick={props.onResumeAll}
              disabled={props.responding}
            >
              {language.t("session.pause.resumeAll")}
            </Button>
            <Button
              variant="primary"
              size="normal"
              onClick={props.onContinue}
              disabled={props.responding}
            >
              {language.t("session.pause.continue")}
            </Button>
          </div>
        </>
      }
    />
  )
}
```

### 4.2 Add pause state to `SessionComposerState`

In [session-composer-state.ts](../../../liteai-app/src/pages/session/composer/session-composer-state.ts), derive the pause request from session status:

```typescript
const pauseRequest = createMemo((): { step: number } | undefined => {
  const s = status()
  if (s.type === "paused") return { step: s.step }
  return undefined
})
```

Expose `pauseRequest` from the state + update `blocked` to include paused:

```typescript
const blocked = createMemo(() => {
  const id = params.id
  if (!id) return false
  return !!permissionRequest() || !!questionRequest() || !!pauseRequest()
})
```

### 4.3 Wire pause dock into `SessionComposerRegion`

In [session-composer-region.tsx](../../../liteai-app/src/pages/session/composer/session-composer-region.tsx), add the pause dock alongside the permission and question docks:

```tsx
<Show when={props.state.pauseRequest()} keyed>
  {(request) => (
    <div>
      <SessionPauseDock
        step={request.step}
        responding={props.state.pauseResponding()}
        onContinue={() => props.state.resume()}
        onResumeAll={() => props.state.resume({ resumeAll: true })}
        onStepBack={() => props.state.stepBackFromPause()}
      />
    </div>
  )}
</Show>
```

### 4.4 Implement resume and step-back actions in composer state

```typescript
const resume = (options?: { resumeAll?: boolean }) => {
  const id = params.id
  if (!id) return
  sdk.client.session
    .resume({ sessionID: id, resumeAll: options?.resumeAll })
    .catch((err: unknown) => {
      showToast({ title: language.t("common.requestFailed"), description: ... })
    })
}

const stepBackFromPause = () => {
  const id = params.id
  if (!id) return
  const messages = sync.data.message[id] ?? []
  const lastUser = [...messages].reverse().find((m) => m.role === "user")
  if (!lastUser) return
  sdk.client.session
    .stepBack({ sessionID: id, messageID: lastUser.id })
    .catch((err: unknown) => {
      showToast({ title: language.t("common.requestFailed"), description: ... })
    })
}
```

### 4.5 Add step-mode submit

Add a modifier to the prompt input submit flow. When the user triggers step-mode submit (e.g., `Ctrl+Shift+Enter`), set `stepMode: true` on the prompt request.

This requires:
1. Detecting the `Ctrl+Shift+Enter` keybind in `PromptInput`
2. Passing `stepMode: true` through the submit handler
3. Including it in the `session.prompt()` SDK call

### 4.6 Add i18n strings

```json
{
  "session.pause.title": "Paused after step {{step}}",
  "session.pause.continue": "Continue",
  "session.pause.resumeAll": "Resume All",
  "session.pause.stepBack": "Step Back"
}
```

### 4.7 Verify

- Submitting with `Ctrl+Shift+Enter` sends prompt with `stepMode: true`
- After each LLM step, the pause dock appears
- "Continue" executes one more step and pauses again
- "Resume All" runs to completion without further pauses
- "Step Back" (when `step > 1`) reverts to previous state

---

## Phase 5: Frontend — Step Back Icon on User Messages

**Risk**: Low — extends existing `UserActions` pattern
**Files**: [message-part.tsx](../../../ui/src/components/message-part.tsx), [message-timeline.tsx](../../../liteai-app/src/pages/session/message-timeline.tsx)

### 5.1 Extend `UserActions` type

In [message-part.tsx](../../../ui/src/components/message-part.tsx):

```diff
 export type UserActions = {
   fork?: SessionAction
   revert?: SessionAction
+  stepBack?: SessionAction
 }
```

### 5.2 Add step-back icon button to `UserMessageDisplay`

In `UserMessageDisplay`, add the return icon between fork and revert (around line 847):

```tsx
<Show when={props.actions?.stepBack}>
  <Tooltip value={i18n.t("ui.message.stepBack")} placement="top" gutter={4}>
    <IconButton
      icon="return"
      size="normal"
      variant="ghost"
      disabled={!!busy()}
      onMouseDown={(e) => e.preventDefault()}
      onClick={(event) => {
        event.stopPropagation()
        run("stepBack")
      }}
      aria-label={i18n.t("ui.message.stepBack")}
    />
  </Tooltip>
</Show>
```

Update the `run` function to handle the new action:

```diff
-const run = (kind: "fork" | "revert") => {
-  const act = kind === "fork" ? props.actions?.fork : props.actions?.revert
+const run = (kind: "fork" | "revert" | "stepBack") => {
+  const act =
+    kind === "fork" ? props.actions?.fork
+    : kind === "revert" ? props.actions?.revert
+    : props.actions?.stepBack
   if (!act || busy()) return
   // ... rest unchanged
 }
```

### 5.3 Wire step-back action in `MessageTimeline`

In [message-timeline.tsx](../../../liteai-app/src/pages/session/message-timeline.tsx), the `actions` prop is passed through to `SessionTurn`. Add `stepBack` to the `UserActions` type and wire it:

```typescript
const stepBack = async (input: { sessionID: string; messageID: string }) => {
  await sdk.client.session.stepBack({
    sessionID: input.sessionID,
    messageID: input.messageID,
  })
}
```

### 5.4 Add icon

Verify that a "return" (↩) icon exists in the icon set. If not, add one. Alternatives: `undo`, `arrow-return`, `corner-down-left`.

### 5.5 Add i18n string

```json
{
  "ui.message.stepBack": "Go back to this point"
}
```

### 5.6 Disable when session is busy

The step-back button should be disabled when the session is `busy` or `paused`. This is already handled via the `busy()` check in the `run()` function, consistent with fork/revert.

### 5.7 Verify

- Each user message shows the return icon alongside fork/revert/copy
- Clicking it while idle: deletes subsequent messages, restores snapshot, session returns to idle
- Clicking it while busy: button is disabled
- After step-back, the user can type a new prompt from that point

---

## Phase 6: Styling & Polish

**Risk**: Low
**Files**: CSS, dock components

### 6.1 Pause dock styling

Follow the permission dock CSS pattern. Key elements:
- Background tint matching the theme (slightly different from permission to distinguish)
- Smooth enter/exit animation (existing spring system in composer region)
- Step number badge

### 6.2 Step-back icon styling

The return icon should be visually distinct from fork/revert but follow the same sizing and positioning pattern. Consider a subtle color differentiation on hover.

### 6.3 Step boundary indicators (optional, future)

When in step mode, optionally add subtle step separators in the message timeline between LLM steps (e.g., a thin dotted line with "Step 2" label). This uses the existing `MessageDivider` pattern.

---

## File Impact Summary

### Backend (`packages/core`)

| File | Phase | Change |
|---|---|---|
| `src/session/status.ts` | 1 | Add `paused` variant to `Info` union |
| `src/session/engine/loop.ts` | 2, 3 | Add `stepMode` to PromptInput/LoopInput, pause logic, `resumeStep()`, `stepBack()` |
| `src/server/routes/session.ts` | 3 | Add `POST /:id/resume` and `POST /:id/step-back` routes |

### Frontend (`packages/liteai-app`)

| File | Phase | Change |
|---|---|---|
| `src/pages/session/composer/session-pause-dock.tsx` | 4 | **NEW** — pause dock component |
| `src/pages/session/composer/session-composer-state.ts` | 4 | Add `pauseRequest`, `resume()`, `stepBackFromPause()` |
| `src/pages/session/composer/session-composer-region.tsx` | 4 | Render `SessionPauseDock` when paused |
| `src/pages/session/composer/index.ts` | 4 | Export new component |
| `src/pages/session/message-timeline.tsx` | 5 | Wire `stepBack` action into `UserActions` |

### UI Library (`packages/ui`)

| File | Phase | Change |
|---|---|---|
| `src/components/message-part.tsx` | 5 | Add `stepBack` to `UserActions`, icon button in `UserMessageDisplay` |

### SDK (`packages/liteai-sdk`)

| File | Phase | Change |
|---|---|---|
| Generated types | 1 | `SessionStatus` includes `paused` variant |
| Generated SDK | 3 | `session.resume()` and `session.stepBack()` methods |

---

## Testing Plan

### Unit Tests

| Test | File | What it verifies |
|---|---|---|
| Pause status is valid | `test/session/status.test.ts` | `SessionStatus.Info` accepts `{ type: "paused", step: 3 }` |
| Step mode pauses after each step | `test/session/loop.test.ts` | Loop sets status to `paused` and waits for resume |
| Resume continues loop | `test/session/loop.test.ts` | `resumeStep()` unblocks the paused loop |
| Resume all disables step mode | `test/session/loop.test.ts` | After `resumeStep({ disableStepMode: true })`, loop runs to completion |
| Step back cleans messages | `test/session/step-back.test.ts` | Messages after target are deleted |
| Step back restores snapshot | `test/session/step-back.test.ts` | File state matches the snapshot at target |
| Step back during pause | `test/session/step-back.test.ts` | Cancels pause, restores state, session becomes idle |

### Integration Tests

| Test | What it verifies |
|---|---|
| `POST /session/:id/resume` | Returns 200, session continues |
| `POST /session/:id/step-back` | Returns 200, session is idle, messages truncated |
| Step mode end-to-end | Prompt with `stepMode: true` → poll status → see `paused` → resume → see `paused` → resume all → see `idle` |

### Frontend Tests

| Test | What it verifies |
|---|---|
| Pause dock appears when status is `paused` | Composer state correctly derives `pauseRequest` |
| Pause dock buttons dispatch correct SDK calls | Continue, Resume All, Step Back call the right endpoints |
| Step-back icon appears on user messages | `UserActions.stepBack` renders the return icon |
| Step-back icon disabled when busy | Button is disabled during active sessions |

---

## What This Enables (Future Work)

### Fork + Auto-Resume
> Fork session to step N's message boundary, then automatically re-enter the loop with different model/agent params. The step-back API already handles the "go back to point N" mechanics — forking just adds "in a new session."

### Guided Re-execution
> User pauses at step 2, types guidance ("try using a middleware pattern instead"), then continues. The guidance becomes a new user message that the LLM sees in context for the next step.

### Per-Step Debugging in Trace Panel
> The trace panel already shows per-step data. When paused, highlighting the current step's trace gives complete visibility into what the LLM saw before the user decides to continue.

---

## Summary

> **Step Pause gives the user control over the agent's pace.**
> **Step Back gives the user control over the agent's direction.**
> Together, they turn the conversation from a one-shot fire-and-forget into an interactive, debuggable collaboration.
