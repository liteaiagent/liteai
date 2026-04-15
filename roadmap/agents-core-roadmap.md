# Agent Core Architecture — Roadmap

> **Goal:** Establish unified system prompt resolution, sub-agent context management, plan mode, and full agent observability UI. Achieves architectural parity with [liteai_cli_mvp](../liteai_cli_mvp/spec/) for core single-agent and plan-mode workflows.

[liteai_cli_mvp source code](~\Documents\workspace\liteai_cli_mvp\src)

---

## Dependency Chain

```
Phase 1: System Prompt Resolution  ✅
        │
        ▼
Phase 2: Sub-Agent Architecture ✅
        │
        ▼
Phase 3: Plan Mode
        │
        ▼
Phase UI: Agent Experience UI
```

Each phase is independently testable and deployable. Each backend phase must be specified using `speckit.specify` before implementation begins.

> **Cross-Roadmap Integration Note:** When Phase 4 (Fork Subagent, see [Roadmap 2](./agents-platform-roadmap.md)) is enabled via `FORK_SUBAGENT` feature flag, it forces ALL agent spawns — including Phase 3's Plan/Explore sub-agents — into async mode. This is a runtime configuration concern, not an implementation dependency. Integration tests covering Phase 3 + fork flag interaction are required before Roadmap 2 Phase 5 begins.

---

## Spec Quality Standards (All Backend Phases)

Every phase `spec.md` **MUST** include the following two sections verbatim. These are non-negotiable requirements; omitting them from a spec is a blocking deficiency. The canonical template is [`specs/003-fork-subagent-durability/spec.md`](../specs/003-fork-subagent-durability/spec.md).

### 1. Reference Implementation Mandate

Each spec must open with a `## Reference Implementation Mandate` section containing:

- A statement that **all work** on the feature (specification, planning, tasks, design, implementation, reuse) MUST be grounded on `liteai_cli_mvp/src`.
- The target quality bar: **same or superior** quality and behavioral parity — no degradation from MVP is acceptable.
- The key reference files specific to the phase (e.g. the MVP source files most relevant to the feature being built).
- The architecture adaptation note: MVP is a **CLI application**; liteai is a **multi-tenant HTTP/SSE backend server**. All MVP patterns must be adapted to backend architecture (session-scoped state, tenant isolation, concurrent connection management) while preserving behavioral equivalence or improving upon it.
- The **propagation directive**: this mandate MUST be carried forward into `plan.md` and `tasks.md` when those artifacts are generated, ensuring every implementation task references the relevant MVP source for design grounding and parity validation.

### 2. Behavioral Parity Constraint (C-001)

Each spec must include the following constraint in its `#### Constraints` subsection under `## Requirements`:

> **C-001**: All implementation MUST achieve behavioral parity with or superiority to the MVP reference implementation (`liteai_cli_mvp/src`), adapted from CLI to multi-tenant HTTP/SSE backend architecture. No behavioral degradation from MVP is acceptable. See *Reference Implementation Mandate* section above for full context and key reference files.

This constraint is the enforcement hook that makes behavioral parity a testable, auditable requirement — not just a preamble note.

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
3. **Context forking (`createSubagentContext`)** — Isolation model for spawning sub-agents: what state is cloned vs. isolated vs. shared.
4. **Context pruning** — Intelligent stripping of heavy context for read-only agents.
5. **Sidechain transcripts** — Sub-agent messages recorded to isolated transcript files. Agent metadata persistence (`writeAgentMetadata`/`readAgentMetadata`) for observability.
6. **Dynamic MCP server mounting** — Agent-declared MCP servers resolved on spawn. Lifecycle cleanup on agent exit.
7. **Permission sandboxing** — Async prompt blocking for background agents, permission mode inheritance rules.
8. **Hooks integration at agent spawn** — `executeSubagentStartHooks()` at spawn, admin-trust gating, cleanup in finally block.
9. **Skills preloading at agent spawn** — Skills declared in frontmatter loaded at spawn, added to `initialMessages`.
10. **Async agent lifecycle management** — `runAsyncAgentLifecycle()`: progress tracking, agent summarization, terminal notifications, handoff classification, partial result extraction.
11. **Agent execution context isolation** — `AsyncLocalStorage<AgentContext>` to prevent analytics attribution cross-contamination.
12. **Deterministic cleanup lifecycle** — 12-step teardown in `runAgent` finally block.

