# Contracts: Plan Mode Lifecycle Events

**Branch**: `013-plan-mode-lifecycle` | **Date**: 2026-05-19

## Bus Event: `PlanStateChanged`

**Source**: `packages/core/src/session/index.ts` → `Session.Event.PlanStateChanged`
**Emitter**: `PlanModeStateRef.update()` in `plan-mode-state.ts`
**Consumers**: CLI (`app-state-events.ts`), ACP (`events.ts`), SSE event stream

### Payload Schema (Updated)

```typescript
z.object({
  sessionID: SessionID.zod,
  // Derived from planSessionID for backward compat with CLI/ACP
  active: z.boolean(),
  // NEW: the child session ID of the plan subagent (undefined when plan mode exits)
  planSessionID: SessionID.zod.optional(),
  planFilePath: z.string(),
  turnsSincePlanReminder: z.number(),
})
```

### Breaking Change

- `active` field remains but is now **derived** from `planSessionID !== undefined`
- New `planSessionID` field added — CLI and ACP consumers should use this for richer state tracking
- CLI `plan.state_changed` handler uses `active` for `isActivating` check — no breaking change

---

## Bus Event: `PlanApprovalRequested`

**Source**: `packages/core/src/session/index.ts` → `Session.Event.PlanApprovalRequested`
**Emitter**: `plan_exit` tool in `tool/plan.ts` (ONLY — removed from `plan_enter`)
**Consumers**: CLI (`app-state-events.ts`), ACP (`events.ts`)

### Payload Schema (Unchanged)

```typescript
z.object({
  sessionID: SessionID.zod,
  planText: z.string(),
  planFilePath: z.string(),
})
```

### Change Notes

- **Removed** from `plan_enter` — was emitting with empty `planText` which served no purpose
- **Retained** in `plan_exit` — provides actual plan text for TUI preview

---

## Bus Event: `PermissionModeChanged`

**Source**: `packages/core/src/session/index.ts` → `Session.Event.PermissionModeChanged`
**Emitter**: `setPermissionMode()` defined in `loop.ts` (L279), re-exported as `SessionPrompt.setPermissionMode` via `session/engine/namespace.ts`
**Consumers**: CLI (`app-state-events.ts`), ACP (`events.ts`)

### Payload Schema (Unchanged)

```typescript
z.object({
  sessionID: SessionID.zod,
  permissionMode: PermissionModeAll, // "default" | "acceptEdits" | "plan" | "bypassPermissions" | "dontAsk" | "bubble"
})
```

### Change Notes

- Now emitted by `plan_enter` (when setting "plan") and `plan_exit` (when restoring "default")
- Previously, the CLI handled permission mode toggling for plan mode in its `plan.state_changed` handler. Now core manages this directly, making the CLI logic redundant but harmless.

---

## Tool Contract: `plan_enter`

### Input Parameters (Updated)

```typescript
z.object({
  // REMOVED: interviewMode (boolean, optional)
  // No parameters — plan_enter is now a zero-argument tool
})
```

### Return Shape

```typescript
{
  title: "Plan completed",
  output: string,  // Full plan text from subagent
  metadata: {
    planFilePath: string,
    planSessionID: string,  // NEW: child session ID
  }
}
```

### Error Cases

| Error | Condition | Recovery |
|-------|-----------|----------|
| `"EnterPlanMode tool cannot be used in sub-agent contexts"` | Non-root agent invocation | None — caller should not retry |
| `"Plan mode is already active"` | `planSessionID` already set | No-op — return current plan info |
| `"Plan subagent failed: ..."` | Subagent crash/timeout | Permission mode restored to "default", `planSessionID` cleared |

---

## Tool Contract: `plan_exit`

### Input Parameters (Unchanged)

```typescript
z.object({
  plan: z.string().trim().min(1, "Plan is empty"),
})
```

### Return Shape (Unchanged structure)

```typescript
{
  title: "Plan approved",
  output: string,  // Approval confirmation + plan text
  metadata: {
    planFilePath: string,
    approved: true,
  }
}
```

### Side Effects (Updated)

| Step | Action | Notes |
|------|--------|-------|
| 1 | Write plan to disk | Unchanged |
| 2 | Emit `PlanApprovalRequested` | Unchanged |
| 3 | `Question.ask` approval dialog | Unchanged |
| 4a | On approve: `setPermissionMode("default")` | **NEW** |
| 4b | On approve: clear `planSessionID` + set `planText` | Updated (was `active: false`) |
| 4c | On reject: throw `Question.RejectedError` | Unchanged — state NOT mutated |

---

## HTTP API: `POST /:sessionID/permission-mode`

**Source**: `packages/core/src/server/routes/session.ts`

### Behavior Change

The route handler syncs `PlanModeStateRef` with the permission mode. Updated to use `planSessionID` instead of `active`:

```typescript
// Before:
if (permissionMode === "plan" && !planActive) {
  ref.update((s) => ({ ...s, active: true }))
}
// After:
if (permissionMode === "plan" && !ref.get().planSessionID) {
  // No-op — plan mode can only be entered via plan_enter tool
  // Manual toggle to "plan" without a plan subagent is a no-op
}
```

The permission mode route no longer activates/deactivates plan mode state. Plan mode transitions are exclusively managed by `plan_enter` / `plan_exit` tools. The route only toggles the permission mode enum.
