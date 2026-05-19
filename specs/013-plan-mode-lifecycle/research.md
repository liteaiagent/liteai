# Research: Plan Mode Lifecycle (Phase 2)

**Branch**: `013-plan-mode-lifecycle` | **Date**: 2026-05-19

## R1: Current `plan_enter` Architecture

**Decision**: Complete rewrite of `plan_enter` — replace approval gate + state machine activation with blocking subagent spawn + permission mode toggle.

**Rationale**: The current `plan_enter` (L107-225, `tool/plan.ts`) performs these steps:
1. Root agent guard (`isRootAgent()`) ✓ KEEP
2. Already-active guard (`state.active`) ✓ KEEP but change to `planSessionID` check
3. **User approval gate** (`Question.ask`) ✗ REMOVE — design doc says approval lives exclusively in `plan_exit`
4. **PlanApprovalRequested event** ✗ REMOVE from `plan_enter` — stays only in `plan_exit`
5. **State machine activation** (`active: true`, `workflowType`) ✗ REMOVE — replaced by `planSessionID`
6. **Load workflow instructions** ✗ REMOVE — plan subagent gets its own prompt via agent config

New steps:
1. Root agent guard (keep)
2. `planSessionID` guard (replaces `active` check)
3. `setPermissionMode("plan")` on root session
4. Create child session for plan subagent
5. `SessionPrompt.runSubagent()` — BLOCKING
6. Parse result: extract `planFilePath` + `planText`
7. Store in `PlanModeStateRef`
8. Return `{planFilePath, planText}` to root agent

**Alternatives considered**:
- Non-blocking async spawn: Rejected (ADR Q4). Nothing useful to do during planning since root is read-only. Adds complexity with no benefit.
- Keep approval gate in `plan_enter`: Rejected (design doc §2B). Creates dual-dialog problem. Single approval point in `plan_exit`.

## R2: Current `plan_exit` Architecture

**Decision**: Modify `plan_exit` to add `setPermissionMode("default")` on approval. Keep existing approval flow.

