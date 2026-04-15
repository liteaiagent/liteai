# Multi-Agent Platform — Roadmap

> **Goal:** Implement advanced agent spawning models (fork), multi-agent orchestration (coordinator + swarms), and built-in specialized agents with project-level memory. Extends the foundation established by [Agent Core Architecture](./agents-core-roadmap.md).

[liteai_cli_mvp source code](~\Documents\workspace\liteai_cli_mvp\src)

---

## Dependency Chain

```
Phase 4: Fork Subagent + Agent Durability ✅  ← Foundation (feature-flagged)
        │
        ▼
Phase 5: Coordinator Mode + Agent Swarms
        │
        ▼
Phase 6: Built-in Specialized Agents + Advanced Memory
```

> **Feature Flag Architecture:** All phases in this roadmap are gated behind feature flags (`FORK_SUBAGENT`, `COORDINATOR_MODE`). These flags are mutually exclusive — fork and coordinator modes cannot be active simultaneously.

> **Cross-Roadmap Prerequisite:** Phase 5's coordinator tool filtering requires `disallowedTools` enforcement from [Roadmap 1 Phase 3](./agents-core-roadmap.md#prerequisite-disallowedtools-enforcement-phase-2-gap). Ensure Roadmap 1 Phase 3 is complete before beginning Phase 5.

> **Cross-Roadmap Runtime Note:** When `FORK_SUBAGENT` is enabled, ALL agent spawns from Roadmap 1 (including Plan/Explore sub-agents) are forced into async mode via `runAsyncAgentLifecycle()`. This is a runtime configuration concern, not an implementation dependency.

---

## Spec Quality Standards (All Phases)

Every phase `spec.md` **MUST** include the following two sections verbatim. These are non-negotiable requirements; omitting them from a spec is a blocking deficiency. The canonical template is [`specs/003-fork-subagent-durability/spec.md`](../specs/003-fork-subagent-durability/spec.md).

### 1. Reference Implementation Mandate

Each spec must open with a `## Reference Implementation Mandate` section containing:

- A statement that **all work** on the feature MUST be grounded on `liteai_cli_mvp/src`.
- The target quality bar: **same or superior** quality and behavioral parity — no degradation from MVP is acceptable.
- The key reference files specific to the phase.
- The architecture adaptation note: MVP is a **CLI application**; liteai is a **multi-tenant HTTP/SSE backend server**. All MVP patterns must be adapted to backend architecture while preserving behavioral equivalence or improving upon it.
- The **propagation directive**: this mandate MUST be carried forward into `plan.md` and `tasks.md`.

### 2. Behavioral Parity Constraint (C-001)

Each spec must include the following constraint in its `#### Constraints` subsection under `## Requirements`:

> **C-001**: All implementation MUST achieve behavioral parity with or superiority to the MVP reference implementation (`liteai_cli_mvp/src`), adapted from CLI to multi-tenant HTTP/SSE backend architecture. No behavioral degradation from MVP is acceptable. See *Reference Implementation Mandate* section above for full context and key reference files.

---

## Phase 4: Fork Subagent + Agent Durability ✅

> **speckit.specify scope:** "Implement cache-identical fork subagent spawning model and agent resume from sidechain transcripts for background agent durability"

### Context

liteai_cli_mvp implements a fork subagent model (feature-gated `FORK_SUBAGENT`) where the child inherits the parent's full conversation context and system prompt for byte-identical API request prefixes, maximizing prompt cache hits. It also supports resuming agents from persisted sidechain transcripts, enabling background agent durability across process restarts and explicit re-engagement.

These features layer on top of Phase 2's core sub-agent architecture (context forking, sidechain transcripts, worktree isolation) and are independently valuable — fork optimizes spawning costs, resume enables long-running agent workflows.

### What Was Specified

1. **Fork subagent model** — `FORK_AGENT` definition, `buildForkedMessages()`, `isInForkChild()` recursion guard, `isForkSubagentEnabled()` feature gate, force-async for all agents when fork enabled.
2. **Agent resume from sidechain transcripts** — `resumeAgentBackground()`, content replacement state reconstruction, worktree path restoration, fork resume with parent system prompt re-thread, message cleanup.

### Reference Implementation

