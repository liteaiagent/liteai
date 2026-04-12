# Implementation Plan: Sub-Agent Architecture

**Branch**: `002-subagent-architecture` | **Date**: 2026-04-11 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/002-subagent-architecture/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

Implement a complete sub-agent orchestration layer for LiteAI `packages/core` that enables context-aware agent spawning with isolated execution contexts, typed agent definitions with multi-source priority merging, permission sandboxing for background agents, sidechain transcript recording, context pruning for read-only agents, dynamic MCP server lifecycle management, agent-scoped memory, and deterministic resource cleanup. The architecture follows the liteai2 reference implementation patterns while leveraging LiteAI's existing infrastructure (SectionRegistry, Worktree, MCP connections, PermissionNext) to minimize new surface area.

## Technical Context

**Language/Version**: TypeScript 5.x on Bun 1.x runtime  
**Primary Dependencies**: ai (Vercel AI SDK), zod, hono (HTTP/SSE), drizzle-orm (SQLite), effect, remeda, @modelcontextprotocol/sdk, @opentelemetry/api, gray-matter, node:async_hooks (AsyncLocalStorage)  
**Storage**: SQLite via drizzle-orm (sessions, messages, parts), filesystem (sidechain transcripts as append-only JSONL, agent memory as MEMORY.md, worktree directories)  
**Testing**: `bun test` with `--timeout 90000` — scoped to `test/agent/`, `test/mcp/`, `test/permission/`, `test/session/`, `test/isolation/`  
**Target Platform**: Node.js/Bun on Windows/Linux/macOS — multi-tenant HTTP/SSE backend  
**Project Type**: Backend library & server (`packages/core` within monorepo)  
**Performance Goals**: Sub-agent spawn < 100ms, zero resource leaks after 100 spawn/exit cycles, background agents never block on permission prompts  
**Constraints**: Strictly non-blocking, multi-tenant session isolation, Windows PowerShell compatible toolchain, liteai2 agent format backward compatibility (copy-paste `.md` files)  
**Scale/Scope**: Supports up to 8 concurrent sub-agents per session (configurable), arbitrary nesting depth, whale sessions with hundreds of historical agent spawns

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Major Release & Compat (v-Next) | ✅ PASS | Clean architecture, no legacy shims. CC-compat fields are additive with sensible defaults |
| II. Architecture & Performance | ✅ PASS | Non-blocking spawn, ALS for tenant isolation, concurrent limit prevents exhaustion |
| III. Tech Stack & Execution | ✅ PASS | Bun runtime, TypeScript, scoped testing |
| IV. Variable & Linter Policy | ✅ PASS | N/A at plan phase — enforced during implementation |
| V. Design & Refactoring Guardrails | ✅ PASS | Scoped feature. Fork model and agent resume explicitly deferred to Phase 4 |
| VI. Strict Error Handling | ✅ PASS | Typed errors for spawn failures, MCP failures, limit exceeded. Cleanup must not throw |
| VII. Test Resolution Protocol | ✅ PASS | N/A at plan phase |
| VIII. Design & Decision Protocol | ✅ PASS | This plan serves as the mandatory ADR/specification |
| IX. Execution Gate & Planning Protocol | ✅ PASS | Planning Mode only — no implementation code |

## Alternatives Considered

> Required by Constitution §VIII before implementation begins.

### Alternative 1: Single `runner.ts` Orchestrator (Chosen)

All sub-agent lifecycle concerns (spawn, query loop, cleanup, transcript) live in a single `runAgent()` orchestrator in `agent/runner.ts`, delegating to focused single-responsibility modules (`context.ts`, `lifecycle.ts`, `cleanup.ts`, etc.) via direct function calls.

**Pros**: Explicit call graph; easy to audit lifecycle order; single entry-point for debugging. Matches liteai2 reference pattern.
**Cons**: `runner.ts` becomes a coordination hub that imports many modules; potential for high fan-out.

### Alternative 2: Event-Driven Pipeline

Sub-agent lifecycle events (`agent.spawn`, `agent.turn`, `agent.exit`) are published to a bus, with independent subscribers handling transcript recording, cleanup, telemetry, and notifications.

**Pros**: Fully decoupled modules; easier to add new lifecycle hooks without modifying the runner.
**Cons**: Harder to reason about execution order and error propagation; the bus becomes a hidden coupling layer; Constitution §VI (fail-fast) is harder to enforce when handlers run asynchronously and independently. Debugging lifecycle failures requires tracing across multiple event consumers.

