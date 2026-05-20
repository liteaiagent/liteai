# Roadmap: Async Subagent Dispatch

**Filed**: 2026-05-20
**Source**: CodeRabbit Finding #4 (agent.ts L127–145)
**Priority**: High
**Status**: Proposed — reference architecture analyzed

## Problem Statement

In [agent.ts](file:///d:/liteai/packages/core/src/tool/agent.ts#L136-L145), the `AgentTool.execute` function calls
`SessionPrompt.runSubagent(...)` with a direct `await`, which blocks the parent
session's tool execution slot for the entire duration of the subagent's run.

While this does **not** block the HTTP thread (the SSE connection is already
streaming events asynchronously via the event-sourced [queryLoop](file:///d:/liteai/packages/core/src/session/engine/loop.ts#L535-L543) architecture),
it **does** tie up the parent session's execution loop. The parent LLM cannot
process other tool calls or produce output until the subagent completes.

---

## Reference Architecture: Claude Code

> [!NOTE]
> All `d:\claude-code` paths are read-only reference material — not our codebase.

Claude Code's `AgentTool` implements a dual-mode execution model with
**async-by-default** behavior gated by feature flags. This is the reference
architecture we should adapt.

### Key Design: `shouldRunAsync` Decision Gate

**Ref**: [AgentTool.tsx:L567](file:///d:/claude-code/src/tools/AgentTool/AgentTool.tsx#L567)

```typescript
const shouldRunAsync = (
  run_in_background === true ||
  selectedAgent.background === true ||
  isCoordinator ||
  forceAsync ||
  assistantForceAsync ||
  proactiveModule?.isProactiveActive()
) && !isBackgroundTasksDisabled;
```

The tool has a `run_in_background` parameter in its schema ([AgentTool.tsx:L87](file:///d:/claude-code/src/tools/AgentTool/AgentTool.tsx#L87)) that the LLM can
set. Additionally, agent definitions can declare `background: true`, and
coordinator mode forces all agents async. There is also a
`CLAUDE_AUTO_BACKGROUND_TASKS` env var that auto-backgrounds agents after
120 seconds of sync execution ([AgentTool.tsx:L72-L77](file:///d:/claude-code/src/tools/AgentTool/AgentTool.tsx#L72-L77)).

### Async Path (fire-and-forget + notification)

When `shouldRunAsync` is true ([AgentTool.tsx:L686-L764](file:///d:/claude-code/src/tools/AgentTool/AgentTool.tsx#L686-L764)):

1. **Register task**: [registerAsyncAgent()](file:///d:/claude-code/src/tasks/LocalAgentTask/LocalAgentTask.tsx#L466-L515) creates a `LocalAgentTaskState`
   in `AppState.tasks` with its own `AbortController` (independent of parent — [L486](file:///d:/claude-code/src/tasks/LocalAgentTask/LocalAgentTask.tsx#L486))
2. **Fire-and-forget**: `void runWithAgentContext(ctx, () => runAsyncAgentLifecycle(...))` ([AgentTool.tsx:L733](file:///d:/claude-code/src/tools/AgentTool/AgentTool.tsx#L733))
   — detached promise, parent doesn't await
3. **Return immediately**: Returns `{ status: 'async_launched', agentId, outputFile }` ([AgentTool.tsx:L754-L764](file:///d:/claude-code/src/tools/AgentTool/AgentTool.tsx#L754-L764))
   to the parent LLM
4. **On completion**: [enqueueAgentNotification()](file:///d:/claude-code/src/tasks/LocalAgentTask/LocalAgentTask.tsx#L197-L262) → [enqueuePendingNotification()](file:///d:/claude-code/src/utils/messageQueueManager.ts#L142-L149)
   which injects an XML `<task-notification>` message into the parent's message
   queue. The parent's main loop picks this up at the next tool-round boundary.

```
Parent tool-call: agent → registerAsyncAgent() → return { status: 'async_launched' }
                              ↓ (fire-and-forget)
                         runAsyncAgentLifecycle(...)
                              ↓
                         subagent completes/fails/killed
                              ↓
                         enqueueAgentNotification() → <task-notification> XML
                              ↓
                         Parent loop picks up notification at next turn boundary
```

### Async Agent Lifecycle

**Ref**: [runAsyncAgentLifecycle()](file:///d:/claude-code/src/tools/AgentTool/agentToolUtils.ts#L508-L686)

This is the core background agent driver. Key flow:

- Creates a [ProgressTracker](file:///d:/claude-code/src/tasks/LocalAgentTask/LocalAgentTask.tsx#L41-L49) to count tool uses and tokens
- Iterates the agent's message stream via `for await (const message of makeStream(...))`
- Calls [updateAsyncAgentProgress()](file:///d:/claude-code/src/tasks/LocalAgentTask/LocalAgentTask.tsx#L339-L353) to push progress into AppState
- On success: [completeAsyncAgent()](file:///d:/claude-code/src/tasks/LocalAgentTask/LocalAgentTask.tsx#L412-L432) FIRST (status transition), then notification
- On abort: [killAsyncAgent()](file:///d:/claude-code/src/tasks/LocalAgentTask/LocalAgentTask.tsx#L281-L303) FIRST, then notification with partial result
- On error: [failAsyncAgent()](file:///d:/claude-code/src/tasks/LocalAgentTask/LocalAgentTask.tsx#L437-L456), then notification with error

> [!IMPORTANT]
> Status transitions happen BEFORE notification/cleanup to avoid blocking `TaskOutput(block=true)` — see `gh-20236` comments at [agentToolUtils.ts:L599-L603](file:///d:/claude-code/src/tools/AgentTool/agentToolUtils.ts#L599-L603).

### Sync Path (blocking with auto-background escape hatch)

**Ref**: [AgentTool.tsx:L765-L1050](file:///d:/claude-code/src/tools/AgentTool/AgentTool.tsx#L765-L1000) (approximate, sync path)

When `shouldRunAsync` is false:

1. **Register foreground**: [registerAgentForeground()](file:///d:/claude-code/src/tasks/LocalAgentTask/LocalAgentTask.tsx#L526-L614) creates the task
   state with `isBackgrounded: false` and returns a `backgroundSignal` Promise
2. **Race loop**: Each iteration of the agent's message stream is raced against
   `backgroundSignal` ([AgentTool.tsx:L886-L892](file:///d:/claude-code/src/tools/AgentTool/AgentTool.tsx#L886-L892)) — if the user sends a background signal (ESC, timer),
   the sync loop exits and re-spawns the agent as async ([AgentTool.tsx:L897-L952](file:///d:/claude-code/src/tools/AgentTool/AgentTool.tsx#L897-L952))
3. **On completion**: [unregisterAgentForeground()](file:///d:/claude-code/src/tasks/LocalAgentTask/LocalAgentTask.tsx#L657-L682) removes the task from
   AppState (it was never visible as a background task)

### Task State & Notification System

**Ref**: [LocalAgentTaskState](file:///d:/claude-code/src/tasks/LocalAgentTask/LocalAgentTask.tsx#L116-L148)

```
AppState.tasks: Record<string, TaskState>
  └── LocalAgentTaskState
       ├── id, type: 'local_agent'
       ├── status: 'pending' | 'running' | 'completed' | 'failed' | 'killed'
       ├── abortController: AbortController (independent of parent)
       ├── progress: { toolUseCount, tokenCount, lastActivity, summary }
       ├── isBackgrounded: boolean
       ├── pendingMessages: string[] (inter-agent messaging via SendMessage)
       └── result?: AgentToolResult
```

**Ref**: [Task.ts](file:///d:/claude-code/src/Task.ts) — base types: `TaskType`, `TaskStatus`, `TaskHandle`, `TaskContext`

**Ref**: [isTerminalTaskStatus()](file:///d:/claude-code/src/Task.ts#L27-L29) — guards against operating on dead tasks

Notifications are injected as synthetic user messages containing XML.
The notification format is defined by XML constants in [xml.ts](file:///d:/claude-code/src/constants/xml.ts#L28):

```xml
<task-notification>
  <task-id>a1234567</task-id>
  <tool-use-id>toolu_xyz</tool-use-id>
  <output-file>/path/to/transcript</output-file>
  <status>completed</status>
  <summary>Agent "Fix tests" completed</summary>
  <result>Here is what I did...</result>
  <usage><total_tokens>50000</total_tokens>...</usage>
</task-notification>
```

### Message Queue Manager

**Ref**: [messageQueueManager.ts](file:///d:/claude-code/src/utils/messageQueueManager.ts)

The notification queue is a module-level `commandQueue: QueuedCommand[]` with priority-based dequeue:
- `'now'` > `'next'` > `'later'` ([L151-L155](file:///d:/claude-code/src/utils/messageQueueManager.ts#L151-L155))
- [enqueuePendingNotification()](file:///d:/claude-code/src/utils/messageQueueManager.ts#L142-L149) defaults to `'later'` priority so user input is never starved
- [dequeue()](file:///d:/claude-code/src/utils/messageQueueManager.ts#L167-L193) supports an optional filter (e.g., agent-scoped draining)
- `task-notification` mode is non-editable — user can't ESC to pull it into input buffer ([L343-L344](file:///d:/claude-code/src/utils/messageQueueManager.ts#L343-L344))

### Coordinator Mode Prompt

**Ref**: [coordinatorMode.ts:L111-L369](file:///d:/claude-code/src/coordinator/coordinatorMode.ts#L111-L369)

The coordinator system prompt teaches the LLM about `<task-notification>`:
- Workers results arrive as user-role messages ([L144](file:///d:/claude-code/src/coordinator/coordinatorMode.ts#L144))
- Includes XML schema example ([L148-L160](file:///d:/claude-code/src/coordinator/coordinatorMode.ts#L148-L160))
- Full conversation flow example with notification interleaving ([L166-L191](file:///d:/claude-code/src/coordinator/coordinatorMode.ts#L166-L191))

### Abort Semantics

- **Async agents**: Own their `AbortController` ([LocalAgentTask.tsx:L486](file:///d:/claude-code/src/tasks/LocalAgentTask/LocalAgentTask.tsx#L486)). NOT linked to parent.
  Survive ESC/cancel on the parent. Killed explicitly via `TaskStopTool` or
  `chat:killAgents` bulk kill ([killAllRunningAgentTasks()](file:///d:/claude-code/src/tasks/LocalAgentTask/LocalAgentTask.tsx#L309-L315))
- **In-process teammates**: Use `createChildAbortController(parent)` — linked
  to parent, auto-abort on parent cancel
- **Sync agents**: Share the parent's abort context (inherited via ALS)

### Progress Tracking

- [ProgressTracker](file:///d:/claude-code/src/tasks/LocalAgentTask/LocalAgentTask.tsx#L41-L49): Counts tool uses, tracks token consumption
- [updateProgressFromMessage()](file:///d:/claude-code/src/tasks/LocalAgentTask/LocalAgentTask.tsx#L68-L96): Updates tracker from each assistant message
- [updateAgentProgress()](file:///d:/claude-code/src/tasks/LocalAgentTask/LocalAgentTask.tsx#L339-L353): Pushes progress into `AppState.tasks[id].progress`
- [AgentSummary service](file:///d:/claude-code/src/services/AgentSummary): Periodically summarizes agent progress via LLM

### Additional Tools

- [TaskCreateTool](file:///d:/claude-code/src/tools/TaskCreateTool/TaskCreateTool.ts): Alternative to AgentTool for explicit background dispatch
- [TaskGetTool](file:///d:/claude-code/src/tools/TaskGetTool): Read task state (status, progress, result)
- [TaskOutputTool](file:///d:/claude-code/src/tools/TaskOutputTool): Read task transcript/output file (supports `block=true` to wait)
- [TaskStopTool](file:///d:/claude-code/src/tools/TaskStopTool): Kill a running background task
- [TaskListTool](file:///d:/claude-code/src/tools/TaskListTool): List all tasks and their statuses
- [TaskUpdateTool](file:///d:/claude-code/src/tools/TaskUpdateTool): Update task state (e.g., inject messages)

---

## LiteAI: Current State (target codebase)

### Files to Modify

| File | Current Role | Ref |
|------|-------------|-----|
| [agent.ts](file:///d:/liteai/packages/core/src/tool/agent.ts) | AgentTool — blocking `await runSubagent()` at [L136-L145](file:///d:/liteai/packages/core/src/tool/agent.ts#L136-L145) | Primary target |
| [agent_stop.ts](file:///d:/liteai/packages/core/src/tool/agent_stop.ts) | Task stop tool — already exists, needs registry integration | Refactor target |
| [loop.ts](file:///d:/liteai/packages/core/src/session/engine/loop.ts) | Session engine — [runSubagent()](file:///d:/liteai/packages/core/src/session/engine/loop.ts#L165-L195) and [loop()](file:///d:/liteai/packages/core/src/session/engine/loop.ts#L1049-L1110) | Engine integration |
| [correction-injector.ts](file:///d:/liteai/packages/core/src/session/engine/correction-injector.ts) | Already injects `<task-notification>` for background commands at [L83-L157](file:///d:/liteai/packages/core/src/session/engine/correction-injector.ts#L83-L157) | Extend for agent tasks |
| [background.ts](file:///d:/liteai/packages/core/src/command/background.ts) | BackgroundTaskRegistry — session-scoped in-memory registry at [L253](file:///d:/liteai/packages/core/src/command/background.ts#L253) | Evaluate reuse vs new TaskRegistry |
| [namespace.ts](file:///d:/liteai/packages/core/src/session/engine/namespace.ts) | SessionPrompt namespace — re-exports [runSubagent](file:///d:/liteai/packages/core/src/session/engine/namespace.ts#L13) | May need new `runSubagentAsync` |

### Existing Infrastructure to Leverage

1. **Notification injection**: [CorrectionInjector.injectNotifications()](file:///d:/liteai/packages/core/src/session/engine/correction-injector.ts#L83-L157)
   already handles `<task-notification>` XML for background commands. Extend this
   to also drain agent task completions.

2. **Notification call site**: [loop.ts:L740-L754](file:///d:/liteai/packages/core/src/session/engine/loop.ts#L740-L754) — between-turn injection
   of background command notifications. Agent task notifications would slot in here.

3. **Abort wiring in AgentTool**: [agent.ts:L129-L133](file:///d:/liteai/packages/core/src/tool/agent.ts#L129-L133) — current `ctx.abort` → `SessionPrompt.cancel` pattern.
   For async agents, this would be replaced with an independent AbortController.

4. **Session creation for subagents**: [agent.ts:L94-L104](file:///d:/liteai/packages/core/src/tool/agent.ts#L94-L104) — `Session.create()` with parentID.
   Sessions are already per-subagent, so the DB/persistence side is handled.

5. **Session cleanup**: [Session.remove()](file:///d:/liteai/packages/core/src/session/index.ts#L934) — available for orphaned session cleanup.

6. **AppState in agent context**: [loop.ts:L548-L581](file:///d:/liteai/packages/core/src/session/engine/loop.ts#L548-L581) — `RootAgentContext` with
   `getAppState`/`setAppState`/`setAppStateForTasks`. Task state would live here.

---

## Proposed Implementation for LiteAI

### Phase 1: Core Infrastructure

1. **TaskRegistry** (new module in `packages/core/src/task/`)
   - In-memory `Map<TaskID, TaskState>` scoped to `Instance.state()`
   - `TaskState`: id, type, status, description, abortController, progress,
     result, createdAt, completedAt
   - `register()`, `update()`, `complete()`, `fail()`, `kill()`, `get()`, `list()`
   - Status transitions with lifecycle hooks
   - Model after [LocalAgentTaskState](file:///d:/claude-code/src/tasks/LocalAgentTask/LocalAgentTask.tsx#L116-L148) and [Task.ts](file:///d:/claude-code/src/Task.ts#L6-L76)

2. **Notification Injection**
   - Extend [CorrectionInjector.injectNotifications()](file:///d:/liteai/packages/core/src/session/engine/correction-injector.ts#L83-L157)
     to drain task notifications in addition to background command notifications
   - Model notification format after [enqueueAgentNotification()](file:///d:/claude-code/src/tasks/LocalAgentTask/LocalAgentTask.tsx#L197-L262)
   - Wire into the existing call site at [loop.ts:L740-L754](file:///d:/liteai/packages/core/src/session/engine/loop.ts#L740-L754)

### Phase 2: AgentTool Refactor

1. **Add `run_in_background` parameter** to agent tool schema
   (model after [AgentTool.tsx:L87](file:///d:/claude-code/src/tools/AgentTool/AgentTool.tsx#L87))
2. **Async path**: When `run_in_background: true`:
   - Register task in TaskRegistry
   - Fire-and-forget `SessionPrompt.runSubagent()` with independent AbortController
     (model after [AgentTool.tsx:L686-L764](file:///d:/claude-code/src/tools/AgentTool/AgentTool.tsx#L686-L764))
   - Return `{ status: 'async_launched', taskId, ... }` immediately
   - On completion: notification → parent picks up at next turn
   - Lifecycle driver modeled after [runAsyncAgentLifecycle()](file:///d:/claude-code/src/tools/AgentTool/agentToolUtils.ts#L508-L686)
3. **Sync path**: Default behavior unchanged (blocking `await runSubagent()`)
4. **Auto-background**: Optional timer-based auto-backgrounding (configurable)

### Phase 3: Task Management Tools

- `task_get`: Read task state and output
- `task_stop`: Kill running background task (refactor existing [agent_stop.ts](file:///d:/liteai/packages/core/src/tool/agent_stop.ts))
- `task_list`: List all active/completed tasks

### Phase 4: Coordinator Mode Integration

- Force `shouldRunAsync = true` in coordinator mode
  (model after [coordinatorMode.ts:L553](file:///d:/claude-code/src/tools/AgentTool/AgentTool.tsx#L553))
- All coordinator subagents run as background tasks
- Parent coordinator can manage multiple concurrent agents
- Update coordinator prompt to document `<task-notification>` format
  (model after [coordinatorMode.ts:L111-L369](file:///d:/claude-code/src/coordinator/coordinatorMode.ts#L111-L369))

---

## Key Design Decisions

| Decision | Claude Code | Proposed for LiteAI |
|----------|------------|---------------------|
| Abort isolation | Async agents NOT linked to parent ([L486](file:///d:/claude-code/src/tasks/LocalAgentTask/LocalAgentTask.tsx#L486)) | Same — independent AbortController |
| Notification format | XML `<task-notification>` in synthetic user message ([L252-L257](file:///d:/claude-code/src/tasks/LocalAgentTask/LocalAgentTask.tsx#L252-L257)) | Same pattern via [CorrectionInjector](file:///d:/liteai/packages/core/src/session/engine/correction-injector.ts) |
| Progress tracking | In-memory AppState + periodic LLM summarization | In-memory TaskRegistry, defer summarization |
| Sync → async escape | [backgroundSignal Promise.race](file:///d:/claude-code/src/tools/AgentTool/AgentTool.tsx#L886-L892) | Defer — start with explicit flag only |
| Task persistence | In-memory AppState only | In-memory, consider SQLite for crash recovery |
| Output file | Disk transcript symlink | SSE events (already have session-per-subagent) |
| Status-before-cleanup | [completeAsyncAgent FIRST, then notification](file:///d:/claude-code/src/tools/AgentTool/agentToolUtils.ts#L599-L603) | Same — status transition before notification |
| Priority queue | [`'later'` priority for notifications](file:///d:/claude-code/src/utils/messageQueueManager.ts#L142-L149) | Similar via CorrectionInjector ordering |

## Prerequisites

1. Review [CorrectionInjector.injectNotifications()](file:///d:/liteai/packages/core/src/session/engine/correction-injector.ts#L83-L157) — currently handles
   background commands only, needs extension for task notifications
2. Verify [BackgroundTaskRegistry](file:///d:/liteai/packages/core/src/command/background.ts#L253) can be reused or if a new `TaskRegistry`
   is cleaner (different lifecycle semantics)
3. Design the notification XML schema
4. Prompt engineering: parent LLM must understand async results arrive as
   `<task-notification>` messages, not as tool call results

## Risks

- **Prompt cache invalidation**: Async results arrive as synthetic user
  messages, breaking the cache-identical prefix that fork subagents rely on
- **Ordering**: Multiple async agents may complete in any order — parent
  must handle non-deterministic result arrival
- **Resource pressure**: N concurrent background agents = N× memory/compute
  with no backpressure mechanism
- **Error propagation**: Background agent failures are notifications, not
  exceptions — parent may miss them if not checking task status
