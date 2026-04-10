# System Prompt Resolution — Refactoring Roadmap

> **Goal:** Refactor system prompt resolution to match [liteai2's architecture](../liteai2/spec/), consolidating multiple provider-specific system prompts into a single unified prompt, restructuring sub-agent context management, and modernizing plan mode.

[liteai2 source code](C:\Users\aghassan\Documents\workspace\liteai2\src)
---

## Dependency Chain

```
Phase 1: System Prompt Resolution
        │
        ▼
Phase 2: Sub-Agent Architecture
        │
        ▼
Phase 3: Plan Mode
```

Each phase is independently testable and deployable. Each phase should be specified using `speckit.specify` before implementation begins.

---

## Phase 1: System Prompt Resolution

> **speckit.specify scope:** "Refactor system prompt resolution to consolidate multiple provider-specific .md files into a single unified system.md with a section-based resolver, dynamic boundary marker, and cached section registry"

### Context

Currently, `SystemPrompt.provider()` in `session/engine/system.ts` dispatches by model ID string matching to load one of 9 different `.md` files (`anthropic.md`, `gemini.md`, `beast.md`, `trinity.md`, etc.). Each file duplicates ~70% of its content with the others.

liteai2 uses a single programmatic prompt builder (`constants/prompts.ts`) with:
- A `systemPromptSection()` registry that memoizes computed sections
- A `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` marker separating cacheable static content from per-session dynamic content
- Static sections (identity, system rules, task guidance, tool usage, tone) + dynamic sections (env info, MCP, skills, language, memory)

### What to Specify

1. **Unified `system.md` template** — A single markdown file with section markers/template variables for dynamic injection. Replaces all 9 provider-specific `.md` files. Provider-specific differences (if any remain) are handled via conditional sections, not separate files.
2. **Section-based resolver** — TypeScript module that reads `system.md`, resolves template sections, and returns `string[]`. Implements:
   - `systemPromptSection(name, computeFn)` — memoized section with cache-until-clear semantics
   - `DANGEROUS_uncachedSystemPromptSection(name, computeFn, reason)` — volatile section that recomputes every turn
   - `resolveSystemPromptSections()` — batch resolver with parallel async evaluation
3. **Dynamic boundary marker** — `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` constant separating static (cross-session cacheable) content from dynamic content. Everything before the marker uses `scope: 'global'` caching.
4. **`Bundled` module update** — Update `bundled/index.ts` to reflect the new single-prompt structure. Deprecate `systemPrompt(name)` in favor of a single entry point.
5. **`SystemPrompt` namespace refactoring** — Collapse `SystemPrompt.provider()` model-dispatch logic. The provider/model is now a parameter to the resolver, not a file selector.

### Reference Implementation

- [liteai2/src/constants/prompts.ts](../liteai2/spec/) — `getSystemPrompt()`, section registration, boundary marker
- [liteai2/src/constants/systemPromptSections.ts](../liteai2/spec/) — Section cache infrastructure

### Files Affected

| File | Action |
|---|---|
| `bundled/prompts/system/system.md` | **Major rewrite** — becomes the single unified template |
| `bundled/prompts/system/{anthropic,gemini,beast,trinity,default,codex_header,google-code-assist}.md` | **Delete** — absorbed into unified `system.md` |
| `bundled/index.ts` | **Modify** — update `Bundled.systemPrompt()` API |
| `session/engine/system.ts` | **Major rewrite** — replace model-dispatch with section resolver |
| `session/engine/query.ts` | **Modify** — update system prompt construction (L326-334) |

---

## Phase 2: Sub-Agent Architecture

> **speckit.specify scope:** "Refactor sub-agent architecture to support context forking, agent definition types, sidechain transcripts, context pruning, permission sandboxing, and agent-scoped MCP server mounting"

### Context

liteai currently uses a flat `Agent.Info` configuration loaded from `.md` frontmatter with no context isolation between parent and child agents. There is no concept of context forking, sidechain transcripts, or agent-scoped resource management.

liteai2 implements a full orchestration layer with `createSubagentContext()` that selectively inherits parent state, isolated sidechain transcripts, dynamic MCP server mounting per agent, and hierarchical permission sandboxing.

### What to Specify

1. **Agent definition type hierarchy** — `BuiltInAgentDefinition | CustomAgentDefinition | PluginAgentDefinition` with source tracking and loading priority (`built-in < plugin < userSettings < projectSettings`).
2. **Agent configuration fields** — Expand `Agent.Info` to support: `tools/disallowedTools`, `skills`, `mcpServers`, `hooks`, `model` (with `'inherit'`), `effort`, `permissionMode`, `maxTurns`, `memory` scopes, `background`, `isolation`, `omitClaudeMd`, `criticalSystemReminder`.
3. **Context forking (`createSubagentContext`)** — Isolation model for spawning sub-agents: what state is cloned vs. isolated vs. shared. Covers `readFileState`, `abortController`, `appState`, tool decisions, messages.
4. **Context pruning** — Intelligent stripping of heavy context for read-only agents: system prompt section stripping (skills, env details), git status removal.
5. **Sidechain transcripts** — Sub-agent messages recorded to isolated transcript files. Parent receives only the dense `<task_result>` block. Transcript grouping for workflow sub-agents.
6. **Dynamic MCP server mounting** — Agent-declared MCP servers resolved on spawn (string reference → reuse, inline definition → new connection). Lifecycle cleanup on agent exit.
7. **Permission sandboxing** — Async prompt blocking for background agents (silent deny), permission mode inheritance rules, tool allow-list scoping (replace, not merge).

### Reference Implementation

- [01-subagent-architecture.md](../liteai2/spec/01-subagent-architecture.md) — Full comparison and liteai2 source references

### Depends On

- **Phase 1** — Sub-agents need the section-based prompt resolver to construct their system prompts. Context pruning strips specific sections from the resolved prompt.

### Files Affected

| File | Action |
|---|---|
| `agent/agent.ts` | **Major rewrite** — type hierarchy, expanded config, loading priority |
| `agent/loader.ts` | **Modify** — support new agent definition types |
| `session/engine/query.ts` | **Modify** — integrate context forking into sub-agent spawning |
| `bundled/agents/*.md` | **Modify** — update frontmatter to new schema |
| *(new)* `agent/fork.ts` | **New** — `createSubagentContext()` implementation |
| *(new)* `agent/transcript.ts` | **New** — sidechain transcript recording |
| *(new)* `agent/mcp.ts` | **New** — agent-scoped MCP lifecycle |

---

## Phase 3: Plan Mode

> **speckit.specify scope:** "Refactor plan mode from synthetic message injection to an attachment-driven state machine with PlanModeState, sparse/full reminder cycles, ExitPlanModeTool with inline approval UI, and dedicated Plan/Explore sub-agents"

### Context

liteai currently implements plan mode via `plan-reminder.ts` which injects synthetic text parts into the last user message. There is no persistent plan state, no reminder cycle, and no inline approval flow. The plan/build switch is a simple agent name check.

liteai2 uses an attachment-driven state machine where plan text is never baked into the system prompt (preserving prompt cache). It uses sparse reminders every turn and full plan text refreshes every 5 turns, with an inline approval UI when transitioning from plan to build mode.

### What to Specify

1. **`PlanModeState`** — State object stored in session state (not messages): `{ active: boolean, planText?: string, planFilePath?: string, turnsSincePlanReminder: number }`.
2. **Attachment-based reminder system** — Replace synthetic message injection with attachments appended to user messages:
   - Every turn: sparse attachment ("Plan at {path}, staying on track?")
   - Every 5 turns: full plan text attachment (refreshes model memory)
   - On mode switch: full plan text in tool result (immediate orientation)
3. **`ExitPlanModeTool`** — Tool that writes plan to disk, renders inline UI with diff and approve/reject buttons, blocks model until user decision. On approval: switches to build mode with full plan text in tool result.
4. **`EnterPlanModeTool`** — Reverse path (build → plan). Used for explicit re-planning or when AI determines current approach needs revisiting.
5. **Plan/Explore sub-agents** — Dedicated read-only sub-agents (depends on Phase 2 infra): `omitClaudeMd: true`, independent sidechain transcripts, separate plan file paths.
6. **Plan-in-context strategy** — On approval, full plan text is included in `ExitPlanModeTool`'s result so the model enters build mode with immediate in-context access to the plan.

### Reference Implementation

- [02-plan-mode.md](../liteai2/spec/02-plan-mode.md) — Full comparison and liteai2 source references

### Depends On

- **Phase 2** — Plan/Explore are specialized sub-agents using context forking, sidechain transcripts, and permission sandboxing.

### Files Affected

| File | Action |
|---|---|
| `session/engine/plan-reminder.ts` | **Major rewrite** — replace synthetic injection with attachment system |
| `session/engine/query.ts` | **Modify** — integrate PlanModeState and attachment injection |
| `bundled/prompts/misc/plan-reminder.md` | **Modify** — update template for attachment format |
| `bundled/prompts/misc/build-switch.md` | **Modify** — update for new approval flow |
| `bundled/prompts/tools/plan-enter.txt` | **Modify** — update tool prompt |
| `bundled/prompts/tools/plan-exit.txt` | **Modify** — update tool prompt |
| `bundled/agents/plan.md` | **Modify** — update to use Phase 2 sub-agent features |
| *(new)* `session/engine/plan-state.ts` | **New** — `PlanModeState` management |
| *(new)* `session/engine/attachments.ts` | **New** — attachment injection system |

---

## Execution Order

```
1. speckit.specify → Phase 1 spec
2. speckit.plan    → Phase 1 plan
3. speckit.tasks   → Phase 1 tasks
4. speckit.implement → Phase 1 implementation
5. Verify Phase 1 (typecheck, tests)
6. Repeat 1-5 for Phase 2
7. Repeat 1-5 for Phase 3
```
