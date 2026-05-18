# Feature Specification: Agent Taxonomy & Rename (Phase 1)

**Feature Branch**: `012-agent-taxonomy-rename`

**Created**: 2026-05-19

**Status**: Draft

**Input**: User description: "Phase 1 of the Plan Mode Redesign roadmap — Agent Taxonomy & Rename: rename `task` tool to `agent`, rename `build` agent to `liteai`, and verify the final agent roster."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Agent Tool Invocation After Rename (Priority: P1)

A developer using LiteAI sends a complex request that requires spawning a subagent. The system recognizes the need and invokes the `agent` tool (formerly `task`) to delegate work. The subagent executes, returns results, and the root agent integrates them into its response — all using the new `agent` naming convention.

**Why this priority**: The `task` → `agent` rename is the foundational change that unblocks all subsequent phases of the Plan Mode Redesign. Every downstream tool, prompt, and configuration depends on the new tool identity.

**Independent Test**: Can be tested by sending any multi-step request that triggers subagent delegation and verifying the tool call uses `"agent"` as the tool ID, not `"task"`.

**Acceptance Scenarios**:

1. **Given** a user sends a complex request requiring delegation, **When** the root agent decides to spawn a subagent, **Then** the tool invocation uses tool ID `"agent"` (not `"task"`).
2. **Given** a subagent is running, **When** the user requests early termination, **Then** the system accepts `"agent_stop"` as the stop tool ID (not `"task_stop"`).
3. **Given** the tool registry is loaded, **When** the system enumerates available tools, **Then** `"agent"` and `"agent_stop"` appear in the registry; `"task"` and `"task_stop"` do not.

---

### User Story 2 - Root Agent Identity After Rename (Priority: P1)

A developer launches LiteAI without specifying a custom default agent. The system boots with the `liteai` agent (formerly `build`) as the root agent, using the correct prompt file and configuration.

**Why this priority**: The `build` → `liteai` rename establishes the product identity at the agent level. The root agent is the entry point for every user interaction — if its identity is wrong, nothing downstream works.

**Independent Test**: Can be tested by starting a fresh LiteAI session and verifying the root agent's name is `"liteai"`, its prompt is loaded from `bundled/agents/liteai.md`, and the default agent fallback returns `"liteai"`.

**Acceptance Scenarios**:

1. **Given** a user starts a new session without custom agent config, **When** the system selects the default agent, **Then** the default agent name is `"liteai"` (not `"build"`).
2. **Given** a user's existing config has `default_agent: "build"`, **When** the system loads configuration, **Then** the system remaps `"build"` to `"liteai"` via migration logic.
3. **Given** the bundled agents directory is scanned, **When** the system loads agent definitions, **Then** `liteai.md` exists and `build.md` does not.

---

### User Story 3 - Agent Roster Completeness (Priority: P2)

A developer or contributor inspects the system's agent roster to understand available agents for subagent delegation, configuration, or prompt customization. The roster accurately reflects the final taxonomy with no stale or duplicate entries.

**Why this priority**: Agent roster integrity is a validation step — it confirms the rename was applied consistently. Lower priority because it is a verification artifact rather than a behavioral change.

**Independent Test**: Can be tested by inspecting the `BUILTIN_AGENT_NAMES` constant, the `bundled/agents/` directory, and the tool filter's `ALL_LITEAI_TOOLS` set to confirm exact match with the expected roster.

**Acceptance Scenarios**:

1. **Given** the system's agent roster is queried, **When** listing all builtin agents, **Then** the roster contains exactly: `liteai`, `explore`, `plan`, `general`, `compaction`, `title`, `summary`.
2. **Given** the tool filter configuration, **When** `ALL_LITEAI_TOOLS` is inspected, **Then** it contains `"agent"` and `"agent_stop"` — not `"task"` or `"task_stop"`.
3. **Given** the bundled agents directory, **When** listing all `.md` files, **Then** no file named `build.md` exists.

---

### User Story 4 - Coordinator Mode Compatibility (Priority: P2)

When LiteAI is running in coordinator mode (multi-agent orchestration), the coordinator and teammate runners reference the `agent` tool correctly. The coordinator prompt and teammate runner use the new naming consistently.

**Why this priority**: Coordinator mode is an advanced feature that depends on correct tool naming. It must be updated as part of the rename, but is lower priority than core single-agent functionality.

**Independent Test**: Can be tested by initiating a coordinator-mode session and verifying that subagent delegation within the coordinator uses `"agent"` tool references.

**Acceptance Scenarios**:

1. **Given** LiteAI is running in coordinator mode, **When** the coordinator spawns a teammate, **Then** the teammate runner references the `"agent"` tool (not `"task"`).
2. **Given** the coordinator prompt template, **When** rendered for the model, **Then** all references use "agent" terminology — no occurrences of "task" in the tool delegation context.

