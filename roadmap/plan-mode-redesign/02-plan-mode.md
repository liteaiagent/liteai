# Phase 2-4: Plan Mode Lifecycle, Cleanup & Prompts

---

## Phase 2: Plan Mode Lifecycle Rewrite

> **Goal**: Rewrite `plan_enter` to spawn plan subagent with permission gating. Modify `plan_exit` for permission restoration. Hard deny writes during plan mode.

### 2A. Harden "plan" permission mode

- Audit `permission/service.ts` to ensure `permissionMode: "plan"` **hard denies** all write operations (edit, write, multiedit, apply_patch) — not just "ask"
- Run_command: evaluate whether to deny or allow read-only commands
- Ensure `setPermissionMode()` in `loop.ts` correctly propagates the "plan" mode to the permission service

### 2B. Rewrite `plan_enter` tool

```
plan_enter(context) →
  1. Guard: root agent only
  2. Guard: not already in plan mode (planSessionID check)
  3. setPermissionMode("plan") on root session
  4. Create child session for plan subagent
  5. SessionPrompt.runSubagent({..., keepHistory: true}) — BLOCKING
  6. Parse plan agent result: extract planFilePath + full planText
  7. Store planFilePath + planText in PlanModeStateRef
  8. Return {planFilePath, planText} to root agent
     (root agent does NOT need to call read() — full plan text is returned)
```

- Remove old approval gate (`Question.ask` in plan_enter)
- Remove old `PlanApprovalRequested` from plan_enter (moved to plan_exit)
- Remove old plan mode state machine activation (`active: true`)
- Remove `interviewMode` parameter — root agent handles clarification before plan_enter
- Explicit `keepHistory: true` for subagent KV cache reuse across plan exploration turns

### 2C. Modify `plan_exit` tool

- Add `setPermissionMode("default")` on approval — restore write access
- Keep `PlanApprovalRequested` event for TUI preview
- Keep `Question.ask` approval dialog
- On rejection: keep permission as "plan", allow re-plan or re-enter
- Remove `workflowType` references
- Clear `planSessionID` on approval

### 2D. Update `PlanModeState` interface

```typescript
interface PlanModeState {
  // REMOVED: active, workflowType
  planText: string | undefined
  planFilePath: string
  turnsSincePlanReminder: number
  planSessionID: SessionID | undefined  // NEW: tracks active plan subagent session
}
```

### 2E. Update plan agent config (`bundled/agents/plan.md`)

- Ensure `plan_exit` is in `disallowedTools` for the plan agent (it is a root-agent-only tool, not for subagents)
- Update instructions: "Return your complete implementation plan as your final response. Write the plan to disk using the write tool at the plan file path."
- Verify the plan agent has the `write` tool available (for writing the plan to disk)

### 2F. Ensure `keepHistory: true` default in `TaskTool` → `AgentTool`

```diff
// tool/agent.ts (was task.ts)
 const result = await SessionPrompt.runSubagent({
   messageID,
   sessionID: session.id,
   model: { modelID: model.modelID, providerID: model.providerID },
   agent: agent.name,
   parts: promptParts,
+  // Persist subagent history for KV cache reuse across multi-turn exploration
 })
```

Note: `runSubagent` already defaults to history persistence via `SqliteCheckpointer.loadHistory()`. Verify this is not overridden by any Session.create() flag.

### Deliverables

End-to-end `plan_enter` → plan subagent → `plan_exit` → approve/reject flow works. Permission correctly toggles between "plan" and "default".

---

## Phase 3: yield_turn Removal & State Cleanup

> **Goal**: Remove all deprecated infrastructure.

### 3A. yield_turn deletion

