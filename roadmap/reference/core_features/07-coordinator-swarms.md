# LiteAI Core — Coordinator Mode & Agent Swarms

> **Scope:** `src/coordinator/`, `src/permission/teammate-classifier.ts`, `src/tool/task.ts`, `src/tool/send_message.ts`, `src/tool/team_create.ts`, `src/tool/team_delete.ts`  
> **Last audited:** 2026-05-10  
> **Roadmap:** [Coordinator Swarm Plan](../coordinator_swarm_plan/)

---

## 1. Coordinator Mode (State Machine)

Session-scoped orchestrator mode that replaces the agent's normal system prompt with a dedicated orchestration prompt and restricts the tool pool to delegation-only tools.

| Feature | Status | Source |
|---|:---:|---|
| Mode detection (`isCoordinatorMode()`) | ✅ | [`coordinator-mode.ts`](../../packages/core/src/coordinator/coordinator-mode.ts) |
| Session mode persistence (`matchSessionMode()`) | ✅ | [`coordinator-mode.ts`](../../packages/core/src/coordinator/coordinator-mode.ts) |
| Coordinator system prompt (~330 lines) | ✅ | [`coordinator-prompt.ts`](../../packages/core/src/coordinator/coordinator-prompt.ts) |
| Tool pool filter (`applyCoordinatorToolFilter()`) | ✅ | [`coordinator-mode.ts`](../../packages/core/src/coordinator/coordinator-mode.ts) |
| Worker capability context injection | ✅ | [`coordinator-mode.ts`](../../packages/core/src/coordinator/coordinator-mode.ts) `getCoordinatorUserContext()` |
| Scratchpad directory injection | ✅ | [`coordinator-prompt.ts`](../../packages/core/src/coordinator/coordinator-prompt.ts) `scratchpadDir` param |
| Environment context injection | ✅ | [`engine/query.ts`](../../packages/core/src/session/engine/query.ts) via `SystemPrompt.environment()` |
| Fork/Coordinator mutual exclusion | ✅ | [`agent/fork.ts`](../../packages/core/src/agent/fork.ts) `isForkSubagentEnabled()` |
| `LITEAI_COORDINATOR_MODE` flag | ✅ | [`flag/flag.ts`](../../packages/core/src/flag/flag.ts) |

> **Architecture:** Coordinator mode is session-scoped via `Flag.LITEAI_COORDINATOR_MODE`. Mode is persisted in session metadata and restored on resume via `matchSessionMode()`. Fork mode and coordinator mode are mutually exclusive.

---

## 2. Coordinator Tools

Orchestration-only tools available to the coordinator. All other tools (file I/O, shell, etc.) are stripped from the coordinator's tool pool.

| Tool | Status | Source |
|---|:---:|---|
| `task` (spawn worker / fork) | ✅ | [`tool/task.ts`](../../packages/core/src/tool/task.ts) |
| `send_message` (continue worker) | ✅ | [`tool/send_message.ts`](../../packages/core/src/tool/send_message.ts) |
| `task_stop` (stop worker) | ✅ | [`tool/task_stop.ts`](../../packages/core/src/tool/task_stop.ts) |
| `team_create` (create team + spawn teammates) | ✅ | [`tool/team_create.ts`](../../packages/core/src/tool/team_create.ts) |
| `team_delete` (disband team + force-kill) | ✅ | [`tool/team_delete.ts`](../../packages/core/src/tool/team_delete.ts) |
| `yield_turn` (wait for workers) | ✅ | [`tool/yield_turn.ts`](../../packages/core/src/tool/yield_turn.ts) |
| `structured_output` (coordinator allowlisted) | ✅ | [`tool/structured_output.ts`](../../packages/core/src/tool/structured_output.ts) |

---

## 3. SendMessage & Mailbox Protocol

Structured inter-agent communication with file-based mailbox persistence and broadcast support.

### 3.1 — Message Routing

