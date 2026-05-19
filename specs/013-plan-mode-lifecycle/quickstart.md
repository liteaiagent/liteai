# Quickstart: Plan Mode Lifecycle

**Branch**: `013-plan-mode-lifecycle` | **Date**: 2026-05-19

## What Changed

The plan mode lifecycle is rewritten from a state-machine toggle pattern to a **blocking subagent spawn pattern**:

| Before (Phase 1) | After (Phase 2) |
|-------------------|-----------------|
| `plan_enter` asks user approval, sets `active: true`, loads workflow instructions | `plan_enter` sets permission to "plan", spawns plan subagent, blocks, returns plan |
| Root agent explores/plans within its own session | Plan subagent explores in its own child session |
| `plan_exit` writes plan, asks approval, sets `active: false` | `plan_exit` writes plan, asks approval, restores permission to "default", clears `planSessionID` |
| Two approval dialogs possible (enter + exit) | Single approval dialog (exit only) |
| `PlanModeState.active` tracks state | `PlanModeState.planSessionID` tracks state |

## Flow Diagram

```
User sends complex task
        │
        ▼
Root Agent assesses complexity
        │
        ▼
Root Agent calls plan_enter()
        │
        ├── setPermissionMode("plan")  ← root session is now read-only
        │
        ├── Session.create({ parentID })
        │
        ├── SessionPrompt.runSubagent("plan", prompt)  ← BLOCKS
        │         │
        │         ├── Plan subagent explores codebase (read, grep, glob, bash read-only)
        │         ├── Plan subagent writes plan to disk (write tool)
        │         └── Plan subagent returns plan text
        │
        ├── Parse subagent result → planText + planFilePath
        │
        └── Return { planText, planFilePath } to root agent
                │
                ▼
Root Agent calls plan_exit(planText)
        │
        ├── Write plan to disk
        ├── Emit PlanApprovalRequested
        ├── Question.ask("Approve plan?")
        │
        ├── User Approves:
        │   ├── setPermissionMode("default")  ← write access restored
        │   ├── Clear planSessionID
        │   └── Return "Plan approved" to root agent
        │
        └── User Rejects:
            ├── Permission stays "plan"
            └── Root agent can re-plan or ask questions
```

## Quick Verification

After implementing, verify with these checks:

1. **Type check**: `bun typecheck` — should pass clean
2. **Lint**: `bun lint:fix` — should pass clean
3. **Scoped tests**: `bun test test/plan-mode` — all plan mode tests pass
4. **Manual E2E**: Send "Add user authentication to the app" to agent, verify:
   - Plan subagent spawns (visible in TUI as subagent)
   - Root session shows "Plan Mode" indicator
   - Plan is written to `.liteai/plans/` directory
   - Single approval dialog appears in TUI
   - Approval restores default permission mode

## Key Files to Read First

1. [plan-mode-state.ts](file:///d:/liteai/packages/core/src/session/plan-mode-state.ts) — Start here: the `PlanModeState` interface
2. [tool/plan.ts](file:///d:/liteai/packages/core/src/tool/plan.ts) — The `plan_enter` and `plan_exit` implementations
3. [app-state-events.ts](file:///d:/liteai/packages/cli/src/tui/state/app-state-events.ts) — CLI event handlers for plan state changes
4. [data-model.md](file:///d:/liteai/specs/013-plan-mode-lifecycle/data-model.md) — State transition diagram
5. [contracts/events-and-tools.md](file:///d:/liteai/specs/013-plan-mode-lifecycle/contracts/events-and-tools.md) — Event and tool contract changes
