# Subagent Result Flow Implementation Explanation

This document details the exact modifications required to fulfill the "Subagent Result Flow" feature without requiring design decisions during the execution phase. The goal is to enforce the pure forward-only execution model by eliminating the last remaining database reads during subagent delegation.

## Context and Current State
In the current architecture, when a subagent is invoked:
1. `loop.ts` orchestrator calls `processSubtask`.
2. `processSubtask` calls `taskTool.execute()`.
3. `TaskTool` (in `task.ts`) performs a database read (`Message.get`) to fetch the parent's model information.
4. `TaskTool` calls `SessionPrompt.prompt()`, which delegates to `loop()`.
5. `loop()` unwraps the `SessionResult`, resolves callbacks, and throws an exception on error, rather than returning the structured `SessionResult`.

## Required Modifications

### 1. Eliminate Database Read in `TaskTool`
**File:** `packages/core/src/tool/task.ts`
- **Current Problem:** `TaskTool` executes `const msg = await Message.get({ sessionID: ctx.sessionID, messageID: ctx.messageID })` to retrieve parent message metadata.
- **Solution:** Utilize the in-memory `ctx.messages` array provided to the tool executor.
- **Action:** Replace the DB read with an in-memory lookup:
  ```typescript
  const parentAssistant = ctx.messages.findLast((m) => m.info.id === ctx.messageID);
  if (!parentAssistant || parentAssistant.info.role !== "assistant") {
      throw new Error("Not an assistant message");
  }
  const parent = {
      modelID: parentAssistant.info.modelID,
      providerID: parentAssistant.info.providerID,
  };
  ```

### 2. Implement Direct `SessionResult` Flow
**File:** `packages/core/src/session/engine/loop.ts`
- **Current Problem:** The subagent loop is invoked via `prompt()`, which throws exceptions on errors instead of returning the structured `SessionResult`. This forces exception-based control flow instead of state-machine-based flow.
- **Solution:** Export a new orchestrator function `runSubagent` specifically for subagent execution.
- **Action:** Create `export const runSubagent = fn(PromptInput, async (input) => { ... })` in `loop.ts`.
  - It should resolve the session and create the initial user message.
  - It should initialize its own `SqliteCheckpointer`, `PromiseTracker`, and `BackgroundTaskRegistry`.
  - It should invoke `runSession( ... )` directly.
  - It MUST return the `SessionResult` directly (e.g. `{ status: "ok", message }` or `{ status: "error", error }`), avoiding `Bus.publish` and exception-throwing for errors.

### 3. Consume `SessionResult` in `TaskTool`
**File:** `packages/core/src/tool/task.ts`
- **Action:** Update the execution to call `SessionPrompt.runSubagent` instead of `SessionPrompt.prompt`.
- **Action:** Explicitly handle the `SessionResult` status. If `status === "ok"`, extract the result text or `yield_turn` summary. If `status === "error"`, format the error gracefully into the `<task_result>` output so the parent agent can recover, rather than crashing the tool execution.

### 4. Verification of `query.ts` and `streaming-tool-executor.ts`
**Files:** `packages/core/src/session/engine/query.ts`, `packages/core/src/session/engine/streaming-tool-executor.ts`
- **Action:** Ensure no legacy database queries exist for subtask retrieval. Note that previous refactoring phases have largely replaced these with `msgsBuffer.current` injection. Confirm the buffer flow is pure and free from hidden DB I/O.
