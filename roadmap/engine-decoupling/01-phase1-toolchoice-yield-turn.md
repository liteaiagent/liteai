# Phase 1: Switch `toolChoice` to `auto` & Update Stop-Drift

> **Depends on**: Nothing (can be implemented first)
> **Risk**: Medium — changes model behavior across all providers
> **Rollback**: Revert `toolChoice` default back to `"required"` in `query.ts:438`

---

## 1. Problem Statement

We force `toolChoice: "required"` on every LLM call, meaning the model **must** call a tool on every turn. This created `yield_turn` — a synthetic "I'm done" tool — because the model has no natural way to stop. Neither Gemini CLI, Claude Code, nor LangGraph do this.

### Current Code Path

```
query.ts:438  →  toolChoice: (agent.toolChoice as "auto" | "required" | "none") ?? "required"
                                                                                    ^^^^^^^^^
                                                                                    This is the problem
```

When `toolChoice: required`, the model can never naturally produce a `finish_reason: stop` without tool calls. So:
- If it does stop without tools → `query.ts:141-158` treats it as "stop-drift" and injects a correction
- If it wants to be done → must call `yield_turn` → renders as a tool call in UI

### What Changes

1. Default `toolChoice` to `"auto"` instead of `"required"`
2. A bare `stop` without tool calls becomes **normal behavior** (not drift)
3. Stop-drift correction logic is rewritten: only fires for plan mode (where tool calls are still mandatory)
4. `yield_turn` remains available but is no longer the primary turn-end mechanism

---

## 2. Files to Modify

### 2.1 `packages/core/src/session/engine/query.ts`

#### Change 1: Default toolChoice to "auto" (line 438)

**Before:**
```typescript
toolChoice: (agent.toolChoice as "auto" | "required" | "none") ?? "required",
```

**After:**
```typescript
toolChoice: (agent.toolChoice as "auto" | "required" | "none") ?? "auto",
```

#### Change 2: Rewrite stop-drift detection (lines 114-161)

The current logic at the top of the `while(true)` loop treats ANY bare stop as drift. With `toolChoice: auto`, a bare stop is normal. Only plan mode requires tool calls.

**Before** (lines 114-161):
```typescript
// ── Check if model already finished ──
if (
  lastAssistant?.finish &&
  !["tool-calls", "unknown"].includes(lastAssistant.finish) &&
  lastUser.id < lastAssistant.id
) {
  // ── Plan mode stop-drift recovery ──
  // ... (plan mode correction)

  // ── General stop-drift recovery ──
  // With toolChoice: "required", a bare "stop" without tool calls should
  // never happen. If it does (provider bug, edge case), retry once.
  const hasToolCalls = lastAssistant.finish === "tool-calls"
  if (!hasToolCalls && stopDriftCorrectionCount < MAX_STOP_CORRECTIONS) {
    // ... inject correction
  }
  break
}
```

**After:**
```typescript
// ── Check if model already finished ──
if (
  lastAssistant?.finish &&
  !["tool-calls", "unknown"].includes(lastAssistant.finish) &&
  lastUser.id < lastAssistant.id
) {
  // ── Plan mode stop-drift recovery ──
  // When plan mode is active, the model MUST call ask_user or plan_exit.
  // A bare "stop" means it drifted. Re-read PlanModeState in case a tool
  // call in this turn mutated it (e.g., plan_exit was approved).
  const currentPlanState = planModeStateRef.get()
  if (currentPlanState.active && planStopCorrectionCount < MAX_PLAN_STOP_CORRECTIONS) {
    planStopCorrectionCount++
    log.warn("plan mode stop-drift: model stopped without calling ask_user/plan_exit", {
      sessionID,
      correctionCount: planStopCorrectionCount,
      max: MAX_PLAN_STOP_CORRECTIONS,
      finish: lastAssistant.finish,
    })
    yield {
      type: "control",
      action: "plan-stop-correction",
      payload: { correctionCount: planStopCorrectionCount },
    } satisfies EngineEvent.GeneratorResultEvent
    continue
  }

  // ── Normal stop: model finished naturally ──
  // With toolChoice: "auto", the model can stop by returning text without
  // tool calls. This is expected behavior (matches Gemini CLI, Claude Code).
  log.info("queryLoop exiting: model finished", { sessionID, finish: lastAssistant.finish })
  break
}
```

**Key change**: Remove the entire `MAX_STOP_CORRECTIONS` / `stopDriftCorrectionCount` block. Remove the `stopDriftCorrectionCount` variable declaration (line 79). Remove the `MAX_STOP_CORRECTIONS` constant (line 78).

