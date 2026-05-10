# Coordinator Swarms Implementation Review

> **Reference Path:** `d:\liteai\roadmap\core_features\coordinator_swarm_plan\`
> **Comparison Target:** `D:\claude-code\src`
> **Last Updated:** 2026-05-10 (Phase 4 completed)

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

**Remaining Phase 2.5 items folded into Phase 3.**

---

## ✅ Phase 3: In-Process Teammate Runner (COMPLETED)

Full in-process teammate execution system achieving feature parity with Claude Code's `inProcessRunner.ts` + `spawnInProcess.ts`.

**What was delivered:**
- **Type Foundation (`teammate-types.ts`)**: `TeammateIdentity`, `TeammateTaskState`, `TeammateStatus` union, UI message cap, `appendCappedMessage()`, `isTeammateTask()` guard, `formatAgentId()`/`parseAgentId()` utilities.
- **Agent Context Evolution (`context.ts`)**: Promoted `TeammateAgentContext` from Phase 1 identity-stub to full execution context (AppState access, AbortController, readFileState, cwd). Updated `AppState.tasks` to accept `BackgroundTaskState | TeammateTaskState` union.
- **Teammate Context (`teammate-context.ts`)**: `AsyncLocalStorage<TeammateAgentContext>` for concurrent execution isolation. `createTeammateContext()` factory with deep-cloned AppState snapshot, root store passthrough via `setAppStateForTasks`, forced `shouldAvoidPermissionPrompts`.
- **Spawn Mechanics (`teammate-spawn.ts`)**: `spawnInProcessTeammate()` creates context + abort controller + AppState task registration. `killInProcessTeammate()` performs atomic abort + cleanup + AppState mutation in single `setAppState` call.
- **Core Runner Loop (`teammate-runner.ts`)**: Persistent idle loop wrapping `SessionPrompt.runSubagent()` per-iteration. 500ms mailbox polling, shutdown request passthrough to model, task claiming from team file, abort-aware sleep. Per-turn `AbortController` linked to lifecycle abort.
- **Event System (`teammate-events.ts`)**: `TeammateEvent.Spawned`, `.Idle`, `.Active`, `.Killed` Bus events for SSE consumers.
- **Prompt Addendum (`teammate-prompt-addendum.ts`)**: System prompt injection teaching teammates SendMessage-only communication.
- **Tool Wiring**: `team_create.ts` now accepts optional `teammates` array for inline spawning. `team_delete.ts` force-kills all active teammates before cleanup (Phase 3 behavioral change from Phase 1 throw-on-active).
- **Deferred Phase 2.5 Items**: Environment context (`SystemPrompt.environment(model)`) and scratchpad directory (`teamScratchpadDir()`) now injected into coordinator system prompt via `query.ts`.
- **Exports**: All Phase 3 modules exported from `coordinator/index.ts` barrel.

**Validation:** Typecheck clean, lint clean, 39/39 coordinator tests pass. M-5 test updated for Phase 3 force-kill semantics.

---

## ✅ Phase 4: Permission Synchronization & Verification (COMPLETED)

Dual-transport permission synchronization, classifier pre-approval, and built-in verification agent — achieving feature parity with Claude Code's `permissionSync.ts`, `leaderPermissionBridge.ts`, and `verificationAgent.ts`.

**What was delivered:**
- **Permission Sync Foundation (`permission-sync.ts`)**: Zod schemas (`SwarmPermissionRequest`, `PermissionResolution`, `PermissionSuggestion`), request factory with unique ID generation, and full file-based storage — `permissions/pending/` and `permissions/resolved/` directories under the team directory with atomic writes (`.tmp` → rename) and `cleanupOldResolutions()` for disk hygiene.
- **Dual-Transport Bridge (`permission-bridge.ts`)**: Singleton `PermissionBridge` with two transport paths:
  - **Primary (in-process):** Handler registration + `Deferred` promise resolution — teammate calls `forward()`, leader calls `resolve()`.
  - **Fallback (file-based):** Teammate writes to `pending/` directory and polls `resolved/` at 500ms intervals with 5-minute timeout. Supports future cross-process teammates.
  - Bus events: `TeammatePermissionEvent.Asked` and `.Resolved` for SSE/UI consumers.
- **Bridge Handler (`permission-bridge-handler.ts`)**: `setupPermissionBridgeHandler()` registers the handler on session start and returns a `decisionCallback` for the UI layer. `resolveFileBasedPermission()` for cross-process resolution.
- **Teammate Classifier (`permission/teammate-classifier.ts`)**: Pre-approval adapter that routes `run_command`/`bash`/`execute`/`shell` permissions through existing `classifyYoloAction()` with a 10s timeout. Builds pseudo-transcript from command metadata. SAFE → auto-approve, DANGEROUS/null → escalate to leader.
- **PermissionService Integration (`permission/service.ts`)**: New teammate bridge path in `ask()`: when `shouldAvoidPermissionPrompts` is true and bridge is registered with a teammate context → classifier pre-approval → bridge forward → fallback to existing `PrePermissionDeny` hook path.
- **Verification Agent (`verification-agent.ts`)**: Read-only agent profile with adversarial system prompt enforcing CANNOT-edit constraints, anti-patterns list, category-specific verification strategies, and mandatory VERDICT: PASS/FAIL/PARTIAL reporting format. Critical reminder prepended to every iteration to prevent prompt drift.
- **Built-in Agent Registry (`built-in-agents.ts`)**: Extensible registry with `findBuiltInAgent()`, `getBuiltInAgents()`, `isBuiltInAgentType()`. Verification agent unconditionally available in coordinator mode (no feature flags).
- **Spawn Integration (`teammate-spawn.ts`)**: `InProcessSpawnConfig.agentType` resolves built-in profile for color override and type registration in `teamContext.teammates`.
- **Runner Integration (`teammate-runner.ts`)**: `TeammateRunnerConfig.agentProfile` injects system prompt and critical reminder for profiled agents.
- **Coordinator Prompt (`coordinator-prompt.ts`)**: Added verification agent documentation section with `agentType: "verification"` usage example and spawn guidelines.
- **Exports**: All Phase 4 modules exported from `coordinator/index.ts` barrel.

**Architectural Decisions:**
1. **Classifier model**: Uses global small model via existing `classifyYoloAction()` — no per-tenant configuration.
2. **Permission propagation**: "Always allow" rules scoped to requesting teammate only — no team-wide propagation (stricter than Claude Code).
3. **Verification agent gating**: Unconditionally available in coordinator mode — no feature flags (v-Next clean release).
4. **File-based fallback**: Fully implemented (not stubbed) — atomic writes, cleanup, 5-minute polling timeout.

**Validation:** Typecheck clean, lint clean, 37/37 Phase 4 tests pass across 3 test files (permission-sync, permission-bridge, verification-agent).

