# Plan Mode — liteai_cli_mvp

This documents the plan mode implementation in the `liteai_cli_mvp` codebase (`src/`). It is a significantly more developed version of plan mode than liteai's, featuring full/sparse reminder cycles, multi-agent sub-agent workflows, A/B experimentation on plan file structure, and an inline user-approval UI flow.

liteai_cli_mvp source location: `C:\Users\aghassan\Documents\workspace\liteai_cli_mvp\src`
---

## Overview

Plan mode is a permission mode (`mode: 'plan'` in `toolPermissionContext`) where the model is restricted to read-only tool access, with the sole exception of writing/editing the session's plan file. The session stays in plan mode until the model calls `ExitPlanModeV2Tool` and the user approves.

---

## Plan File

**Source:** [`src/utils/plans.ts`](../../liteai_cli_mvp/src/utils/plans.ts)

### Path Resolution

```ts
export function getPlanFilePath(agentId?: AgentId): string {
  const planSlug = getPlanSlug(getSessionId())
  if (!agentId) return join(getPlansDirectory(), `${planSlug}.md`)
  return join(getPlansDirectory(), `${planSlug}-agent-${agentId}.md`)
}
```

- **Main session**: `<plansDir>/<wordSlug>.md`
- **Sub-agents**: `<plansDir>/<wordSlug>-agent-<agentId>.md` — each sub-agent gets its own plan file

The `wordSlug` is a human-readable random slug (e.g. `bright-river`) generated lazily on first access via `generateWordSlug()` and cached per session.

### Plans Directory

Default: `~/.claude/plans/` (or the `CLAUDE_CONFIG_HOME`-relative `plans/` dir).  
Configurable via `settings.plansDirectory` (relative path within project root, validated against path traversal).

### Plan Reading

`getPlan(agentId?)` reads the plan file synchronously at call time. It returns `null` if the file doesn't exist (ENOENT). This is called:
- In `getPlanModeAttachments()` to detect `planExists`
- In `ExitPlanModeV2Tool.call()` to read the plan for the approval dialog

### Plan Recovery (Remote Sessions)

In CCR (remote/cloud) sessions, plan files don't persist between sessions. On resume, `copyPlanForResume()` recovers the plan from, in order:
1. A `file_snapshot` system message (written incrementally during the session)
2. The `plan` field in an `ExitPlanModeV2` tool_use block in message history
3. A `planContent` field on user messages
4. A `plan_file_reference` attachment written by compaction

---

## Prompt Injection — Attachment System

