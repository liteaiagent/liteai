# Coordinator Mode + Agent Swarms — Phased Roadmap

> **Package:** `packages/core`  
> **Reference:** `D:\claude-code\src` (coordinator, swarm, teammate, task, and SendMessage subsystems)  
> **Depends On:** Agent Core Architecture (Phases 1–4 ✅), `disallowedTools` enforcement  
> **Last Updated:** 2026-05-10

---

## Overview

This roadmap implements two complementary multi-agent paradigms adapted from the Claude Code reference to LiteAI's multi-tenant HTTP/SSE backend architecture:

1. **Coordinator Mode** — The main agent becomes a pure orchestrator that delegates all real work to workers. Uses a dedicated system prompt, restricted tool pool, and worker capability injection.

2. **Agent Swarms** — A full teammate system where multiple agents run concurrently (in-process), communicate via a structured mailbox protocol, share task lists, and coordinate through shutdown/plan-approval protocols.

### Key Architectural Adaptation

The reference implementation is a **CLI application** (single-tenant, single-process). LiteAI is a **multi-tenant HTTP/SSE backend**. Every reference pattern must be adapted:

| Concern | CLI Reference | LiteAI Adaptation |
|---|---|---|
| Mode detection | `process.env.CLAUDE_CODE_COORDINATOR_MODE` | Session-scoped flag via `Flag` + session state |
| State management | Global `AppState` + React hooks | Session-scoped `AppState` via `AgentExecutionContext` ALS |
| Mailbox storage | `~/.claude/teams/{team}/inboxes/*.json` | `~/.liteai/teams/{team}/inboxes/*.json` (file-based, lock-guarded) |
| Team config | `~/.claude/teams/{team}/config.json` | `~/.liteai/teams/{team}/config.json` |
| Permission bridge | React `setToolUseConfirmQueue` | HTTP/SSE permission events to client |
| Worker context | `AsyncLocalStorage` per process | `AsyncLocalStorage` per in-process worker (shared process) |
| Agent spawn | `runAgent()` in Ink process | `SessionPrompt.runSubagent()` via session engine |

---

## Dependency Chain

```
Phase 0: Permission System Hardening (Subagent attribution, mode activation)
        │
        ▼
Phase 1: Coordinator Mode State Machine + System Prompt
        │
        ▼
Phase 2: SendMessage + Mailbox Protocol + Agent Name Registry
        │
        ▼
Phase 3: In-Process Teammate Runner + Team Lifecycle
        │
        ▼
Phase 4: Permission Synchronization + Verification Agent
```

> **Feature Flag Architecture:** Coordinator mode is gated behind `Flag.LITEAI_COORDINATOR_MODE`. Fork mode and coordinator mode are mutually exclusive — `isForkSubagentEnabled()` already rejects when `context.isCoordinator` is true.

---

## Phase 1: Coordinator Mode State Machine + System Prompt

> **Scope:** Mode detection, session mode persistence, coordinator system prompt, tool filtering, worker capability context injection

### What to Implement

1. **Coordinator mode detection** — `isCoordinatorMode()` reads from `Flag.LITEAI_COORDINATOR_MODE` (session-scoped). Returns `false` if flag not set.

2. **Session mode persistence** — Store `coordinator` | `normal` in session metadata. On session resume, `matchSessionMode()` aligns the flag to the stored mode. Prevents mode drift across restarts.

