# Phase 4: Subagent Result Flow

> **Depends on**: Phase 2 (Self-Contained Loop)  
> **Estimated scope**: ~3 files modified  
> **Risk**: Medium — touches the task/subagent delegation path

---

## Goal

Child loops return results directly to their parent through the call stack, not through the database.

---

## Problem

Currently, when a parent agent delegates to a subagent:

```
Parent queryLoop:
  1. Yields "subtask" event
  2. Orchestrator calls SubagentRunner.run(taskInput)
  3. SubagentRunner creates a CHILD session in DB
  4. SubagentRunner calls loop() for the child session
  5. Child loop runs, writes messages to DB
  6. Child loop reads its own result from DB (!)
  7. Parent continues, reads child's messages from DB (!)
```

Steps 6 and 7 are DB-mediated inter-loop communication. The child produces a result in memory, discards it, writes it to DB, and the parent reads it back from DB.

---

## Design

With Phase 2's `SessionResult`, the child loop already returns its result directly:

```typescript
// SubagentRunner (conceptual):
const childResult = await runSession({
  sessionID: childSessionID,
  initialMessages: parentContext,
  checkpointer,  // optional — same or different checkpointer
})

// Parent receives result directly:
switch (childResult.status) {
  case "ok":
    // Inject child's response into parent's msgsBuffer
    msgsBuffer.current.push(childResult.message)
    break
  case "error":
    // Handle child failure in parent context
    break
}
```

**Key insight**: The child's checkpointer still persists the child's messages (for history/debugging). But the parent doesn't need to read them from the checkpointer — it receives them via the function return.

---

## Scope Limitation

This phase focuses ONLY on the result flow — making the child-to-parent data transfer go through function returns instead of DB reads.

It does NOT change:
- How child sessions are created
- How child session IDs are assigned
- How child messages are displayed in the UI (still via SSE events from the child's checkpointer)

---

## Files to Change

| File | Change |
|---|---|
| `[MODIFY] loop.ts` | Subagent delegation in orchestrator uses child's `SessionResult` directly |
| `[MODIFY] query.ts` | Subtask handling receives child result via return, not DB query |
| `[MODIFY] streaming-tool-executor.ts` | If subagent tool execution reads child results from DB, change to use return value |

---

## Analysis Tasks (for future sessions)

- [ ] Map the exact subagent delegation path: which function creates the child session, which function reads the result
- [ ] Determine if the parent needs the child's FULL message list or just the final response
- [ ] Evaluate fork/branch scenarios: does forking a session with subagents need to fork the child sessions too?
- [ ] Audit `TaskTool` — how does it currently retrieve subagent results?