**Rationale**: Current `plan_exit` (L19-105, `tool/plan.ts`):
1. Active guard (`state.active`) — CHANGE to `planSessionID` or `planText` check
2. Write plan to disk — KEEP (but plan is already on disk from subagent; this is the user's refined version)
3. `PlanApprovalRequested` event — KEEP
4. `Question.ask` approval dialog — KEEP
5. On rejection: throw `RejectedError` — KEEP
6. On approval: update state (`active: false`) — CHANGE to `setPermissionMode("default")` + clear `planSessionID`

**Changes needed**:
- Add `SessionPrompt.setPermissionMode(ctx.sessionID, "default")` on approval
- Replace `active: false` with clearing `planSessionID`
- Remove `workflowType: undefined` (field being removed)
- On rejection: keep permission as "plan" (already works — state not mutated)

## R3: Permission Mode Hardening

**Decision**: The existing `permission/service.ts` already hard-denies on `permissionMode === "plan"` (L191-195). No changes needed to the permission service itself.

**Rationale**: Found at L191-195 in `service.ts`:
```typescript
if (permMode === "plan") {
  return yield* new DeniedError({
    ruleset: [{ permission: request.permission, pattern: "plan-mode", action: "deny" }],
  })
}
```
This blocks ALL permissions when `permissionMode === "plan"`. The `run_command` read-only exception is NOT yet implemented — the current code denies everything. The design doc says to "evaluate whether to deny or allow read-only commands" (§2A), but this is a Phase 2A subtask we should implement.

**For run_command in plan mode**: The plan subagent runs in its own session with its own permission mode (not "plan"). The root agent is blocked in `plan_enter` and can't call any tools. So the run_command question only applies to the plan subagent, which already has bash tools allowed in its agent config. No change needed for Phase 2.

## R4: `PlanModeState` Interface Changes

**Decision**: Remove `active` and `workflowType`, add `planSessionID`.

**Current interface** (L8-21, `plan-mode-state.ts`):
```typescript
interface PlanModeState {
  active: boolean                              // REMOVE
  planText: string | undefined                 // KEEP
  planFilePath: string                         // KEEP
  turnsSincePlanReminder: number               // KEEP
  workflowType: "interview" | "5phase" | undefined  // REMOVE
}
```

**New interface**:
```typescript
interface PlanModeState {
  planText: string | undefined
  planFilePath: string
  turnsSincePlanReminder: number
  planSessionID: SessionID | undefined         // NEW
}
```

**Impact analysis**: 17 files reference `PlanModeState`. Fields `active` and `workflowType` are used in:
- `tool/plan.ts`: `state.active` guard (2 places), `workflowType` assignment — ALL changing
- `plan-mode-state.ts`: `createDefaultPlanModeState()` — update
- `plan-reminder.ts`: `planModeState.active` check (L49) — change to `planSessionID`
- `stop-drift.ts`: `planState.active` check (L50) — change to `planSessionID`
- `query.ts`: `planModeState.active` (L263, L563) — change to `planSessionID`
- `PlanModeStateRef.update()`: `prev.active !== this._state.active` transition check (L96) — change to `planSessionID`

## R5: Plan Agent Config Updates

**Decision**: Update `bundled/agents/plan.md` to allow `write` tool (scoped to plan file) and remove `plan_exit` from disallowed tools.

**Rationale**: Current plan agent config:
```yaml
disallowedTools:
  - task          # Already renamed to agent in P1
  - plan_exit     # REMOVE — not applicable in subagent context
  - edit          # KEEP — plan agent should not edit source files
  - write         # REMOVE — plan agent needs write for plan file
  - multiedit     # KEEP
  - apply_patch   # KEEP
```

The plan subagent needs `write` to save the plan file. It should still be barred from `edit`, `multiedit`, and `apply_patch` (source file modification). `task` → `agent` was already done in Phase 1. `plan_exit` is not available to subagents anyway (filtered by `ALL_AGENT_DISALLOWED_TOOLS` in filter.ts L4).

**Updated prompt**: Add instruction to write the plan to disk and return full plan text as final response. Include `<plan_path>...</plan_path>` convention for `plan_enter` to parse.

## R6: `keepHistory` for Subagent Sessions

**Decision**: Verify `keepHistory` is the default. The current `SessionPrompt.runSubagent()` uses `SqliteCheckpointer.loadHistory()` which already loads full history. No explicit flag needed — history persistence is the default behavior.

**Rationale**: `runSubagent` (loop.ts L165-195) creates a `SqliteCheckpointer` and calls `runSession()`. `runSessionInner` calls `checkpointer.loadHistory()` which returns previously persisted messages. This is already `keepHistory: true` semantically.

**No code change needed** — just verify and document.

## R7: Plan Subagent Result Parsing

**Decision**: Plan agent returns full plan text as its final response text content. `plan_enter` extracts the plan file path from the plan agent's known `planFilePath` (from `PlanModeState`) and the plan text from the subagent result message.

**Rationale**: Design doc says "Plan agent writes to disk AND returns full text + path". The plan file path is deterministic (set by `Session.plan()` in `createDefaultPlanModeState`), so `plan_enter` already knows it. The plan agent writes the plan to that path using the `write` tool. `plan_enter` reads the text from the subagent result's `<agent_result>` output.

**Alternative**: Use `<plan_path>...</plan_path>` XML tags. Rejected — path is already known. Parse plan text from the final message's text content instead.

## R8: Error Recovery in plan_enter

**Decision**: On subagent timeout/crash, `plan_enter` must:
1. Clear `planSessionID` from `PlanModeStateRef`
2. Call `setPermissionMode("default")` to restore write access
3. Throw a structured error

**Rationale**: If the plan subagent fails, the root agent should not be left in read-only mode permanently. Error recovery is critical for UX.

**Implementation**: Wrap `runSubagent()` in try/catch. In the catch block, restore permission mode and clear plan session state before re-throwing.