### Reference Implementation

- [01-subagent-architecture.md](../liteai_cli_mvp/spec/01-subagent-architecture.md) — Full comparison and liteai_cli_mvp source references

### Depends On

- **Phase 1** — Sub-agents need the section-based prompt resolver to construct their system prompts.

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

> **Architecture Review (2026-04-11):** Phase 2 was enriched with 9 integration gaps identified during spec review vs liteai_cli_mvp. Gaps added: hooks integration at spawn, skills preloading at spawn, async lifecycle management, agent execution context (AsyncLocalStorage), thinking config isolation, deterministic cleanup lifecycle, `setAppStateForTasks` root-store bypass, `requiredMcpServers` availability gating, effort level override runtime behavior. Fork subagent model and agent resume deferred to Roadmap 2 Phase 4.

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
3. **`ExitPlanModeTool` rewrite** — Rewrite `tool/plan.ts::PlanExitTool`. New behaviour: writes plan to disk, emits `plan.approval_requested` SSE event, blocks model until user decision. On approval: switches to build mode with **full plan text in tool result**.
4. **`EnterPlanModeTool` rewrite** — Uncomment and rewrite `PlanEnterTool` in `tool/plan.ts`. Must set `PlanModeState.active = true` and inject full plan-in-context attachment.
5. **Plan/Explore sub-agents** — Dedicated read-only sub-agents (depends on Phase 2 infra): `omitClaudeMd: true`, independent sidechain transcripts. **Requires `disallowedTools` enforcement (see prerequisite below).**
6. **Plan-in-context strategy** — On approval, full plan text is included in `ExitPlanModeTool`'s result so the model enters build mode with immediate in-context access to the plan.

### Reference Implementation

- [02-plan-mode.md](../liteai_cli_mvp/spec/02-plan-mode.md) — Full comparison and liteai_cli_mvp source references

### Depends On

- **Phase 2** — Plan/Explore are specialized sub-agents using context forking, sidechain transcripts, and permission sandboxing.

### Prerequisite: `disallowedTools` Enforcement (Phase 2 Gap)

Phase 2 specified `tools/disallowedTools` per-agent config fields but `ToolRegistry.tools()` does **not** currently enforce them. This gap **must be closed as the first task of Phase 3** before Plan/Explore sub-agents can have restricted tool pools.

- **File:** `tool/registry.ts` — `ToolRegistry.tools()` must apply the agent's `disallowedTools` list as a deny filter before returning the assembled tool pool.
- **Scope:** Narrow — one additional `.filter()` pass in the existing assembly chain.

### Files Affected

**Prerequisite (Phase 2 gap closure):**

| File | Action |
|---|---|
| `tool/registry.ts` | **Modify** — enforce agent `disallowedTools` deny filter in `ToolRegistry.tools()` |

**Phase 3 proper:**

| File | Action |
|---|---|
| `tool/plan.ts` | **Major rewrite** — rewrite `PlanExitTool`; uncomment and rewrite `PlanEnterTool` |
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

## Phase UI: Agent Experience UI

> **Scope:** Full agent observability and plan mode UI in `packages/ui`, shared by `packages/web` (primary) and `packages/vscode` (secondary via same pane system).

> **Full specification:** [ui-agent-experience-roadmap.md](./ui-agent-experience-roadmap.md) — All design decisions are locked.

### Context

After Phase 2 and 3 backend implementation, the UI is completely blind to:
- Agent metadata / sidechain transcripts produced by Phase 2 (`writeAgentMetadata`)
- Plan mode state produced by Phase 3 (`PlanModeState`)
- Plan approval requests from `ExitPlanModeTool`

The current UI uses a "link-in-chat → navigate" pattern for sub-agents. This is replaced with a persistent, live **Agent Panel** (slide-in drawer). The plan approval flow uses a **sticky dock** above the prompt input.

The `packages/ui` stack is **SolidJS** + Kobalte + vanilla CSS. No code is shared with the MVP TUI (Ink/React). Design language and information architecture are adopted from the MVP TUI (`AgentProgressLine.tsx`, `CoordinatorAgentStatus.tsx`).

### Sequencing (Two Sub-Phases)

