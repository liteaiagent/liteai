# Plan Mode — liteai_cli_mvp

> Source: `C:\Users\aghassan\Documents\workspace\liteai_cli_mvp\src\tools\ExitPlanModeTool\`, `EnterPlanModeTool\`

---

## Overview

Plan Mode in liteai_cli_mvp is an **attachment-driven state machine** that controls how the AI approaches multi-step tasks. It switches between `plan` and `build` phases, with the plan text embedded directly in model context.

---

## 1. Core Mechanism

### The Cycle

```
              ┌─────────── user message ───────────┐
              ▼                                     │
        ┌──────────┐    ExitPlanModeV2Tool    ┌──────────┐
        │   PLAN   │ ──────────────────────→  │  BUILD   │
        │   mode   │                          │   mode   │
        └──────────┘    EnterPlanModeTool     └──────────┘
              ▲     ←────────────────────────      │
              └─────────── manual entry ───────────┘
```

### State Storage

Plan mode state lives in `AppState`, not in conversation messages:

```ts
type PlanModeState = {
  active: boolean
  planText?: string
  planFilePath?: string
  turnsSincePlanReminder: number
}
```

---

## 2. Reminder System — Attachment-Based

**The key innovation:** Plan text is not baked into the system prompt (which would break prompt cache). Instead, it's injected via **attachments** that are appended to user messages.

### Reminder Cycles

| Interval | Content | Purpose |
|---|---|---|
| **Every turn** | Sparse attachment — "Plan at {path}, staying on track?" | Prevent drift |
| **Every 5 turns** | Full plan text in attachment | Refresh model's memory |
| **On mode switch** | Full plan text in tool result | Immediate orientation |

### Attachment Injection

```ts
// In attachments.ts — runs before each model turn
function getPlanModeAttachments(state: AppState): Attachment[] {
  if (!state.planMode.active) return []
  
  state.planMode.turnsSincePlanReminder++

  if (state.planMode.turnsSincePlanReminder % 5 === 0) {
    // Full plan text — refreshes model's memory
    return [{ type: 'plan_full', content: state.planMode.planText }]
  }
  
  // Sparse reminder — just the path and "stay on track"
  return [{ type: 'plan_sparse', path: state.planMode.planFilePath }]
}
```

This preserves the prompt cache because the system prompt itself never changes — only the user-turn attachments vary.

---

## 3. ExitPlanModeV2Tool — Inline Approval UI

**Source:** `ExitPlanModeV2Tool.tsx`

When the AI decides the plan is ready, it calls `ExitPlanModeV2Tool` which:

1. **Writes the plan to disk** at the specified path
2. **Renders an inline UI** with the plan dif and approve/reject buttons
3. **Blocks the model** until the user approves, rejects, or edits
4. On approval: switches to build mode with the plan text embedded in the tool result

### Plan-in-Context Strategy

The critical design: when the user approves and the model enters build mode, the **full plan text** is included in the tool result's response:

```ts
// ExitPlanModeV2Tool.tsx
return {
  type: 'success',
  result: `Plan approved and saved to ${filePath}.\n\n<plan>\n${planText}\n</plan>\n\nYou are now in build mode. Execute the plan above step by step.`
}
```

This means the model enters build mode with **immediate, in-context access** to the plan — no need to read it from disk.

---

## 4. Explore + Plan Sub-Agents

liteai_cli_mvp supports spawning dedicated sub-agents for the explore and plan phases:

- **Explore agent:** Read-only, strips CLAUDE.md + gitStatus to save tokens. Uses search tools to understand the codebase.
- **Plan agent:** Also read-only, writes a plan file and returns it. Separate plan file paths per sub-agent.

Both have:
- `omitClaudeMd: true` — saves ~5-15 Gtok/week
- Independent sidechain transcripts
- Ability to write separate plan files

---

## 5. EnterPlanModeTool

Switches from build → plan mode. This is the reverse path, used when:
- The user explicitly asks to re-plan
- The AI realizes the current approach needs revisiting
- A sub-agent finishes explore and needs to formalize findings

---

## Comparison: liteai vs liteai_cli_mvp (Plan Mode)

| Dimension | liteai | liteai_cli_mvp |
|---|---|---|
| Plan storage | Artifact file, no in-context | Deduplicated: file + attachment cycle |
| Reminder system | None — plan drifts out of context | Sparse/full reminder every turn/5 turns |
| Approval flow | `Question.ask()` — simple Y/N | Inline JSX UI with diff view |
| Context entry to build | Model must re-read plan file | Plan-in-context in tool result |
| Cache impact | N/A | Zero — attachments don't hit system prompt cache |
| Sub-agents | N/A | Dedicated Explore + Plan agents |