Unlike liteai, which uses persisted DB parts injected by `plan-reminder.ts`, liteai_cli_mvp uses an **attachment system**: `getAttachments()` is called each turn and returns typed `Attachment` objects, which are then converted to `UserMessage[]` by `normalizeAttachmentForAPI()` in [`src/utils/messages.ts`](../../liteai_cli_mvp/src/utils/messages.ts#L3136).

**Source:** [`src/utils/attachments.ts`](../../liteai_cli_mvp/src/utils/attachments.ts)

Attachments are **not persisted** in the same way as conversation messages — they are regenerated each turn.

### Attachment Types

| Type | When | Content |
|---|---|---|
| `plan_mode` | Every N human turns while `mode === 'plan'` | Full or sparse plan mode instructions |
| `plan_mode_reentry` | First turn when re-entering plan mode with an existing plan | Re-entry guidance |
| `plan_mode_exit` | Immediately after exiting plan mode | Confirmation that edits are now permitted |
| `plan_file_reference` | After compaction, if a plan exists | Plan file path + full content |

---

## Full/Sparse Reminder Cycle

**Source:** [`src/utils/attachments.ts#L1186`](../../liteai_cli_mvp/src/utils/attachments.ts#L1186)

This is the key design difference from liteai. Plan mode instructions cycle between two forms:

```ts
export const PLAN_MODE_ATTACHMENT_CONFIG = {
  TURNS_BETWEEN_ATTACHMENTS: 5,       // how often to re-inject at all
  FULL_REMINDER_EVERY_N_ATTACHMENTS: 5, // how often to use full vs sparse
} as const
```

**Algorithm:**
1. Count user (non-meta, non-tool-result) turns since the last `plan_mode` attachment
2. If `turnCount < 5` and a prior attachment exists → skip injection entirely
3. Otherwise, count total `plan_mode` attachments since the last `plan_mode_exit`
4. If `count % 5 === 1` (1st, 6th, 11th...) → inject **full** instructions
5. Otherwise → inject **sparse** one-liner

**Full reminder** (every 5th occasion): the entire 5-phase workflow (~70 lines), rendered by `getPlanModeV2Instructions()` in `messages.ts`.

**Sparse reminder** (all others): one sentence:
> *"Plan mode still active (see full instructions earlier in conversation). Read-only except plan file (`<path>`). Follow 5-phase workflow. End turns with AskUserQuestion (for clarifications) or ExitPlanModeV2 (for plan approval)."*

The cycle resets when the user exits and re-enters plan mode (counts start from 0 after a `plan_mode_exit` attachment).

---

## Plan Mode Instructions Content

**Source:** [`src/utils/messages.ts#L3136`](../../liteai_cli_mvp/src/utils/messages.ts#L3136)

All plan mode instruction messages are wrapped in `<system-reminder>` tags via `wrapMessagesInSystemReminder()`.

### Standard 5-Phase Workflow (`getPlanModeV2Instructions`)

Used unless the interview phase feature flag is enabled. The workflow:

1. **Phase 1 — Initial Understanding**: Launch up to N parallel `explore` sub-agents to map the codebase
2. **Phase 2 — Design**: Launch plan sub-agent(s) to design an implementation approach
3. **Phase 3 — Review**: Read critical files; clarify with the user via `AskUserQuestion`
4. **Phase 4 — Final Plan**: Write the plan to the plan file (only permitted edit)
5. **Phase 5 — Exit**: Call `ExitPlanModeV2` — the **only** acceptable way to signal plan readiness

The model is explicitly told:
> *"Do NOT ask about plan approval in any other way — no text questions, no AskUserQuestion. Phrases like 'Is this plan okay?', 'Should I proceed?', 'How does this plan look?' MUST use ExitPlanModeV2."*

### Interview-Phase Workflow (`getPlanModeInterviewInstructions`)

**Gate:** `isPlanModeInterviewPhaseEnabled()` — always on for internal (`USER_TYPE === 'ant'`), otherwise controlled by the `tengu_plan_mode_interview_phase` feature flag.

A different, more iterative approach:
- No forced agent dispatching
- Model reads code, writes to plan file incrementally, asks questions as they arise
- The plan file acts as a live working document from the first turn
- "Start by scanning a few key files... write a skeleton plan and ask the user your first questions. Don't explore exhaustively before engaging."

### Sub-Agent Plan Mode (`getPlanModeV2SubAgentInstructions`)

When plan mode is active inside a sub-agent (`isSubAgent: true`):
- No 5-phase workflow
- Just the core constraint: read-only except the plan file
- Use `AskUserQuestion` to clarify

---

## Plan File Structure Experiments

**Source:** [`src/utils/planModeV2.ts`](../../liteai_cli_mvp/src/utils/planModeV2.ts)

Phase 4 of the 5-phase workflow is an active A/B test (`tengu_pewter_ledger`). Four arms control how prescriptive the guidance is:

| Arm | Key Difference |
|---|---|
| `null` (control) | Full guidance: Context section, alternatives rejected, file paths, verification section |
| `'trim'` | One-line context, single verification command (no numbered procedure) |
| `'cut'` | No context section at all; file paths + one-line changes per file; hard "most plans under 40 lines" hint |
| `'cap'` | **Hard limit: 40 lines.** No context, no prose paragraphs. "If the plan is longer, delete prose — not file paths." |

**Motivation from code comment:**
> *"Baseline (control, 14d ending 2026-03-02): p50 4,906 chars | p90 11,617 | mean 6,207. Reject rate monotonic with size: 20% at <2K → 50% at 20K+"*

The primary metric is session cost (Opus output tokens are 5× input price), with the guardrail being feedback-bad rate.

---

## Parallel Sub-Agent Count

**Source:** [`src/utils/planModeV2.ts#L5`](../../liteai_cli_mvp/src/utils/planModeV2.ts#L5)

The number of explore/plan sub-agents the model is instructed to launch is dynamic:

```ts
// Plan agents (design phase)
function getPlanModeV2AgentCount(): number {
  if (subscriptionType === 'max' && rateLimitTier === 'default_claude_max_20x') return 3
  if (subscriptionType === 'enterprise' || subscriptionType === 'team') return 3
  return 1   // pro/free: single agent
}

// Explore agents (research phase)
function getPlanModeV2ExploreAgentCount(): number {
  return 3   // default (env var override available)
}
```

---

## Tool: `ExitPlanModeV2Tool`

**Source:** [`src/tools/ExitPlanModeTool/ExitPlanModeV2Tool.ts`](../../liteai_cli_mvp/src/tools/ExitPlanModeTool/ExitPlanModeV2Tool.ts)  
**Prompt:** [`src/tools/ExitPlanModeTool/prompt.ts`](../../liteai_cli_mvp/src/tools/ExitPlanModeTool/prompt.ts)

### Input schema

```ts
{
  allowedPrompts?: Array<{
    tool: 'Bash'
    prompt: string  // semantic description, e.g. "run tests", "install dependencies"
  }>
}
```

`allowedPrompts` lets the plan pre-declare what categories of bash commands implementation will need. These become semantic permissions in the build phase.

### UI flow (non-teammate, non-agent)

1. `checkPermissions()` returns `behavior: 'ask'` → UI shows approval dialog
2. User sees the plan and can optionally **edit** it inline (CCR web UI)
3. On approve: `call()` runs:
   - Reads plan from disk (or from `input.plan` if the user edited it)
   - If user edited: writes modified plan back to disk (`writeFile`)
   - Sets `mode` back to `prePlanMode` (restores default/auto state before plan was entered)
   - Sets `needsPlanModeExitAttachment = true` flag
4. The `tool_result` returned to the model contains:
   ```
   User has approved your plan. You can now start coding...

   ## Approved Plan:
   <full plan content>
   ```

**This directly answers liteai Q3**: the plan content is embedded in the tool result, not just a path. The model enters build mode already holding the full approved text.

### Tool result label

If the user edited the plan in the UI:
```
## Approved Plan (edited by user):
```
This tells the model that the content may differ from what it wrote.

### Swarm / teammate flow

When plan mode is **required** for a sub-agent (`isPlanModeRequired()` is true):
- Tool bypasses the approval UI
- Writes a `plan_approval_request` to the team lead's mailbox
- Returns `awaitingLeaderApproval: true`
- The model is told to wait for inbox response before proceeding

---

## Tools Available in Plan Mode

| Tool | Available | Notes |
|---|---|---|
| `ExitPlanModeV2` | ✅ | Primary plan completion signal |
| `AskUserQuestion` | ✅ | Clarifications and tradeoff questions |
| `Read` / `Glob` / `Grep` / `Bash (read-only)` | ✅ | Exploration only |
| `Write` / `Edit` | ⚠️ Plan file only | Permission system enforces `.md` plan path |
| `Agent (explore/plan types)` | ✅ | Used for parallel codebase exploration |
| Any mutating bash commands | ❌ | Rejected by permission system |

---

## On Build-Switch: Plan-in-Context Strategy

When `ExitPlanModeV2` is approved:

1. The plan content is embedded in the **tool result** returned to the model:
   `"User has approved your plan... ## Approved Plan:\n<content>"`

2. A `plan_mode_exit` attachment is injected on the next turn:
   `"You have exited plan mode. You can now make edits... The plan file is at <path>."`

3. A `plan_file_reference` attachment is created by auto-compaction to preserve the plan across context boundaries.

The model enters build mode with:
- The full plan text in its immediate context (inside the tool result)
- A confirmation that edits are now permitted
- The plan file path for ongoing reference

**The planning conversation history is retained** (no compaction on switch), but the plan-in-tool-result means the model doesn't need to re-read the file to start work.

---

## Data Flow

```
User enables plan mode (UI button or config)
        │
        ▼
toolPermissionContext.mode = 'plan'
─────────────────────────────────────────────────────────────────
Each turn in plan mode:
        │
        ▼
getAttachments() in attachments.ts
  └── getPlanModeAttachments()
        ├── count human turns since last plan_mode attachment
        ├── if < 5 turns → skip
        └── otherwise:
              ├── check hasExitedPlanModeInSession()
              │     └── if true + plan exists → plan_mode_reentry attachment
              ├── count plan_mode attachments since last exit
              └── attachmentCount % 5 === 1?
                    ├── yes → 'full': entire 5-phase workflow (~70 lines)
                    └── no  → 'sparse': one-sentence reminder
        │
        ▼
normalizeAttachmentForAPI({ type: 'plan_mode', reminderType, ... })
  └── getPlanModeInstructions()
        ├── isSubAgent? → getPlanModeV2SubAgentInstructions()
        ├── reminderType === 'sparse'? → getPlanModeV2SparseInstructions()
        └── otherwise → getPlanModeV2Instructions() (or interview variant)
            All wrapped in <system-reminder> tags as user messages (isMeta: true)
─────────────────────────────────────────────────────────────────
Model calls ExitPlanModeV2Tool
        │
        ├── validateInput: confirm mode === 'plan'
        ├── checkPermissions: behavior 'ask' → UI approval dialog
        ├── User approves (optionally edits plan)
        └── call():
              ├── read plan from disk (or updated input.plan)
              ├── write back if user edited
              ├── restore mode to prePlanMode
              ├── setNeedsPlanModeExitAttachment(true)
              └── return tool_result:
                    "User has approved your plan...
                    ## Approved Plan:
                    <full plan text>"
        │
        ▼
Next turn: getPlanModeExitAttachment() fires
  └── plan_mode_exit attachment:
        "You have exited plan mode. You can now make edits, run tools..."
```

---

## Key Differences vs liteai

| Dimension | liteai | liteai_cli_mvp |
|---|---|---|
| Reminder cycle | Inject once (persisted DB part) | Full/sparse cycle every 5 human turns |
| Reminder persistence | Persisted to DB — stays in history | Regenerated each turn, not persisted |
| Plan-in-context on switch | Path only (model must read) | Full content in tool result |
| Exit mechanism | `plan_exit` tool → `Question.ask` | `ExitPlanModeV2` → inline UI with editable plan |
| Sub-agent isolation | No sub-agent plan mode | Separate plan files per sub-agent |
| Plan file path | timestamp+slug form | word-slug form, configurable directory |
| Remote session recovery | N/A | File snapshots + history extraction |
| Phase 4 experimentation | None | 4-arm A/B test on plan file length guidance |
| Interview workflow | N/A | Feature-gated iterative explore+ask workflow |
| Plan content post-exit | Not explicitly injected | Embedded in `ExitPlanModeV2` tool result |
| Team/swarm support | None | Leader approval via mailbox |
