# Research: yield_turn Removal & State Cleanup

**Branch**: `014-yield-turn-removal` | **Date**: 2026-05-19

## Codebase Audit Results

### yield_turn References (15 total across 8 files)

| File | Lines | Type |
|------|-------|------|
| `src/tool/yield_turn.ts` | 2, 5 | **Source file** — DELETE entire file |
| `src/bundled/prompts/tools/yield_turn.txt` | — | **Prompt file** — DELETE entire file |
| `src/tool/index.ts` | 29 | Export statement: `export * from "./yield_turn"` |
| `src/tool/registry.ts` | 32, 44 | Import + array entry: `YieldTurnTool` |
| `src/agent/filter.ts` | 37 | String literal in `ALL_LITEAI_TOOLS` set |
| `src/tool/agent.ts` | 185-189 | yield_turn result parsing logic in subagent output |
| `src/session/engine/query.ts` | 616-622 | yield_turn detection + loop break |
| `src/coordinator/coordinator-mode.ts` | 78, 105 | String in two tool arrays |
| `src/coordinator/coordinator-prompt.ts` | 44, 114 | String in prompt text descriptions |
| `src/coordinator/teammate-runner.ts` | 204 | String in prompt text to workers |

### PlanStateChanged References (6 files)

| File | Lines | Type |
|------|-------|------|
| `src/session/plan-mode-state.ts` | 100-107 | `Bus.publish(Session.Event.PlanStateChanged, ...)` in `update()` |
| `src/session/index.ts` | 233-244 | `PlanStateChanged` BusEvent definition |
| `src/acp/events.ts` | 40-47 | `Bus.subscribe(Session.Event.PlanStateChanged, ...)` |
| `test/session/plan-mode-state.test.ts` | — | Test file (update or delete) |
| `test/plan-mode/plan-mode-state.test.ts` | — | Test file (update or delete) |
| `test/plan-mode/enter-plan-tool.test.ts` | — | Test file (update or delete) |

### CLI TUI References (plan.state_changed — cross-package impact)

| File | Lines | Type |
|------|-------|------|
| `packages/cli/src/tui/state/app-state-events.ts` | 402-446 | `case "plan.state_changed"` event handler — dead code after core removal |
| `packages/cli/src/tui/state/app-state.ts` | 44-53, 93, 103, 134, 137 | `PlanState` interface, `plan` and `prePlanPermissionMode` state fields |

### plan-active-reminder References (2 files)

| File | Lines | Type |
|------|-------|------|
| `src/bundled/prompts/misc/plan-active-reminder.md` | — | **Prompt file** — DELETE entire file |
| `src/session/engine/plan-reminder.ts` | 214 | `Bundled.miscPrompt("plan-active-reminder")` call |

### Other Legacy Artifacts

| File | Status |
|------|--------|
| `bundled/prompts/misc/plan-workflow.md` | **Already deleted** — not found on disk |
| `bundled/prompts/misc/plan-interview.md` | **Already deleted** — not found on disk |
| `workflowType` field | **Already removed** — zero references in codebase |
| `active` field on PlanModeState | **Already removed** — not in the interface definition |

## Key Findings

### Decision 1: PlanModeState is Already Clean
The `PlanModeState` interface (lines 8-18 of `plan-mode-state.ts`) already contains exactly 4 fields: `planSessionID`, `planText`, `planFilePath`, `turnsSincePlanReminder`. The `active` and `workflowType` fields referenced in the roadmap have **already been removed** during Phase 2 work.

**Rationale**: Phase 2 likely cleaned these fields as part of the plan_enter rewrite.
**Impact**: Phase 3B scope is reduced — only the `PlanStateChanged` event emission, ACP subscription, and engine cleanup remain.

### Decision 2: plan-active-reminder.md Still Needed?
The `injectActivePlanReminder()` function (lines 188-270 of `plan-reminder.ts`) uses `Bundled.miscPrompt("plan-active-reminder")` for full constraint injection during plan mode. Per the roadmap, this function should be **removed** in Phase 3B.

However, this function serves a purpose in the current architecture: it injects constraint reminders to prevent the plan subagent from drifting. The roadmap says to "Remove `injectActivePlanReminder()`. Remove `if (planModeState.active)` branch. Keep build-phase path."

But the current code uses `planModeState.planSessionID !== undefined` (not `.active`), meaning P2 already migrated the conditional. The full `injectActivePlanReminder` function is still actively used during plan mode.

**Decision**: The roadmap's intent is clear — the active plan reminder system is legacy infrastructure that should be replaced by the plan subagent's own system prompt constraints. Remove `injectActivePlanReminder()` and the `planSessionID !== undefined` dispatch branch in `injectPlanAttachment()`. The build-phase (post-approval) path remains.

### Decision 3: stop-drift.ts is Not Legacy
The `StopDriftService` (stop-drift.ts) was rewritten during Phase 2 and is **not** legacy — it correctly uses `planState.planSessionID === undefined` for its check. The roadmap says to "Remove plan mode drift detection from the stop-drift module" but the current implementation is the **new** drift detection, not the legacy one.

**Decision**: Do NOT remove `StopDriftService`. The roadmap's Phase 3B item for stop-drift was written before Phase 2 implementation. The current `StopDriftService` is the correct, P2-era drift detection for plan mode. Removing it would break plan mode enforcement.

### Decision 4: query.ts yield_turn Detection
Lines 616-622 of `query.ts` check `toolExecutor.hasToolCall("yield_turn")` and break the loop. This is dead code since `yield_turn` is being removed from the tool registry.

**Decision**: Remove the yield_turn detection block (lines 616-622). The model can no longer call a tool that doesn't exist.

### Decision 5: Coordinator References
Three coordinator files reference `yield_turn` in tool arrays and prompt text. These are active code paths for Coordinator/Swarm mode.

**Decision**: Remove `yield_turn` from coordinator tool arrays and prompt descriptions. Update prompt text to reference alternative turn-ending patterns.

### Decision 6: Agent Tool yield_turn Parsing
Lines 185-189 of `tool/agent.ts` extract a `yield_turn` part from subagent results for the `[Yield]` prefix. Since yield_turn is being removed, subagents can no longer call it.

**Decision**: Remove the yield_turn-specific parsing. The `taskResultContent` should always use `textPart` (the last text part of the subagent's response).

### Decision 7: CLI TUI Dead Code
The CLI package (`packages/cli/src/tui/state/`) has a `plan.state_changed` event handler (lines 402-446 of `app-state-events.ts`) that receives `PlanStateChanged` events via SSE and populates the `plan` and `prePlanPermissionMode` state fields. When `PlanStateChanged` is removed from core, this handler will silently never fire, leaving those state fields permanently empty.

Notably, no selectors or components currently read from `state.plan` — the state gets populated but nothing consumes it. This confirms it's dead code.

**Decision**: Remove the `plan.state_changed` case block from `app-state-events.ts`, remove the `PlanState` interface and `plan`/`prePlanPermissionMode` fields from `app-state.ts`, and remove their defaults from `getDefaultAppState()`. Also note: `packages/sdk/src/gen/types.gen.ts` has `EventPlanStateChanged` but is auto-generated — will be fixed on next SDK regen (out of scope).

## Alternatives Considered

**No alternatives needed.** This is a deletion/cleanup feature. The roadmap design documents and Phase 2 implementation define the target state unambiguously. The only decisions are scoping adjustments based on what Phase 2 already accomplished.
