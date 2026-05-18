# Data Model: Agent Taxonomy & Rename (Phase 1)

**Date**: 2026-05-19
**Branch**: `012-agent-taxonomy-rename`

## Overview

Phase 1 is a naming/identity refactor — it does not introduce new data structures, tables, or schemas. The changes affect **identifier strings** and **file names** within existing entities.

---

## Entities Affected

### 1. Tool Identity

| Field | Before | After |
|-------|--------|-------|
| `Tool.define()` ID — agent delegation | `"task"` | `"agent"` |
| `Tool.define()` ID — agent stop | `"task_stop"` | `"agent_stop"` |
| Source file — delegation tool | `tool/task.ts` | `tool/agent.ts` |
| Source file — stop tool | `tool/task_stop.ts` | `tool/agent_stop.ts` |
| Export class — delegation tool | `TaskTool` | `AgentTool` |
| Export class — stop tool | `TaskStopTool` | `AgentStopTool` |

### 2. Agent Identity

| Field | Before | After |
|-------|--------|-------|
| Root agent name | `"build"` | `"liteai"` |
| Agent definition file | `bundled/agents/build.md` | `bundled/agents/liteai.md` |
| `BUILTIN_AGENT_NAMES` entry | `"build"` | `"liteai"` |
| `defaultAgent()` fallback | `"build"` | `"liteai"` |
| Foundational agent guard | `key === "build"` | `key === "liteai"` |

### 3. Permission Identity

| Field | Before | After |
|-------|--------|-------|
| `PermissionNext.evaluate()` permission name | `"task"` | `"agent"` |
| `ctx.ask({ permission: ... })` value | `"task"` | `"agent"` |

### 4. Prompt File Identity

| Field | Before | After |
|-------|--------|-------|
| Tool prompt file | `bundled/prompts/tools/task.txt` | `bundled/prompts/tools/agent.txt` |
| Prompt text content | "Task tool" references | "Agent tool" references |

### 5. Tool Filter Sets

| Set | Before | After |
|-----|--------|-------|
| `ALL_LITEAI_TOOLS` | `"task"` | `"agent"` |
| `COORDINATOR_ALLOWED_TOOLS` | `"task"`, `"task_stop"` | `"agent"`, `"agent_stop"` |
| `INTERNAL_COORDINATOR_TOOLS` | `"task"`, `"task_stop"` | `"agent"`, `"agent_stop"` |
| `filterToolsForAgent()` guard | `tool === "task"` | `tool === "agent"` |

### 6. Platform Compatibility Maps

| Platform | Before | After |
|----------|--------|-------|
| Claude Code `toolNameMap` | `Agent: "task"` | `Agent: "agent"` |

### 7. Telemetry Attributes

| Attribute | Before | After |
|-----------|--------|-------|
| `ai.telemetry.metadata.langgraph_node` | `"task"` | `"agent"` |

---

## Relationships

No relationship changes. All existing parent-child, session, and message associations remain unchanged. The rename affects identity strings only.

---

## State Transitions

No state transition changes. Tool execution lifecycle, session lifecycle, and agent lifecycle remain unchanged.

---

## Validation Rules

No new validation rules. Existing schema validation via Zod remains unchanged — the `z.string()` types on tool IDs and agent names accept any string value.

---

## Agent Roster (Final State)

| Agent Name | Mode | Role | File |
|------------|------|------|------|
| `liteai` | `primary` | Root agent | `bundled/agents/liteai.md` |
| `explore` | `subagent` | Read-only exploration | `bundled/agents/explore.md` |
| `plan` | `subagent` | Planning specialist | `bundled/agents/plan.md` |
| `general` | `subagent` | General-purpose | `bundled/agents/general.md` |
| `compaction` | `subagent` (hidden) | Context compaction | `bundled/agents/compaction.md` |
| `title` | `subagent` (hidden) | Title generation | `bundled/agents/title.md` |
| `summary` | `subagent` (hidden) | Summary generation | `bundled/agents/summary.md` |
