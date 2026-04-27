OK — `WorkflowTool` is a stub (never recovered from MVP extraction). Here's the complete audit:

### MVP → v-Next Tool Name Mapping

| MVP Name (PascalCase) | v-Next Name (snake_case) | filter.ts Entry | Status |
|---|---|---|---|
| `AskUserQuestion` | `ask_user` ✅ | `"ask_user"` ✅ | **Migrated** (this PR) |
| `TaskStop` | ❌ None | `"task_stop"` | **Ghost** — MVP subagent terminal tool. v-Next subagents end via `SessionPrompt.prompt()` return |
| `TaskOutput` | ❌ None | `"task_output"` | **Ghost** — MVP's `TaskOutput` was for swarm/coordinator mode. Not migrated |
| `StructuredOutput` | `StructuredOutput` (dynamic) | `"synthetic_output"` ← **wrong name** | **Migrated** but filter uses stale MVP constant name |
| `Workflow` | ❌ None (stub) | `"workflow"` | **Ghost** — MVP feature-gated, stub in extraction |
| `ExitPlanModeV2` | `plan_exit` ✅ | `"plan_exit"` ✅ | **Migrated** |
| `EnterPlanMode` | `plan_enter` ✅ | `"plan_enter"` ✅ | **Migrated** |

### What needs cleaning in `filter.ts`

The `ALL_AGENT_DISALLOWED_TOOLS` array should only contain tools that **actually exist** in the registry. Current clean state should be:

```typescript
const ALL_AGENT_DISALLOWED_TOOLS = [
  "plan_exit",
  "plan_enter",
  "ask_user",
  "yield_turn",
]
```

**Removed:**
- `"task_output"` — ghost, never existed in v-next
- `"task_stop"` — ghost, never migrated (subagents use implicit termination)
- `"workflow"` — ghost, stub in MVP extraction
- `"synthetic_output"` — stale name, `StructuredOutput` is dynamically created per-turn, never in the global registry

And in `ASYNC_AGENT_ALLOWED_TOOLS`, remove `"synthetic_output"` as well.

Shall I apply these filter.ts cleanups now, or do you want to address the subagent terminal tool gap first (the fact that `task_stop` was never migrated)?