3. **Coordinator system prompt** — Dedicated ~370-line orchestration prompt covering:
   - Role definition (delegate, don't execute)
   - Tool documentation (task, send_message, task_stop)
   - Worker lifecycle (research → synthesis → implementation → verification)
   - Concurrency management (read-only parallel, write-heavy serialized)
   - Failure handling (continue same worker via send_message)
   - Worker prompt engineering guidelines
   - Continue vs spawn decision matrix

4. **Coordinator tool filtering** — `applyCoordinatorToolFilter()` restricts the coordinator's tool pool to orchestration-only tools: `task`, `send_message`, `task_stop`, `team_create`, `team_delete`, plus `SyntheticOutput` equivalent. All other tools are excluded.

5. **Worker capability context injection** — `getCoordinatorUserContext()` builds a `workerToolsContext` string listing what tools workers have access to, injected into the coordinator's user context. Includes MCP server names.

### Reference Implementation

- [coordinatorMode.ts](file:///D:/claude-code/src/coordinator/coordinatorMode.ts) — Mode detection, system prompt, tool filtering (370 lines)

### Files Affected

| File | Action |
|---|---|
| *(new)* `src/coordinator/coordinator-mode.ts` | **New** — `isCoordinatorMode()`, `matchSessionMode()`, `getCoordinatorUserContext()`, `applyCoordinatorToolFilter()` |
| *(new)* `src/coordinator/coordinator-prompt.ts` | **New** — `getCoordinatorSystemPrompt()` (~370 lines) |
| *(new)* `src/coordinator/index.ts` | **New** — Barrel export |
| `src/flag/flag.ts` | **Modify** — Add `LITEAI_COORDINATOR_MODE` flag |
| `src/session/engine/system.ts` | **Modify** — Inject coordinator system prompt when mode active |
| `src/session/engine/tools.ts` | **Modify** — Apply coordinator tool filter to pool |
| `src/session/index.ts` | **Modify** — Persist/restore session mode field |
| `src/agent/fork.ts` | **Modify** — Wire `ForkGateContext.isCoordinator` to live `isCoordinatorMode()` check |

### Verification

- Typecheck: `bun typecheck`
- Test: `bun test test/coordinator` (new test suite)
- Behavioral: Enable `LITEAI_COORDINATOR_MODE`, verify system prompt swap, tool pool restriction, mode persistence across session resume

---

## Phase 2: SendMessage + Mailbox Protocol + Agent Name Registry

> **Scope:** Expand `send_message` stub into full routing (running/stopped/evicted), add structured message types, file-based mailbox system, agent name registry, broadcast support

### What to Implement

1. **Agent name registry** — `Map<name, agentId>` in session `AppState.agentNameRegistry`. Set at async agent registration (in `runAsyncAgentLifecycle`), used by `send_message` for human-readable addressing.

2. **Full SendMessage routing** — Expand the existing `send_message.ts` stub to handle 3 routing modes:
   - **Running agents**: message queued via `queuePendingMessage()` (already implemented)
   - **Stopped tasks**: auto-resume with message as new prompt via `resumeAgentBackground()` (already implemented)
   - **Evicted tasks**: resume from disk transcript (already implemented)
   - **New**: Teammate mailbox routing for swarm contexts
   - **New**: Broadcast to all teammates (`to: "*"`)

3. **Structured messages** — Add discriminated union schema for structured messages:
   - `shutdown_request` — Leader requests teammate to shut down
   - `shutdown_response` — Teammate approves/rejects shutdown
   - `plan_approval_response` — Leader approves/rejects teammate's plan

4. **Teammate mailbox system** — File-based message queues per agent:
   - Storage: `~/.liteai/teams/{team_name}/inboxes/{agent_name}.json`
   - Operations: `writeToMailbox()`, `readMailbox()`, `markMessageAsReadByIndex()`, `clearMailbox()`
   - File locking via `proper-lockfile` (or equivalent) for concurrent agent safety
   - Message format: `{ from, text, timestamp, read, color?, summary? }`

5. **Idle notification protocol** — When a teammate finishes its current task, it sends an `idle_notification` to the leader's mailbox with completion metadata.

### Reference Implementation

- [SendMessageTool.ts](file:///D:/claude-code/src/tools/SendMessageTool/SendMessageTool.ts) — Full routing (918 lines)
- [teammateMailbox.ts](file:///D:/claude-code/src/utils/teammateMailbox.ts) — File-based mailbox (1184 lines)

### Files Affected

| File | Action |
|---|---|
| `src/tool/send_message.ts` | **Major rewrite** — Full routing, structured messages, broadcast, teammate mailbox integration |
| *(new)* `src/agent/teammate-mailbox.ts` | **New** — File-based mailbox: `writeToMailbox()`, `readMailbox()`, `markMessageAsReadByIndex()`, `clearMailbox()`, message type parsers |
| *(new)* `src/agent/teammate-mailbox.types.ts` | **New** — `TeammateMessage`, `IdleNotificationMessage`, `ShutdownRequestMessage`, `ShutdownApprovedMessage`, `PermissionRequestMessage`, `PermissionResponseMessage` schemas |
| `src/agent/context.ts` | **Modify** — Add `teamContext`, `teamName` to `AppState`; ensure `agentNameRegistry` is properly typed |
| `src/agent/lifecycle.ts` | **Modify** — Register agent name in `agentNameRegistry` during `runAsyncAgentLifecycle()` |

### Verification

- Typecheck: `bun typecheck`
- Test: `bun test test/agent/teammate-mailbox` + `bun test test/tool/send_message`
- Behavioral: Send message to running agent → queued. Send to stopped → resumed. Broadcast → all teammates receive.

---

## Phase 3: In-Process Teammate Runner + Team Lifecycle

> **Scope:** In-process teammate spawning, AsyncLocalStorage context isolation, team create/delete tools, teammate runner with continuous prompt loop, auto-compaction, task claiming

### What to Implement

1. **TeammateContext** — Extend `AgentExecutionContext` with teammate identity isolation:
   - `runWithTeammateContext()` wraps the teammate's entire execution in ALS
   - Carries: `agentId`, `agentName`, `teamName`, `color`, `planModeRequired`, `parentSessionId`
   - Decoupled from parent session's state mutations

2. **In-process teammate spawning** — `spawnInProcessTeammate()`:
   - Creates `TeammateContext` with identity
   - Creates independent `AbortController` (not linked to parent query)
   - Registers `InProcessTeammateTaskState` in parent's `AppState`
   - Returns spawn result with context for the runner

3. **In-process teammate runner** — `runInProcessTeammate()`:
   - Wraps `SessionPrompt.runSubagent()` within `runWithTeammateContext()`
   - Continuous prompt loop: run → idle → wait for message/shutdown → run
   - Mailbox polling (500ms interval) for new messages and shutdown requests
   - Auto-compaction when token count exceeds threshold
   - Task claiming from shared task list
   - Shutdown request → pass to model for decision (approve/reject)
   - Idle notification to leader on completion

4. **TeamCreate tool** — `team_create`:
   - Creates team directory structure: `~/.liteai/teams/{team_name}/`
   - Writes `config.json` with team metadata, leader info, members list
   - Spawns in-process teammates with specified names, colors, prompts
   - Registers cleanup for session exit

5. **TeamDelete tool** — `team_delete`:
   - Sends shutdown requests to all teammates
   - Waits for approval/cleanup
   - Removes team directory structure
   - Cleans up worktrees if any

6. **Team discovery** — Expose team state via SSE events for client UI:
   - `team.created`, `team.deleted` events
   - `teammate.spawned`, `teammate.idle`, `teammate.killed` events
   - Team status via `/session/{id}/team` route

### Reference Implementation

- [inProcessRunner.ts](file:///D:/claude-code/src/utils/swarm/inProcessRunner.ts) — Teammate runner (1553 lines)
- [spawnInProcess.ts](file:///D:/claude-code/src/utils/swarm/spawnInProcess.ts) — Spawn logic (329 lines)
- [teamHelpers.ts](file:///D:/claude-code/src/utils/swarm/teamHelpers.ts) — Team file management (684 lines)

### Files Affected

| File | Action |
|---|---|
| *(new)* `src/agent/teammate-context.ts` | **New** — `TeammateContext` type, `runWithTeammateContext()`, `createTeammateContext()` |
| *(new)* `src/agent/teammate-runner.ts` | **New** — `runInProcessTeammate()`, `startInProcessTeammate()`, idle/shutdown/prompt loop |
| *(new)* `src/agent/teammate-spawn.ts` | **New** — `spawnInProcessTeammate()`, `killInProcessTeammate()` |
| *(new)* `src/agent/team-helpers.ts` | **New** — Team file read/write, member management, cleanup, worktree destruction |
| *(new)* `src/tool/team_create.ts` | **New** — TeamCreate tool definition |
| *(new)* `src/tool/team_delete.ts` | **New** — TeamDelete tool definition |
| *(new)* `src/agent/teammate-types.ts` | **New** — `TeammateIdentity`, `InProcessTeammateTaskState`, `InProcessRunnerConfig`, `InProcessRunnerResult`, `TeamFile` |
| `src/agent/context.ts` | **Modify** — Add `teamContext` to `AppState` with teammate map |
| `src/agent/events.ts` | **Modify** — Add team/teammate events |
| `src/tool/registry.ts` | **Modify** — Register `team_create` and `team_delete` tools |
| `src/session/engine/tools.ts` | **Modify** — Inject team-essential tools into teammate tool pools |

### Verification

- Typecheck: `bun typecheck`
- Test: `bun test test/agent/teammate-runner` + `bun test test/agent/team-helpers`
- Behavioral: Create team → teammates spawn → teammates receive prompts → teammates go idle → leader sends new work → teammates resume → team delete → cleanup

---

## Phase 4: Permission Synchronization + Verification Agent

> **Scope:** Leader ↔ teammate permission bridge, classifier auto-approval for bash commands, permission update propagation, verification agent with read-only enforcement

### What to Implement

1. **Permission synchronization** — Leader ↔ teammate permission bridge:
   - **In-process path**: Teammates use the leader's permission dialog via SSE event bridge. Worker badge in UI shows which teammate is requesting.
   - **Mailbox fallback**: When UI bridge unavailable, teammates send `permission_request` to leader's mailbox, poll their own mailbox for `permission_response`.
   - **Classifier auto-approval**: For bash commands, teammates await the classifier result (don't race against user interaction like the main agent).
   - **Permission update propagation**: When leader grants "always allow", the update is written back to the leader's shared context — preserving the leader's mode.

2. **Swarm permission request/response flow**:
   - Worker creates `SwarmPermissionRequest` with tool details
   - Worker writes request to `~/.liteai/teams/{team}/permissions/pending/`
   - Leader polls pending directory (or receives via mailbox)
   - User approves/rejects via leader's UI
   - Leader writes resolution to `resolved/`, removes from `pending/`
   - Worker polls for resolution

3. **Verification agent** — Read-only agent for post-implementation quality verification:
   - **Tool restrictions**: Disallows `edit`, `write`, `apply_patch`. Allowed to write ephemeral test scripts to temp dir.
   - **Adversarial system prompt** (~130 lines): Strategy matrix per change type, anti-rationalization rules, required command-run evidence format
   - **Output protocol**: Structured `### Check:` blocks with `VERDICT: PASS | FAIL | PARTIAL`
   - **`whenToUse`**: Triggered after non-trivial tasks (3+ file edits, backend/API changes)
   - **Model**: `inherit` (needs full capability)

4. **Guide agent** (lightweight):
   - Documentation assistant with read-only tools + web fetch
   - Cost-optimized model (small/haiku equivalent)
   - `permissionMode: 'dontAsk'`
   - Injects user's configured skills, custom agents, MCP servers into system prompt

### Reference Implementation

- [permissionSync.ts](file:///D:/claude-code/src/utils/swarm/permissionSync.ts) — Permission request/response (929 lines)
- [inProcessRunner.ts:128-451](file:///D:/claude-code/src/utils/swarm/inProcessRunner.ts) — `createInProcessCanUseTool()` (permission bridge)

### Files Affected

| File | Action |
|---|---|
| *(new)* `src/agent/permission-sync.ts` | **New** — `SwarmPermissionRequest` schema, `createPermissionRequest()`, `writePermissionRequest()`, `readPendingPermissions()`, `resolvePermission()`, `sendPermissionRequestViaMailbox()`, `sendPermissionResponseViaMailbox()` |
| *(new)* `src/agent/built-in/verification.ts` | **New** — Verification agent definition with read-only enforcement and adversarial prompt |
| *(new)* `src/agent/built-in/guide.ts` | **New** — Guide agent definition with doc-fetching prompt |
| `src/agent/teammate-runner.ts` | **Modify** — Integrate `createInProcessCanUseTool()` with permission bridge |
| `src/agent/loader.ts` | **Modify** — Register new built-in agents |
| `src/server/routes/` | **Modify** — Add `/session/{id}/permissions` route for SSE permission events |

### Verification

- Typecheck: `bun typecheck`
- Test: `bun test test/agent/permission-sync` + `bun test test/agent/built-in`
- Behavioral: Teammate requests bash permission → appears in leader UI → user approves → teammate proceeds. Verification agent runs read-only → produces VERDICT.

---

## Execution Order

```
1. speckit.specify → Phase 1 spec
2. speckit.plan    → Phase 1 plan
3. speckit.tasks   → Phase 1 tasks
4. speckit.implement → Phase 1 implementation
5. Verify Phase 1 (typecheck, tests)
6. Repeat 1-5 for Phase 2
7. Repeat 1-5 for Phase 3
8. Repeat 1-5 for Phase 4
```

> **Gate:** Phase 2 requires Phase 1 (coordinator mode must exist for tool filtering context).  
> **Gate:** Phase 3 requires Phase 2 (teammate runner needs mailbox and send_message).  
> **Gate:** Phase 4 requires Phase 3 (permission sync needs the in-process runner).

---

## Estimated Complexity

| Phase | New Files | Modified Files | LOC (est.) | Complexity |
|---|---|---|---|---|
| 1 — Coordinator Mode | 3 | 5 | ~600 | Medium |
| 2 — SendMessage + Mailbox | 2 | 3 | ~1200 | High |
| 3 — Teammate Runner + Teams | 7 | 4 | ~2500 | Very High |
| 4 — Permission Sync + Agents | 4 | 3 | ~1500 | High |
| **Total** | **16** | **15** | **~5800** | |

---

## Cross-References

- **Roadmap Prerequisite:** `disallowedTools` enforcement (agent/filter.ts) must be complete before Phase 1 coordinator tool filtering can function.
- **Fork Subagent Exclusivity:** Phase 4 of agents-platform-roadmap.md (Fork Subagent ✅) is mutually exclusive with coordinator mode — `isForkSubagentEnabled()` already rejects when `isCoordinator` is true.
- **Engine Decoupling:** The Checkpointer interface from the engine-decoupling roadmap should be used for any new persistence needs in the teammate runner.
- **Project-Scoped Persistence:** Team directories under `~/.liteai/teams/` should follow the same lifecycle management as project persistence directories.
