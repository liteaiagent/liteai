# Quickstart: Async Subagent Dispatch

**Branch**: `015-subagent-async-dispatch` | **Date**: 2026-05-20

## Overview

This feature adds fire-and-forget background agent execution to LiteAI's core. Subagents can run independently while the parent session continues processing.

## Key Concepts

### Dual-Mode Execution

The `agent` tool now supports two modes:

- **Sync (default)**: `await runSubagent(...)` — parent blocks until subagent completes. Unchanged from current behavior.
- **Async**: Fire-and-forget — parent receives immediate acknowledgment, subagent runs in background, result delivered via `<task-notification>`.

### Task Lifecycle

```
register → pending → running → completed / failed / killed
```

Tasks are tracked in the instance-scoped `AgentTaskRegistry`. Each task owns an independent `AbortController` (not linked to parent).

### Notification Flow

```
1. AgentTool dispatches async agent → runAsyncAgentLifecycle() (detached promise)
2. Parent continues processing other tool calls
3. Subagent completes → status transition in AgentTaskRegistry
4. Next turn boundary → CorrectionInjector drains registry → <task-notification> injected
5. Parent LLM reads notification and acts on result
```

## Usage Patterns

### LLM: Dispatch Background Agent

```json
{
  "name": "agent",
  "input": {
    "description": "Research API patterns",
    "prompt": "Find and document all REST API patterns used in the codebase",
    "subagent_type": "explore",
    "run_in_background": true
  }
}
```

### LLM: Query Task Status

```json
{
  "name": "task_get",
  "input": { "task_id": "task_01JWRX..." }
}
```

### LLM: List All Tasks

```json
{
  "name": "task_list",
  "input": { "status_filter": "running" }
}
```

### LLM: Stop a Task

```json
{
  "name": "task_stop",
  "input": { "task_id": "task_01JWRX..." }
}
```

### Coordinator Mode (Automatic)

In coordinator mode, ALL agent dispatches are forced to background:

```json
{
  "name": "agent",
  "input": {
    "description": "Fix unit tests",
    "prompt": "Fix all failing tests in packages/core/test/sessions",
    "subagent_type": "liteai"
  }
}
```
→ Automatically runs as background task (no `run_in_background` needed).

## Architecture

### New Module: `packages/core/src/task/`

| File | Purpose |
|------|---------|
| `task.ts` | `TaskID` branded type, `TaskStatus`, `TaskState`, `TaskProgress` types |
| `registry.ts` | `AgentTaskRegistry` — instance-scoped in-memory task store |
| `lifecycle.ts` | `runAsyncAgentLifecycle()` — detached promise that drives the background agent |

### Modified Files

| File | Change |
|------|--------|
| `tool/agent.ts` | Add `run_in_background` param, dual-mode dispatch |
| `tool/agent_stop.ts` | Rename to `task_stop`, use `AgentTaskRegistry` |
| `tool/registry.ts` | Register `task_get`, `task_list`, `task_stop` |
| `session/engine/correction-injector.ts` | Extend to drain agent task notifications |
| `session/engine/loop.ts` | Wire `AgentTaskRegistry` into session lifecycle |
| `agent/context.ts` | Add `AgentTaskState` to `AppState.tasks` union |
| `coordinator/coordinator-mode.ts` | Add task tools to allowed set, force async |

## Limitations (v1)

- **No nested async**: Background subagents run their sub-calls synchronously
- **No auto-background**: No timer-based sync→async conversion
- **In-memory only**: Task state does not survive process restart
- **No inter-agent messaging**: Background agents cannot send messages to each other (deferred to SendMessage tool extension)
