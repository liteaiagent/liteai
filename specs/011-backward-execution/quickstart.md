# Quickstart: Backward Execution & Step-Level Control

**Date**: 2026-05-04  
**Feature**: [spec.md](file:///d:/liteai/specs/011-backward-execution/spec.md)

---

## 1. Step Mode — Pause & Inspect

### Enable step mode when submitting a prompt

```http
POST /project/session/:sessionID/prompt
Content-Type: application/json

{
  "sessionID": "sess_01J...",
  "parts": [{ "type": "text", "text": "Refactor the auth module" }],
  "stepMode": true
}
```

### Wait for pause status via SSE

```
event: session.status
data: { "sessionID": "sess_01J...", "status": { "type": "paused", "step": 1 } }
```

### Inspect step results

The session's messages are visible via the standard message endpoint. During pause, the messages include everything the agent produced in the completed step (file reads, tool calls, tool results, text).

### Resume execution

```http
POST /project/session/:sessionID/resume
Content-Type: application/json

{
  "guidance": "Good approach, but use a middleware pattern for the error handler."
}
```

### Disable step mode mid-session

```http
POST /project/session/:sessionID/resume
Content-Type: application/json

{
  "disableStepMode": true
}
```

---

## 2. Step-Back — Undo & Re-Execute

### List checkpoints for a session

```http
GET /project/session/:sessionID/checkpoints
```

```json
[
  { "id": "ckpt_01J...", "step": 1, "timestamp": 1714834200000, "metadata": { "agent": "coder", "model": { "providerID": "google", "modelID": "gemini-2.5-pro" }, "trigger": "user" } },
  { "id": "ckpt_01J...", "step": 2, "timestamp": 1714834205000, "metadata": { ... } },
  { "id": "ckpt_01J...", "step": 3, "timestamp": 1714834210000, "metadata": { ... } }
]
```

### Step back to step 2

```http
POST /project/session/:sessionID/step-back
Content-Type: application/json

{
  "checkpointID": "ckpt_01J...",
  "guidance": "Try using a decorator pattern instead"
}
```

### Response

```json
{
  "restored": true,
  "step": 2,
  "orphanedChildren": []
}
```

After step-back:
- File state matches what it was at step 2's checkpoint
- Conversation contains only messages up to step 2
- The agent's next execution will use the injected guidance

### Resume from the restored point

```http
POST /project/session/:sessionID/resume
```

---

## 3. Fork at Checkpoint

### Fork at step 2 with a different model

```http
POST /project/session/:sessionID/fork-at
Content-Type: application/json

{
  "checkpointID": "ckpt_01J...",
  "guidance": "Use the functional programming approach",
  "model": {
    "providerID": "anthropic",
    "modelID": "claude-sonnet-4-20250514"
  },
  "autoResume": true
}
```

### Response

```json
{
  "id": "sess_01K...",
  "title": "Refactor the auth module (fork #1)"
}
```

The original session remains unchanged. The fork starts executing from step 2 with the new model.

---

## 4. Step Context Inspection

### Query step context for step 3

```http
GET /project/session/:sessionID/checkpoints/:checkpointID
```

```json
{
  "id": "ckpt_01J...",
  "step": 3,
  "metadata": {
    "agent": "coder",
    "model": { "providerID": "google", "modelID": "gemini-2.5-pro" },
    "trigger": "user",
    "timing": { "start": 1714834210000, "end": 1714834215000 },
    "tokenUsage": { "input": 15234, "output": 2341, "reasoning": 5678 },
    "traceSpanID": "span_abc123"
  },
  "messages": [ ... ],
  "snapshot": "a1b2c3d4..."
}
```
