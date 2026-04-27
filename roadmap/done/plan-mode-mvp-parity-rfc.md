# RFC: Plan Mode MVP Parity — Eliminate Agent-Swap, Align with Permission-Driven Architecture

> **Status**: Proposed
> **Author**: @aghassan
> **Date**: 2026-04-16
> **Type**: Change Request (CR) — corrective refactor of Phase 3 implementation
> **Scope**: `packages/core/src/tool/plan.ts`, `packages/core/src/bundled/agents/`, `packages/core/src/bundled/prompts/`, `packages/core/src/session/engine/plan-reminder.ts`, `packages/core/src/session/engine/system.ts`
> **Supersedes**: Behavioral aspects of `specs/004-plan-mode` that deviated from MVP reference
> **Spec**: To be generated via `speckit.specify` at `specs/006-plan-mode-mvp-parity/`

---

## 1. Context & Problem Statement

Phase 3 (Plan Mode, `specs/004-plan-mode`) was implemented and marked ✅ on the [agents-core-roadmap](./agents-core-roadmap.md). However, a post-implementation trace analysis revealed that the current implementation is a **broken hybrid** of two incompatible architectures:

1. **Legacy Dual-Agent Persona Swap** — The `plan_enter` tool injects a message with `agent: "plan"`, causing the session engine to swap the root agent to `plan.md` (different system prompt, different permissions). On exit, `plan_exit` injects `agent: "build"`, swapping back. This causes **conversation context fragmentation** ("amnesia") because each agent swap resets the system prompt.

2. **MVP Permission-Driven Model** — The reference implementation (`liteai_cli_mvp`) uses a **single continuous root agent** that stays the same throughout. Mode changes are via `toolPermissionContext.mode = 'plan'`, and behavioral constraints are injected as tool result text. Subagents (`Explore`, `Plan`) are spawned via the `Agent` tool — they are NOT the root agent.

### 1.1 What Went Wrong

The Phase 3 implementation conflated two distinct concepts from the MVP:

| MVP Concept | What Phase 3 Did | What MVP Actually Does |
|---|---|---|
| **Plan mode activation** | Swapped root agent to `plan.md` via `inject: [{ agent: "plan" }]` | Mutates `toolPermissionContext.mode = 'plan'` — root agent unchanged |
| **Explore subagent** | Created `plan-explore.md` — never used, duplicate of `explore.md` | Uses existing `Explore` subagent type via `Agent` tool |
| **Plan subagent** | Does not exist | `Plan` subagent type — read-only architect, designs strategies |
| **5-phase workflow** | Not implemented | Injected as attachment text in `EnterPlanMode` tool result |
| **Proactive entry** | Tool description says "Switch to the plan agent" — passive | Rich "When to Use / When NOT to Use" guidance in tool description |
| **User approval for entry** | Not implemented | `shouldDefer: true` — requires user consent |
| **Interview phase** | Not implemented | Alternative iterative mode (no subagent phases) |
| **Reminders during plan mode** | Fire during `active === true` (plan phase) | Fire during build phase to keep agent on-plan |

### 1.2 Root Cause

The MVP source code (`liteai_cli_mvp/src`) was not carefully studied during Phase 3 specification. The `plan.md` and `plan-explore.md` agents were created based on assumptions rather than tracing the actual MVP code paths. The `agents-core-roadmap.md` Phase 3 description used phrases like "dedicated Plan/Explore sub-agents" which were misinterpreted as root-agent persona swaps.

### 1.3 Impact

- Agent loses conversation context on every plan/build switch (amnesia)
- No 5-phase workflow — agent has no structured planning behavior
- No user approval for plan mode entry — agent can enter without consent
- No architect subagent — agent does all design work itself without delegation
- Reminders are redundant in plan mode (the `plan.md` agent already has a restrictive prompt)
- `plan-explore.md` is dead code — never spawned, duplicates `explore.md`

---

## 2. Decision Drivers

1. **MVP Behavioral Parity**: Align with `liteai_cli_mvp` per the project's Reference Implementation Mandate (C-001)
2. **Agent Name Parity**: Use exact MVP agent type names (`Explore`, `Plan`)
3. **Instruction Parity**: Port the exact MVP workflow instructions and tool descriptions
4. **Approval Flow Parity**: Implement `shouldDefer` pattern for plan mode entry
5. **Interview Mode Support**: Implement the alternative iterative planning variant
6. **Zero Amnesia**: Eliminate all root-agent persona swaps

---

## 3. MVP Reference Implementation Analysis

### 3.1 Key MVP Source Files

