# Data Model: yield_turn Removal & State Cleanup

**Branch**: `014-yield-turn-removal` | **Date**: 2026-05-19

This feature is a **deletion-only** change with zero new entities. The data model
document captures the **state transitions** of existing entities after cleanup.

## Entity: PlanModeState

**File**: `src/session/plan-mode-state.ts`

### Current Interface (Post-P2 — Already Clean)

```typescript
export interface PlanModeState {
  planSessionID: SessionID | undefined
  planText: string | undefined
  planFilePath: string
  turnsSincePlanReminder: number
}
```

**Status**: No changes needed. The `active` and `workflowType` fields were already
removed during Phase 2 implementation.

### Event Emission Changes

| Event | Current State | Target State |
|-------|--------------|-------------|
| `PlanStateChanged` | Emitted on `planSessionID` transitions in `PlanModeStateRef.update()` | **REMOVED** — event definition, emissions, and subscriptions all deleted |
| `PlanApprovalRequested` | Emitted by `plan_exit` tool on plan approval | **RETAINED** — still needed for CLI/ACP plan approval flow |
| `PermissionModeChanged` | Emitted on permission mode transitions | **RETAINED** — unrelated to plan state cleanup |

### PlanModeStateRef.update() Simplification

The `update()` method currently (lines 82-115):
1. Mutates state via `fn(prev)`
2. Derives `wasActive`/`isActive` from `planSessionID`
3. Emits `PlanStateChanged` on transition
4. Sets OpenTelemetry span attributes

After cleanup:
1. Mutates state via `fn(prev)` (retained)
2. Sets OpenTelemetry span attributes (retained — tracing is valuable)
3. `PlanStateChanged` emission **removed**
4. The `wasActive`/`isActive` derivation is only needed for the event — **removed**

## Entity: ToolRegistry

**File**: `src/tool/registry.ts`

### Tool Pool Changes

| Tool | Current | After Cleanup |
|------|---------|---------------|
| `yield_turn` | Included in `all()` result array | **REMOVED** from array, import deleted |
| All other tools | Present | Unchanged |

## Entity: AgentTool Result Processing

**File**: `src/tool/agent.ts`

### Subagent Result Format Changes

| Field | Current | After Cleanup |
|-------|---------|---------------|
| `yieldTurnPart` | Extracted from `completedMessage.parts` | **REMOVED** — no yield_turn parts can exist |
| `taskResultContent` | `yieldTurnPart?.args?.summary ?? textPart` | Simplified to `textPart` |

## Entity: Coordinator Tool Arrays

**File**: `src/coordinator/coordinator-mode.ts`

### Tool Array Changes

Two arrays in `coordinator-mode.ts` list tools available to coordinators.
`yield_turn` is removed from both.

## Deleted Files (Full Removal)

| File | Purpose | Reason |
|------|---------|--------|
| `src/tool/yield_turn.ts` | Tool definition | Tool no longer exists |
| `src/bundled/prompts/tools/yield_turn.txt` | Tool prompt description | No tool to describe |
| `src/bundled/prompts/misc/plan-active-reminder.md` | Active plan mode constraint text | Replaced by plan subagent system prompt |
