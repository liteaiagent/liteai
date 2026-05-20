# Implementation Plan: Async Subagent Dispatch

**Branch**: `015-subagent-async-dispatch` | **Date**: 2026-05-20 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/015-subagent-async-dispatch/spec.md`

## Summary

Currently, `AgentTool.execute` blocks the parent session's execution loop for the entire duration of a subagent run via `await SessionPrompt.runSubagent(...)`. This feature introduces a dual-mode execution model — synchronous (default) and asynchronous (fire-and-forget) — so the parent LLM can dispatch subagents as independent background tasks and receive results via `<task-notification>` messages at turn boundaries.

The design adds a new `TaskRegistry` in `packages/core/src/task/`, refactors `AgentTool` to support a `run_in_background` parameter, extends the existing `CorrectionInjector` notification pipeline, and introduces task management tools (`agent_get`, `agent_list`, `agent_stop`).

**Reference Architecture**: [D:\claude-code\src\tools\AgentTool](file:///d:/claude-code/src/tools/AgentTool) — Claude Code's dual-mode agent dispatch model. Key reference files:
- [AgentTool.tsx](file:///d:/claude-code/src/tools/AgentTool/AgentTool.tsx) — `shouldRunAsync` gate (L567), async path (L686-L764), sync path (L765-L1050)
- [agentToolUtils.ts](file:///d:/claude-code/src/tools/AgentTool/agentToolUtils.ts) — `runAsyncAgentLifecycle()` (L508-L686), status-before-cleanup ordering (L599-L603)
- [LocalAgentTask.tsx](file:///d:/claude-code/src/tasks/LocalAgentTask/LocalAgentTask.tsx) — `LocalAgentTaskState` (L116-L148), `registerAsyncAgent()` (L466-L515), independent AbortController (L486), `enqueueAgentNotification()` (L197-L262)
- [Task.ts](file:///d:/claude-code/src/Task.ts) — Base types: `TaskType`, `TaskStatus`, `TaskHandle`, `isTerminalTaskStatus()` (L27-L29)
- [coordinatorMode.ts](file:///d:/claude-code/src/coordinator/coordinatorMode.ts) — Coordinator prompt with `<task-notification>` documentation (L111-L369)
- [messageQueueManager.ts](file:///d:/claude-code/src/utils/messageQueueManager.ts) — Priority-based notification queue (L142-L149)

## Technical Context

**Language/Version**: TypeScript (strict mode), Bun runtime

**Primary Dependencies**: zod (schema validation), effect/Schema (branded types), @liteai/util/log (structured logging)

**Storage**: SQLite via existing `SqliteCheckpointer` (session persistence). TaskRegistry is in-memory — mirrors existing `BackgroundTaskRegistry` pattern.

**Testing**: Bun's built-in test runner, scoped to modified domains

**Target Platform**: Windows primary, Node.js-compatible Bun runtime

**Project Type**: Multi-tenant HTTP/SSE backend (`packages/core`)

**Performance Goals**: Task launch < 100ms, notification delivery within one turn boundary, 5+ concurrent background agents without parent degradation

**Constraints**: Non-blocking, strict tenant isolation, in-memory task state (no crash recovery in v1)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Architectural Purity | ✅ PASS | Clean break — new `task/` module, no backward compat shims |
| II. Non-Blocking Performance | ✅ PASS | Core objective: fire-and-forget async dispatch eliminates parent blocking |
| III. Strict Type Safety | ✅ PASS | Branded `TaskID`, strict `TaskStatus` union, zod schemas for all tool params |
| IV. Fail-Fast Error Handling | ✅ PASS | Task failures → structured error in notification, never silently dropped |
| V. Design-First Development | ✅ PASS | This plan is the design artifact; two alternatives evaluated in research.md |
| VI. Test Integrity & Isolation | ✅ PASS | Hermetic tests with isolated `TaskRegistry` instances, no global mocking |
| VII. Incremental Scope | ✅ PASS | Scoped to 4 phases, nested async + auto-background explicitly deferred |

No gate violations.

## Project Structure

### Documentation (this feature)

```text
specs/015-subagent-async-dispatch/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   └── task-tool-schemas.md
└── tasks.md             # Phase 2 output (/speckit-tasks)
```

### Source Code (repository root)

```text
packages/core/src/
├── task/                          # [NEW] Task lifecycle module
│   ├── task.ts                    # TaskID branded type, TaskStatus, TaskState, TaskProgress
│   ├── registry.ts                # AgentTaskRegistry — in-memory per-instance registry
│   └── lifecycle.ts               # runAsyncAgentLifecycle() — background agent driver
│
├── tool/
│   ├── agent.ts                   # [MODIFY] Add run_in_background, dual-mode dispatch
│   ├── agent_stop.ts              # [MODIFY] Refactor to use AgentTaskRegistry
│   ├── agent_get.ts               # agent_get tool — query task status/result
│   ├── agent_list.ts              # agent_list tool — list all tasks
│   ├── registry.ts                # [MODIFY] Register new tools
│   └── index.ts                   # [MODIFY] Re-export new tools
│
├── session/engine/
│   ├── correction-injector.ts     # [MODIFY] Extend to drain AgentTaskRegistry notifications
│   ├── loop.ts                    # [MODIFY] Wire AgentTaskRegistry into runSession/runSubagent
│   └── namespace.ts               # [MODIFY] Export runSubagentAsync if needed
│
├── agent/
│   ├── context.ts                 # [MODIFY] Extend AppState.tasks type for agent tasks
│   └── filter.ts                  # [MODIFY] Add task tools to ASYNC_AGENT_ALLOWED_TOOLS
│
├── coordinator/
│   └── coordinator-mode.ts        # [MODIFY] Add task tools to COORDINATOR_ALLOWED_TOOLS, force async
│
└── bundled/prompts/tools/
    └── agent.txt                  # [MODIFY] Document run_in_background in tool description
```

**Structure Decision**: The new `task/` module is a peer to the existing `command/` directory (which contains `BackgroundTaskRegistry` for shell processes). This separation is intentional: `command/background.ts` manages child processes (ChildProcess lifecycle), while `task/` manages agent sessions (Session lifecycle). They share the notification pipeline in `CorrectionInjector` but have fundamentally different lifecycle semantics.

## Complexity Tracking

No constitution violations to justify.
