# Plan Mode Redesign: Subagent Architecture + yield_turn Removal

## Problem Statement

The current plan mode implementation has several UX and architectural issues:

1. **Dual dialog bug**: When the agent calls `plan_enter`, both a `PlanApprovalRequested` event (TUI "Plan Review" dialog) AND a `Question.ask()` ("Approve entering plan mode?") fire simultaneously, creating two overlapping dialogs.
2. **Permission friction**: Entering plan mode requires user approval — this adds unnecessary friction.
3. **KV cache pollution**: When plan mode activates, the root agent's context switches to read-only mode with reminders injected every turn, disrupting the conversation history and wasting KV cache.
4. **Monolithic plan flow**: The root agent itself does the planning, which ties up the main session and prevents the user from interacting.
5. **`yield_turn` is redundant**: With `toolChoice: "auto"`, the model can naturally stop by finishing its response. The `yield_turn` tool adds complexity for no benefit.

## User Review Required

> [!IMPORTANT]
> **Breaking change**: This removes `plan_enter`/`plan_exit` as state-machine tools and replaces them with a single `plan_enter` tool that spawns a subagent. All existing plan mode state infrastructure is removed.

> [!IMPORTANT]
> **Breaking change**: `yield_turn` tool is fully removed. Coordinator mode prompts will be updated to no longer reference it.

> [!WARNING]
> **Plan reminder system removal**: The per-turn plan reminder injection (`plan-reminder.ts`, `plan-active-reminder.md`) and stop-drift correction for plan mode are being removed since the root agent will no longer enter a "plan mode" state. Post-plan-approval reminders (build phase) are kept because the approved plan text is still useful context.

## Open Questions

> [!IMPORTANT]
> **Plan approval UX**: After the plan subagent completes, the `plan_enter` tool will write the plan to disk and ask the user to approve/reject it via `Question.ask`. Should the "Plan Review" dialog (`PlanApprovalRequested` event) also still fire for the TUI? Currently the TUI uses this to show a file preview dialog. **Recommendation**: Keep `PlanApprovalRequested` for TUI file preview, but only fire it ONCE (not the duplicate that causes the current bug).

> [!IMPORTANT]  
> **Build-phase plan reminders**: After plan approval, should the sparse/full plan text reminders still be injected into the root agent's context during implementation? **Recommendation**: Yes — keep `injectPlanAttachment` for the `active=false, planText!=undefined` path (build phase). Only remove the `active=true` path (active plan mode constraints).

## Proposed Changes

### Component 1: Plan Mode Tool Refactor

Summary: Rewrite `plan_enter` to spawn a "plan" subagent instead of switching the root agent into plan mode. Remove `plan_exit` entirely — the plan lifecycle is now managed end-to-end by `plan_enter`.

#### [MODIFY] [plan.ts](file:///d:/liteai/packages/core/src/tool/plan.ts)

**Remove** `PlanExitTool` entirely (lines 19-105).

**Rewrite** `PlanEnterTool` (lines 107-225):
- Remove `Question.ask()` approval gate (the "Approve entering plan mode?" dialog)
- Remove `PlanApprovalRequested` event emission on entry
- Instead of switching `PlanModeStateRef.active = true`, spawn the "plan" subagent via `SessionPrompt.runSubagent()`
- After subagent completes:
  1. Extract plan text from subagent result
  2. Write plan to disk (same path logic as old `plan_exit`)
  3. Fire `PlanApprovalRequested` event (for TUI plan review preview)
  4. Ask user to approve/reject via `Question.ask()` (single dialog, not dual)
  5. On approval: store `planText` in `PlanModeStateRef` for build-phase reminders
  6. On rejection: return rejection error so agent can revise
- The tool keeps the `interviewMode` parameter but maps it to different plan agent prompts

#### [MODIFY] [plan-enter.txt](file:///d:/liteai/packages/core/src/bundled/prompts/tools/plan-enter.txt)

Update description to reflect new behavior:
- Remove "This tool REQUIRES user approval" note
- Update "What Happens in Plan Mode" to describe subagent spawning
- Remove references to `plan_exit`

#### [DELETE] [plan-exit.txt](file:///d:/liteai/packages/core/src/bundled/prompts/tools/plan-exit.txt)

No longer needed — plan lifecycle is managed by `plan_enter`.

