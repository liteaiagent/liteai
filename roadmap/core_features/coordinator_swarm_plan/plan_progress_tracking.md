# Coordinator Swarms Implementation Review

> **Reference Path:** `d:\liteai\roadmap\core_features\coordinator_swarm_plan\`
> **Comparison Target:** `D:\claude-code\src`
> **Last Updated:** 2026-05-10

---

## ✅ Phase 1: Coordinator Mode State Machine + System Prompt (COMPLETED)

Phase 1 achieved full feature parity with Claude Code's mode gating and orchestration logic, strictly adapted to LiteAI's multi-tenant architecture. 

**What was delivered:**
- **Mode Gating (`coordinator-mode.ts`)**: `isCoordinatorMode()` and `matchSessionMode()` for environment + session-mode detection and drift reconciliation.
- **System Prompt (`coordinator-prompt.ts`)**: ~304-line authoritative orchestration prompt with full Claude Code parity — subagent operation model, fork vs fresh semantics, parallelism emphasis, task_stop workflow, 6-row continue/spawn decision table, scratchpadDir parameter.
- **Tool Allowlist & Injection**: `applyCoordinatorToolFilter()` strips file-system tools; `getCoordinatorUserContext()` provides dynamic MCP context to workers.
- **Tools**: `task_stop.ts`, `team_create.ts`, `team_delete.ts`.
- **Fork Gate Wiring**: `isForkSubagentEnabled` wired into TaskTool with optional `subagent_type`.

**Critical Bugs Remediated:**
1. Root `AppState` stub bug — introduced stateful `AppState` with `RootAgentContext` via `AsyncLocalStorage`.
2. Missing session cleanup — wired team directory deletion into engine `cleanup()` phase.
3. Task directory/name registration — refactored swarm tools to consume `AgentExecutionContext.getStore()` predictably.

---

## ✅ Phase 2: SendMessage + Mailbox Protocol (COMPLETED)

**What was delivered:**
- **Teammate Mailbox (`teammate-mailbox.ts`)**: File-based, lock-guarded JSON inbox storage under `~/.liteai/teams/{teamName}/inboxes/{agentName}.json` with `proper-lockfile` concurrency.
- **Structured Swarm Messages (`swarm-messages.ts`)**: Zod schemas for `idle_notification`, `shutdown_request`, `shutdown_approved/rejected`, `plan_approval_request/response` (stubbed).
- **Agent Name Registry**: Hooked into `runAsyncAgentLifecycle` for automatic spawn/teardown name-to-ID mapping.
- **`send_message` Refactor**: Hybrid routing — broadcast (`to: "*"`), teammate mailbox routing, legacy subagent fallback. Structured IPC dispatch with auto UUID injection.

**Validation:** 47 tests passing, 100% type-safe, lint-clean.

---

## ✅ Phase 2.5: Filtering & Integration Hardening (COMPLETED)

Audit and gap closure for the filtering/wiring layer, achieving full Claude Code architectural parity.

**What was delivered:**
- **StructuredOutput Tool Architecture**: Refactored from inline AI SDK `tool()` injection to a proper `Tool.Info` definition (`structured_output.ts`) with `STRUCTURED_OUTPUT_TOOL_NAME` constant, WeakMap schema caching, and explicit coordinator allowlist entry — matching Claude Code's `SyntheticOutputTool` pattern.
- **StructuredOutput Scoping**: Base tool intentionally excluded from `ToolRegistry.all()` (like Claude Code's `specialTools` filter). Only enters tool pool when SDK caller requests `json_schema` format. Subagents/workers never see it.
- **Tool Injection Order**: Schema-validated variant injected BEFORE coordinator filter, making the allowlist the single source of truth for coordinator tool visibility.

**Remaining (deferred to Phase 3 implementation):**
- Environment context injection (`SystemPrompt.environment(model)`) in coordinator system prompt.
- Scratchpad directory wiring via `teamScratchpadDir()`.
- Integration test for `query.ts` coordinator wiring path.

---

## ⏳ Phase 3: In-Process Teammate Runner (NOT STARTED)

**What needs to be implemented:**
1. **Teammate Context (`teammate-context.ts`)**: `AsyncLocalStorage` isolation to decouple in-process teammates from parent session state mutations.
2. **In-Process Runner (`teammate-runner.ts`)**: Prompt loop wrapping `SessionPrompt.runSubagent()` with 500ms mailbox polling, task claiming, and idle notification dispatch.
3. **Spawn Mechanics (`teammate-spawn.ts`)**: Wire `team_create` to execute `spawnInProcessTeammate()` instead of merely creating folders.
4. **Team Event Discovery**: Plumb SSE events (`team.created`, `teammate.spawned`, `teammate.idle`) to the client UI.

---

## ⏳ Phase 4: Permission Synchronization & Verification (NOT STARTED)

**What needs to be implemented:**
1. **Permission Mailbox Bridge**: Teammates write `SwarmPermissionRequest` to `~/.liteai/teams/{team}/permissions/pending/` and poll mailbox for leader resolution.
2. **Classifier Auto-Approval**: Decouple teammates from racing against main UI; asynchronous classifier bash command approval.
3. **Verification Agent**: Read-only verification profile (disallowing `edit`, `write`, `apply_patch`) with adversarial verification prompt.
