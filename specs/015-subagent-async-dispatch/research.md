# Research: Async Subagent Dispatch

**Branch**: `015-subagent-async-dispatch` | **Date**: 2026-05-20

## R-001: TaskRegistry Design — New Module vs. Extend BackgroundTaskRegistry

### Decision: New `task/` module with `AgentTaskRegistry`

### Rationale

The existing `BackgroundTaskRegistry` (in `command/background.ts`) is purpose-built for shell `ChildProcess` lifecycle management — it wraps a `ChildProcess`, captures stdout/stderr via `OutputBuffer`, manages process trees via `Shell.killTree()`, and tracks exit codes. Agent task lifecycle is fundamentally different:

| Dimension | BackgroundTaskRegistry (commands) | AgentTaskRegistry (agents) |
|-----------|----------------------------------|---------------------------|
| Underlying resource | `ChildProcess` | `Session` + `runSubagent()` promise |
| Output capture | stdout/stderr → `OutputBuffer` ring buffer | Agent result message (last text part) |
| Termination | `Shell.killTree(proc)` | `SessionPrompt.cancel(sessionID)` |
| Identity | `cmd_<hex>` auto-generated | `task_<ulid>` branded type |
| Progress | Exit code, output bytes | Tool use count, token count, last activity |
| Result format | Raw text output | Structured `AgentToolResult` with session ID |
| Notification | `<task-notification>` with command/status/output | `<task-notification>` with agent/status/result/usage |

Forcing agent tasks into `BackgroundTaskRegistry` would require either polymorphic base types (adding `ChildProcess | Session` unions, conditional logic throughout) or inheritance (which the codebase avoids). A new module is cleaner.

### Alternatives Considered

1. **Extend BackgroundTaskRegistry with generics** — Makes `BackgroundTask<T>` generic over its underlying resource. Rejected: the two lifecycles share almost no behavior beyond "has a status". Generics would add complexity without reducing code.

2. **Unified TaskManager superclass** — Extract a common `TaskManager<T>` base. Rejected: premature abstraction. If a third task type emerges (e.g., MCP server tasks), we can extract then. Currently only two consumers.

---

## R-002: Notification Integration — CorrectionInjector Extension

### Decision: Extend `CorrectionInjector.injectNotifications()` to drain both registries

### Rationale

