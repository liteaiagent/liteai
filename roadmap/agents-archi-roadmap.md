# System Prompt Resolution — Refactoring Roadmap

> **Goal:** Refactor system prompt resolution to match [liteai_cli_mvp's architecture](../liteai_cli_mvp/spec/), consolidating multiple provider-specific system prompts into a single unified prompt, restructuring sub-agent context management, modernizing plan mode, and implementing advanced agent spawning models with durability.

[liteai_cli_mvp source code](~\Documents\workspace\liteai_cli_mvp\src)
---

## Dependency Chain

```
Phase 1: System Prompt Resolution  ✅
        │
        ▼
Phase 2: Sub-Agent Architecture ✅
        │
        ├──────────────┐
        ▼              ▼
Phase 3: Plan Mode    Phase 4: Fork Subagent + Agent Durability
                       (parallel-eligible with Phase 3)
```

Each phase is independently testable and deployable. Each phase should be specified using `speckit.specify` before implementation begins.

---

## Phase 1: System Prompt Resolution ✅

> **speckit.specify scope:** "Refactor system prompt resolution to consolidate multiple provider-specific .md files into a single unified system.md with a section-based resolver, dynamic boundary marker, and cached section registry"

### Context

Currently, `SystemPrompt.provider()` in `session/engine/system.ts` dispatches by model ID string matching to load one of 9 different `.md` files (`anthropic.md`, `gemini.md`, `beast.md`, `trinity.md`, etc.). Each file duplicates ~70% of its content with the others.

liteai_cli_mvp uses a single programmatic prompt builder (`constants/prompts.ts`) with:
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

- [liteai_cli_mvp/src/constants/prompts.ts](../liteai_cli_mvp/spec/) — `getSystemPrompt()`, section registration, boundary marker
- [liteai_cli_mvp/src/constants/systemPromptSections.ts](../liteai_cli_mvp/spec/) — Section cache infrastructure

### Files Affected

| File | Action |
|---|---|
| `bundled/prompts/system/system.md` | **Major rewrite** — becomes the single unified template |
| `bundled/prompts/system/{anthropic,gemini,beast,trinity,default,codex_header,google-code-assist}.md` | **Delete** — absorbed into unified `system.md` |
| `bundled/index.ts` | **Modify** — update `Bundled.systemPrompt()` API |
| `session/engine/system.ts` | **Major rewrite** — replace model-dispatch with section resolver |
| `session/engine/query.ts` | **Modify** — update system prompt construction (L326-334) |

---

## Phase 2: Sub-Agent Architecture ✅

> **speckit.specify scope:** "Refactor sub-agent architecture to support context forking, agent definition types, sidechain transcripts, context pruning, permission sandboxing, agent-scoped MCP server mounting, async agent lifecycle management, deterministic cleanup, and agent execution context isolation"

### Context

liteai currently uses a flat `Agent.Info` configuration loaded from `.md` frontmatter with no context isolation between parent and child agents. There is no concept of context forking, sidechain transcripts, or agent-scoped resource management.

liteai_cli_mvp implements a full orchestration layer with `createSubagentContext()` that selectively inherits parent state, isolated sidechain transcripts, dynamic MCP server mounting per agent, and hierarchical permission sandboxing.

### What to Specify

1. **Agent definition type hierarchy** — `BuiltInAgentDefinition | CustomAgentDefinition | PluginAgentDefinition` with source tracking and loading priority (`built-in < plugin < userSettings < projectSettings`). Includes `requiredMcpServers` availability gating.
2. **Agent configuration fields** — Expand `Agent.Info` to support: `tools/disallowedTools`, `skills`, `mcpServers`, `hooks`, `model` (with `'inherit'`), `effort`, `permissionMode`, `maxTurns`, `memory` scopes, `background`, `isolation`, `omitClaudeMd`, `criticalSystemReminder`, `requiredMcpServers`.
3. **Context forking (`createSubagentContext`)** — Isolation model for spawning sub-agents: what state is cloned vs. isolated vs. shared. Covers `readFileState`, `abortController`, `appState`, tool decisions, messages. Includes `thinkingConfig` isolation (disabled for regular sub-agents), `setAppStateForTasks` root-store bypass for nested async agents, and effort level override at runtime.
4. **Context pruning** — Intelligent stripping of heavy context for read-only agents: system prompt section stripping (skills, env details), git status removal.
5. **Sidechain transcripts** — Sub-agent messages recorded to isolated transcript files. Parent receives only the dense `<task_result>` block. Transcript grouping for workflow sub-agents. Agent metadata persistence (`writeAgentMetadata`/`readAgentMetadata`) for observability.
6. **Dynamic MCP server mounting** — Agent-declared MCP servers resolved on spawn (string reference → reuse, inline definition → new connection). Lifecycle cleanup on agent exit.
7. **Permission sandboxing** — Async prompt blocking for background agents (silent deny), permission mode inheritance rules, tool allow-list scoping (replace, not merge).
8. **Hooks integration at agent spawn** — `executeSubagentStartHooks()` at spawn, frontmatter hook registration with `isAgent=true` (converts Stop→SubagentStop), admin-trust gating for hook registration, cleanup in finally block.
9. **Skills preloading at agent spawn** — Skills declared in frontmatter are loaded at spawn and added to `initialMessages`. Plugin skill resolution with namespace-aware lookup (`resolveSkillName()` — exact, plugin-prefix, suffix match). Cleanup (`clearInvokedSkillsForAgent`) on exit.
10. **Async agent lifecycle management** — `runAsyncAgentLifecycle()`: progress tracking (`ProgressTracker` with activity descriptions), agent summarization (periodic cache-sharing summaries), terminal notifications (completed/failed/killed with usage), handoff classification (auto-mode safety classifier), partial result extraction for killed agents, cache eviction hints.
11. **Agent execution context isolation** — `AsyncLocalStorage<AgentContext>` to prevent analytics attribution cross-contamination between concurrent background agents. `SubagentContext` vs `TeammateAgentContext` discriminated union. `runWithAgentContext()` wraps entire agent execution. `consumeInvokingRequestId()` for sparse edge telemetry.
12. **Deterministic cleanup lifecycle** — 12-step teardown in `runAgent` finally block: MCP cleanup, session hooks, prompt cache tracking, file state cache release, context message release, perfetto tracing, transcript subdir mapping, todos entry cleanup (prevents whale-session memory leaks), shell task killing (prevents zombie processes), monitor task cleanup.

### Reference Implementation

- [01-subagent-architecture.md](../liteai_cli_mvp/spec/01-subagent-architecture.md) — Full comparison and liteai_cli_mvp source references

### Depends On

- **Phase 1** — Sub-agents need the section-based prompt resolver to construct their system prompts. Context pruning strips specific sections from the resolved prompt.

### Files Affected

| File | Action |
|---|---|
| `agent/agent.ts` | **Major rewrite** — type hierarchy, expanded config, loading priority |
| `agent/loader.ts` | **Modify** — support new agent definition types, requiredMcpServers gating |
| `session/engine/query.ts` | **Modify** — integrate context forking into sub-agent spawning |
| `bundled/agents/*.md` | **Modify** — update frontmatter to new schema |
| *(new)* `agent/fork.ts` | **New** — `createSubagentContext()` implementation |
| *(new)* `agent/transcript.ts` | **New** — sidechain transcript recording |
| *(new)* `agent/mcp.ts` | **New** — agent-scoped MCP lifecycle |
| *(new)* `agent/lifecycle.ts` | **New** — `runAsyncAgentLifecycle()`, cleanup sequence, progress tracking |
| *(new)* `agent/context.ts` | **New** — `AsyncLocalStorage<AgentContext>`, `runWithAgentContext()` |

---

> **Architecture Review (2026-04-11):** Phase 2 was enriched with 9 integration gaps identified during spec review vs liteai_cli_mvp. Gaps added: hooks integration at spawn, skills preloading at spawn, async lifecycle management, agent execution context (AsyncLocalStorage), thinking config isolation, deterministic cleanup lifecycle, `setAppStateForTasks` root-store bypass, `requiredMcpServers` availability gating, effort level override runtime behavior. Fork subagent model and agent resume deferred to Phase 4.

---

## Phase 3: Plan Mode

> **speckit.specify scope:** "Refactor plan mode from synthetic message injection to an attachment-driven state machine with PlanModeState, sparse/full reminder cycles, ExitPlanModeTool with inline approval UI, and dedicated Plan/Explore sub-agents"

### Context

liteai currently implements plan mode via `plan-reminder.ts` which injects synthetic text parts into the last user message. There is no persistent plan state, no reminder cycle, and no inline approval flow. The plan/build switch is a simple agent name check.

liteai_cli_mvp uses an attachment-driven state machine where plan text is never baked into the system prompt (preserving prompt cache). It uses sparse reminders every turn and full plan text refreshes every 5 turns, with an inline approval UI when transitioning from plan to build mode.

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

- [02-plan-mode.md](../liteai_cli_mvp/spec/02-plan-mode.md) — Full comparison and liteai_cli_mvp source references

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

## Phase 4: Fork Subagent + Agent Durability

> **speckit.specify scope:** "Implement cache-identical fork subagent spawning model and agent resume from sidechain transcripts for background agent durability"

### Context

liteai_cli_mvp implements a fork subagent model (feature-gated `FORK_SUBAGENT`) where the child inherits the parent's full conversation context and system prompt for byte-identical API request prefixes, maximizing prompt cache hits. It also supports resuming agents from persisted sidechain transcripts, enabling background agent durability across process restarts and explicit re-engagement.

These features layer on top of Phase 2's core sub-agent architecture (context forking, sidechain transcripts, worktree isolation) and are independently valuable — fork optimizes spawning costs, resume enables long-running agent workflows.

### What to Specify

1. **Fork subagent model** — A fundamentally different spawning model where the child inherits the parent's full conversation context and rendered system prompt bytes for cache-identical API prefixes:
   - `FORK_AGENT` definition: `permissionMode: 'bubble'`, `model: 'inherit'`, `maxTurns: 200`, `tools: ['*']`
   - `buildForkedMessages()`: Constructs byte-identical API request prefixes (cloned assistant message + placeholder tool_results + per-child directive)
   - `isInForkChild()`: Recursion guard via `<fork_boilerplate>` tag scan — fork children cannot recursively fork
   - `isForkSubagentEnabled()`: Feature gate mutually exclusive with coordinator mode and non-interactive sessions
   - Force-async model: When fork is enabled, ALL agent spawns are forced async for unified `<task-notification>` interaction model
   - Fork + worktree: `buildWorktreeNotice()` injects path translation guidance when fork child runs in isolated worktree
   - System prompt: Fork child inherits parent's **rendered** system prompt bytes (`toolUseContext.renderedSystemPrompt`), not recomputed — byte-exact for cache hits

2. **Agent resume from sidechain transcripts** — Resume previously-running agents from their persisted sidechain transcripts and metadata:
   - `resumeAgentBackground()`: Reconstruct execution state from persisted transcript + metadata
   - Content replacement state reconstruction from transcript records for prompt cache stability
   - Worktree path restoration (with existence check and mtime bump to prevent stale cleanup by GC)
   - Fork resume: Re-thread parent system prompt for cache sharing
   - Message cleanup: Filter orphaned thinking-only messages, whitespace-only assistant messages, and unresolved tool_use pairs before resuming
   - Integration with `SendMessage` tool for teammate re-engagement

### Reference Implementation

- [forkSubagent.ts](../../liteai_cli_mvp/src/tools/AgentTool/forkSubagent.ts) — Fork agent definition, forked message construction, recursion guard
- [resumeAgent.ts](../../liteai_cli_mvp/src/tools/AgentTool/resumeAgent.ts) — Agent resume lifecycle, transcript reconstruction
- [AgentTool.tsx:L318–L356](../../liteai_cli_mvp/src/tools/AgentTool/AgentTool.tsx#L318) — Fork path routing and force-async logic

### Depends On

- **Phase 2** — Fork uses context forking, async lifecycle, and system prompt resolver. Resume uses sidechain transcripts, content replacement state, and worktree isolation.

### Files Affected

| File | Action |
|---|---|
| *(new)* `agent/fork-subagent.ts` | **New** — `FORK_AGENT`, `buildForkedMessages()`, `isInForkChild()`, `buildWorktreeNotice()` |
| *(new)* `agent/resume.ts` | **New** — `resumeAgentBackground()`, transcript reconstruction, message cleanup |
| `agent/fork.ts` | **Modify** — Add fork variant to `createSubagentContext()` with `renderedSystemPrompt` passthrough |
| `agent/lifecycle.ts` | **Modify** — Integrate fork force-async routing and resume lifecycle |
| `session/engine/query.ts` | **Modify** — Route fork path when `isForkSubagentEnabled()` is active |

---

## Execution Order

```
1. speckit.specify → Phase 1 spec
2. speckit.plan    → Phase 1 plan
3. speckit.tasks   → Phase 1 tasks
4. speckit.implement → Phase 1 implementation
5. Verify Phase 1 (typecheck, tests) ✅
6. Repeat 1-5 for Phase 2                ◄── current
7. Repeat 1-5 for Phase 3
8. Repeat 1-5 for Phase 4                (parallel-eligible with Phase 3)
```
