# Agent Architecture — Roadmap Index

> This roadmap has been split into two focused documents. Choose based on your current work scope.

---

## Roadmap 1 — Agent Core Architecture

**File:** [agents-core-roadmap.md](./agents-core-roadmap.md)

**Phases:**
- Phase 1: System Prompt Resolution ✅
- Phase 2: Sub-Agent Architecture ✅
- Phase 3: Plan Mode ← **current work**
- Phase UI: Agent Experience UI

**Theme:** Core infrastructure, single-agent behavior, plan mode, and full UI observability. All features are always-on (no feature flags).

---

## Roadmap 2 — Multi-Agent Platform

**File:** [agents-platform-roadmap.md](./agents-platform-roadmap.md)

**Phases:**
- Phase 4: Fork Subagent + Agent Durability ✅ (foundation)
- Phase 5: Coordinator Mode + Agent Swarms
- Phase 6: Built-in Specialized Agents + Advanced Memory

**Theme:** Feature-flagged advanced spawning (`FORK_SUBAGENT`), multi-agent orchestration (`COORDINATOR_MODE`), and specialized built-in agents.

---

## Cross-Roadmap Integration Points

| Concern | Detail |
|---|---|
| `disallowedTools` enforcement | Required by **Roadmap 1 Phase 3** (prerequisite). Also gates **Roadmap 2 Phase 5** coordinator tool filtering. |
| Fork flag + Plan/Explore agents | When `FORK_SUBAGENT` is active, all spawns (including Roadmap 1 Phase 3 sub-agents) go async. Runtime concern, not implementation dependency. |
| `SendMessage` re-engagement | Roadmap 2 Phase 5 depends on `resumeAgentBackground()` from Roadmap 2 Phase 4 ✅. |

---

## UI Companion

**File:** [ui-agent-experience-roadmap.md](./ui-agent-experience-roadmap.md)

Full specification for the Agent Experience UI phase (Phase UI in Roadmap 1). All design decisions are locked.
