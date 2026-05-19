# Phase 1: Agent Taxonomy & Rename

> ✅ **COMPLETED** — 2026-05-19 | Spec: `specs/012-agent-taxonomy-rename/`

> **Goal**: Clean up naming across the entire codebase. This is a mechanical, low-risk phase that unblocks all subsequent work.

---

## 1A. Rename `task` tool → `agent` tool

| Change | Scope |
|--------|-------|
| `tool/task.ts` → `tool/agent.ts` | File rename + `TaskTool` → `AgentTool`, tool id `"task"` → `"agent"` |
| `tool/task_stop.ts` → `tool/agent_stop.ts` | File rename + `TaskStopTool` → `AgentStopTool`, tool id → `"agent_stop"` |
| `tool/index.ts` | Update exports |
| `tool/registry.ts` | Update imports: `TaskTool` → `AgentTool`, `TaskStopTool` → `AgentStopTool` |
| `agent/filter.ts` | `ALL_LITEAI_TOOLS`: `"task"` → `"agent"`, `filterToolsForAgent` guard |
| `bundled/prompts/tools/task.txt` → `agent.txt` | Rename + update text (no more "task", say "agent") |
| `bundled/prompts/tools/task_stop.txt` → `agent_stop.txt` | Same |
| `coordinator/*` | Update `"task"` references in coordinator-mode, coordinator-prompt, teammate-runner |
| `acp/events.ts` | Update task event references if applicable |
| All test files | Update imports and references |

---

## 1B. Rename `build` agent → `liteai` agent

| Change | Scope |
|--------|-------|
| `bundled/agents/build.md` → `bundled/agents/liteai.md` | File rename, `name: liteai`, update description |
| `agent/agent.ts` | `BUILTIN_AGENT_NAMES`: `"build"` → `"liteai"` |
| `agent/agent.ts` | `defaultAgent()` fallback: `return "liteai"` |
| `agent/agent.ts` | Foundational agent guard: `key === "liteai"` |
| System prompt `system.md` | References (if any) to "build" agent |
| Config schema | Any references to "build" as default |

---

## 1C. Verify agent taxonomy

Confirm final agent roster:

| Agent | Mode | Role | Status |
|-------|------|------|--------|
| `liteai` | `primary` | Root agent. Full tool access, planning, implementation | **Renamed from `build`** |
| `explore` | `subagent` | Read-only codebase exploration | **Keep** |
| `plan` | `subagent` | Planning specialist, read-only | **Keep** |
| `general` | `subagent` | General-purpose subagent, full tools | **Keep** |
| `compaction` | `subagent` (hidden) | Context compaction | **Keep (system)** |
| `title` | `subagent` (hidden) | Session title generation | **Keep (system)** |
| `summary` | `subagent` (hidden) | Session summary generation | **Keep (system)** |

---

## Deliverables

- Clean `bun typecheck`
- Clean `bun lint:fix`
- Scoped tests pass
- No references to old names remain