**Phase UI-A — Minimal (delivered with Phase 3 backend):**
Functional plan mode UI with minimal design polish. Enables end-to-end UAT-1.

**Phase UI-B — Full (after UAT-1):**
Complete agent experience designed once, coherently. Enables UAT-2.

### Depends On

- **Phase 2** — Agent metadata SSE events (`agent.spawned`, `agent.progress`, `agent.completed`) require Phase 2's `writeAgentMetadata()` and the sidechain transcript system.
- **Phase 3** — Plan mode SSE events (`plan.state_changed`, `plan.approval_requested`) require Phase 3's `PlanModeState` and `ExitPlanModeTool`.

### Design Decisions (Locked)

| # | Decision |
|---|---|
| D-1 | Agent panel **auto-opens** on first `agent.spawned` SSE event |
| D-2 | Plan approval UI is a **dock** (sticky above prompt input, blocks input) |
| D-3 | Sidechain transcript viewer is **panel-level** (drawer body swap, no page navigation) |

### Backend SSE Events Required (from `packages/core`)

| Event | Source |
|---|---|
| `agent.spawned` | Phase 2 `writeAgentMetadata()` adapter |
| `agent.progress` | Phase 2 lifecycle hooks |
| `agent.completed` | Phase 2 lifecycle hooks |
| `agent.backgrounded` | Phase 2 async lifecycle |
| `plan.state_changed` | Phase 3 `PlanModeState` |
| `plan.approval_requested` | Phase 3 `ExitPlanModeTool` |

### Files Affected

**Phase UI-A (Minimal):**

| File | Action |
|---|---|
| `packages/ui/src/panes/chat/session-title-bar.tsx` | **Modify** — add plan mode badge |
| `packages/ui/src/panes/chat/chat-prompt-input.tsx` | **Modify** — add plan mode input lock + hint |
| `packages/ui/src/panes/chat/chat-pane.tsx` | **Modify** — mount `PlanApprovalDock` in `promptDocks` slot |
| *(new)* `packages/ui/src/components/plan-approval-dock.tsx` | **New** — minimal approve/reject dock |
| *(new)* `packages/ui/src/components/plan-approval-dock.css` | **New** |

**Phase UI-B (Full):**

| File | Action |
|---|---|
| *(new)* `packages/ui/src/components/agent-panel.tsx` | **New** — drawer container, auto-open logic |
| *(new)* `packages/ui/src/components/agent-panel.css` | **New** |
| *(new)* `packages/ui/src/components/agent-row.tsx` | **New** — agent entry: badge, status, stats |
| *(new)* `packages/ui/src/components/agent-row.css` | **New** |
| *(new)* `packages/ui/src/components/agent-status-badge.tsx` | **New** — running/done/error/backgrounded chip |
| *(new)* `packages/ui/src/components/agent-status-badge.css` | **New** |
| *(new)* `packages/ui/src/components/plan-mode-bar.tsx` | **New** — sticky amber plan mode bar |
| *(new)* `packages/ui/src/components/plan-mode-bar.css` | **New** |
| `packages/ui/src/components/plan-approval-dock.tsx` | **Rewrite** — final dock design with plan preview |
| `packages/ui/src/components/plan-approval-dock.css` | **Rewrite** |
| `packages/ui/src/panes/chat/chat-pane.tsx` | **Modify** — add AgentPanel slot + PlanModeBar |
| `packages/ui/src/panes/chat/session-title-bar.tsx` | **Modify** — agents toggle button, session mode chip slot |
| *(new)* `packages/ui/src/panes/controllers/agent-panel-controller.ts` | **New** — SSE agent tree subscriber |

---

## Execution Order

```
1. speckit.specify → Phase 1 spec
2. speckit.plan    → Phase 1 plan
3. speckit.tasks   → Phase 1 tasks
4. speckit.implement → Phase 1 implementation
5. Verify Phase 1 (typecheck, tests) ✅
6. Repeat 1-5 for Phase 2 ✅
7. Repeat 1-5 for Phase 3
8. Phase UI-A (Minimal UI, delivered with Phase 3)
9. UAT-1: Backend correctness + functional plan mode UI
10. Backend SSE event wiring (agent.* + plan.* events)
11. Phase UI-B (Full agent experience design)
12. UAT-2: UX validation (web primary, vscode secondary)
```
