# Tool Contracts: Async Subagent Dispatch

**Branch**: `015-subagent-async-dispatch` | **Date**: 2026-05-20

## Modified Tool: `agent`

### Schema Changes

Add `run_in_background` optional boolean parameter:

```typescript
const parameters = z.object({
  description: z.string().describe("A short (3-5 words) description of the task"),
  prompt: z.string().describe("The task for the agent to perform"),
  subagent_type: z.string().describe("The type of specialized agent to use").optional(),
  task_id: z.string().describe("Resume a previous task by passing its task_id").optional(),
  command: z.string().describe("The command that triggered this task").optional(),
  run_in_background: z.boolean()
    .describe("If true, launch the agent as a background task and return immediately. Results will arrive as a <task-notification> message when the agent completes.")
    .optional(),
})
```

### Response Contract

**Sync mode** (default, `run_in_background` unset or false):
```
task_id: <sessionID> (for resuming to continue this task if needed)

<agent_result>
<result text>
</agent_result>
```
No change from current behavior.

**Async mode** (`run_in_background: true`):
```
task_id: <taskID>
session_id: <sessionID>
agent: <agentName>

<agent_launched>
Background task launched successfully. You will receive a <task-notification> when it completes.
Status: running
Description: <description>
</agent_launched>
```

---

## New Tool: `task_get`

### Description

Query the status, progress, and result of a background task by its ID.

### Schema

```typescript
const parameters = z.object({
  task_id: z.string().describe("The ID of the background task to query"),
})
```

### Response

**Running task**:
```
Task: <taskID>
Agent: <agentName>
Status: running
Description: <description>
Progress:
  Tool uses: 12
  Tokens: 45000
  Last activity: 3s ago
```

**Completed task**:
```
Task: <taskID>
Agent: <agentName>
Status: completed
Description: <description>
Duration: 32s

<task-result>
<result text>
</task-result>
```

**Failed task**:
```
Task: <taskID>
Agent: <agentName>
Status: failed
Description: <description>
Error: <error message>
```

**Not found**:
```
No task found with ID: <taskID>
```

---

## New Tool: `task_list`

### Description

List all background tasks and their current statuses.

### Schema

```typescript
const parameters = z.object({
  status_filter: z.enum(["all", "running", "completed", "failed", "killed"])
    .describe("Filter tasks by status. Defaults to 'all'.")
    .optional(),
})
```

### Response

```
Background Tasks:

| ID | Agent | Status | Description | Duration |
|----|-------|--------|-------------|----------|
| task_01JWR... | explore | running | Research API patterns | 12s |
| task_01JWR... | liteai | completed | Fix unit tests | 45s |

Total: 2 tasks (1 running, 1 completed)
```

**No tasks**:
```
No background tasks found.
```

---

## Modified Tool: `agent_stop` → `task_stop`

### Rename Rationale

The existing `agent_stop` tool name is misleading — it stops *tasks*, not agents. Rename to `task_stop` for consistency with the `task_get`/`task_list` family.

> [!NOTE]
> The rename is a clean break (Constitution Principle I — zero backward compatibility).
> The old `agent_stop` ID is dropped entirely.

### Schema

```typescript
const parameters = z.object({
  task_id: z.string().describe("The ID of the background task to stop"),
})
```

### Response

No change from current behavior. Returns success/failure status.

---

## Notification Contract: `<task-notification>` (Agent Tasks)

Injected as a synthetic user message at turn boundaries.

### Format

```xml
<task-notification>
The following background agent task(s) have completed:

Task ID: task_01JWRX...
Agent: explore
Status: completed
Description: Research API patterns
Result:
```
<result text truncated to 2000 chars>
```

Usage:
  Tool uses: 12
  Tokens: 45000
  Duration: 32s

</task-notification>
```

### Failed Agent Notification

```xml
<task-notification>
The following background agent task(s) have completed:

Task ID: task_01JWRX...
Agent: liteai
Status: failed
Description: Fix unit tests
Error: Subagent execution failed: Model returned error response

</task-notification>
```

### Killed Agent Notification

```xml
<task-notification>
The following background agent task(s) have completed:

Task ID: task_01JWRX...
Agent: explore
Status: killed
Description: Research API patterns
Partial result:
```
<partial output if any>
```

</task-notification>
```

### Coexistence with Command Notifications

Both command notifications (from `BackgroundTaskRegistry`) and agent notifications (from `AgentTaskRegistry`) use the `<task-notification>` wrapper. They are injected in the same call site at the turn boundary. If both registries have pending notifications, they are combined into a single `<task-notification>` message.