---

### Component 2: Plan Mode State Simplification

Summary: Remove "active plan mode" state machine. Keep plan file path generation and build-phase plan text storage.

#### [MODIFY] [plan-mode-state.ts](file:///d:/liteai/packages/core/src/session/plan-mode-state.ts)

- Remove `active` field from `PlanModeState` interface
- Remove `workflowType` field
- Keep `planText`, `planFilePath`, `turnsSincePlanReminder` (needed for build-phase reminders)
- Remove `PlanStateChanged` event emission from `update()` (no more active transitions)
- Simplify `createDefaultPlanModeState`

#### [MODIFY] [plan-reminder.ts](file:///d:/liteai/packages/core/src/session/engine/plan-reminder.ts)

- Remove `injectActivePlanReminder()` function entirely (lines 188-270)
- Remove the `if (planModeState.active)` branch in `injectPlanAttachment` (lines 49-51)
- Keep the build-phase reminder injection (the `planModeState.planText` path)

#### [DELETE] [plan-active-reminder.md](file:///d:/liteai/packages/core/src/bundled/prompts/misc/plan-active-reminder.md)

No longer needed — active plan mode constraints are removed.

#### [MODIFY] [stop-drift.ts](file:///d:/liteai/packages/core/src/session/engine/stop-drift.ts)

- Remove all plan mode drift detection logic
- The `StopDriftService.check()` method always returns `{ drifted: false }` (or remove the class entirely if no other drift types exist)

#### [MODIFY] [query.ts](file:///d:/liteai/packages/core/src/session/engine/query.ts)

- Remove plan mode stop-drift recovery block (lines 124-142)
- Remove `yield_turn` detection block (lines 616-622)
- Remove `planModeState.active` check for counter update (lines 563-565) — simplify to always update if plan text exists
- Keep `injectPlanAttachment` call (build-phase reminders still needed)
- Remove `StopDriftService` import and instantiation if fully gutted

---

### Component 3: yield_turn Tool Removal

Summary: Remove the `yield_turn` tool from the entire codebase.

#### [DELETE] [yield_turn.ts](file:///d:/liteai/packages/core/src/tool/yield_turn.ts)

#### [DELETE] [yield_turn.txt](file:///d:/liteai/packages/core/src/bundled/prompts/tools/yield_turn.txt)

#### [MODIFY] [tool/index.ts](file:///d:/liteai/packages/core/src/tool/index.ts)

Remove `export * from "./yield_turn"` line.

#### [MODIFY] [tool/registry.ts](file:///d:/liteai/packages/core/src/tool/registry.ts)

- Remove `import { YieldTurnTool } from "./yield_turn"` (line 32)
- Remove `YieldTurnTool` from the `all()` function result array (line 44)

#### [MODIFY] [agent/filter.ts](file:///d:/liteai/packages/core/src/agent/filter.ts)

- Remove `"yield_turn"` from `ALL_LITEAI_TOOLS` set (line 37)

#### [MODIFY] [coordinator/coordinator-mode.ts](file:///d:/liteai/packages/core/src/coordinator/coordinator-mode.ts)

- Remove `"yield_turn"` from `COORDINATOR_ALLOWED_TOOLS` (line 78)
- Remove `"yield_turn"` from `INTERNAL_COORDINATOR_TOOLS` (line 105)

#### [MODIFY] [coordinator/coordinator-prompt.ts](file:///d:/liteai/packages/core/src/coordinator/coordinator-prompt.ts)

- Remove `yield_turn` references from prompt text (line 44, 114)

#### [MODIFY] [coordinator/teammate-runner.ts](file:///d:/liteai/packages/core/src/coordinator/teammate-runner.ts)

- Remove reference to `yield_turn` in prompt text (line 204)

#### [MODIFY] [tool/task.ts](file:///d:/liteai/packages/core/src/tool/task.ts)

- Remove `yield_turn` result parsing logic (lines 181-185)
- Simplify `taskResultContent` to just use `textPart`

---

### Component 4: Tool Registry & Filter Cleanup

Summary: Update tool registry and agent filters to remove plan_exit and reflect new plan_enter behavior.

#### [MODIFY] [tool/registry.ts](file:///d:/liteai/packages/core/src/tool/registry.ts)