| File | Purpose | Lines of Interest |
|---|---|---|
| [`EnterPlanModeTool.ts`](file:///c:/Users/aghassan/Documents/workspace/liteai_cli_mvp/src/tools/EnterPlanModeTool/EnterPlanModeTool.ts) | Entry tool — permission context mutation, shouldDefer | L88-94 (permission mutation) |
| [`prompt.ts`](file:///c:/Users/aghassan/Documents/workspace/liteai_cli_mvp/src/tools/EnterPlanModeTool/prompt.ts) | "When to Use / When NOT to Use" guidance | L23-98 (external), L101-163 (internal) |
| [`ExitPlanModeV2Tool.ts`](file:///c:/Users/aghassan/Documents/workspace/liteai_cli_mvp/src/tools/ExitPlanModeTool/ExitPlanModeV2Tool.ts) | Exit tool — approval flow, plan-in-context | L1-494 |
| [`messages.ts`](file:///c:/Users/aghassan/Documents/workspace/liteai_cli_mvp/src/utils/messages.ts) | 5-phase workflow instructions injected as attachment | L3207-3297 (5-phase), L3330-3361 (interview) |
| [`planModeV2.ts`](file:///c:/Users/aghassan/Documents/workspace/liteai_cli_mvp/src/utils/planModeV2.ts) | Agent count config for plan/explore phases | L1-96 |
| [`exploreAgent.ts`](file:///c:/Users/aghassan/Documents/workspace/liteai_cli_mvp/src/tools/AgentTool/built-in/exploreAgent.ts) | `EXPLORE_AGENT` definition — read-only search specialist | L64-83 |
| [`planAgent.ts`](file:///c:/Users/aghassan/Documents/workspace/liteai_cli_mvp/src/tools/AgentTool/built-in/planAgent.ts) | `PLAN_AGENT` definition — read-only architect | L73-92 |
| [`builtInAgents.ts`](file:///c:/Users/aghassan/Documents/workspace/liteai_cli_mvp/src/tools/AgentTool/builtInAgents.ts) | Agent registry — Explore + Plan enabled together | L50-52 |

### 3.2 MVP Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                 SINGLE ROOT AGENT (continuous)               │
│                                                              │
│  1. User: "Add billing feature"                              │
│  2. Root agent calls EnterPlanMode tool                      │
│     → shouldDefer: true → User approves                      │
│     → toolPermissionContext.mode = 'plan'                    │
│     → Tool result injects 5-phase workflow constraints       │
│  3. Plan mode attachment injected per-turn (sparse/full)     │
│                                                              │
│  ┌──── Phase 1: Initial Understanding ─────────────────────┐ │
│  │ Root calls Agent(type="Explore") × 1-3 IN PARALLEL      │ │
│  │ Explore subagents search code, read files, return report │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌──── Phase 2: Design ───────────────────────────────────┐  │
│  │ Root calls Agent(type="Plan") × 1-3 IN PARALLEL        │  │
│  │ Plan subagents design implementation, return strategy   │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  Phase 3: Root reviews plans, reads critical files            │
│  Phase 4: Root writes final plan to plan file                 │
│  Phase 5: Root calls ExitPlanMode → approval → build          │
│                                                              │
│  Post-approval: SAME root agent continues with full tools     │
└─────────────────────────────────────────────────────────────┘
```

### 3.3 Interview Phase Variant

When `isPlanModeInterviewPhaseEnabled()` returns true:

```
Root agent enters plan mode
  → NO Explore/Plan subagent phases
  → Root uses read-only tools directly (Glob, Grep, Read, Bash read-only)
  → Root iterates with user via question tool
  → Root writes plan file incrementally
  → Root calls ExitPlanMode → approval → build
```

This variant is simpler but slower. It's the MVP's default for internal users (`USER_TYPE === 'ant'`).

### 3.4 MVP Agent Definitions

**`EXPLORE_AGENT`** (from [`exploreAgent.ts`](file:///c:/Users/aghassan/Documents/workspace/liteai_cli_mvp/src/tools/AgentTool/built-in/exploreAgent.ts)):
```typescript
export const EXPLORE_AGENT: BuiltInAgentDefinition = {
  agentType: 'Explore',
  whenToUse: 'Fast agent specialized for exploring codebases...',
  disallowedTools: [AGENT_TOOL_NAME, EXIT_PLAN_MODE_TOOL_NAME, FILE_EDIT_TOOL_NAME, FILE_WRITE_TOOL_NAME, NOTEBOOK_EDIT_TOOL_NAME],
  source: 'built-in',
  baseDir: 'built-in',
  model: process.env.USER_TYPE === 'ant' ? 'inherit' : 'haiku',
  omitClaudeMd: true,
  getSystemPrompt: () => getExploreSystemPrompt(),
}
```

**`PLAN_AGENT`** (from [`planAgent.ts`](file:///c:/Users/aghassan/Documents/workspace/liteai_cli_mvp/src/tools/AgentTool/built-in/planAgent.ts)):
```typescript
export const PLAN_AGENT: BuiltInAgentDefinition = {
  agentType: 'Plan',
  whenToUse: 'Software architect agent for designing implementation plans...',
  disallowedTools: [AGENT_TOOL_NAME, EXIT_PLAN_MODE_TOOL_NAME, FILE_EDIT_TOOL_NAME, FILE_WRITE_TOOL_NAME, NOTEBOOK_EDIT_TOOL_NAME],
  source: 'built-in',
  tools: EXPLORE_AGENT.tools,
  baseDir: 'built-in',
  model: 'inherit',
  omitClaudeMd: true,
  getSystemPrompt: () => getPlanV2SystemPrompt(),
}
```

### 3.5 MVP Tool Descriptions

**EnterPlanMode — "When to Use" (external users):**
- New Feature Implementation
- Multiple Valid Approaches
- Code Modifications affecting existing behavior
- Architectural Decisions
- Multi-File Changes (more than 2-3 files)
- Unclear Requirements
- User Preferences Matter

**EnterPlanMode — "When NOT to Use":**
- Single-line or few-line fixes
- Adding a single function with clear requirements
- Tasks with very specific, detailed user instructions
- Pure research/exploration tasks (use Agent tool with Explore instead)

Full source: [`prompt.ts:23-98`](file:///c:/Users/aghassan/Documents/workspace/liteai_cli_mvp/src/tools/EnterPlanModeTool/prompt.ts#L23-L98)

### 3.6 MVP Reminder System

| Interval | Content | Purpose |
|---|---|---|
| Every turn | Sparse: "Plan at {path}, staying on track?" | Prevent drift |
| Every 5 turns | Full plan text in attachment | Refresh model memory |
| On mode switch | Full plan text in tool result | Immediate orientation |

Source: [`messages.ts`](file:///c:/Users/aghassan/Documents/workspace/liteai_cli_mvp/src/utils/messages.ts) (`getPlanModeAttachments`)

---

## 4. Current LiteAI State (What Exists Today)

### 4.1 Files That Need to Change

| File | Current State | Problem |
|---|---|---|
| [`plan.ts`](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/tool/plan.ts) | `PlanEnterTool` injects `agent: "plan"`, `PlanExitTool` injects `agent: "build"` | Root agent persona swap — causes amnesia |
| [`plan.md`](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/bundled/agents/plan.md) | Primary agent with restricted permissions | Legacy — should not exist as a root agent |
| [`plan-explore.md`](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/bundled/agents/plan-explore.md) | Subagent, strict read-only | Dead code — duplicate of `explore.md`, never spawned |
| [`build.md`](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/bundled/agents/build.md) | Default agent, allows `plan_enter` but no guidance on WHEN to use it | Missing proactive planning instructions |
| [`explore.md`](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/bundled/agents/explore.md) | Subagent, read-only search | ✅ Correct — this IS the MVP's `Explore` subagent |
| [`plan-reminder.ts`](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/session/engine/plan-reminder.ts) | Fires when `active === true` | Correct for new architecture but logic context changed |
| [`system.md`](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/bundled/prompts/system/system.md) | Section 5 says "you are strictly in Planning Mode" | Stale — conflicts with autonomous execution, confuses agent |
| [`plan-exit.txt`](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/bundled/prompts/tools/plan-exit.txt) | 1-line thin description | Missing detail on what the plan file should contain |
| [`plan-mode-state.ts`](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/session/plan-mode-state.ts) | In-memory `PlanModeStateRef` registry per session | ✅ Correct infrastructure |
| [`registry.ts`](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/tool/registry.ts) | `disallowedTools` filtering exists (Phase 2 gap closed) | ✅ Correct infrastructure |

### 4.2 Files That Do NOT Exist (Need to be Created)

| File | Purpose | MVP Source |
|---|---|---|
| `bundled/agents/plan.md` (REWRITE) | `Plan` subagent — read-only architect | [`planAgent.ts`](file:///c:/Users/aghassan/Documents/workspace/liteai_cli_mvp/src/tools/AgentTool/built-in/planAgent.ts) |
| `bundled/prompts/misc/plan-workflow.md` | 5-phase workflow instructions | [`messages.ts:3207-3297`](file:///c:/Users/aghassan/Documents/workspace/liteai_cli_mvp/src/utils/messages.ts#L3207-L3297) |
| `bundled/prompts/misc/plan-interview.md` | Interview phase instructions | [`messages.ts:3330-3361`](file:///c:/Users/aghassan/Documents/workspace/liteai_cli_mvp/src/utils/messages.ts#L3330-L3361) |

---

## 5. Proposed Changes

### 5.1 Eliminate Root Agent Persona Swap

**`plan.ts` — `PlanEnterTool.execute()`:**
- Remove `inject: [{ info: { agent: "plan", ... }, parts: [] }]`
- Add `shouldDefer: true` (requires user approval, matching MVP)
- Set `PlanModeStateRef.for(ctx.sessionID).update(s => ({ ...s, active: true }))`
- Check interview mode flag to select workflow variant
- Return 5-phase or interview workflow text as tool result output

**`plan.ts` — `PlanExitTool.execute()`:**
- Remove `inject: [{ info: { agent: "build", ... }, parts: [] }]`
- Set `PlanModeStateRef.for(ctx.sessionID).update(s => ({ ...s, active: false }))`
- Return plan text + approval status in tool result

### 5.2 Rename `plan.md` Agent → `Plan` Subagent

**Delete** the current `plan.md` (root agent persona). **Create** a new `plan.md` as a subagent:
- `mode: subagent` (NOT primary)
- `description: "Software architect agent for designing implementation plans..."` (matching MVP's `PLAN_AGENT.whenToUse`)
- Read-only permissions: deny `*`, allow read/search tools
- `disallowedTools: [task, plan_exit, edit, write, multiedit]`
- System prompt: Port from MVP's [`getPlanV2SystemPrompt()`](file:///c:/Users/aghassan/Documents/workspace/liteai_cli_mvp/src/tools/AgentTool/built-in/planAgent.ts#L14-L70)

### 5.3 Delete `plan-explore.md`

Dead code. The existing `explore.md` is the correct Explore subagent (functionally identical to MVP's `EXPLORE_AGENT`).

### 5.4 Port MVP Workflow Instructions

**`plan-workflow.md`** — 5-phase workflow for the subagent-heavy variant. Ported from MVP's [`messages.ts:3207-3297`](file:///c:/Users/aghassan/Documents/workspace/liteai_cli_mvp/src/utils/messages.ts#L3207-L3297).

**`plan-interview.md`** — Interview phase for iterative variant. Ported from MVP's [`messages.ts:3330-3361`](file:///c:/Users/aghassan/Documents/workspace/liteai_cli_mvp/src/utils/messages.ts#L3330-L3361).

### 5.5 Update Tool Descriptions

**`plan_enter` description** — Port from MVP's [`prompt.ts`](file:///c:/Users/aghassan/Documents/workspace/liteai_cli_mvp/src/tools/EnterPlanModeTool/prompt.ts):
- "When to Use This Tool" (7 conditions)
- "When NOT to Use This Tool" (4 exclusions)
- "What Happens in Plan Mode" (6 steps)
- Examples (GOOD and BAD)

**`plan_exit` description** — Expand from 1 line to include:
- When to call (plan file finalized)
- What the plan file should contain
- Prohibition on using text/question for approval (must use this tool)

### 5.6 Fix System Prompt Section 5

Replace the stale "Planning Mode" directives in `system.md` Section 5 with a reference to the `plan_enter` tool. The current text tells the agent to stop and ask permission before ANY change — conflicting with Section 6's autonomous execution directives.

### 5.7 Implement Interview Phase Flag

Add a configuration option (environment variable or config field) to select between:
- **5-Phase variant** (default): Uses Explore + Plan subagents
- **Interview variant**: Direct exploration, iterative with user

MVP uses `isPlanModeInterviewPhaseEnabled()` which checks an internal feature flag.

---

## 6. Risk Assessment

| Risk | Severity | Mitigation |
|---|---|---|
| Breaking existing plan mode workflows | High | This is a v-next clean break (per Core Mandate §0). Legacy behavior is explicitly being replaced. |
| Agent not following 5-phase workflow | Medium | Workflow text is injected as tool result — high in-context priority. Reminders keep agent on track. |
| Subagent delegation failure | Medium | `disallowedTools` on Explore/Plan subagents prevents write operations. Fallback: agent does work itself. |
| Interview mode not well-tested | Low | Start with 5-phase as default. Interview mode is opt-in via flag. |
| Regression in plan-reminder.ts | Medium | Existing tests cover the attachment injection path. Logic guard stays the same. |

---

## 7. Cross-References

### Existing Artifacts (LiteAI)

| Document | Relevance |
|---|---|
| [`agents-core-roadmap.md`](file:///c:/Users/aghassan/Documents/workspace/liteai/roadmap/agents-core-roadmap.md) | Phase 3 marked ✅ — this RFC corrects it |
| [`specs/004-plan-mode/spec.md`](file:///c:/Users/aghassan/Documents/workspace/liteai/specs/004-plan-mode/spec.md) | Original Phase 3 spec — behavioral aspects superseded by this RFC |
| ~~`plan-mode-migration.md`~~ | Deleted — findings absorbed into this RFC |
| ~~`plan_mode_trace_analysis.md`~~ | Deleted — findings absorbed into this RFC |
| [`agent-execution-modes.md`](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/docs/agent-execution-modes.md) | Current architecture doc — describes the permission-driven model correctly |

### MVP Reference Files (liteai_cli_mvp)

| File | What to Port |
|---|---|
| [`EnterPlanModeTool.ts`](file:///c:/Users/aghassan/Documents/workspace/liteai_cli_mvp/src/tools/EnterPlanModeTool/EnterPlanModeTool.ts) | Permission context mutation, shouldDefer pattern |
| [`prompt.ts`](file:///c:/Users/aghassan/Documents/workspace/liteai_cli_mvp/src/tools/EnterPlanModeTool/prompt.ts) | "When to Use / When NOT to Use" tool description |
| [`ExitPlanModeV2Tool.ts`](file:///c:/Users/aghassan/Documents/workspace/liteai_cli_mvp/src/tools/ExitPlanModeTool/ExitPlanModeV2Tool.ts) | Approval flow, plan-in-context result |
| [`messages.ts`](file:///c:/Users/aghassan/Documents/workspace/liteai_cli_mvp/src/utils/messages.ts) | 5-phase workflow (L3207-3297), interview phase (L3330-3361), read-only tool names (L3344) |
| [`planModeV2.ts`](file:///c:/Users/aghassan/Documents/workspace/liteai_cli_mvp/src/utils/planModeV2.ts) | Agent count config (explore: 3, plan: 1-3) |
| [`exploreAgent.ts`](file:///c:/Users/aghassan/Documents/workspace/liteai_cli_mvp/src/tools/AgentTool/built-in/exploreAgent.ts) | Explore agent system prompt and `disallowedTools` |
| [`planAgent.ts`](file:///c:/Users/aghassan/Documents/workspace/liteai_cli_mvp/src/tools/AgentTool/built-in/planAgent.ts) | Plan agent system prompt, `disallowedTools`, `tools: EXPLORE_AGENT.tools` |
| [`builtInAgents.ts`](file:///c:/Users/aghassan/Documents/workspace/liteai_cli_mvp/src/tools/AgentTool/builtInAgents.ts) | `areExplorePlanAgentsEnabled()`, agent registration |
| [`constants.ts` (ExitPlanMode)](file:///c:/Users/aghassan/Documents/workspace/liteai_cli_mvp/src/tools/ExitPlanModeTool/constants.ts) | Tool name constant |

---

## 8. Verification Plan

### Automated Tests

| Test | Scope |
|---|---|
| `bun test test/plan-mode/` | Plan enter/exit state transitions |
| `bun test test/session/engine/plan-reminder.test.ts` | Reminder injection |
| `bun typecheck` | Full type check after agent deletions/changes |
| New: plan_enter returns workflow text, not agent-swap message | Core behavioral change |
| New: plan_exit returns plan-in-context, not agent-swap message | Core behavioral change |

### Manual E2E Verification

| Scenario | Expected |
|---|---|
| Send complex task → agent calls `plan_enter` | User sees approval prompt |
| Approve → agent enters plan mode | 5-phase workflow in tool result, agent spawns Explore subagents |
| Agent writes plan file | Phase 4 — plan file created at expected path |
| Agent calls `plan_exit` | Approval dock appears in UI |
| User approves | Same root agent continues with full tools + plan-in-context |
| Check UI | "Plan" badge active during plan mode, clears after exit |
| Check context | NO agent swap messages in conversation history |

---

## 9. Speckit Feature Specification

This RFC will be specified via `speckit.specify` as `specs/006-plan-mode-mvp-parity/`. The spec must include:

1. **Reference Implementation Mandate** — All work grounded on `liteai_cli_mvp/src` files listed in Section 3.1
2. **C-001 Behavioral Parity Constraint** — No behavioral degradation from MVP
3. **The MVP source file references from Section 3.1** — carried into `plan.md` and `tasks.md`
4. **Interview mode** as a functional requirement
5. **shouldDefer approval** as a functional requirement
6. **5-phase workflow** as a functional requirement
7. **Agent naming parity** (Explore, Plan) as a constraint