**Decision**: Alternative 1 chosen. The explicit orchestrator model better satisfies §VI (structured, typed errors bubbling from a single call stack) and §II (strict non-blocking, auditable resource lifecycle). The event-driven model's decoupling benefits do not outweigh the debuggability and error-handling costs in a multi-tenant SSE backend.

---

### Alternative A: `AsyncLocalStorage` for Agent Identity (Chosen, re: FR-024)

Agent identity and analytics attribution are isolated using Node.js `AsyncLocalStorage<AgentContext>`, populated at agent spawn via `runWithAgentContext()`.

**Pros**: Zero explicit threading; compatible with Bun's async model; per-agent context automatically inherited by all async calls within the agent's execution.
**Cons**: Invisible to type system — requires discipline to ensure `runWithAgentContext()` wraps the entire execution.

### Alternative B: Passed-Context (Dependency Injection)

Pass `AgentContext` as an explicit parameter to every function called within an agent's execution.

**Pros**: Fully type-safe; no hidden state.
**Cons**: Viral parameter threading across 20+ internal functions; breaks separation of concerns for telemetry/analytics layers that shouldn't need caller identity injected manually.

**Decision**: Alternative A (ALS) chosen. The per-function injection cost (Alternative B) is prohibitive for an analytics attribution concern that is legitimately cross-cutting. ALS is the established pattern for this use case in Node.js/Bun.

---

## Project Structure

### Documentation (this feature)

```text
specs/002-subagent-architecture/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
│   └── agent-api.md     # Agent tool + runner public API contract
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
packages/core/src/
├── agent/
│   ├── agent.ts              # EXTEND — AgentDefinition type hierarchy, requiredMcpServers filtering,
│   │                         #   thinking/thinkingBudget/timeout fields, concurrent limit config
│   ├── errors.ts             # NEW — Structured error types: ConcurrentAgentLimitError,
│   │                         #   AgentDisabledError, McpConnectionError, RequiredMcpServerError,
│   │                         #   AgentSpawnError, AgentTimeoutError
│   ├── events.ts             # NEW — Agent bus events: agent.spawned, agent.completed,
│   │                         #   agent.progress — BusEvent.define() with zod schemas
│   ├── loader.ts             # EXTEND — source provenance tracking (builtIn/custom/plugin),
│   │                         #   requiredMcpServers validation at load-time
│   ├── context.ts            # NEW — SubagentContext type, createSubagentContext() factory,
│   │                         #   AgentExecutionContext ALS, runWithAgentContext(), consumeInvokingRequestId()
│   ├── lifecycle.ts          # NEW — AsyncAgentLifecycle: progress tracking, summarization,
│   │                         #   terminal notifications, handoff classification, partial result extraction
│   ├── cleanup.ts            # NEW — deterministic 11-step cleanup sequence (idempotent, non-throwing)
│   ├── memory.ts             # NEW — agent memory: scope resolution, MEMORY.md injection,
│   │                         #   Read/Write/Edit tool auto-injection, snapshot system
│   ├── runner.ts             # NEW — runAgent() orchestrator: spawn lifecycle, context fork,
│   │                         #   query loop delegation, hook execution, skill preloading, cleanup
│   └── filter.ts             # REWRITE — centralized tool/permission filtering, context pruning
│                             #   (omitLiteaiMd, git status stripping), feature flag kill-switch
├── session/
│   ├── engine/
│   │   ├── loop.ts           # EXTEND — root vs sub-agent gating (agentId discriminator),
│   │   │                     #   criticalSystemReminder attachment injection per turn
│   │   └── system.ts         # EXTEND — sub-agent system prompt construction via SectionRegistry
│   ├── transcript.ts         # NEW — SidechainTranscript: append-only JSONL recording,
│   │                         #   agent ID-based file naming, workflow subdir grouping
│   └── index.ts              # MINOR — concurrent agent limit tracking per session
├── mcp/
│   ├── index.ts              # EXTEND — getMcpConfigByName() lookup for string references
│   └── agent-mcp.ts          # NEW — initializeAgentMcpServers(): string ref resolution,
│                             #   inline definition connection, cleanup function, policy guard
├── permission/
│   ├── service.ts            # EXTEND — shouldAvoidPermissionPrompts context flag
│   ├── sandbox.ts            # NEW — background agent silent-deny, mode inheritance logic,
│   │                         #   tool allow-list scoping (replace not merge), bubble mode
│   └── classifier.ts         # NEW — classifyYoloAction safety classifier for handoff review
├── worktree/
│   └── index.ts              # EXTEND — agent-scoped worktree creation via makeWorktreeInfo
├── isolation/
│   ├── docker.ts             # NEW — remote isolation mode: Docker container spawn via CLI,
│   │                         #   label-based container tracking, configurable TTL
│   └── registry.ts           # NEW — Filesystem-scan-based isolation GC: worktree discovery
│                             #   via naming conventions + mtime, Docker via label queries,
│                             #   cleanupStaleIsolationArtifacts() on session start
├── telemetry/
│   └── perfetto.ts           # EXTEND — registerPerfettoAgent()/unregisterPerfettoAgent(),
│                             #   hierarchical parent→child tracing
├── hook/
│   └── hook.ts               # EXTEND — agent-scoped hook registration with isAgent=true,
│                             #   Stop→SubagentStop event conversion, clearSessionHooks(agentId)
├── tools/
│   └── shell.ts              # EXTEND — execController interception for isolation modes
├── skill/
│   └── loader.ts             # EXTEND — agent-spawn skill preloading, resolveSkillName()
│                             #   with 3-strategy namespace resolution
└── config/
    └── schema.ts             # EXTEND — add agent config schema fields (mcpServers, tools, skills,
                              #   omitLiteaiMd, initialPrompt, color (already exists)
```