| Feature | Status | Source |
|---|:---:|---|
| Running agent → queue pending message | ✅ | [`tool/send_message.ts`](../../packages/core/src/tool/send_message.ts) |
| Stopped agent → auto-resume with prompt | ✅ | [`tool/send_message.ts`](../../packages/core/src/tool/send_message.ts) |
| Teammate mailbox routing | ✅ | [`tool/send_message.ts`](../../packages/core/src/tool/send_message.ts) |
| Broadcast to all teammates (`to: "*"`) | ✅ | [`tool/send_message.ts`](../../packages/core/src/tool/send_message.ts) |
| Agent name registry (`agentNameRegistry`) | ✅ | [`agent/context.ts`](../../packages/core/src/agent/context.ts) `AppState` |

### 3.2 — Teammate Mailbox

| Feature | Status | Source |
|---|:---:|---|
| File-based inbox storage | ✅ | [`coordinator/teammate-mailbox.ts`](../../packages/core/src/coordinator/teammate-mailbox.ts) |
| `proper-lockfile` concurrency guard | ✅ | [`coordinator/teammate-mailbox.ts`](../../packages/core/src/coordinator/teammate-mailbox.ts) |
| `writeToMailbox()` | ✅ | [`coordinator/teammate-mailbox.ts`](../../packages/core/src/coordinator/teammate-mailbox.ts) |
| `readMailbox()` | ✅ | [`coordinator/teammate-mailbox.ts`](../../packages/core/src/coordinator/teammate-mailbox.ts) |
| `markMessageAsReadByIndex()` | ✅ | [`coordinator/teammate-mailbox.ts`](../../packages/core/src/coordinator/teammate-mailbox.ts) |
| `clearMailbox()` | ✅ | [`coordinator/teammate-mailbox.ts`](../../packages/core/src/coordinator/teammate-mailbox.ts) |

### 3.3 — Structured Swarm Messages

| Feature | Status | Source |
|---|:---:|---|
| `idle_notification` schema | ✅ | [`coordinator/swarm-messages.ts`](../../packages/core/src/coordinator/swarm-messages.ts) |
| `shutdown_request` schema | ✅ | [`coordinator/swarm-messages.ts`](../../packages/core/src/coordinator/swarm-messages.ts) |
| `shutdown_approved` / `shutdown_rejected` | ✅ | [`coordinator/swarm-messages.ts`](../../packages/core/src/coordinator/swarm-messages.ts) |
| `plan_approval_request` / `plan_approval_response` | ✅ | [`coordinator/swarm-messages.ts`](../../packages/core/src/coordinator/swarm-messages.ts) |

---

## 4. In-Process Teammate Runner

Full in-process teammate execution with `AsyncLocalStorage` context isolation, continuous prompt loop, and mailbox polling.

### 4.1 — Type Foundation

| Feature | Status | Source |
|---|:---:|---|
| `TeammateIdentity` type | ✅ | [`coordinator/teammate-types.ts`](../../packages/core/src/coordinator/teammate-types.ts) |
| `TeammateTaskState` type | ✅ | [`coordinator/teammate-types.ts`](../../packages/core/src/coordinator/teammate-types.ts) |
| `TeammateStatus` union | ✅ | [`coordinator/teammate-types.ts`](../../packages/core/src/coordinator/teammate-types.ts) |
| `formatAgentId()` / `parseAgentId()` | ✅ | [`coordinator/teammate-types.ts`](../../packages/core/src/coordinator/teammate-types.ts) |
| `appendCappedMessage()` (UI message cap) | ✅ | [`coordinator/teammate-types.ts`](../../packages/core/src/coordinator/teammate-types.ts) |
| `isTeammateTask()` guard | ✅ | [`coordinator/teammate-types.ts`](../../packages/core/src/coordinator/teammate-types.ts) |

### 4.2 — Agent Context & Isolation

