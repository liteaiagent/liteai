# Research: Agent Taxonomy & Rename (Phase 1)

**Date**: 2026-05-19
**Branch**: `012-agent-taxonomy-rename`

## Research Summary

No NEEDS CLARIFICATION items existed in the technical context. Phase 1 is a mechanical rename with well-defined scope from the design document. Research focused on identifying all touchpoints and verifying assumptions.

---

## R1: Complete Inventory of `"task"` Tool ID References

**Decision**: 15 source files contain `"task"` as a tool ID string literal that require updating.

**Findings**:

### Source files (`packages/core/src/`)

| File | References | Type |
|------|-----------|------|
| `tool/task.ts` | `Tool.define("task", ...)`, `PermissionNext.evaluate("task", ...)`, `permission: "task"` | Tool definition, permission |
| `tool/task_stop.ts` | `Tool.define("task_stop", ...)` | Tool definition |
| `tool/registry.ts` | `import { TaskTool }`, `import { TaskStopTool }` | Import + registration |
| `tool/index.ts` | `export * from "./task"` (no `task_stop` export — it's imported directly) | Re-export |
| `tool/truncation.ts` | `PermissionNext.evaluate("task", ...)`, `hasTaskTool()` | Permission check |
| `agent/filter.ts` | `"task"` in `ALL_LITEAI_TOOLS`, `tool === "task"` guard | Tool set, filter |
| `coordinator/coordinator-mode.ts` | `"task"` and `"task_stop"` in `COORDINATOR_ALLOWED_TOOLS` and `INTERNAL_COORDINATOR_TOOLS`, `"task tool"` in string | Tool sets, user-facing text |
| `session/engine/loop.ts` | `tool: "task"`, `TaskTool.id`, `TaskTool.init()`, `"ai.telemetry.metadata.langgraph_node", "task"` | Subtask processing |
| `session/engine/input.ts` | `PermissionNext.evaluate("task", ...)`, `"call the task tool"` text | Permission, user hint |
| `platform/profiles/claude.ts` | `Agent: "task"` in `toolNameMap` | Platform compat mapping |

### Prompt files

| File | Content |
|------|---------|
| `bundled/prompts/tools/task.txt` | Full prompt text — must be renamed to `agent.txt` and reworded |

### Test files (28 files reference `"task"`, `TaskTool`, `TaskStopTool`, or `"build"`)

Key test files requiring updates:
- `test/agent/filter.test.ts`
- `test/agent/agent.test.ts`
- `test/coordinator/coordinator-mode.test.ts`
- `test/coordinator/swarm-tools.test.ts`
- `test/plan-mode/enter-plan-tool.test.ts`
- `test/permission-task.test.ts`
- `test/bundled/bundled.test.ts`
- `test/session/engine/registry-wiring.test.ts`

**Rationale**: Grep-based enumeration ensures no reference is missed. The `"task"` string is used as a tool ID, permission name, and telemetry attribute — all three must be renamed to `"agent"`.

---

## R2: Complete Inventory of `"build"` Agent Name References

**Decision**: 4 source locations contain `"build"` as an agent name.

**Findings**:

| File | References | Type |
|------|-----------|------|
| `agent/agent.ts` L34 | `BUILTIN_AGENT_NAMES = [..., "build", ...]` | Constant |
| `agent/agent.ts` L257 | `if (key === "build" && isDisabled)` | Guard |
| `agent/agent.ts` L402 | `return "build"` in `defaultAgent()` | Fallback |
| `agent/context.ts` L88 | Comment: `(e.g., "explore", "build")` | Doc comment |
| `bundled/agents/build.md` | `name: build` | Agent definition file |

**Rationale**: The `"build"` agent name is well-contained. Migration logic for `default_agent: "build"` remapping will be added to `agent.ts`.

---

## R3: File Rename Strategy

**Decision**: Use git-aware renames (rename + update imports in same commit) for:

1. `tool/task.ts` → `tool/agent.ts`
2. `tool/task_stop.ts` → `tool/agent_stop.ts`
3. `bundled/prompts/tools/task.txt` → `bundled/prompts/tools/agent.txt`
4. `bundled/agents/build.md` → `bundled/agents/liteai.md`

**Rationale**: Clean renames preserve git history. All imports use relative paths within `packages/core/src/`, so only the immediate importers need updating.

**Alternatives considered**:
- Creating new files and deprecating old ones → Rejected (v-Next, no backward compat)
- Symbolic links → Rejected (unnecessary complexity)

---

## R4: Permission Name Migration

**Decision**: The permission identifier `"task"` used in `PermissionNext.evaluate("task", ...)` must be renamed to `"agent"`.

**Findings**: Permission checks for the task tool occur in:
1. `tool/task.ts` L37, L117 — evaluating agent access
2. `tool/truncation.ts` L48 — checking if agent has task tool
3. `session/engine/input.ts` L167 — checking agent part permissions

All use `PermissionNext.evaluate("task", ...)` which is a runtime string lookup. Renaming to `"agent"` is safe — no persisted permission data uses this key (permissions are defined in config, not stored in DB by tool ID).

---

## R5: Telemetry Attribute Impact

**Decision**: The telemetry attribute `"ai.telemetry.metadata.langgraph_node", "task"` in `loop.ts` must be renamed to `"agent"`.

**Rationale**: This is a trace span attribute for observability. Changing it is safe — it affects future traces only. Historical traces retain the old value, which is acceptable for a major release.

---

## R6: `default_agent: "build"` Migration

**Decision**: Add a one-time remap in `agent.ts` `defaultAgent()` function and in the agent loading loop.

**Implementation**:
- In `defaultAgent()`: if `cfg.default_agent === "build"`, treat it as `"liteai"`
- In the agent config loop: if `key === "liteai" && isDisabled`, protect it (currently checks `"build"`)
- Log a warning when migration triggers

**Alternatives considered**:
- Config file migration script → Rejected (too heavy for a single field rename)
- Silent remap → Rejected (must log for diagnostics per Mandate §5)
