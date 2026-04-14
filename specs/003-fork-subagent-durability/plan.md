# Implementation Plan: Fork Subagent + Agent Durability

**Branch**: `003-fork-subagent-durability` | **Date**: 2026-04-14 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/003-fork-subagent-durability/spec.md`

## MVP Grounding

> **All implementation tasks in this feature — code, tests, and design decisions — MUST be grounded on the MVP reference implementation at `C:\Users\aghassan\Documents\workspace\liteai_cli_mvp\src`.** The target is **same or superior** quality and behavioral parity; no degradation from MVP is acceptable.
>
> The MVP was built as a **CLI application**; this project implements a **multi-tenant HTTP/SSE backend server**. All patterns from the MVP must be adapted to the backend architecture (session-scoped state via AsyncLocalStorage instead of process-global state, tenant isolation, concurrent connection management) while preserving behavioral equivalence or improving upon it.
>
> Key MVP reference files:
> - `tools/AgentTool/forkSubagent.ts` — Fork definition, feature gate, message construction, behavioral contract, recursion guard, worktree notice
> - `tools/AgentTool/resumeAgent.ts` — Resume orchestration, orphan filtering, content replacement reconstruction, worktree validation, system prompt re-threading
> - `utils/forkedAgent.ts` — CacheSafeParams, subagent context isolation, forked query loop, transcript recording, ephemeral forks
> - `tools/AgentTool/agentToolUtils.ts` — Tool filtering, async agent lifecycle, progress tracking, summarization, partial result extraction, handoff classification
> - `tools/SendMessageTool/SendMessageTool.ts` — 3-way message routing (running → queue, stopped → auto-resume, evicted → resume from disk)
>
> **Parity validation rule**: Every task must reference the specific MVP source that defines the behavioral contract and verify that behavioral output matches MVP for equivalent inputs.

## Summary

Implement cache-identical fork subagent spawning and agent resume from sidechain transcripts to enable cost-optimized multi-agent workflows and durable background agent execution. Fork spawning shares the parent agent's prompt cache across all children, reducing per-spawn token cost by ≥80%. Agent resume reconstructs execution state from persisted transcripts, allowing interrupted agents to continue without re-executing completed work. The feature also introduces teammate re-engagement via messaging with 3-way routing and post-turn cache sharing for system-internal forks.

## Technical Context

**Language/Version**: TypeScript 5.x (strict mode) on Bun 1.x runtime
**Primary Dependencies**: ai (Vercel AI SDK), zod, hono (HTTP/SSE), drizzle-orm (SQLite), effect, remeda, @modelcontextprotocol/sdk, @opentelemetry/api, gray-matter, node:async_hooks (AsyncLocalStorage)
**Storage**: SQLite (via drizzle-orm) for session/message persistence + JSONL sidechain transcript files on disk
**Testing**: bun test (scoped to modified domains)
**Target Platform**: Multi-tenant HTTP/SSE backend server (Windows development environment)
**Project Type**: Backend server library (`packages/core`)
**Performance Goals**: Non-blocking, concurrent connections, minimal memory footprint per session, ≤5s resume SLA for ≤2000-message transcripts
**Constraints**: No backward compatibility (v-Next §0), fail-fast error handling (§VI), MVP parity (C-001)
**Scale/Scope**: Multi-tenant sessions with concurrent fork children per parent, no hard concurrency limit

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| §I v-Next | ✅ PASS | Clean break — no legacy adapters needed. Fork is new functionality. |
| §II Architecture | ✅ PASS | All state is session-scoped via ALS. No global mutable state. CacheSafeParams slot is per-session, not process-global (unlike MVP's module-level `lastCacheSafeParams`). |
| §III Tech Stack | ✅ PASS | Bun runtime, typecheck/lint after modifications. |
| §IV Variable Policy | ✅ PASS | Will analyze unused variables before suppressing. |
| §V Design > Speed | ✅ PASS | Following established Phase 2 patterns (SubagentContext, SidechainTranscript, worktree isolation). |
| §VI Fail-Fast | ✅ PASS | Typed errors for spawn/resume failures, no silent fallbacks. Exception: summarization is best-effort (already justified in lifecycle.ts). |
| §VII Test Resolution | ✅ PASS | New feature — no existing tests to conflict with. |
| §VIII Design Protocol | ✅ PASS | This IS the design phase — ADR artifacts generated. |
| §IX Execution Gate | ✅ PASS | Planning mode — no code until explicit approval. |

## Project Structure

### Documentation (this feature)

```text
specs/003-fork-subagent-durability/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   ├── fork-spawn.md
│   ├── agent-resume.md
│   ├── cache-safe-params.md
│   └── messaging.md
└── tasks.md             # Phase 2 output (generated by /speckit.tasks)
```

### Source Code (repository root)

```text
packages/core/src/
├── agent/
│   ├── fork.ts           # NEW — Fork agent definition, feature gate, message construction,
│   │                     #        behavioral contract, worktree notice, recursion guard
│   ├── resume.ts         # NEW — Resume from sidechain, orphan filtering, state reconstruction,
│   │                     #        worktree validation, system prompt re-threading
│   ├── context.ts        # MODIFY — Add fork-specific SubagentContext fields
│   ├── lifecycle.ts      # MODIFY — Extend runAsyncAgentLifecycle for CacheSafeParams, post-turn slot
│   ├── filter.ts         # MODIFY — Add orphaned message filtering functions
│   └── runner.ts         # MODIFY — Wire fork path into agent spawning
├── session/
│   ├── transcript.ts     # MODIFY — Add read/reconstruct capabilities + content replacement extraction
│   └── tasks/            # MODIFY — Agent task registry for name→ID mapping
├── tool/
│   └── send_message.ts   # NEW — Teammate re-engagement with 3-way routing
├── flag/
│   └── (feature gate)    # MODIFY — Add FORK_SUBAGENT feature gate
└── worktree/
    └── index.ts          # MODIFY — Add mtime refresh utility

packages/core/test/
├── agent/
│   ├── fork.test.ts      # NEW
│   ├── resume.test.ts    # NEW
│   └── filter.test.ts    # MODIFY
└── session/
    └── transcript.test.ts # MODIFY
```

**Structure Decision**: All new fork/resume code lives in the existing `agent/` module to maintain cohesion with the existing sub-agent architecture (Phase 2). Sidechain transcript extensions stay in `session/transcript.ts`. The messaging tool follows the existing tool pattern in `tool/`. No new top-level modules — fork is an extension of the agent subsystem, not a separate domain.

## Complexity Tracking

> No constitution violations to justify.

| Decision | Rationale |
|----------|-----------|
| CacheSafeParams as session-scoped slot | MVP uses module-level global (`lastCacheSafeParams`). Multi-tenant backend requires per-session scoping to prevent cross-tenant cache pollution. Stored on the session's engine context. |
| Fork agent as synthetic definition (not registered in agent list) | Matches MVP pattern — fork is triggered by omitting subagent_type, not by selecting a named agent. Keeps the agent registry clean. |
| Orphan filtering in `filter.ts` (not `resume.ts`) | Three filters (whitespace-only, thinking-only, unresolved tool uses) are reusable beyond resume — e.g., transcript compaction. Keeps `resume.ts` focused on orchestration. |
| Permission mode composition rule | Elevated parent modes override fork child's bubble mode. Matches MVP behavior. Avoids interactive permission prompts for background workers when the parent already opted into a permissive mode. |
