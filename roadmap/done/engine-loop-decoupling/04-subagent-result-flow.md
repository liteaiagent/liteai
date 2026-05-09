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

## Files Changed (Actual)

| File | Change |
|---|---|
| `[MODIFY] loop.ts` | Exported `runSubagent()` — creates own `SqliteCheckpointer`, `PromiseTracker`, `BackgroundTaskRegistry`; returns `SessionResult` directly without `Bus.publish` or exceptions |
| `[MODIFY] task.ts` | Replaced `Message.get()` DB read with `ctx.messages.findLast()` in-memory lookup; calls `runSubagent` instead of `prompt`; explicitly handles all 3 `SessionResult` states |
| `[VERIFIED] query.ts` | Already decoupled from subagent DB reads after Phase 2 — no changes needed |
| `[VERIFIED] streaming-tool-executor.ts` | Already clean — no changes needed |

---

## Analysis Tasks (Resolved)

- [x] **Map the exact subagent delegation path**: `loop.ts:runSessionInner` → control event `subtask` → `processSubtask()` → `TaskTool.execute()` → `SessionPrompt.runSubagent()` → `runSession()` → `SessionResult`. Documented in `specs/010-subagent-result-flow/explanation.md`.
- [x] **Parent needs full message list or just final response?**: Final response only. The parent extracts the last text part or `yield_turn` summary from `SessionResult.message`. The child's full message history is persisted by its own checkpointer for UI streaming and audit, but the parent never reads it.
- [x] **Fork/branch scenarios — does forking need to fork child sessions?**: **No.** Analysis of Claude Code's fork model confirms: fork is context-sharing (copying the parent's message buffer), not state-cloning. By the time a parent forks, completed subagents have already returned their `SessionResult` and the result is embedded in the parent's `msgsBuffer`. Forking the buffer automatically includes subagent contributions. If a fork child needs to continue a prior subagent's work, it creates a new child session via the `task_id` resume path (`task.ts:71-74`). Reference: `D:\claude-code\src\tools\AgentTool\forkSubagent.ts` — children receive `forkContextMessages` (a copy of the parent's messages), not clones of child session state.
- [x] **Audit `TaskTool`**: Fully refactored. `task.ts` now uses `ctx.messages.findLast()` for parent model resolution (zero DB reads) and `SessionPrompt.runSubagent()` for execution (direct `SessionResult` return).
