# Data Model: Plan Mode MVP Parity

**Feature**: Plan Mode MVP Parity (006)  
**Date**: 2026-04-17  

## Entities

### PlanModeState (Existing — No Schema Changes)

```
PlanModeState
├── active: boolean                    — Plan mode active flag
├── planText: string | undefined       — Approved plan text (set on exit approval)
├── planFilePath: string               — Deterministic per-session plan file path
└── turnsSincePlanReminder: number     — Counter for full-text reminder injection
```

**Behavioral change**: `planText` becomes the semantic signal for "a plan has been approved." Plan reminders fire during build mode when `!active && planText !== undefined`, not during plan mode.

### Agent Definitions (File Changes)

```
bundled/agents/
├── build.md          — Unchanged (root agent, default primary)
│   └── mode: primary
│
├── explore.md        — Verified against MVP EXPLORE_AGENT
│   ├── mode: subagent
│   ├── name: explore (matches MVP internally)
│   └── permissions: read-only (deny *, allow specific read tools)
│
├── plan.md           — REWRITTEN (was: primary root agent, becomes: subagent)
│   ├── mode: subagent (was: primary)
│   ├── description: ported from MVP PLAN_AGENT.whenToUse
│   ├── disallowedTools: [task, plan_exit, edit, write, multiedit]
│   ├── omitLiteaiMd: true
│   └── system prompt: ported from MVP getPlanV2SystemPrompt()
│
├── plan-explore.md   — DELETED (dead code, never spawned)
│
├── compaction.md     — Unchanged
├── general.md        — Unchanged
├── summary.md        — Unchanged
└── title.md          — Unchanged
```

### Prompt Assets (New Files)

```
bundled/prompts/
├── misc/
│   ├── plan-workflow.md      — NEW: 5-phase workflow instructions (from MVP messages.ts)
│   ├── plan-interview.md     — NEW: Interview mode instructions (from MVP messages.ts)
│   └── max-steps.md          — Unchanged
├── tools/
│   └── plan-exit.txt         — REWRITTEN: expanded from MVP ExitPlanModeV2Tool
└── system/
    └── system.md             — UPDATED: Section 5 stale directives replaced
```

### Tool Definitions (Behavioral Changes)

```
PlanEnterTool ("plan_enter")
├── description             — REWRITTEN: ported from MVP prompt.ts (When to Use / When NOT)
├── parameters              — UPDATED: add optional interviewMode: boolean
├── execute()
│   ├── REMOVED: inject: [{info: {agent: "plan"}, parts: []}]
│   ├── REMOVED: getLastModel() + userMsg construction
│   ├── ADDED: Question.ask() approval gate (before state mutation)
│   ├── ADDED: Load and return workflow text as output
│   └── KEPT: PlanModeStateRef.update() with active=true

PlanExitTool ("plan_exit")
├── description             — REWRITTEN: ported from MVP ExitPlanModeV2Tool
├── execute()
│   ├── REMOVED: inject: [{info: {agent: "build"}, parts: []}]
│   ├── REMOVED: getLastModel() + userMsg construction
│   ├── KEPT: Question.ask() approval gate
│   ├── KEPT: PlanModeStateRef.update() with active=false, planText
│   └── KEPT: Bus.publish PlanApprovalRequested
```

## State Transitions

```
                    ┌─────────────────────┐
                    │    Build Mode        │
                    │  (active = false)    │
                    │  (planText = undef)  │
                    └─────────┬───────────┘
                              │
                    Agent calls plan_enter
                    User approves via Question.ask()
                              │
                    ┌─────────▼───────────┐
                    │    Plan Mode         │
                    │  (active = true)     │
                    │  Root agent SAME     │
                    │  No persona swap     │
                    └─────────┬───────────┘
                              │
                    Agent calls plan_exit
                    User approves via Question.ask()
                              │
                    ┌─────────▼───────────┐
                    │    Build Mode        │
                    │  (active = false)    │
                    │  (planText = set)    │
                    │  Reminders fire here │
                    └─────────────────────┘
```

## Relationships

- `PlanModeStateRef` is a session-scoped in-memory singleton (per session). Lifecycle: register on session start, deregister on cleanup.
- `PlanModeState.active` transitions emit `Session.Event.PlanStateChanged` via `Bus.publish`.
- `PlanModeState.active === false && planText !== undefined` → plan-reminder system injects sparse/full attachments.
- Tool registry filters `disallowedTools` for Plan and Explore subagents.
- `BUILTIN_AGENT_NAMES` in `agent.ts` must match the set of `.md` files in `bundled/agents/`.
