# Contract: Plan Mode State API

**Feature Branch**: `004-plan-mode` | **Date**: 2026-04-15

## Module: `src/session/plan-mode-state.ts`

### Types

```typescript
export interface PlanModeState {
  /** Whether plan mode is currently active */
  active: boolean
  /** Last-known plan text (set by ExitPlanModeTool) */
  planText: string | undefined
  /** Deterministic per-session plan file path */
  planFilePath: string
  /** Turns since last full plan reminder injection. Resets at 5. */
  turnsSincePlanReminder: number
}
```

### Factory

```typescript
/**
 * Create a default PlanModeState for a session.
 * Used on session creation and when the `plan_mode` column is null.
 */
export function createDefaultPlanModeState(session: Session.Info): PlanModeState
```

### Read/Write

```typescript
/**
 * Read PlanModeState from the session row.
 * Returns default state if the column is null.
 */
export function getPlanModeState(sessionID: SessionID): Promise<PlanModeState>

/**
 * Persist PlanModeState to the session row.
 * Emits plan.state_changed SSE event if `active` field changed.
 */
export function setPlanModeState(
  sessionID: SessionID,
  updater: (state: PlanModeState) => PlanModeState
): Promise<PlanModeState>
```

---

## Module: `src/tool/plan.ts`

### ExitPlanModeTool

```typescript
export const ExitPlanModeTool = Tool.define("plan_exit", {
  description: string,      // From bundled prompt
  parameters: z.object({
    plan: z.string().min(1)  // Non-empty plan content
  }),
  execute(params, ctx): Promise<Tool.Result>
})
```

**Execute contract**:
1. Write `params.plan` to `PlanModeState.planFilePath` on disk
2. Update `PlanModeState.planText = params.plan`
3. Emit `plan.approval_requested` SSE event
4. Block via `Question.ask()` until user responds
5. On approve:
   - Set `PlanModeState.active = false`, reset `turnsSincePlanReminder`
   - Emit `plan.state_changed` with `{ active: false }`
   - Return tool result containing full plan text
6. On reject:
   - Throw `Question.RejectedError`

### EnterPlanModeTool

```typescript
export const EnterPlanModeTool = Tool.define("plan_enter", {
  description: string,      // From bundled prompt
  parameters: z.object({}),
  execute(params, ctx): Promise<Tool.Result>
})
```

**Execute contract**:
1. If `PlanModeState.active === true`: return no-op confirmation (idempotent)
2. Set `PlanModeState.active = true`, reset `turnsSincePlanReminder`
3. Emit `plan.state_changed` with `{ active: true, planFilePath }`
4. Read plan file from disk (if exists):
   - Exists: return tool result with plan text + review instructions
   - Not exists: return tool result with creation guidance

---

## Module: `src/tool/registry.ts`

### ToolRegistry.tools() — Enhanced Signature

```typescript
export async function tools(
  model: { providerID: ProviderID; modelID: ModelID },
  agent?: Agent.Info,
): Promise<ResolvedTool[]>
```

**New behavior**: After existing assembly steps, apply `agent.disallowedTools` deny filter via `resolveAgentTools()` from `agent/filter.ts`.

**No-op guarantee**: When `agent.disallowedTools` is `undefined` or `[]`, `resolveAgentTools()` returns the full tool pool unchanged (FR-021).

---

## Module: `src/session/events.ts` (BusEvent additions)

### plan.state_changed

```typescript
export const PlanStateChanged = BusEvent.define(
  "plan.state_changed",
  z.object({
    sessionID: SessionID.zod,
    active: z.boolean(),
    planFilePath: z.string(),
    turnsSincePlanReminder: z.number(),
  })
)
```

### plan.approval_requested

```typescript
export const PlanApprovalRequested = BusEvent.define(
  "plan.approval_requested",
  z.object({
    sessionID: SessionID.zod,
    planText: z.string(),
    planFilePath: z.string(),
  })
)
```

---

## Module: `src/session/engine/plan-reminder.ts` — Refactored

### Signature

```typescript
export function injectPlanAttachment(input: {
  messages: Message.WithParts[]
  planModeState: PlanModeState
  session: Session.Info
}): Promise<{
  messages: Message.WithParts[]
  updatedState: PlanModeState
}>
```

**Contract**:
- If `planModeState.active === false`: return messages unchanged, state unchanged
- If `turnsSincePlanReminder >= 5`: inject full plan text, reset counter to 0
- Otherwise: inject sparse reminder, increment counter
- Plan file missing on full-reminder turn: fall back to sparse
- No DB writes — in-memory part appends only