| File | Action |
|------|--------|
| `tool/yield_turn.ts` | DELETE |
| `bundled/prompts/tools/yield_turn.txt` | DELETE |
| `tool/index.ts` | Remove export |
| `tool/registry.ts` | Remove import + array entry |
| `agent/filter.ts` | Remove from `ALL_LITEAI_TOOLS` |
| `coordinator/coordinator-mode.ts` | Remove from allowed/internal tools |
| `coordinator/coordinator-prompt.ts` | Remove references in prompt text |
| `coordinator/teammate-runner.ts` | Remove reference in prompt text |
| `tool/agent.ts` (was task.ts) | Remove yield_turn parsing logic |

### 3B. Plan state cleanup

| File | Action |
|------|--------|
| `session/plan-mode-state.ts` | Remove `active`, `workflowType` fields. Remove `PlanStateChanged` emission from `update()` |
| `session/engine/plan-reminder.ts` | Remove `injectActivePlanReminder()`. Remove `if (planModeState.active)` branch. Keep build-phase path |
| `session/engine/stop-drift.ts` | Remove plan mode drift detection |
| `session/engine/query.ts` | Remove plan mode stop-drift recovery, yield_turn detection |
| `session/index.ts` | Remove `PlanStateChanged` event definition |
| `acp/events.ts` | Remove `PlanStateChanged` subscription |

### 3C. Prompt cleanup

| File | Action |
|------|--------|
| `bundled/prompts/misc/plan-active-reminder.md` | DELETE |
| `bundled/prompts/misc/plan-workflow.md` | DELETE |
| `bundled/prompts/misc/plan-interview.md` | DELETE |
| `bundled/prompts/tools/plan-exit.txt` | UPDATE (if not already done in Phase 2) |

### Deliverables

Zero references to `yield_turn`, `PlanStateChanged`, `active` plan mode. Clean typecheck.

---

## Phase 4: System Prompt & Agent Prompt Rewrites

> **Goal**: Update all instructions to reflect the new architecture. This phase affects agent behavior, not code structure.

### 4A. System prompt (`system.md`) — Section 5 rewrite

Current Section 5 describes the old plan_enter/plan_exit state machine workflow. Rewrite to:

```markdown
## 5. Structured Planning
For complex implementation tasks, use the `plan_enter` tool to launch a planning subagent.
The subagent will explore the codebase and design an implementation plan. Your conversation
history is preserved while the planning subagent works.

- **When to plan**: Use `plan_enter` for any task involving multiple files, architectural
  decisions, unclear requirements, or multiple valid implementation approaches.
- **When NOT to plan**: Skip planning for simple, obvious single-file changes, typo fixes,
  or tasks where the implementation path is entirely clear.
- **Before planning**: Always assess complexity first. Use the `ask_user` tool for 1-3
  critical clarifying questions. Optionally launch the `explore` agent for research.
- **After planning**: The plan will be presented for your approval via `plan_exit`.
  Once approved, implement the plan using the full tool set.
```

### 4B. System prompt — Section 6 agent delegation updates

Update references from `Task` tool to `agent` tool. Update agent names.

### 4C. Plan agent prompt (`bundled/agents/plan.md`)

- Update instructions for new lifecycle (returns plan text, writes to disk)
- Remove `plan_exit` from disallowed tools
- Consider: should plan agent write plan to disk, or should plan_enter handle it?
- If interview mode is kept: how does plan agent interact with user? (ask_user tool? bubble permission?)

### 4D. Plan-enter tool description (`bundled/prompts/tools/plan-enter.txt`)

Rewrite to describe the new behavior:
- No approval gate
- Spawns plan subagent
- Returns plan file path + summary
- Permission switches to read-only

### 4E. Plan-exit tool description (`bundled/prompts/tools/plan-exit.txt`)

Update to reflect:
- Takes plan text
- Fires approval dialog
- Restores write permissions on approve

### 4F. Agent tool description (`bundled/prompts/tools/agent.txt`, was task.txt)

Rename references from "task" to "agent" throughout.

### Deliverables

All prompts consistent with new architecture. Agent behavior matches design.
