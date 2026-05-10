# Phase 1: Coordinator Mode State Machine + System Prompt

> **Roadmap:** [07-coordinator-swarms.md](file:///d:/liteai/roadmap/core_features/07-coordinator-swarms.md)  
> **Reference:** [coordinatorMode.ts](file:///D:/claude-code/src/coordinator/coordinatorMode.ts)  
> **Prerequisite:** Phase 0 ✅ (Permission System Hardening)

---

## Goal

Implement the coordinator mode state machine for LiteAI's multi-tenant backend. When enabled, the main agent becomes a pure orchestrator: it receives a dedicated system prompt, its tool pool is restricted to orchestration-only tools, and workers get capability context describing what tools are available to them.

## Sub-Plans

This plan is split into three parts to stay within generation limits:

| Part | File | Scope |
|------|------|-------|
| 1 | [Part 1: Mode Detection + Session Persistence](file:///C:/Users/ahmed/.gemini/antigravity/brain/47fd34a1-ae4d-4a83-b0d9-2f86648113e9/plan_part1_mode_detection.md) | `Flag`, `isCoordinatorMode()`, `matchSessionMode()`, session mode persistence, runtime toggle |
| 2 | [Part 2: Coordinator System Prompt](file:///C:/Users/ahmed/.gemini/antigravity/brain/47fd34a1-ae4d-4a83-b0d9-2f86648113e9/plan_part2_system_prompt.md) | `getCoordinatorSystemPrompt()`, prompt structure, tool name references |
| 3 | [Part 3: Tool Filtering + Context Injection + Wiring](file:///C:/Users/ahmed/.gemini/antigravity/brain/47fd34a1-ae4d-4a83-b0d9-2f86648113e9/plan_part3_filtering_wiring.md) | `applyCoordinatorToolFilter()`, `getCoordinatorUserContext()`, integration into engine |
| 4 | [Part 4: Coordinator Tools](file:///C:/Users/ahmed/.gemini/antigravity/brain/47fd34a1-ae4d-4a83-b0d9-2f86648113e9/plan_part4_coordinator_tools.md) | `task_stop`, `team_create`, `team_delete` tool implementations + registry |

---

## Architecture Decisions

### AD-1: Mode Storage — Session-scoped DB field vs. Environment Variable

The reference implementation uses `process.env.CLAUDE_CODE_COORDINATOR_MODE` (a global env var). LiteAI is multi-tenant — a global env var leaks state across sessions.

| Approach | Pros | Cons |
|----------|------|------|
| **A: Dynamic Flag getter + session DB field** | Session-isolated, survives restarts, zero cross-tenant leakage, consistent with existing `Flag` pattern | Requires a live session ID for mode checks during engine setup |
| **B: ALS-scoped context field** | Zero DB dependency, naturally request-scoped | Requires ALS to be active (not always true at startup), doesn't survive process restarts |

**Decision: Hybrid of A + B.**
- `Flag.LITEAI_COORDINATOR_MODE` — dynamic getter (like `LITEAI_FORK_SUBAGENT`) used as the **startup/default** signal.
- `Session.Info.sessionMode` — already exists with `"Normal" | "Coordinator" | "Swarm"` enum in the DB schema. This is the **authoritative** source once a session is active.
- `isCoordinatorMode(sessionMode)` — pure function that checks the session's stored mode. No global mutation.
- `matchSessionMode()` — called on session resume to detect drift between the flag and the stored mode.

> [!IMPORTANT]
> Unlike the reference which mutates `process.env`, our `isCoordinatorMode()` takes the session mode as a parameter. This makes it multi-tenant safe and testable.

### AD-2: Tool Filtering — Agent `disallowedTools` vs. Dedicated Filter Function

| Approach | Pros | Cons |
|----------|------|------|
| **A: Synthesize a coordinator agent with `disallowedTools`** | Reuses existing `ToolRegistry.tools()` filtering | Inverts the logic (allowlist becomes blocklist), fragile if new tools are added |
| **B: Dedicated `applyCoordinatorToolFilter()` as a post-filter** | Explicit allowlist, clear coordinator boundary, matches reference | Additional filter step in the tool resolution path |

**Decision: B — Dedicated filter function.**

The coordinator's tool set is a small, explicit allowlist (`task`, `send_message`, `yield_turn`). An allowlist is safer than inverting to a blocklist — new tools added to `ToolRegistry` are automatically excluded from the coordinator unless explicitly added. The filter runs in `query.ts` *after* `resolveTools()`.

### AD-3: System Prompt Injection — SectionRegistry vs. Direct Override

| Approach | Pros | Cons |
|----------|------|------|
| **A: Register coordinator prompt as a SectionRegistry section** | Consistent with existing system.md architecture | Over-engineered for a mode-conditional prompt swap, sections are scope-tagged (`static`/`dynamic`) not mode-tagged |
| **B: Direct override in `query.ts`** | Simple, explicit, matches reference pattern (swap entire system prompt when coordinator mode) | Breaks from section-based architecture |

**Decision: B — Direct override in `query.ts`.**

When coordinator mode is active, the system prompt is *completely different* — it's not an additive section, it replaces the agent's prompt entirely. The coordinator prompt is a self-contained ~350-line string. Injecting it as a section would require mode-aware filtering logic in `SectionRegistry` that doesn't exist today and would be a scope-creep refactor.

---

## File Inventory

### New Files

| File | Purpose |
|------|---------|
| `src/coordinator/coordinator-mode.ts` | `isCoordinatorMode()`, `matchSessionMode()`, `getCoordinatorUserContext()`, `applyCoordinatorToolFilter()` |
| `src/coordinator/coordinator-prompt.ts` | `getCoordinatorSystemPrompt()` — the ~350-line orchestration prompt |
| `src/coordinator/index.ts` | Barrel export |
| `src/tool/task_stop.ts` | `TaskStopTool` — stop a running background task by ID |
| `src/tool/team_create.ts` | `TeamCreateTool` — create a team for multi-agent coordination |
| `src/tool/team_delete.ts` | `TeamDeleteTool` — disband a team and clean up resources |
| `test/coordinator/coordinator-mode.test.ts` | Unit tests for mode detection, session matching, tool filtering, context injection |

### Modified Files

| File | Change |
|------|--------|
| [flag.ts](file:///d:/liteai/packages/core/src/flag/flag.ts) | Add `LITEAI_COORDINATOR_MODE` dynamic getter |
| [query.ts](file:///d:/liteai/packages/core/src/session/engine/query.ts) | Inject coordinator system prompt + apply tool filter when mode active |
| [fork.ts](file:///d:/liteai/packages/core/src/agent/fork.ts) | Wire `ForkGateContext.isCoordinator` to live session mode check |
| [registry.ts](file:///d:/liteai/packages/core/src/tool/registry.ts) | Register `task_stop`, `team_create`, `team_delete` tools |
| [context.ts](file:///d:/liteai/packages/core/src/agent/context.ts) | Add `teamContext` to `AppState` interface |

> [!NOTE]
> `session/index.ts` and `session.sql.ts` already have `sessionMode` with `"Coordinator"` as a valid enum value. No schema changes needed.

---

## Verification Plan

### Automated Tests
```
bun test test/coordinator
bun typecheck
bun lint:fix
```

### Behavioral Verification
1. Set `LITEAI_COORDINATOR_MODE=true` → new session gets `sessionMode: "Coordinator"`
2. Verify system prompt is the coordinator prompt (not default agent prompt)
3. Verify tool pool contains only `task`, `send_message`, `yield_turn` (+ MCP tools excluded)
4. Verify `getCoordinatorUserContext()` lists worker-available tools
5. Resume session with `sessionMode: "Coordinator"` without the flag → mode auto-restores
6. Verify `isForkSubagentEnabled()` returns `false` when session is in coordinator mode

---

## Resolved Questions

- **Q1 (task_stop):** Implemented in Phase 1. Full tool with `SessionPrompt.cancel()` integration. See Part 4.
- **Q2 (team_create / team_delete):** Implemented in Phase 1. Full tool definitions with schemas, prompts, and execute functions. `team_create` creates team filesystem structure + `AppState.teamContext`. `team_delete` cleans up. Both gated behind coordinator/swarm mode. See Part 4.
- **Q3 (Runtime toggle):** Yes. `Session.setConfig({ sessionMode: "Coordinator" })` is already wired. The engine reads `session.sessionMode` on each turn. No additional work needed — the existing `setConfig` route + `query.ts` integration handles it.
