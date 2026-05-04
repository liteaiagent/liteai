# HTTP API Contracts: Backward Execution & Step-Level Control

**Date**: 2026-05-04  
**Feature**: [spec.md](file:///d:/liteai/specs/011-backward-execution/spec.md)  
**Base path**: `/:projectID/session`

All endpoints follow existing Hono route conventions in `server/routes/session.ts`.

---

## POST `/:sessionID/resume`

Resume a paused session, optionally injecting user guidance.

**operationId**: `project.session.resume`

### Request

```typescript
// Param
{ sessionID: SessionID }

// Body (JSON)
{
  guidance?: string           // Optional text to inject before next step
  disableStepMode?: boolean   // If true, resume and disable step mode
}
```

### Response

```typescript
// 200 OK
{ resumed: true }

// 400 Bad Request — session not in paused state
{ error: "Session is not paused" }

// 404 Not Found — session does not exist
{ error: "Session not found: <sessionID>" }
```

---

## POST `/:sessionID/step-back`

Step back to a prior checkpoint: restore file state, truncate messages, optionally inject guidance.

**operationId**: `project.session.stepBack`

### Request

```typescript
// Param
{ sessionID: SessionID }

// Body (JSON)
{
  checkpointID: string        // Target checkpoint to restore to
  guidance?: string           // Optional guidance for next step
}
```

### Response

```typescript
// 200 OK
{
  restored: true
  step: number                // Step number of the restored checkpoint
  orphanedChildren: SessionID[] // Child sessions spawned after this checkpoint
}

// 400 Bad Request — session is busy
{ error: "Session is busy" }

// 404 Not Found — checkpoint not found
{ error: "Checkpoint not found: <checkpointID>" }

// 409 Conflict — external file modifications detected
{
  error: "File conflict detected"
  conflicts: string[]         // List of conflicting file paths
}
```

---

## POST `/:sessionID/fork-at`

Fork a session at a specific checkpoint with optional parameter overrides.

**operationId**: `project.session.forkAt`

### Request

```typescript
// Param
{ sessionID: SessionID }

// Body (JSON)
{
  checkpointID: string        // Checkpoint to fork from
  guidance?: string           // Optional guidance for the forked session
  model?: {
    providerID: string
    modelID: string
  }
  agent?: string
  autoResume?: boolean        // If true, start the loop automatically in the fork
}
```

### Response

```typescript
// 200 OK — returns the new forked session
Session.Info

// 400 Bad Request — invalid model/agent
{ error: "Model not found: <providerID>/<modelID>" }

// 404 Not Found — checkpoint not found
{ error: "Checkpoint not found: <checkpointID>" }
```

---

## GET `/:sessionID/checkpoints`

List all checkpoints for a session, ordered by step.

**operationId**: `project.session.checkpoints`

### Request

```typescript
// Param
{ sessionID: SessionID }
```

### Response

```typescript
// 200 OK
Array<{
  id: string
  parentID?: string
  step: number
  timestamp: number
  metadata: {
    agent: string
    model: { providerID: string; modelID: string }
    trigger: "user" | "subtask" | "compaction" | "retry"
    timing: { start: number; end: number }
    tokenUsage?: { input: number; output: number; reasoning: number }
  }
  // Note: messages are NOT included in the list response (too large)
  // Use GET /:sessionID/checkpoints/:checkpointID for full data
}>
```

---

## GET `/:sessionID/checkpoints/:checkpointID`

Get a specific checkpoint with full message data.

**operationId**: `project.session.checkpoint`

### Request

```typescript
// Param
{ sessionID: SessionID; checkpointID: string }
```

### Response

```typescript
// 200 OK — full CheckpointData
{
  id: string
  parentID?: string
  sessionID: SessionID
  step: number
  messages: Message.WithParts[]
  snapshot?: string
  timestamp: number
  metadata: CheckpointMetadata
}

// 404 Not Found
{ error: "Checkpoint not found: <checkpointID>" }
```

---

## SSE Events (via existing `/session/events` stream)

### `session.status` — Extended

```typescript
// Existing variants: idle, busy, retry
// NEW variant:
{
  sessionID: string
  status: {
    type: "paused"
    step: number
  }
}
```

### `session.checkpoint` — New

Emitted when a new checkpoint is captured (allows frontend to update checkpoint list).

```typescript
{
  sessionID: string
  checkpoint: {
    id: string
    step: number
    timestamp: number
    metadata: CheckpointMetadata
  }
}
```

---

## Prompt Input Extension

The existing `PromptInput` schema is extended with step mode:

```typescript
export const PromptInput = z.object({
  sessionID: SessionID.zod,
  // ... existing fields ...
  stepMode: z.boolean().optional(),   // NEW: enable step-by-step execution
})
```

---

## Internal Contracts

### Checkpointer Interface Extension

```typescript
// Added to existing Checkpointer interface
interface Checkpointer {
  // ... existing methods ...
  
  // NEW: Checkpoint lifecycle
  captureCheckpoint(data: Omit<CheckpointData, "id">): Promise<CheckpointData>
  getCheckpoint(checkpointID: string): Promise<CheckpointData | undefined>
  getCheckpointByStep(sessionID: SessionID, step: number): Promise<CheckpointData | undefined>
  listCheckpoints(sessionID: SessionID): Promise<CheckpointData[]>
  truncateAfter(checkpointID: string): Promise<void>
}
```

### CheckpointStore Class

```typescript
class CheckpointStore {
  constructor(sessionID: SessionID)
  
  capture(input: {
    step: number
    messages: Message.WithParts[]
    snapshot?: string
    metadata: CheckpointMetadata
    parentID?: string
  }): CheckpointData
  
  get(checkpointID: string): CheckpointData | undefined
  getByStep(step: number): CheckpointData | undefined
  truncateAfter(checkpointID: string): void
  list(): CheckpointData[]
  latest(): CheckpointData | undefined
}
```