| Feature | Status | Source |
|---|:---:|---|
| `TeammateAgentContext` (full execution context) | ✅ | [`agent/context.ts`](../../packages/core/src/agent/context.ts) |
| `AsyncLocalStorage<TeammateAgentContext>` | ✅ | [`coordinator/teammate-context.ts`](../../packages/core/src/coordinator/teammate-context.ts) |
| `createTeammateContext()` factory | ✅ | [`coordinator/teammate-context.ts`](../../packages/core/src/coordinator/teammate-context.ts) |
| `runWithTeammateContext()` ALS wrapper | ✅ | [`coordinator/teammate-context.ts`](../../packages/core/src/coordinator/teammate-context.ts) |
| `isInProcessTeammate()` / `getTeammateContext()` | ✅ | [`coordinator/teammate-context.ts`](../../packages/core/src/coordinator/teammate-context.ts) |
| Deep-cloned AppState snapshot per teammate | ✅ | [`coordinator/teammate-context.ts`](../../packages/core/src/coordinator/teammate-context.ts) |
| Forced `shouldAvoidPermissionPrompts` | ✅ | [`coordinator/teammate-context.ts`](../../packages/core/src/coordinator/teammate-context.ts) |

### 4.3 — Spawn & Lifecycle

| Feature | Status | Source |
|---|:---:|---|
| `spawnInProcessTeammate()` | ✅ | [`coordinator/teammate-spawn.ts`](../../packages/core/src/coordinator/teammate-spawn.ts) |
| `killInProcessTeammate()` (atomic abort + cleanup) | ✅ | [`coordinator/teammate-spawn.ts`](../../packages/core/src/coordinator/teammate-spawn.ts) |
| Independent `AbortController` per teammate | ✅ | [`coordinator/teammate-spawn.ts`](../../packages/core/src/coordinator/teammate-spawn.ts) |
| `AppState.tasks` registration | ✅ | [`coordinator/teammate-spawn.ts`](../../packages/core/src/coordinator/teammate-spawn.ts) |
| `agentType` support (built-in profiles) | ✅ | [`coordinator/teammate-spawn.ts`](../../packages/core/src/coordinator/teammate-spawn.ts) |

### 4.4 — Core Runner Loop

| Feature | Status | Source |
|---|:---:|---|
| `runInProcessTeammate()` (persistent loop) | ✅ | [`coordinator/teammate-runner.ts`](../../packages/core/src/coordinator/teammate-runner.ts) |
| `startInProcessTeammate()` (fire-and-forget) | ✅ | [`coordinator/teammate-runner.ts`](../../packages/core/src/coordinator/teammate-runner.ts) |
| Per-iteration `SessionPrompt.runSubagent()` | ✅ | [`coordinator/teammate-runner.ts`](../../packages/core/src/coordinator/teammate-runner.ts) |
| 500ms mailbox polling | ✅ | [`coordinator/teammate-runner.ts`](../../packages/core/src/coordinator/teammate-runner.ts) |
| Shutdown request passthrough to model | ✅ | [`coordinator/teammate-runner.ts`](../../packages/core/src/coordinator/teammate-runner.ts) |
| Abort-aware sleep | ✅ | [`coordinator/teammate-runner.ts`](../../packages/core/src/coordinator/teammate-runner.ts) |
| Per-turn `AbortController` linked to lifecycle | ✅ | [`coordinator/teammate-runner.ts`](../../packages/core/src/coordinator/teammate-runner.ts) |
| Built-in agent profile injection (system prompt + critical reminder) | ✅ | [`coordinator/teammate-runner.ts`](../../packages/core/src/coordinator/teammate-runner.ts) |

### 4.5 — Events & Prompt

