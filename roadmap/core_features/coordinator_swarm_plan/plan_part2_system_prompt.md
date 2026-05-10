# Part 2: Coordinator System Prompt

> **Parent:** [Implementation Plan](file:///C:/Users/ahmed/.gemini/antigravity/brain/47fd34a1-ae4d-4a83-b0d9-2f86648113e9/implementation_plan.md)  
> **Reference:** [coordinatorMode.ts:111-369](file:///D:/claude-code/src/coordinator/coordinatorMode.ts)

---

## Overview

The coordinator system prompt is a self-contained ~350-line string that completely replaces the normal agent system prompt when coordinator mode is active. It defines the coordinator's role, available tools, worker lifecycle, prompt engineering guidelines, and example sessions.

#### [NEW] [coordinator-prompt.ts](file:///d:/liteai/packages/core/src/coordinator/coordinator-prompt.ts)

---

## Implementation

```typescript
/**
 * Returns the coordinator system prompt.
 * 
 * This prompt completely replaces the agent's normal system prompt when
 * coordinator mode is active. It defines the coordinator's role as a pure
 * orchestrator that delegates all real work to workers.
 * 
 * The prompt is parameterized with:
 * - `workerCapabilities`: Description of what tools workers have access to.
 *   Varies based on session configuration (simple vs full mode).
 * 
 * Reference: coordinatorMode.ts:111-369 — `getCoordinatorSystemPrompt()`
 * 
 * @param options.workerCapabilities - Text describing worker tool access.
 *   Defaults to full capabilities description.
 */
export function getCoordinatorSystemPrompt(options?: {
  workerCapabilities?: string
}): string {
  const workerCapabilities = options?.workerCapabilities
    ?? "Workers have access to standard tools, MCP tools from configured MCP servers, and project skills via the Skill tool. Delegate skill invocations to workers."

  return `You are an AI assistant that orchestrates software engineering tasks across multiple workers.

## 1. Your Role
...`
// (full prompt content below)
}
```

## Prompt Structure

The prompt follows the reference's structure with these sections:

### Section 1: Role Definition
- Coordinator delegates, doesn't execute
- Every message is to the user
- Worker results are internal signals, not conversation partners
- Summarize new information as it arrives
- Answer questions directly when possible — don't delegate trivially

### Section 2: Tool Documentation
Three tools available to the coordinator:

| Tool | Purpose | Notes |
|------|---------|-------|
| `task` | Spawn a new worker | Maps to LiteAI's existing `TaskTool` |
| `send_message` | Continue an existing worker | Maps to LiteAI's existing `SendMessageTool` |
| `yield_turn` | End the coordinator's turn | Maps to LiteAI's existing `YieldTurnTool` |

> [!IMPORTANT]
> The reference uses `task_stop` and `team_create`/`team_delete`. Per Q1/Q2 in the main plan, these tools don't exist yet. The prompt will reference `task_stop` as a future capability but won't include it in the "Your Tools" section until the tool is implemented.

**Task notification format:** Workers report results as `<task-notification>` XML blocks injected as user messages. The prompt documents this format:

```xml
<task-notification>
<task-id>{agentId}</task-id>
<status>completed|failed|killed</status>
<summary>{human-readable status summary}</summary>
<result>{agent's final text response}</result>
<usage>
  <total_tokens>N</total_tokens>
  <tool_uses>N</tool_uses>
  <duration_ms>N</duration_ms>
</usage>
</task-notification>
```

### Section 3: Worker Capabilities
Injected via parameter. Describes what tools workers have access to (read, write, edit, bash, search, etc.).

### Section 4: Task Workflow
Four phases:

| Phase | Who | Purpose |
|-------|-----|---------|
| Research | Workers (parallel) | Investigate codebase, find files, understand problem |
| Synthesis | **Coordinator** | Read findings, understand the problem, craft implementation specs |
| Implementation | Workers | Make targeted changes per spec, commit |
| Verification | Workers | Test changes work |

**Concurrency rules:**
- Read-only tasks → parallel freely
- Write-heavy tasks → one at a time per file set
- Verification can run alongside implementation on different file areas

**Failure handling:**
- Continue same worker with `send_message` — it has the error context
- If correction fails, try different approach or report to user

### Section 5: Worker Prompt Engineering
This is the most critical section — it teaches the coordinator how to write effective worker prompts.

**Key principles:**
1. Workers can't see the conversation — every prompt must be self-contained
2. Always synthesize research findings before delegating implementation
3. Never write "based on your findings" — synthesize yourself
4. Include file paths, line numbers, error messages
5. State what "done" looks like

**Continue vs spawn decision matrix:**

| Situation | Mechanism | Why |
|-----------|-----------|-----|
| Research explored exactly the files that need editing | Continue via `send_message` | Worker has the files in context |
| Research was broad but implementation is narrow | Spawn fresh via `task` | Avoid dragging exploration noise |
| Correcting a failure | Continue | Worker has error context |
| Verifying code a different worker wrote | Spawn fresh | Fresh eyes, no implementation assumptions |
| Wrong approach entirely | Spawn fresh | Clean slate avoids anchoring |

### Section 6: Example Session
A complete worked example showing:
1. User asks to fix a bug
2. Coordinator spawns parallel research workers
3. Worker reports findings via `<task-notification>`
4. Coordinator synthesizes and continues the worker with an implementation spec
5. Coordinator responds to user check-in while waiting

---

## Adaptation Notes

| Reference Pattern | LiteAI Adaptation |
|---|---|
| `AgentTool` | `task` (same tool, different name in prompt) |
| `SendMessageTool` | `send_message` (already exists) |
| `TaskStopTool` | Deferred — not yet implemented |
| `SyntheticOutputTool` | Not needed — coordinator uses natural text output |
| `subscribe_pr_activity` | Not included — LiteAI doesn't have GitHub PR integration |
| `CLAUDE_CODE_SIMPLE` mode | Not included — LiteAI doesn't have a "simple" mode toggle |
| Feature gate `feature('COORDINATOR_MODE')` | Replaced by `Flag.LITEAI_COORDINATOR_MODE` |

---

## Token Estimation

The coordinator prompt will be approximately:
- **~350 lines** of text
- **~4,500 tokens** (estimated)
- This is comparable to the reference's 370 lines

The prompt is returned as a single string. It does NOT go through `SectionRegistry` — it replaces the entire system prompt when coordinator mode is active (see AD-3 in the main plan).
