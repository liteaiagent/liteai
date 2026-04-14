# Deferred Items: Sub-Agent Architecture

**Feature**: 002-subagent-architecture  
**Created**: 2026-04-12  
**Purpose**: Reference document tracking items explicitly deferred from this phase.

## When to Start

**All items below are blocked until the current 002-subagent-architecture plan is fully implemented, tested, and shipped.** None of these should be picked up during implementation. After the plan ships, each item has its own trigger:

| Item | Trigger | Depends on (from this plan) |
|------|---------|-----------------------------|
| Fork subagent model | Next feature spec cycle (Phase 4 roadmap) | US1 (context forking), US4 (transcript format) |
| Agent resume | Next feature spec cycle (Phase 4 roadmap) | US4 (sidechain transcripts) |
| Retain mode | UI integration phase (`packages/web`) | US3b (lifecycle hooks) |
| flag/policy settings | Feature-flag/policy infrastructure buildout | US2 (agent definitions) |
| TeammateAgentContext runtime (swarm) | Future swarm/teammate feature spec | US1 (context forking), US2 (agent definitions) |

---

## Phase 4 Deferrals (from spec.md)

These were identified during the liteai_cli_mvp parity review and explicitly scoped out of Phase 2.

### Fork Subagent Model
**Source**: spec.md L433, Clarification L192  
**Description**: Cache-identical context sharing with byte-identical API prefixes (`CacheSafeParams`, `buildForkedMessages()`). Enables sub-agents to share the parent's prompt cache prefix for cost reduction.  
**Why deferred**: Requires deep integration with the prompt cache layer and byte-level API prefix matching. High complexity, optimization-tier feature — not required for functional sub-agent orchestration.  
**liteai_cli_mvp reference**: `forkSubagent.ts` — `FORK_AGENT` definition, `buildForkedMessages()`, `isInForkChild()`, `buildWorktreeNotice()`

### Agent Resume from Sidechain Transcripts
**Source**: spec.md L433, Clarification L192  
**Description**: Resume a previously killed/timed-out agent from its sidechain transcript. Enables long-running agents to be interrupted and continued without re-executing completed work.  
**Why deferred**: Depends on sidechain transcript format stability (Phase 2 US4) and a resume protocol that correctly handles partial state. Design complexity is high.  
**liteai_cli_mvp reference**: `invocationKind: "spawn" | "resume"` in `SubagentContext`

---

## UI Integration Deferrals

### Retain Mode (Live Message Streaming)
**Source**: spec.md L137, remediation C6  
**Description**: When UI holds a background agent task, append assistant messages to AppState live instead of buffering, enabling real-time streaming of sub-agent output to the frontend.  
**Why deferred**: Requires coordinated implementation in `packages/web` (frontend) and `packages/core` (backend). The core lifecycle manager (US3b) provides the backend hooks, but the UI rendering and state management are out of scope for `packages/core`.  
**liteai_cli_mvp reference**: `runAsyncAgentLifecycle()` L559–570 — live message appending when `retainMessages: true`  
**Prerequisite**: US3b (Background Agent Lifecycle) must be complete first.

---

## Priority Level Deferrals

### `flagSettings` / `policySettings` Override Levels
**Source**: spec.md FR-002 (L370)  
**Description**: liteai_cli_mvp's reference implementation includes 6 priority levels for agent definition merging: `builtIn < plugin < userSettings < projectSettings < flagSettings < policySettings`. Phase 2 implements only the first 4 levels.  
**Why deferred**: `flagSettings` and `policySettings` are tied to feature flag and policy infrastructure that doesn't exist yet in liteai. The 4-level model is sufficient for all current use cases.  
**When to revisit**: When feature flag and/or policy management infrastructure is built.

---

## Swarm / Teammate Deferrals

### TeammateAgentContext Runtime Behavior (Swarm Execution)

**Source**: tasks.md T005, spec.md §Agent Execution Context (AgentContext ALS)  
**Description**: `TeammateAgentContext` is defined as a type-only placeholder in Phase 2 (T005) for in-process swarm teammates with fields `teamName`, `agentColor`, `planModeRequired`, `isTeamLead`. No runtime execution logic is implemented in this phase — the type is included in the `AgentExecutionContext` discriminated union for type system completeness only.  
**Why deferred**: Swarm execution requires a coordination protocol (team formation, lead/follower election, shared plan state) that is architecturally separate from the single-agent orchestration being built here. Implementing runtime behavior prematurely would create coupling without a driving use case.  
**When to revisit**: When a swarm/multi-agent collaboration feature spec is created (e.g., `specs/005-swarm-agents/`).  
**Prerequisite**: US1 (context forking infrastructure) and US2 (agent definitions) from this plan must be complete first.

---

## Notes

- Items in this document are **not bugs or missing features** — they are intentional scope decisions.
- **Do not start any of these during the current implementation plan.** They are post-ship work.
- Each item has a clear prerequisite chain. They should be revisited in the order listed once their prerequisites are met.
- This document should be updated when any deferred item is picked up for implementation.
- When picking one up, create a new feature spec (e.g., `specs/004-fork-subagent/spec.md`) following the standard speckit workflow.