| Feature | Status | Source |
|---|:---:|---|
| `TeammateEvent.Spawned` | ✅ | [`coordinator/teammate-events.ts`](../../packages/core/src/coordinator/teammate-events.ts) |
| `TeammateEvent.Idle` | ✅ | [`coordinator/teammate-events.ts`](../../packages/core/src/coordinator/teammate-events.ts) |
| `TeammateEvent.Active` | ✅ | [`coordinator/teammate-events.ts`](../../packages/core/src/coordinator/teammate-events.ts) |
| `TeammateEvent.Killed` | ✅ | [`coordinator/teammate-events.ts`](../../packages/core/src/coordinator/teammate-events.ts) |
| System prompt addendum (teammate constraints) | ✅ | [`coordinator/teammate-prompt-addendum.ts`](../../packages/core/src/coordinator/teammate-prompt-addendum.ts) |

---

## 5. Permission Synchronization

Dual-transport permission bridge enabling teammates to request tool use approval from the leader.

### 5.1 — Permission Sync Foundation

| Feature | Status | Source |
|---|:---:|---|
| `SwarmPermissionRequest` schema (Zod) | ✅ | [`coordinator/permission-sync.ts`](../../packages/core/src/coordinator/permission-sync.ts) |
| `PermissionResolution` schema | ✅ | [`coordinator/permission-sync.ts`](../../packages/core/src/coordinator/permission-sync.ts) |
| `PermissionSuggestion` schema | ✅ | [`coordinator/permission-sync.ts`](../../packages/core/src/coordinator/permission-sync.ts) |
| `createPermissionRequest()` factory | ✅ | [`coordinator/permission-sync.ts`](../../packages/core/src/coordinator/permission-sync.ts) |
| File-based pending/resolved storage | ✅ | [`coordinator/permission-sync.ts`](../../packages/core/src/coordinator/permission-sync.ts) |
| Atomic writes (`.tmp` → rename) | ✅ | [`coordinator/permission-sync.ts`](../../packages/core/src/coordinator/permission-sync.ts) |
| `cleanupOldResolutions()` disk hygiene | ✅ | [`coordinator/permission-sync.ts`](../../packages/core/src/coordinator/permission-sync.ts) |

### 5.2 — Permission Bridge (Dual-Transport)

| Feature | Status | Source |
|---|:---:|---|
| `PermissionBridge` singleton | ✅ | [`coordinator/permission-bridge.ts`](../../packages/core/src/coordinator/permission-bridge.ts) |
| In-process path (Deferred promise) | ✅ | [`coordinator/permission-bridge.ts`](../../packages/core/src/coordinator/permission-bridge.ts) |
| File-based fallback (polling) | ✅ | [`coordinator/permission-bridge.ts`](../../packages/core/src/coordinator/permission-bridge.ts) |
| Handler registration / unregistration | ✅ | [`coordinator/permission-bridge.ts`](../../packages/core/src/coordinator/permission-bridge.ts) |
| Abort signal support | ✅ | [`coordinator/permission-bridge.ts`](../../packages/core/src/coordinator/permission-bridge.ts) |
| `TeammatePermissionEvent.Asked` / `.Resolved` | ✅ | [`coordinator/permission-bridge.ts`](../../packages/core/src/coordinator/permission-bridge.ts) |
| Pending request inspection | ✅ | [`coordinator/permission-bridge.ts`](../../packages/core/src/coordinator/permission-bridge.ts) |

### 5.3 — Leader Bridge Handler

| Feature | Status | Source |
|---|:---:|---|
| `setupPermissionBridgeHandler()` | ✅ | [`coordinator/permission-bridge-handler.ts`](../../packages/core/src/coordinator/permission-bridge-handler.ts) |
| `PermissionDecisionCallback` for UI | ✅ | [`coordinator/permission-bridge-handler.ts`](../../packages/core/src/coordinator/permission-bridge-handler.ts) |
| `resolveFileBasedPermission()` | ✅ | [`coordinator/permission-bridge-handler.ts`](../../packages/core/src/coordinator/permission-bridge-handler.ts) |
| Bus event publication for SSE consumers | ✅ | [`coordinator/permission-bridge-handler.ts`](../../packages/core/src/coordinator/permission-bridge-handler.ts) |