```text
packages/core/test/
├── agent/
│   ├── agent.test.ts         # AgentDefinition type guards, merge priority, hidden protection,
│   │                         #   requiredMcpServers validation, liteai2 format compatibility
│   ├── benchmark.test.ts     # Spawn latency p95 < 100ms (SC-001), token reduction ≥30% (SC-002)
│   ├── context.test.ts       # SubagentContext forking: state isolation, abort linkage,
│   │                         #   setAppState no-op, file state cloning, thinking config
│   ├── lifecycle.test.ts     # Async lifecycle: progress, notifications, partial extraction
│   ├── cleanup.test.ts       # 11-step cleanup: idempotent, non-throwing, resource release
│   ├── memory.test.ts        # Memory scopes, MEMORY.md injection, tool auto-injection
│   ├── runner.test.ts        # Agent spawn integration: hooks, skills, MCP, full lifecycle
│   └── filter.test.ts        # Tool filtering, context pruning, disallow lists
├── telemetry/
│   └── perfetto.test.ts      # Hierarchical child tracing, unregister verification
├── hook/
│   └── hook.test.ts          # Agent Stop hook cleanup and SubagentStop conversions
├── mcp/
│   └── agent-mcp.test.ts     # Agent-scoped MCP: string refs, inline defs, cleanup
├── permission/
│   └── sandbox.test.ts       # Silent deny, mode inheritance, allow-list scoping
├── session/
│   └── transcript.test.ts    # Sidechain recording: append, naming, subdir grouping
└── isolation/
    ├── worktree.test.ts      # Worktree creation, isolation, TTL retention, GC
    └── docker.test.ts        # Docker spawn, read-only mount, TTL cleanup, GC
```

**Structure Decision**: Single project within existing monorepo structure at `packages/core/src/`. New modules added to `agent/`, with integration points extending existing `session/`, `mcp/`, `permission/`, `hook/`, `skill/`, `telemetry/`, and `config/` modules. Test files organized by domain under `packages/core/test/`.

## Complexity Tracking

> Constitution violations: None. Managed exceptions: 2 (documented below).

| Concern | Principle | Status | Rationale |
|---------|-----------|--------|-----------|
| FR-008: Transcript recording errors do not propagate to agent execution | §VI Fail-Fast | ✅ **Approved Exception** | Sidechain transcripts are observability side-channels. Propagating their write failures would abort the agent's primary task — violating the principle that monitoring infrastructure must not disrupt production workloads. Errors are logged. |
| FR-027: Failed skill resolution silently skipped with debug log | §VI Fail-Fast | ✅ **Approved Exception** | Skills are non-critical enrichment. A missing skill name (typo or stale config) must not block agent spawn — the agent is still fully functional without the skill. Debug log provides observability. |