---

### Edge Cases

- What happens when a user has a stale configuration file referencing `"task"` as a tool name in their custom tool filters? → System should fail fast with a clear error message indicating the tool ID has been renamed, not silently ignore.
- What happens when an old session log contains `"task"` tool calls and the user loads it? → Historical data is read-only; old tool IDs in logs are preserved as-is (no migration of historical data).
- What happens when a third-party extension references the `"task"` tool by ID? → System should return a structured error (tool not found) with the new tool ID in the error message for discoverability.
- What happens when `default_agent` is set to `"build"` but no migration logic catches it? → System must detect and remap `"build"` to `"liteai"` during config loading. If remapping fails, system should throw a typed error, not silently fall back.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST rename the `task` tool to `agent` across all source files, with tool ID changing from `"task"` to `"agent"`.
- **FR-002**: System MUST rename the `task_stop` tool to `agent_stop` across all source files, with tool ID changing from `"task_stop"` to `"agent_stop"`.
- **FR-003**: System MUST rename the bundled agent definition file from `build.md` to `liteai.md`, updating the agent name field within to `liteai`.
- **FR-004**: System MUST update the `BUILTIN_AGENT_NAMES` constant to list `"liteai"` instead of `"build"`.
- **FR-005**: System MUST update the `defaultAgent()` fallback to return `"liteai"` instead of `"build"`.
- **FR-006**: System MUST update the foundational agent guard to check for `"liteai"` instead of `"build"`.
- **FR-007**: System MUST update all tool filter sets (e.g., `ALL_LITEAI_TOOLS`) to reference `"agent"` and `"agent_stop"` instead of `"task"` and `"task_stop"`.
- **FR-008**: System MUST update all bundled prompt text files to use "agent" terminology: rename `task.txt` → `agent.txt` and `task_stop.txt` → `agent_stop.txt`.
- **FR-009**: System MUST update coordinator mode references (coordinator prompt, coordinator mode config, teammate runner) to use `"agent"` instead of `"task"`.
- **FR-010**: System MUST update all ACP (Agent Communication Protocol) event references that use task-based naming to agent-based naming.
- **FR-011**: System MUST provide migration logic that remaps `default_agent: "build"` to `"liteai"` during configuration loading.
- **FR-012**: System MUST update all affected test files to reference the new tool and agent names.
- **FR-013**: System MUST NOT provide backward compatibility aliases — no shims, polyfills, or dual-name support for `"task"` or `"build"`.
- **FR-014**: System MUST pass `bun typecheck` with zero errors after all renames are applied.
- **FR-015**: System MUST pass `bun lint:fix` cleanly after all renames are applied.
- **FR-016**: System MUST pass all scoped tests related to tools, agents, and coordinator modules after renames.

### Key Entities

- **Agent Tool**: The delegation mechanism that spawns subagents. Formerly `TaskTool`, now `AgentTool`. Tool ID: `"agent"`.
- **Agent Stop Tool**: The mechanism to terminate a running subagent. Formerly `TaskStopTool`, now `AgentStopTool`. Tool ID: `"agent_stop"`.
- **LiteAI Agent**: The root/primary agent. Formerly `build`, now `liteai`. Definition file: `bundled/agents/liteai.md`.
- **Agent Roster**: The canonical set of builtin agents: `liteai`, `explore`, `plan`, `general`, `compaction`, `title`, `summary`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Zero occurrences of `"task"` as a tool identifier remain in the production source code (excluding historical logs and comments explaining the rename).
- **SC-002**: Zero occurrences of `"build"` as an agent name remain in the production source code (excluding migration logic and comments explaining the rename).
- **SC-003**: All automated type checks pass with zero errors after the rename.
- **SC-004**: All automated linting passes cleanly after the rename.
- **SC-005**: All scoped tests targeting tools, agents, and coordinator modules pass after the rename.
- **SC-006**: A fresh LiteAI session starts with `"liteai"` as the root agent name without manual configuration.
- **SC-007**: Subagent delegation uses tool ID `"agent"` in all model-facing tool schemas.

## Assumptions

- This is a v-Next major release — no backward compatibility is required for `"task"` or `"build"` names.
- The rename is mechanical and low-risk: it changes identifiers and file names but does not alter behavioral logic, control flow, or data structures.
- All references to `"task"` (tool) and `"build"` (agent) in source code are known and enumerable via grep search — no dynamic string construction generates these names at runtime.
- Historical session logs and conversation data are not migrated — old tool IDs are preserved as-is in existing logs.
- The coordinator mode is actively maintained and must be updated as part of this rename — it is not deprecated.
- The `default_agent: "build"` migration logic is a minimal one-time remap during config loading, not a persistent migration system.
