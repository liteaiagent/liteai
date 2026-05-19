# Quickstart: yield_turn Removal & State Cleanup

**Branch**: `014-yield-turn-removal` | **Date**: 2026-05-19

## Overview

This feature removes the deprecated `yield_turn` tool and associated legacy plan
mode infrastructure from `packages/core`. It is a **deletion-only** feature — no
new code is introduced, no interfaces change, and no external APIs are affected.

## What Changes

### Removed
- **`yield_turn` tool**: Source file, prompt file, registry entry, filter entry,
  coordinator references, and all detection logic
- **`PlanStateChanged` event**: Event definition, emission, and ACP subscription
- **`injectActivePlanReminder()`**: Function and its dispatch branch in
  `injectPlanAttachment()`
- **Prompt file**: `plan-active-reminder.md`
- **Query loop yield_turn detection**: Dead code in `query.ts`
- **Agent tool yield_turn parsing**: Subagent result extraction in `agent.ts`

### Not Changed
- **`PlanModeState` interface**: Already contains exactly 4 fields (cleaned in P2)
- **`StopDriftService`**: Rewritten in P2, correctly enforces plan mode constraints
- **`plan_enter` / `plan_exit` tools**: Unchanged — blocking subagent workflow intact
- **`PlanApprovalRequested` event**: Retained for CLI/ACP plan approval flow

## Verification

```bash
# Phase 3A: After yield_turn removal
cd packages/core
bun typecheck 2>&1 | Out-String

# Phase 3B: After PlanStateChanged removal
bun typecheck 2>&1 | Out-String

# Phase 3C: After prompt file deletion
bun typecheck 2>&1 | Out-String

# Final: Lint and scoped tests
bun lint:fix 2>&1 | Out-String
bun test test/plan-mode 2>&1 | Out-String
bun test test/session 2>&1 | Out-String
bun test test/tools 2>&1 | Out-String

# CLI: After plan.state_changed handler removal
cd ../cli
bun typecheck 2>&1 | Out-String
bun lint:fix 2>&1 | Out-String
```

## Grep Verification

After all phases complete, these must return zero results:

```bash
grep -rn "yield_turn" packages/core/src/
grep -rn "PlanStateChanged" packages/core/src/
grep -rn "plan-active-reminder" packages/core/src/
grep -rn "injectActivePlanReminder" packages/core/src/
grep -rn "plan.state_changed" packages/cli/src/
grep -rn "PlanState" packages/cli/src/tui/state/app-state.ts
```