#### Change 3: Keep yield_turn detection but make it secondary (lines 539-545)

No change needed here. `yield_turn` detection still works — if the model calls it, the loop breaks. With `toolChoice: auto`, the model just won't be forced to call it. It remains as an explicit structured signal for subagents.

#### Change 4: Update the secondary modelFinished check (lines 561-574)

No change needed. The `modelFinished` check at `line 567-574` still correctly handles natural stops.

---

### 2.2 `packages/core/src/session/engine/loop.ts`

#### Change 1: Remove `stop-drift-correction` handler (lines 709-748)

The `stop-drift-correction` control event handler in the `runSessionInner` switch case should be removed entirely since general stop-drift correction no longer exists.

**Remove this entire block** (lines 709-748):
```typescript
case "stop-drift-correction": {
  const { correctionCount } = event.payload as { correctionCount: number }
  // ... all of this
  break
}
```

#### Change 2: Update `plan-stop-correction` handler correction text (lines 665-708)

Keep the `plan-stop-correction` handler as-is. It remains correct — plan mode still requires tool calls.

**Optional improvement**: Update the correction text at line 733 to remove the `yield_turn` reference:

**Before:**
```typescript
"- Use `yield_turn` if you have completed the user's request",
```

**After:**
Remove this line entirely from the plan mode correction. Plan mode should only mention `plan_exit` and `ask_user`.

---

### 2.3 `packages/core/src/session/events.ts`

#### Change: Remove `stop-drift-correction` from GeneratorResultEvent action union (line 54)

**Before:**
```typescript
action:
  | "continue"
  | "compact"
  | "stop"
  | "subtask"
  | "compaction-task"
  | "overflow"
  | "loop-detected"
  | "plan-stop-correction"
  | "stop-drift-correction"
```

**After:**
```typescript
action:
  | "continue"
  | "compact"
  | "stop"
  | "subtask"
  | "compaction-task"
  | "overflow"
  | "loop-detected"
  | "plan-stop-correction"
```

---

### 2.4 `packages/core/src/tool/yield_turn.ts` — NO CHANGES

Keep as-is. `yield_turn` remains in the registry. With `toolChoice: auto`, the model simply won't be forced to call it. It remains useful for:
- Subagents (structured completion signal via `task.ts:124`)
- Agents with `toolChoice: "required"` override
- Future: explicit turn-end when the model wants to provide a summary

---

### 2.5 `packages/core/src/agent/filter.ts` — NO CHANGES

`yield_turn` stays in `ALL_LITEAI_TOOLS` set (line 37). No filtering changes.

---

### 2.6 `packages/core/src/tool/task.ts` — NO CHANGES

Subagent task tool (line 124) still checks for `yield_turn` in subagent results. This continues to work — subagents can still call `yield_turn` to provide a structured summary.

---

### 2.7 `packages/core/src/bundled/prompts/tools/yield_turn.txt` — UPDATE

Update the description to reflect that `yield_turn` is optional, not mandatory:

**Before:**
```
Call this tool ONLY when you have fully completed the user's request, answered their question, or have no further actions to take.

This tool signals that your turn is complete and yields control back to the user.
```

**After:**
```
Call this tool when you want to explicitly signal turn completion with a summary message.

This tool yields control back to the user with a structured summary of what you accomplished.

NOTE: You do NOT need to call this tool to end your turn. Simply finishing your response without tool calls will naturally end your turn. Use this tool only when you want to provide an explicit completion summary.
```

---

## 3. Agent Configuration Impact

### Default agents (no `toolChoice` override)
- **Before**: `toolChoice: "required"` → model must call `yield_turn` to stop
- **After**: `toolChoice: "auto"` → model stops naturally by returning text

### Subagents (`agent.toolChoice: "required"`)
- No change — they explicitly set `toolChoice: "required"` in their agent config
- They continue to use `yield_turn` for structured completion

### Plan mode
- No change — plan mode stop-drift correction still fires (plan mode requires `plan_exit`/`ask_user`)

---

## 4. Testing Strategy

### Unit Tests
- Test `queryLoop` with `toolChoice: auto` — verify loop exits on `finish: "stop"` without correction
- Test `queryLoop` with plan mode active — verify stop-drift correction still fires
- Test `queryLoop` with `agent.toolChoice: "required"` override — verify old behavior preserved
- Verify `stop-drift-correction` control event is no longer emitted

### Integration Tests
- Run session with default agent → model should stop naturally
- Run session with plan mode → model should be corrected if it stops without `plan_exit`
- Run subagent task → subagent should still use `yield_turn` for structured result

### Telemetry
- Monitor `finish` reasons in production after deployment
- Compare premature stop rates across providers
