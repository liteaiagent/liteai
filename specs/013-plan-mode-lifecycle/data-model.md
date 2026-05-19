# Data Model: Plan Mode Lifecycle (Phase 2)

**Branch**: `013-plan-mode-lifecycle` | **Date**: 2026-05-19

## Entity Changes

### PlanModeState (Modified)

**Source**: `packages/core/src/session/plan-mode-state.ts`

| Field | Before | After | Notes |
|-------|--------|-------|-------|
| `active` | `boolean` | **REMOVED** | Replaced by `planSessionID !== undefined` |
| `planText` | `string \| undefined` | `string \| undefined` | Unchanged |
| `planFilePath` | `string` | `string` | Unchanged |
| `turnsSincePlanReminder` | `number` | `number` | Unchanged |
| `workflowType` | `"interview" \| "5phase" \| undefined` | **REMOVED** | Interview mode dropped per design doc |
| `planSessionID` | — | `SessionID \| undefined` | **NEW**: tracks active plan subagent session |

**Derived State**:
- `isInPlanMode` ≡ `planSessionID !== undefined` (replaces `active`)
- `hasPlan` ≡ `planText !== undefined` (unchanged)

**State Transitions**:

```
┌──────────────────┐    plan_enter()     ┌──────────────────────┐
│ planSessionID:   │ ─────────────────→  │ planSessionID:       │
│   undefined      │   setPermissionMode │   <child-session-id> │
│ planText:        │   ("plan")          │ planText: undefined  │
│   undefined      │                     │                      │
└──────────────────┘                     └──────────┬───────────┘
                                                    │
                                         subagent completes
                                                    │
                                                    ▼
┌──────────────────┐    plan_exit()       ┌──────────────────────┐
│ planSessionID:   │ ◀───────────────── │ planSessionID:       │
│   undefined      │   On APPROVE:       │   <child-session-id> │
│ planText: <text> │   setPermissionMode │ planText: <text>     │
│                  │   ("default")       │ planFilePath: <path> │
└──────────────────┘                     └──────────────────────┘
        │
        │ plan_exit() REJECT
        │ (no state change — stays in plan mode)
        ▼
┌──────────────────────┐
│ planSessionID:       │  Root agent can re-plan
│   <child-session-id> │  or ask questions
│ planText: <text>     │
└──────────────────────┘
```

### createDefaultPlanModeState (Modified)

**Before**:
```typescript
{
  active: false,
  planText: undefined,
  planFilePath: Session.plan(session),
  turnsSincePlanReminder: 0,
  workflowType: undefined,
}
```

**After**:
```typescript
{
  planText: undefined,
  planFilePath: Session.plan(session),
  turnsSincePlanReminder: 0,
  planSessionID: undefined,
}
```

### PlanModeStateRef.update() Event Emission (Modified)

**Before**: Emits `PlanStateChanged` when `active` transitions (`prev.active !== this._state.active`)

**After**: Emits `PlanStateChanged` when `planSessionID` transitions (`prev.planSessionID !== this._state.planSessionID`). Event payload changes:

| Field | Before | After |
|-------|--------|-------|
| `active` | `boolean` | **Derived**: `planSessionID !== undefined` |
| `planSessionID` | — | `SessionID \| undefined` (NEW) |
| `planFilePath` | `string` | Unchanged |
| `turnsSincePlanReminder` | `number` | Unchanged |

## Validation Rules

- `planSessionID` must reference a valid child session (created by `Session.create({ parentID })`)
- `planFilePath` is immutable for the session lifetime (set once by `createDefaultPlanModeState`)
- `planText` is only set after plan subagent completes or after `plan_exit` approval
- `turnsSincePlanReminder` resets to 0 on full reminder injection (unchanged)

## Session Table Impact

- `plan_mode` column (JSON, type `PlanModeState`) — schema evolves automatically since it's `text({ mode: "json" })` (see `session.sql.ts` L36)
- No migration needed — old persisted rows with `active`/`workflowType` are only read by `createDefaultPlanModeState()` which creates fresh state on session start