### 5.4 — PermissionService Integration

| Feature | Status | Source |
|---|:---:|---|
| Teammate bridge path in `ask()` | ✅ | [`permission/service.ts`](../../packages/core/src/permission/service.ts) |
| Classifier pre-approval → bridge forward | ✅ | [`permission/service.ts`](../../packages/core/src/permission/service.ts) |
| Fallback to `PrePermissionDeny` hook | ✅ | [`permission/service.ts`](../../packages/core/src/permission/service.ts) |

### 5.5 — Teammate Classifier

| Feature | Status | Source |
|---|:---:|---|
| `tryTeammateClassifier()` pre-approval | ✅ | [`permission/teammate-classifier.ts`](../../packages/core/src/permission/teammate-classifier.ts) |
| Command permission pre-filter | ✅ | [`permission/teammate-classifier.ts`](../../packages/core/src/permission/teammate-classifier.ts) |
| Pseudo-transcript builder | ✅ | [`permission/teammate-classifier.ts`](../../packages/core/src/permission/teammate-classifier.ts) |
| 10s classifier timeout | ✅ | [`permission/teammate-classifier.ts`](../../packages/core/src/permission/teammate-classifier.ts) |
| `ClassifierUnavailableError` handling | ✅ | [`permission/teammate-classifier.ts`](../../packages/core/src/permission/teammate-classifier.ts) |

> **Architecture:** Permissions use a dual-transport model:
> - **Primary (in-process):** Handler registration + `Deferred` promise resolution for same-process teammates.
> - **Fallback (file-based):** Atomic writes to `permissions/pending/` with polling at 500ms. Supports future cross-process teammates.
> - **Propagation:** "Always allow" rules are scoped to the requesting teammate only — no team-wide propagation.

---

## 6. Built-in Agent Profiles

Specialized agent profiles with tool restrictions, system prompt overrides, and model selection policies.

### 6.1 — Registry

| Feature | Status | Source |
|---|:---:|---|
| `BuiltInAgentProfile` interface | ✅ | [`coordinator/built-in-agents.ts`](../../packages/core/src/coordinator/built-in-agents.ts) |
| `getBuiltInAgents()` (unconditional) | ✅ | [`coordinator/built-in-agents.ts`](../../packages/core/src/coordinator/built-in-agents.ts) |
| `findBuiltInAgent()` by type | ✅ | [`coordinator/built-in-agents.ts`](../../packages/core/src/coordinator/built-in-agents.ts) |
| `isBuiltInAgentType()` check | ✅ | [`coordinator/built-in-agents.ts`](../../packages/core/src/coordinator/built-in-agents.ts) |

### 6.2 — Verification Agent

| Feature | Status | Source |
|---|:---:|---|
| Read-only tool enforcement | ✅ | [`coordinator/verification-agent.ts`](../../packages/core/src/coordinator/verification-agent.ts) |
| Disallowed tools list (write/edit/delete/patch) | ✅ | [`coordinator/verification-agent.ts`](../../packages/core/src/coordinator/verification-agent.ts) |
| Adversarial system prompt (~130 lines) | ✅ | [`coordinator/verification-agent.ts`](../../packages/core/src/coordinator/verification-agent.ts) |
| VERDICT: PASS / FAIL / PARTIAL reporting | ✅ | [`coordinator/verification-agent.ts`](../../packages/core/src/coordinator/verification-agent.ts) |
| Critical reminder (anti-drift) | ✅ | [`coordinator/verification-agent.ts`](../../packages/core/src/coordinator/verification-agent.ts) |
| Category-specific verification strategies | ✅ | [`coordinator/verification-agent.ts`](../../packages/core/src/coordinator/verification-agent.ts) |
| Coordinator prompt documentation | ✅ | [`coordinator/coordinator-prompt.ts`](../../packages/core/src/coordinator/coordinator-prompt.ts) |