The existing `CorrectionInjector.injectNotifications()` at [correction-injector.ts:L83-L157](file:///d:/liteai/packages/core/src/session/engine/correction-injector.ts#L83-L157) already implements the exact pattern we need:

1. Query registry for unnotified completed tasks
2. Format as `<task-notification>` XML
3. Persist as synthetic user message with `synthetic: true`
4. Append to in-memory `msgsBuffer` (FR-3 buffer invariant)
5. Mark tasks as notified

The call site at [loop.ts:L740-L754](file:///d:/liteai/packages/core/src/session/engine/loop.ts#L740-L754) runs between turns after `flushResult === "continue"`, which is exactly when agent task notifications should be injected.

### Design

Add a second method `injectAgentTaskNotifications()` (or make `injectNotifications()` accept a union type). The agent notification XML format differs slightly:

```xml
<task-notification>
  <task-id>task_01JWRX...</task-id>
  <agent>explore</agent>
  <status>completed</status>
  <description>Research API patterns</description>
  <result>Here is what I found...</result>
  <usage>
    <tool-uses>12</tool-uses>
    <tokens>45000</tokens>
    <duration-ms>32000</duration-ms>
  </usage>
</task-notification>
```

vs. the existing command notification which uses `Command:`, `Exit code:`, and raw output.

### Alternatives Considered

1. **Separate notification method on AgentTaskRegistry** — Registry self-formats and self-persists. Rejected: breaks separation of concerns (registry shouldn't know about message persistence) and duplicates the checkpoint/buffer logic already in CorrectionInjector.

2. **Priority queue (MessageQueueManager pattern)** — Claude Code uses a `commandQueue` with priority levels. Rejected: our `CorrectionInjector` pattern is simpler and sufficient — notifications are always injected at turn boundaries (equivalent to Claude's `'later'` priority). No need for `'now'`/`'next'` priorities since we don't have interactive user input competing.

---

## R-003: Abort Semantics — Independent vs. Linked AbortController

### Decision: Independent AbortController for async agents (not linked to parent)

### Rationale

The reference architecture (Claude Code) uses independent abort controllers for async agents at [LocalAgentTask.tsx:L486](file:///d:/claude-code/src/tasks/LocalAgentTask/LocalAgentTask.tsx#L486). This is the correct design for our use case:

- **Parent cancellation should NOT kill background agents** — the parent may be cancelled and restarted while background agents continue their work.
- **Background agents survive parent session lifecycle** — a background agent may outlive the parent's current loop iteration.
- **Explicit cancellation via `agent_stop`** — the LLM or user must explicitly cancel background agents.

However, the existing `createSubagentContext()` at [context.ts:L218-L228](file:///d:/liteai/packages/core/src/agent/context.ts#L218-L228) always creates a child `AbortController` linked to the parent. For async dispatch, we need to bypass this and create a truly independent controller.

### Design

`runAsyncAgentLifecycle()` creates its own `AbortController` and passes it through the context. The `AgentTaskRegistry` holds a reference to this controller for explicit cancellation via `agent_stop`. On parent session cleanup, the registry is NOT disposed (unlike `BackgroundTaskRegistry.disposeAll()` which is called in the defer block).

### Key Difference from Sync Path

- **Sync**: `ctx.abort.addEventListener("abort", cancel)` at [agent.ts:L132](file:///d:/liteai/packages/core/src/tool/agent.ts#L132) links parent abort → subagent cancel
- **Async**: AbortController is independent, stored in TaskRegistry, only triggered by explicit `agent_stop` or `killAll()`

---

## R-004: AppState.tasks — Type Unification

### Decision: Extend existing `AppState.tasks` with agent task state

### Rationale

`AppState.tasks` already exists as `Record<string, BackgroundTaskState | TeammateTaskState>` at [context.ts:L36](file:///d:/liteai/packages/core/src/agent/context.ts#L36). The `AgentStopTool` at [agent_stop.ts:L60](file:///d:/liteai/packages/core/src/tool/agent_stop.ts#L60) already reads from `appState.tasks?.[rawId]`. We should add `AgentTaskState` to this union.

However, `AppState.tasks` is a loose record — it mixes command tasks and teammate tasks. The `BackgroundTaskState` type at [context.ts:L22-L26](file:///d:/liteai/packages/core/src/agent/context.ts#L22-L26) is very permissive (`status?: string, [key: string]: unknown`).

### Design

Add a discriminated `AgentTaskState` interface to the `AppState.tasks` union:

```typescript
export interface AgentTaskState {
  type: "agent_task"
  status: "pending" | "running" | "completed" | "failed" | "killed"
  taskId: TaskID
  sessionId: SessionID
  agentName: string
  description: string
  progress: TaskProgress
  result?: string
  error?: string
  createdAt: number
  completedAt?: number
}
```

The `type: "agent_task"` discriminator ensures `AgentStopTool` can distinguish agent tasks from command tasks, avoiding ambiguous cancellation.

---

## R-005: Coordinator Mode Integration

### Decision: Force `run_in_background = true` in coordinator mode

### Rationale

The coordinator's allowed tools at [coordinator-mode.ts:L75-L82](file:///d:/liteai/packages/core/src/coordinator/coordinator-mode.ts#L75-L82) already include `"agent"` and `"agent_stop"`. In coordinator mode, all subagents should run as background tasks so the coordinator can manage multiple concurrent workers.

### Design

In `AgentTool.execute()`, compute `shouldRunAsync`:

```typescript
const shouldRunAsync =
  params.run_in_background === true ||
  isCoordinatorMode(parentSession.sessionMode)
```

The coordinator's system prompt (not in this codebase yet, constructed in `query.ts`) should document the `<task-notification>` format so the LLM understands async results arrive as user messages.

Add `agent_get`, `agent_list`, and `agent_stop` to `COORDINATOR_ALLOWED_TOOLS` so the coordinator can manage its worker pool.

---

## R-006: Concurrency Limit

### Decision: Configurable max concurrent tasks per instance, default 10

### Rationale

Unbounded background agents would consume N× memory/compute with no backpressure. A configurable limit prevents resource exhaustion.

### Design

`AgentTaskRegistry` enforces a max concurrent count. When the limit is reached, `register()` throws a structured error that the `AgentTool` catches and returns as an informative tool result (not a crash). The LLM can then decide to wait for existing tasks or cancel one.

The limit is configurable via `Config` (or a Flag), defaulting to 10 concurrent tasks.

---

## R-007: Status-Before-Cleanup Ordering

### Decision: Transition status BEFORE dispatching notification

### Rationale

Claude Code documents this explicitly at [agentToolUtils.ts:L599-L603](file:///d:/claude-code/src/tools/AgentTool/agentToolUtils.ts#L599-L603) — status transitions happen before notification/cleanup to avoid race conditions with `TaskOutput(block=true)` queries.

In our system, `CorrectionInjector.injectNotifications()` already follows this pattern: it queries completed tasks, formats notifications, persists them, and only THEN calls `markNotified()`. But the task status transition (from "running" to "completed"/"failed"/"killed") must happen in `runAsyncAgentLifecycle()` BEFORE the CorrectionInjector's next drain cycle.

### Design

`runAsyncAgentLifecycle()`:
1. Awaits `runSubagent()` result
2. Updates `AgentTaskRegistry` status → `completed`/`failed` (synchronous, in-memory)
3. The NEXT turn boundary, `CorrectionInjector` drains the registry and injects the notification

This is naturally ordered since `runAsyncAgentLifecycle()` runs in a detached promise and `CorrectionInjector` runs in the parent's event loop between turns.
