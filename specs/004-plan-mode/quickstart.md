# Quickstart: Plan Mode

**Feature Branch**: `004-plan-mode` | **Date**: 2026-04-15

## Prerequisites

- Phase 2 sub-agent infrastructure complete (context forking, sidechain transcripts)
- Bun 1.x runtime
- SQLite database with existing session schema

## What This Feature Does

Plan Mode transforms the ad-hoc "plan agent" into a structured state machine with:
1. **Persistent state** — `PlanModeState` stored on the session row
2. **Attachment-based reminders** — sparse/full plan text injected as user message parts (no system prompt pollution)
3. **Approval gate** — `ExitPlanModeTool` blocks until user approves the plan, then injects it into the tool result
4. **Tool restriction** — `disallowedTools` enforcement in `ToolRegistry.tools()` for read-only sub-agents
5. **Enter/Exit tools** — bidirectional transitions between build ↔ plan mode

## Key Files to Modify

| File | Change |
|---|---|
| `src/session/session.sql.ts` | Add `plan_mode` JSON column |
| `src/session/engine/plan-reminder.ts` | Rewrite: attachment-based, read PlanModeState |
| `src/tool/plan.ts` | Rewrite ExitPlanModeTool, restore EnterPlanModeTool |
| `src/tool/registry.ts` | Add disallowedTools deny filter |
| `src/session/events.ts` | Add plan mode SSE event types |
| `src/session/engine/query.ts` | Wire PlanModeState read + turn counter increment |
| `src/agent/agent.ts` | Add plan-explore to BUILTIN_AGENT_NAMES |

## Key Files to Create

| File | Purpose |
|---|---|
| `src/session/plan-mode-state.ts` | PlanModeState type, default factory, read/write helpers |
| `src/bundled/agents/plan-explore.md` | Plan/Explore sub-agent definition |
| `drizzle/migrations/XXXX_add_plan_mode.sql` | Schema migration |

## How to Verify

```bash
# Run scoped tests after implementation
bun test test/plan-mode
bun test test/tool/plan
bun test test/agent/filter

# Typecheck
bun typecheck

# Lint
bun lint:fix
```

## Architecture Quick Reference

```
Session (SQLite)
  └── plan_mode: PlanModeState (JSON column)
        ├── active: boolean
        ├── planText: string | undefined
        ├── planFilePath: string
        └── turnsSincePlanReminder: number

Query Loop (per turn)
  ├── Read PlanModeState
  ├── If active: inject sparse/full reminder attachment
  ├── Increment turnsSincePlanReminder
  └── Persist updated state

ExitPlanModeTool
  ├── Write plan to disk
  ├── Emit plan.approval_requested SSE
  ├── Block via Question.ask()
  ├── Approved → set active=false, return plan-in-tool-result
  └── Rejected → throw RejectedError

EnterPlanModeTool
  ├── Set active=true, reset counter
  ├── Emit plan.state_changed SSE
  └── Return plan text (or creation guidance) in tool result

ToolRegistry.tools()
  ├── Existing assembly (config, model-based filters)
  └── NEW: Apply agent.disallowedTools deny filter (resolveAgentTools)
```

## Reference Implementation

All behavioral decisions are grounded in the MVP at:
`C:\Users\aghassan\Documents\workspace\liteai_cli_mvp\src`

Key files:
- `tools/ExitPlanModeTool/ExitPlanModeV2Tool.ts`
- `tools/EnterPlanModeTool/EnterPlanModeTool.ts`
- `utils/attachments.ts` (reminder/attachment patterns)