- [forkSubagent.ts](../../liteai_cli_mvp/src/tools/AgentTool/forkSubagent.ts) — Fork agent definition, forked message construction, recursion guard
- [resumeAgent.ts](../../liteai_cli_mvp/src/tools/AgentTool/resumeAgent.ts) — Agent resume lifecycle, transcript reconstruction
- [AgentTool.tsx:L318–L356](../../liteai_cli_mvp/src/tools/AgentTool/AgentTool.tsx#L318) — Fork path routing and force-async logic

### Depends On

- **Roadmap 1 Phase 2** — Fork uses context forking, async lifecycle, and system prompt resolver. Resume uses sidechain transcripts, content replacement state, and worktree isolation.

### Files Affected

| File | Action |
|---|---|
| *(new)* `agent/fork-subagent.ts` | **New** — `FORK_AGENT`, `buildForkedMessages()`, `isInForkChild()`, `buildWorktreeNotice()` |
| *(new)* `agent/resume.ts` | **New** — `resumeAgentBackground()`, transcript reconstruction, message cleanup |
| `agent/fork.ts` | **Modify** — Add fork variant to `createSubagentContext()` with `renderedSystemPrompt` passthrough |
| `agent/lifecycle.ts` | **Modify** — Integrate fork force-async routing and resume lifecycle |
| `session/engine/query.ts` | **Modify** — Route fork path when `isForkSubagentEnabled()` is active |

---

## Phase 5: Coordinator Mode + Agent Swarms

> **speckit.specify scope:** "Implement coordinator mode (delegating orchestrator with restricted tool pool) and multi-agent swarms with inter-agent messaging, teammate spawning, file-based mailbox protocol, permission synchronization, and task-driven work distribution"

### Context

liteai_cli_mvp implements two complementary multi-agent paradigms:

1. **Coordinator Mode** — The main agent becomes a pure orchestrator that delegates all real work to workers. It uses a dedicated system prompt, restricted tool pool (Agent + SendMessage + TaskStop + TeamCreate + TeamDelete + SyntheticOutput), and worker capability injection. Feature-gated via `COORDINATOR_MODE`.

2. **Agent Swarms** — A full teammate system where multiple agents run concurrently (in-process or as separate terminal processes), communicate via file-based mailboxes, share task lists, and coordinate through structured protocols (shutdown, plan approval).

LiteAI currently has only a forward-declaring placeholder (`ForkGateContext.isCoordinator`) — no implementation exists.

### What to Specify

1. **Coordinator mode state machine** — Session mode (`coordinator` | `normal`) persisted in session storage. `isCoordinatorMode()` reads live from env var. `matchSessionMode()` aligns mode on session resume.

2. **Coordinator system prompt** — Dedicated orchestration prompt (~370 lines in MVP) covering:
   - Role definition (delegate, don't execute)
   - Tool documentation (Agent, SendMessage, TaskStop)
   - Worker lifecycle management (spawn → research → synthesis → implementation → verification)
   - Concurrency management rules (read-only parallel, write-heavy serialized)
   - Failure handling protocol (continue same worker via SendMessage)
   - Worker prompt engineering guidelines (self-contained, synthesized, no lazy delegation)
   - Continue vs spawn decision matrix

3. **Coordinator tool filtering** — `applyCoordinatorToolFilter()` restricts the coordinator's tool pool to orchestration-only tools. Worker capability context injected into coordinator's user context (`workerToolsContext`).

4. **SendMessage tool** — Inter-agent messaging with 3 routing modes:
   - Running agents: message queued via mailbox
   - Stopped tasks: auto-resume with message as new prompt
   - Evicted tasks: resume from disk transcript
   - Structured messages: `shutdown_request`, `shutdown_response`, `plan_approval_response`
   - Broadcast to all teammates (`to: "*"`)

5. **Agent name registry** — `Map<name, agentId>` in session state for human-readable addressing. Set at async agent registration, used by SendMessage for routing.

6. **TeamCreate / TeamDelete tools** — Spawn and disband teams of agents. Team configuration stored in team file on disk.

7. **In-process teammate runner** — Teammates running in the same Node process with:
   - `AsyncLocalStorage`-based context isolation (`runWithTeammateContext()`)
   - Mailbox-based polling for prompts, shutdown requests, and DMs
   - Task claiming from shared task list
   - Permission bridge to leader's ToolUseConfirm dialog (worker badge in UI)
   - Fallback: mailbox-based permission request → leader → response polling
   - Auto-compaction support
   - Idle notification protocol

8. **Teammate mailbox system** — File-based message queues per agent:
   - `writeToMailbox()` / `readMailbox()` / `markMessageAsReadByIndex()`
   - Shutdown protocol: request → approve/reject → cleanup
   - Permission request forwarding
   - Idle notifications with completion metadata

9. **Permission synchronization** — Leader ↔ teammate permission bridge:
   - ToolUseConfirm dialog bridge (leader UI queue, worker badge)
   - Classifier auto-approval for bash commands (teammates await classifier, don't race)
   - Permission update propagation (leader's context preserved)
   - Mailbox fallback when UI bridge unavailable

### Reference Implementation

- [`coordinator/coordinatorMode.ts`](../../liteai_cli_mvp/src/coordinator/coordinatorMode.ts) — Mode detection, system prompt, tool filtering
- [`tools/SendMessageTool/`](../../liteai_cli_mvp/src/tools/SendMessageTool/) — Inter-agent messaging (918 lines)
- [`utils/swarm/inProcessRunner.ts`](../../liteai_cli_mvp/src/utils/swarm/inProcessRunner.ts) — In-process teammate runner (1553 lines)
- [`utils/teammateMailbox.ts`](../../liteai_cli_mvp/src/utils/teammateMailbox.ts) — File-based mailbox protocol
- [`utils/swarm/permissionSync.ts`](../../liteai_cli_mvp/src/utils/swarm/permissionSync.ts) — Permission request/response synchronization
- [`utils/swarm/teamHelpers.ts`](../../liteai_cli_mvp/src/utils/swarm/teamHelpers.ts) — Team file management
- [`tools/TeamCreateTool/`](../../liteai_cli_mvp/src/tools/TeamCreateTool/) — Team creation
- [`tools/TeamDeleteTool/`](../../liteai_cli_mvp/src/tools/TeamDeleteTool/) — Team deletion

### Depends On

- **Phase 4** — Coordinator mode is mutually exclusive with fork subagent (`isForkSubagentEnabled()` vs `isCoordinatorMode()`). SendMessage requires the agent resume system (`resumeAgentBackground()`) for re-engaging stopped agents. Agent name registry extends fork's async lifecycle.
- **Roadmap 1 Phase 3** — `disallowedTools` enforcement must be in place for coordinator tool filtering to function correctly.

### Files Affected

| File | Action |
|---|---|
| *(new)* `coordinator/coordinator-mode.ts` | **New** — Mode detection, system prompt, tool filtering, session mode matching |
| *(new)* `tool/send_message.ts` | **Major rewrite** — Expand stub into full routing (running/stopped/evicted), structured messages, broadcast |
| *(new)* `tool/team_create.ts` | **New** — Team creation tool |
| *(new)* `tool/team_delete.ts` | **New** — Team deletion tool |
| *(new)* `agent/teammate-runner.ts` | **New** — In-process teammate runner with AsyncLocalStorage isolation |
| *(new)* `agent/teammate-mailbox.ts` | **New** — File-based mailbox system |
| *(new)* `agent/permission-sync.ts` | **New** — Leader ↔ teammate permission bridge |
| `agent/fork.ts` | **Modify** — Complete `ForkGateContext.isCoordinator` wiring |
| `agent/resume.ts` | **Modify** — Integrate with SendMessage re-engagement routing |
| `session/state.ts` | **Modify** — Add `agentNameRegistry`, team context, session mode |

---

## Phase 6: Built-in Specialized Agents + Advanced Memory

> **speckit.specify scope:** "Implement built-in verification agent with read-only enforcement and adversarial testing protocol, guide agent for user assistance, and project-level agent memory snapshots with sync detection"

### Context

liteai_cli_mvp ships several built-in specialized agents beyond the basic explore/plan/general-purpose types. The verification agent in particular serves as a critical quality gate in coordinator workflows — it's a read-only agent with strict adversarial testing protocols and structured verdict output. The agent memory snapshot system enables project-level memory sharing via VCS.

### What to Specify

1. **Verification agent** — Read-only agent for post-implementation quality verification:
   - **Tool restrictions**: Disallows `FileEdit`, `FileWrite`, `NotebookEdit`, `Agent`, `ExitPlanMode`. Allowed to write ephemeral test scripts to `/tmp`.
   - **Adversarial system prompt** (~130 lines): Strategy matrix per change type (frontend, backend, CLI, infra, library, bug fix, refactor, data pipeline, DB migration), explicit anti-rationalization rules, required command-run evidence format
   - **Output protocol**: Structured `### Check:` blocks with `Command run:`, `Output observed:`, `Result: PASS/FAIL`. Terminal `VERDICT: PASS | FAIL | PARTIAL`
   - **Critical system reminder**: Per-turn enforcement text preventing mode drift
   - **`whenToUse`**: Triggered after non-trivial tasks (3+ file edits, backend/API changes, infra)
   - **Color**: red (visual distinction in UI)
   - **Model**: inherit (needs full capability for substantive verification)

2. **Guide agent** — Lightweight documentation assistant:
   - **Purpose**: Answers questions about the tool, SDK, and API using live documentation
   - **Tool restrictions**: Read-only tools + WebFetch + WebSearch (no write access)
   - **Model**: haiku (cost-optimized — documentation lookup doesn't need full reasoning)
   - **Permission mode**: `dontAsk` (never prompts user)
   - **Dynamic context**: Injects user's configured skills, custom agents, MCP servers, and settings into system prompt
   - **Re-engagement**: Prefers continuing existing guide agent via SendMessage over spawning new ones

3. **Agent memory snapshots** — Project-level memory sharing via VCS:
   - **Snapshot directory**: `<cwd>/.liteai/agent-memory-snapshots/<agentType>/`
   - **Snapshot metadata**: `snapshot.json` with `updatedAt` timestamp
   - **Sync detection**: 3-way check:
     - No local memory → `initialize` (copy snapshot)
     - Local memory, no sync marker OR snapshot newer → `prompt-update` (offer replace)
     - Synced and up-to-date → `none`
   - **Sync marker**: `.snapshot-synced.json` in local memory dir with `syncedFrom` timestamp
   - **Operations**: `initializeFromSnapshot()`, `replaceFromSnapshot()`, `markSnapshotSynced()`

### Reference Implementation

- [`built-in/verificationAgent.ts`](../../liteai_cli_mvp/src/tools/AgentTool/built-in/verificationAgent.ts) — Verification agent (153 lines)
- [`built-in/claudeCodeGuideAgent.ts`](../../liteai_cli_mvp/src/tools/AgentTool/built-in/claudeCodeGuideAgent.ts) — Guide agent (206 lines)
- [`agentMemorySnapshot.ts`](../../liteai_cli_mvp/src/tools/AgentTool/agentMemorySnapshot.ts) — Memory snapshot sync (198 lines)

### Depends On

- **Roadmap 1 Phase 2** — Built-in agents use the agent definition type system, context forking, tool restrictions, and background agent lifecycle.
- **Phase 5** *(optional)* — Verification agent benefits from coordinator workflows; guide agent uses SendMessage re-engagement pattern. Both function independently without swarms.

### Files Affected

| File | Action |
|---|---|
| *(new)* `agent/built-in/verification.ts` | **New** — Verification agent definition with read-only enforcement and adversarial prompt |
| *(new)* `agent/built-in/guide.ts` | **New** — Guide agent definition with doc-fetching prompt |
| *(new)* `agent/memory-snapshot.ts` | **New** — Snapshot sync detection, initialization, replacement |
| `agent/loader.ts` | **Modify** — Register new built-in agents in priority chain |
| `agent/agent.ts` | **Modify** — Add `criticalSystemReminder` field enforcement |

---

## Execution Order

```
1. Verify Phase 4 foundation ✅ (typecheck, tests)
2. speckit.specify → Phase 5 spec
3. speckit.plan    → Phase 5 plan
4. speckit.tasks   → Phase 5 tasks
5. speckit.implement → Phase 5 implementation
6. Verify Phase 5 (typecheck, tests)
7. Repeat 2-6 for Phase 6
```

> **Gate:** Do not begin Phase 5 until Roadmap 1 Phase 3 (`disallowedTools` enforcement) is complete and verified.
