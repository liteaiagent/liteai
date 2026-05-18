# Agent Workflow Redesign

## Problem

The current agentic workflow has these failures:

1. **No pre-planning clarification** — agent jumps into `plan_enter` without first understanding the user's intent, exploring the codebase, or asking clarifying questions
2. **Approval friction on entry** — `plan_enter` asks "Approve entering plan mode?" which is pointless friction — the user already asked for something complex
3. **KV cache pollution** — plan mode injects per-turn reminders into the root agent's context, breaking the KV cache for every turn
4. **Dual dialog bug** — `plan_enter` fires both `PlanApprovalRequested` event AND `Question.ask()` simultaneously
5. **Task tool creates fresh sessions** — each subagent call starts with zero history, wasting KV cache warmup
6. **No exploration phase** — agent has no formal "research before planning" stage

## Target Workflow

```
User: "Create a portfolio management web app"
  │
  ▼
Root Agent: Complexity Assessment
  │ "This requires multiple files, architectural decisions, unclear requirements"
  │
  ▼
Root Agent: Clarification (OPTIONAL)
  │ Ask 1-3 critical questions directly via Question.ask()
  │ e.g. "What tech stack?" "Any auth requirements?" "Data sources?"
  │
  ▼
Root Agent: Exploration (OPTIONAL)
  │ Launch explorer subagent → search codebase, web, APIs, libs
  │ Receive structured research output
  │
  ▼
Root Agent: plan_enter (NO approval gate)
  │ Spawns plan subagent with research context
  │ Root agent's KV cache is UNTOUCHED
  │
  ▼
Plan Subagent: Designs plan (read-only tools)
  │ Returns plan text to root agent
  │
  ▼
Root Agent: plan_exit → writes plan → asks approval
  │ SINGLE dialog: "Approve this plan?"
  │ User reviews → approves/rejects
  │
  ▼
Root Agent: Executes plan (full tool access)
```

## Key Design Decisions

### 1. Clarification happens BEFORE plan_enter

The root agent's system prompt (Section 5) must instruct it to:
- Assess complexity first
- Ask clarifying questions via normal conversation (not a tool)
- Optionally launch explorer agent for research
- THEN call `plan_enter` with the gathered context

This is a **prompt-level change**, not a tool-level change. The tool itself doesn't need a "clarify" gate — the instructions tell the agent when to call it.

### 2. plan_enter: No approval, spawns subagent

- Remove the `Question.ask()` approval gate from `plan_enter`
- Remove the `PlanApprovalRequested` event from `plan_enter`
- `plan_enter` now spawns a "plan" subagent via `SessionPrompt.runSubagent()`
- The plan subagent works in an isolated session with read-only tools
- Root agent's context/KV cache is completely untouched

### 3. plan_exit: Merged into plan_enter

Since plan mode is now entirely within the subagent, there's no separate "exit" step for the root agent. The flow is:

1. `plan_enter` spawns plan subagent
2. Plan subagent returns plan text
3. `plan_enter` writes plan to disk
4. `plan_enter` fires `PlanApprovalRequested` (TUI preview)
5. `plan_enter` asks user to approve via `Question.ask()` (SINGLE dialog)
6. On approval: stores planText for build-phase reminders
7. On rejection: returns error so agent can revise/re-plan

`plan_exit` tool is deleted entirely.

### 4. Task tool defaults to keeping history

Change `SessionPrompt.runSubagent()` call in `task.ts` to pass `keepHistory: true` by default. This means:
- Subagent sessions reuse their KV cache across turns
- The `task_id` resume path still works but is now the default behavior
- Fresh sessions only created when explicitly requested

### 5. Remove all plan mode prompt injection

Delete:
- `plan-active-reminder.md` — per-turn plan mode constraints
- `plan-workflow.md` — 5-phase workflow (now in plan subagent's prompt)
- `plan-interview.md` — interview variant
- `injectActivePlanReminder()` function
- `PlanModeStateRef.active` field
- `PlanStateChanged` event
- Stop-drift plan mode detection

Keep:
- Build-phase plan text injection (`injectPlanAttachment` for `planText` path)
- `PlanApprovalRequested` event (used by TUI for plan preview)

## Files Affected

| File | Action | Scope |
|------|--------|-------|
| `tool/plan.ts` | Rewrite | Remove PlanExitTool, rewrite PlanEnterTool |
| `tool/task.ts` | Modify | Default keepHistory=true, remove yield_turn parsing |
| `tool/yield_turn.ts` | Delete | Redundant tool |
| `session/plan-mode-state.ts` | Simplify | Remove `active`, `workflowType` fields |
| `session/engine/plan-reminder.ts` | Gut | Remove active plan reminder, keep build-phase |
| `session/engine/stop-drift.ts` | Gut | Remove plan mode drift detection |
| `session/engine/query.ts` | Simplify | Remove plan mode recovery, yield_turn blocks |
| `bundled/prompts/system/system.md` | Update | Rewrite Section 5 for new workflow |
| `bundled/agents/plan.md` | Update | Remove plan_exit from disallowed, update instructions |
| `bundled/prompts/tools/plan-enter.txt` | Rewrite | New description |
| `bundled/prompts/tools/plan-exit.txt` | Delete | No longer exists |
| `bundled/prompts/tools/yield_turn.txt` | Delete | No longer exists |
| `bundled/prompts/misc/plan-*.md` | Delete | All 3 plan prompt files |
| `tool/registry.ts` | Modify | Remove PlanExitTool, YieldTurnTool |
| `agent/filter.ts` | Modify | Remove yield_turn, plan_exit |
| `coordinator/*` | Modify | Remove yield_turn references |
| `session/index.ts` | Modify | Remove PlanStateChanged event |
| `acp/events.ts` | Modify | Remove PlanStateChanged subscription |