- Remove `PlanExitTool` import (line 17 — it's imported alongside PlanEnterTool)
- Remove `PlanExitTool` from the `all()` array (line 73)
- Update `toolProfile` filtering — `plan_exit` no longer exists in the set (line 128)

#### [MODIFY] [agent/filter.ts](file:///d:/liteai/packages/core/src/agent/filter.ts)

- Remove `"plan_exit"` from `ALL_AGENT_DISALLOWED_TOOLS` (line 4) — no longer exists
- Keep `"plan_enter"` in disallowed for subagents (still makes sense — only root should plan)

---

### Component 5: System Prompt & Agent Config Updates

Summary: Update system prompt and bundled agent configs to reflect the new plan-as-subagent model.

#### [MODIFY] [system.md](file:///d:/liteai/packages/core/src/bundled/prompts/system/system.md)

Update Section 5 "Structured Planning" (lines 30-35):
```markdown
## 5. Structured Planning
For complex implementation tasks, use the `plan_enter` tool to launch a planning subagent. The subagent will explore the codebase and design an implementation plan for your approval. Your conversation history is preserved while the planning subagent works.
- **When to plan**: Use `plan_enter` for any task involving multiple files, architectural decisions, unclear requirements, or multiple valid implementation approaches.
- **When NOT to plan**: Skip planning for simple, obvious single-file changes, typo fixes, or tasks where the implementation path is entirely clear.
- **After planning**: The plan will be presented for your approval. Once approved, implement the plan using the full tool set.
```

#### [MODIFY] [plan.md](file:///d:/liteai/packages/core/src/bundled/agents/plan.md)

- Remove `plan_exit` from `disallowedTools` (it no longer exists)
- The plan agent returns its plan as the final response text (no tool call needed)
- Update instructions to say "Return your complete implementation plan as your final response"

---

### Component 6: Session Events Cleanup

Summary: Remove `PlanStateChanged` event (no more active transitions). Keep `PlanApprovalRequested`.

#### [MODIFY] [session/index.ts](file:///d:/liteai/packages/core/src/session/index.ts)

- Remove `PlanStateChanged` event definition (lines 233-241) — no longer emitted

#### [MODIFY] [acp/events.ts](file:///d:/liteai/packages/core/src/acp/events.ts)

- Remove `PlanStateChanged` subscription (line 40)

---

### Component 7: CLI Subagent Display Verification

Summary: Verify that the CLI's `run.ts` correctly displays subagent progress for the plan subagent.

#### [VERIFY] [run.ts](file:///d:/liteai/packages/cli/src/cli/cmd/run.ts)

The existing `task()` renderer (lines 169-184) handles subagent display. Verify:
- Running task status icon (•) displays while planning subagent runs
- Completed status icon (✓) displays when planning finishes
- The description shows the plan task description

No changes expected — the existing task rendering should work for plan subagents since they use the same `TaskTool` infrastructure.

---

### Component 8: Misc Prompt Cleanup

Summary: Remove plan workflow prompts that are no longer loaded.

#### [DELETE] [plan-workflow.md](file:///d:/liteai/packages/core/src/bundled/prompts/misc/plan-workflow.md)

The 5-phase workflow was returned as tool output by the old `plan_enter`. No longer needed — the plan subagent has its own system prompt.

#### [DELETE] [plan-interview.md](file:///d:/liteai/packages/core/src/bundled/prompts/misc/plan-interview.md)

The interview workflow variant. No longer needed.

---

## Verification Plan

### Automated Tests

1. **`bun typecheck`** — Verify no type errors after all changes
2. **`bun lint:fix`** — Fix formatting
3. **`bun test test/plan-mode`** — Run scoped plan mode tests (will need updates)
4. **`bun test test/session`** — Run session engine tests

### Manual Verification

1. **Start TUI, trigger plan mode**: Send a complex task → agent should call `plan_enter` → plan subagent spawns → subagent explores → plan written → single Plan Review dialog appears → approve → agent implements
2. **Verify no dual dialogs**: Only ONE dialog should appear (Plan Review), not two
3. **Verify KV cache preservation**: Root agent's conversation history should be intact after planning
4. **Verify `yield_turn` removed**: No `yield_turn` in tool list, coordinator prompts clean
5. **Verify CLI subagent display**: `liteai run "plan something complex"` → task rendering shows planning progress