### 6.3 — Guide Agent (Planned)

| Feature | Status | Source |
|---|:---:|---|
| Documentation assistant with read-only tools + web fetch | ❌ | Planned |
| Cost-optimized model (small/haiku equivalent) | ❌ | Planned |
| Skills/MCP context injection | ❌ | Planned |

---

## 7. Team Helpers & Infrastructure

| Feature | Status | Source |
|---|:---:|---|
| Team directory management | ✅ | [`coordinator/team-helpers.ts`](../../packages/core/src/coordinator/team-helpers.ts) |
| Team name sanitization | ✅ | [`coordinator/team-helpers.ts`](../../packages/core/src/coordinator/team-helpers.ts) |
| Team config read/write | ✅ | [`coordinator/team-helpers.ts`](../../packages/core/src/coordinator/team-helpers.ts) |
| Team directory cleanup on session exit | ✅ | [`coordinator/team-helpers.ts`](../../packages/core/src/coordinator/team-helpers.ts) |
| Scratchpad directory (`teamScratchpadDir()`) | ✅ | [`coordinator/team-helpers.ts`](../../packages/core/src/coordinator/team-helpers.ts) |
| Barrel export (`coordinator/index.ts`) | ✅ | [`coordinator/index.ts`](../../packages/core/src/coordinator/index.ts) |

---

## 8. StructuredOutput Tool (Coordinator Scoping)

| Feature | Status | Source |
|---|:---:|---|
| `structured_output` as proper `Tool.Info` | ✅ | [`tool/structured_output.ts`](../../packages/core/src/tool/structured_output.ts) |
| `STRUCTURED_OUTPUT_TOOL_NAME` constant | ✅ | [`tool/structured_output.ts`](../../packages/core/src/tool/structured_output.ts) |
| WeakMap schema caching | ✅ | [`tool/structured_output.ts`](../../packages/core/src/tool/structured_output.ts) |
| Coordinator allowlist entry | ✅ | [`coordinator/coordinator-mode.ts`](../../packages/core/src/coordinator/coordinator-mode.ts) |
| Excluded from `ToolRegistry.all()` (injected on demand) | ✅ | [`tool/structured_output.ts`](../../packages/core/src/tool/structured_output.ts) |

---

## Summary

| Category | ✅ | 🔶 | ❌ | Total |
|---|:---:|:---:|:---:|:---:|
| Coordinator Mode | 9 | 0 | 0 | 9 |
| Coordinator Tools | 7 | 0 | 0 | 7 |
| Message Routing | 5 | 0 | 0 | 5 |
| Teammate Mailbox | 6 | 0 | 0 | 6 |
| Structured Swarm Messages | 4 | 0 | 0 | 4 |
| Type Foundation | 6 | 0 | 0 | 6 |
| Agent Context & Isolation | 7 | 0 | 0 | 7 |
| Spawn & Lifecycle | 5 | 0 | 0 | 5 |
| Core Runner Loop | 8 | 0 | 0 | 8 |
| Events & Prompt | 5 | 0 | 0 | 5 |
| Permission Sync Foundation | 7 | 0 | 0 | 7 |
| Permission Bridge | 7 | 0 | 0 | 7 |
| Leader Bridge Handler | 4 | 0 | 0 | 4 |
| PermissionService Integration | 3 | 0 | 0 | 3 |
| Teammate Classifier | 5 | 0 | 0 | 5 |
| Built-in Registry | 4 | 0 | 0 | 4 |
| Verification Agent | 7 | 0 | 0 | 7 |
| Guide Agent | 0 | 0 | 3 | 3 |
| Team Helpers | 6 | 0 | 0 | 6 |
| StructuredOutput Scoping | 5 | 0 | 0 | 5 |
| **Total** | **114** | **0** | **3** | **117** |
