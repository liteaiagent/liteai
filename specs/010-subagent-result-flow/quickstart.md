# Quickstart: Subagent Result Flow

## How it works

When an agent needs to delegate a task to a subagent, it uses the `runSubagent()` orchestrator. The child runs its own session loop with its own `SqliteCheckpointer` (for UI streaming and persistence), but returns the result directly to the parent via the call stack.

### Legacy Approach (Coupled)

Previously, the parent would execute the child, discard the result, and query the database:

```typescript
// DON'T DO THIS
await SessionPrompt.prompt(taskInput);
const msg = await Message.get({ sessionID, messageID }); // DB Read!
```

### New Approach (Decoupled)

The parent calls `runSubagent()` and handles the `SessionResult` directly:

```typescript
// DO THIS
const result = await SessionPrompt.runSubagent({
  messageID,
  sessionID: childSession.id,
  model: { modelID, providerID },
  agent: agent.name,
  parts: promptParts,
});

switch (result.status) {
  case "ok":
    // Result is directly in memory. No DB reads.
    const text = result.message.parts.findLast(p => p.type === "text")?.text;
    break;
  case "error":
    // Error returned directly — no exception, no Bus.publish
    const errorMsg = result.error instanceof Error ? result.error.message : String(result.error);
    break;
  case "aborted":
    // Subagent was cancelled
    break;
}
```

### Dual-Consumer Model

The child session has two independent consumers:

| Consumer | What it sees | How |
|---|---|---|
| **UI** (TUI/frontend) | Live streaming progress | Child's own SSE stream via its `sessionID` + `SqliteCheckpointer` |
| **Parent agent** (LLM) | Final result only | `SessionResult` returned by `runSubagent()` |

This ensures a pure forward-only execution model where the engine loop is not dependent on the database for its logic.
