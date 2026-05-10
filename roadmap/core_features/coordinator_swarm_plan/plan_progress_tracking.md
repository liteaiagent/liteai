# Coordinator Swarms Implementation Review

> **Reference Path:** `d:\liteai\roadmap\core_features\coordinator_swarm_plan\`
> **Comparison Target:** `D:\claude-code\src`
> **Date:** 2026-05-10

This document reviews the completion status of the Coordinator Swarms architectural roadmap. Phase 1 is officially completed and structurally validated. We will begin the next session targeting Phase 2.

---

## ✅ Phase 1: Coordinator Mode State Machine + System Prompt (COMPLETED)

Phase 1 achieved full feature parity with Claude Code's mode gating and orchestration logic, strictly adapted to LiteAI's multi-tenant architecture. 

**What was done:**
- **Mode Gating (`coordinator-mode.ts`)**: Implemented `isCoordinatorMode()` and `matchSessionMode()` to detect environment variables and persist the mode in the database via `Session.createNext()`.
- **System Prompt (`coordinator-prompt.ts`)**: The ~304-line authoritative orchestration prompt, injected directly into the `query.ts` engine loop when `sessionMode === "Coordinator"`. Enriched to full Claude Code parity (2026-05-10) covering: subagent operation model (context isolation, tool access, execution lifecycle, completion reporting), fork vs fresh worker semantics, parallelism emphasis, verification rigor, task_stop workflow, purpose statement guidance, 6-row continue/spawn decision table, continue mechanics with code examples, expanded good/bad prompt examples, verification-specific directives, and scratchpadDir parameter readiness.
- **Tool Allowlist & Injection**: Implemented `applyCoordinatorToolFilter()` to aggressively strip file-system tools from the coordinator's capability set, and `getCoordinatorUserContext()` to provide workers with visibility into the dynamic MCP context.
- **Tools implementation**: 
  - `task_stop.ts`: Safely aborts running `SessionPrompt` background tasks.
  - `team_create.ts`: Initializes the `~/.liteai/teams/{team_name}` folder structure and updates the root `AppState.teamContext`.
  - `team_delete.ts`: Safely disbands the team, ensuring no active background jobs are abruptly terminated before wiping the file system.

**Anomalies / Explanations:**
- **`isForkSubagentEnabled` Wiring (RESOLVED):** Originally, this gate had no callers because LiteAI's `TaskTool` strictly required a `subagent_type`. We have now refactored `task.ts` to make `subagent_type` optional, and correctly wired `isForkSubagentEnabled` into the Task Tool. If omitted and the gate is active, it seamlessly falls back to spinning up a shared-cache `ForkAgentConfig` fork (aligned 1:1 with Claude Code architecture).

**CRITICAL BUGS & ARCHITECTURAL ISSUES DISCOVERED (REMEDIATED):**
1. **The Root `AppState` Stub Bug (RESOLVED):** 
   - **Fix:** We introduced a stateful `AppState` object directly to the root engine loop (`loop.ts`). Modified `runSessionInner` to properly mount a `RootAgentContext` via `AsyncLocalStorage`, granting all root session tools the ability to robustly access and mutate `teamContext` and `tasks` state without evaporation.

2. **Missing Session Cleanup Tracking (RESOLVED):**
   - **Fix:** Wired team directory deletion dynamically into the engine's `cleanup(sessionID)` phase in `loop.ts`. This ensures canceled/aborted sessions reliably and automatically execute `fs.rm` to tear down transient team folders, plugging the file system leak risk.

3. **Task Directory/Name Registration Omission (RESOLVED):**
   - **Fix:** Refactored swarm tools (`team_create`, `task_stop`, `team_delete`, `send_message`) to consume `AgentExecutionContext.getStore()` predictably. Background tasks and teammates outputs are properly anchored to the root AppState's task definitions, laying the stable foundation required for Phase 2 Mailbox IPC integration.

**Conclusion for Phase 1 Remediation:** The architectural defects preventing mutable state persistence in the coordinator swarm model have been fully eliminated. The foundation is structurally sound, rigorously type-safe, and ready for Phase 2 implementation.

---

## ⏳ Phase 2: SendMessage + Mailbox Protocol (REMAINING)

**Current State:** Not Started (Phase 2).
*Note: `queuePendingMessage` and auto-resume logic already exist as stubs from previous feature sets, but swarm routing is missing.*

**What needs to be implemented:**
1. **Agent Name Registry**: Populate `AppState.agentNameRegistry` during the asynchronous agent lifecycle to allow name-to-id resolving for teammates.
2. **Teammate Mailbox Integration (`teammate-mailbox.ts`)**: File-based lock-guarded message queues (`writeToMailbox`, `readMailbox`, `clearMailbox`) stored in `~/.liteai/teams/{team_name}/inboxes/`.
3. **Structured Swarm Messages**: Implement discriminated union schemas for internal communications (`shutdown_request`, `plan_approval_response`, `idle_notification`).
4. **Broadcast Routing**: Update `send_message.ts` to support wildcard addressing (`to: "*"`).

---

## ⏳ Phase 3: In-Process Teammate Runner (REMAINING)

**Current State:** Not Started.

**What needs to be implemented:**
1. **Teammate Context (`teammate-context.ts`)**: Create `TeammateContext` with `AsyncLocalStorage` isolation to decouple in-process teammates from the parent session's state mutations.
2. **In-Process Runner (`teammate-runner.ts`)**: The core prompt loop wrapping `SessionPrompt.runSubagent()`, including 500ms mailbox polling, task claiming, and idle notification dispatch.
3. **Spawn Mechanics (`teammate-spawn.ts`)**: Wire `team_create` to actually execute `spawnInProcessTeammate()` instead of merely creating the folders.
4. **Team Event Discovery**: Plumb SSE events (`team.created`, `teammate.spawned`, `teammate.idle`) to the client UI.

---

## ⏳ Phase 4: Permission Synchronization & Verification (REMAINING)

**Current State:** Not Started.

**What needs to be implemented:**
1. **Permission Mailbox Bridge**: When teammates encounter a permission blockade, they must write a `SwarmPermissionRequest` to `~/.liteai/teams/{team}/permissions/pending/` and poll their mailbox for the leader's resolution.
2. **Classifier Auto-Approval**: Decouple teammates from racing against the main UI; they must await asynchronous classifier bash command approval.
3. **Verification Agent**: A read-only verification profile that is aggressively locked down (disallowing `edit`, `write`, `apply_patch`), equipped with an adversarial verification prompt (~130 lines).
