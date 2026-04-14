# Remaining Backend Features — liteai_cli_mvp

> Systems not covered in docs 01–06 that warrant porting consideration.

---

## 1. Context Compaction & AutoCompact

> Source: `src/services/compact/` (~160KB total)

### What It Does

When the conversation approaches the context window limit, liteai_cli_mvp automatically compacts the conversation history by summarizing older messages into a dense representation. This prevents the model from hitting context limits mid-task.

### Architecture

```
shouldAutoCompact()           ← Token count vs threshold check
  → trySessionMemoryCompaction()  ← Experimental: prune by session memory
  → compactConversation()        ← Fork a sub-agent to generate summary
    → Replace messages with compact summary
    → runPostCompactCleanup()    ← Reset caches, notify systems
```

### Key Mechanisms

| Component | Purpose |
|---|---|
| `autoCompact.ts` | Gate chain: token threshold → circuit breaker → fork compaction |
| `compact.ts` (60KB!) | Full compaction engine — message replacement, recompaction, analytics |
| `microCompact.ts` | Lightweight per-turn compaction (clear old tool results) |
| `sessionMemoryCompact.ts` | Experimental: prune using session memory graphs |
| `postCompactCleanup.ts` | Reset caches and context state after compaction |

### Configuration

```ts
const AUTOCOMPACT_BUFFER_TOKENS = 13_000    // Trigger threshold below context limit
const WARNING_THRESHOLD_BUFFER_TOKENS = 20_000
const MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3  // Circuit breaker
```

### Circuit Breaker

After 3 consecutive compaction failures, auto-compact stops attempting for the session. This prevents ~250K wasted API calls/day fleet-wide from irrecoverably over-limit sessions.

---

## 2. Context Collapse (Experimental)

> Source: `src/services/contextCollapse/`

A more granular context management system that replaces auto-compact in experimental builds. Instead of summarizing the entire conversation, it "collapses" individual sections:
- Commits context snapshots at 90% capacity
- Triggers blocking spawn at 95% capacity
- Owns the headroom problem entirely when active (auto-compact is suppressed)
- Has its own `CtxInspectTool` for debugging

---

## 3. Speculative Execution

> Source: `src/services/PromptSuggestion/speculation.ts` (31KB)

### What It Does

After the model generates a response, liteai_cli_mvp predicts what the user will likely say next (prompt suggestion) and **starts executing it speculatively** before the user types anything. If the user accepts the suggestion, the speculated work is injected into the conversation.

### Architecture

```
Model turn complete
  → generateSuggestion()         ← Predict next user prompt
  → startSpeculation()           ← Fork execution of predicted prompt
    → runForkedAgent({
        canUseTool: speculationGuard  ← Overlay-based file isolation
      })
    → onMessage: track progress
  → User accepts → acceptSpeculation()
    → copyOverlayToMain()        ← Commit speculated file changes
    → prepareMessagesForInjection()  ← Strip thinking, strip failed tools
    → Inject into conversation
```

### Overlay Isolation (Copy-on-Write)

Speculative file edits use a **filesystem overlay**:

```ts
// Writes go to overlay directory, reads check overlay first then fall through
if (isWriteTool) {
  // Copy original to overlay on first write
  if (!writtenPaths.has(rel)) {
    await copyFile(join(cwd, rel), join(overlayPath, rel))
    writtenPaths.add(rel)
  }
  input = { ...input, [pathKey]: join(overlayPath, rel) }
} else if (writtenPaths.has(rel)) {
  // Reads redirect to overlay if file was previously written
  input = { ...input, [pathKey]: join(overlayPath, rel) }
}
```

### Safety Boundaries

Speculation stops at:
- File edits when permission mode requires approval (not `acceptEdits`/`bypassPermissions`)
- Non-read-only bash commands
- Unknown tools (WebFetch, etc.)

### Pipelining

When speculation completes, it immediately generates the **next** prompt suggestion using the speculated conversation state — cascading predictions.

---

## 4. Hooks System (Lifecycle Hooks)

> Source: `src/utils/hooks.ts` (159KB — the largest file in the codebase!)

### What It Does

A comprehensive lifecycle hooks system that lets users/plugins/policies run shell commands, HTTP requests, or agent invocations at 20+ event points during the agent lifecycle.

### Event Points

| Event | When | Can Block? |
|---|---|---|
| `SessionStart` | New session begins | ✓ |
| `SessionEnd` | Session terminates | ✗ |
| `Setup` | Any session init | ✓ |
| `PreToolUse` | Before any tool call | ✓ (modify input, deny) |
| `PostToolUse` | After tool returns | ✓ (inject context) |
| `PostToolUseFailure` | Tool call failed | ✗ |
| `PermissionDenied` | Permission rejected by user | ✗ (can retry) |
| `PermissionRequest` | Before permission dialog | ✓ (auto-allow/deny) |
| `UserPromptSubmit` | User sends a prompt | ✓ (inject context) |
| `SubagentStart` | Sub-agent spawned | ✓ |
| `SubagentStop` | Sub-agent finished | ✗ |
| `TaskCreated` / `TaskCompleted` | Background task lifecycle | ✗ |
| `ConfigChange` | Settings modified | ✗ |
| `CwdChanged` | Working directory changed | ✗ |
| `FileChanged` | File modification detected | ✗ |
| `Elicitation` / `ElicitationResult` | MCP elicitation flow | ✓ |
| `Stop` / `StopFailure` | Turn completion | ✓ (async rewake) |

### Hook Types

```ts
type HookCommand = {
  type: 'command'
  command: string         // Shell command to execute
  shell?: 'bash' | 'powershell'
  timeout?: number
}

type HookCallback = {
  type: 'prompt'         // Invoke an agent with a prompt
  prompt: string
}

// HTTP hooks (for remote webhook integrations)
type HttpHook = {
  type: 'http'
  url: string
  method?: string
}
```

### Hook Output Protocol

Hooks communicate back via structured JSON:

```json
{
  "continue": false,           // Stop the session
  "stopReason": "Policy violation",
  "decision": "block",         // Block the tool use
  "reason": "File outside scope",
  "permissionDecision": "allow", // Auto-approve permission
  "systemMessage": "Context injected by hook",
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "updatedInput": { "file_path": "/safe/path" },
    "additionalContext": "Reminder from CI"
  }
}
```

### Async Hooks

Hooks can run asynchronously in the background. `asyncRewake` hooks notify the model on completion via `enqueuePendingNotification()`.

### Security: Workspace Trust

ALL hooks require workspace trust acceptance. Historical vulnerabilities (SessionEnd executing on trust decline, SubagentStop firing before trust) are mitigated.

---

## 5. Git Worktree Isolation

> Source: `src/utils/worktree.ts` (50KB)

### What It Does

Agents can create isolated git worktrees for parallel work. Each worktree gets its own branch, directory, and can optionally run in a tmux session.

### Architecture

```
EnterWorktreeTool → createWorktreeForSession()
  → validateWorktreeSlug()        ← Security: prevent path traversal
  → getOrCreateWorktree()         ← Fast resume if exists, git worktree add if not
    → fs readWorktreeHeadSha()    ← Bypass subprocess for resume detection
    → git fetch origin <branch>   ← Only for new worktrees
    → git worktree add -B <branch> <path> <base>
  → performPostCreationSetup()
    → Copy settings.local.json (secrets)
    → Configure git hooks path
    → symlinkDirectories()        ← Prevent disk bloat (node_modules)
    → copyWorktreeIncludeFiles()  ← Copy gitignored files via .worktreeinclude
    → Install attribution hooks
  → process.chdir(worktreePath)   ← Agent now works in isolated tree
```

### Key Features

- **Sparse checkout**: Configurable via `settings.worktree.sparsePaths`
- **Hook-based**: Users can override worktree creation with `WorktreeCreate`/`WorktreeRemove` hooks for non-git VCS
- **PR-based**: Can create worktree from a PR number (`#123` or GitHub URL)
- **Resume**: Fast resume via direct SHA read (no subprocess)
- **tmux integration**: Each worktree can have its own tmux session
- **Cleanup**: `ExitWorktreeTool` → `cleanupWorktree()` or `keepWorktree()`

---

## 6. Coordinator Mode (Agent Swarms)

> Source: `src/coordinator/coordinatorMode.ts`

### What It Does

Transforms the agent from a single-threaded executor into a **coordinator** that delegates work to parallel worker agents:

```
User → Coordinator (you)
         ├── AgentTool(worker) → Research task A
         ├── AgentTool(worker) → Research task B
         └── SendMessage(agent-id) → Continue worker with new instructions
```

### Key Design

- Coordinator only has: `AgentTool`, `SendMessage`, `TaskStop`, `SubscribePR`
- Workers get the full tool set (Bash, Read, Edit, etc.)
- Results arrive as `<task-notification>` XML in user messages
- Coordinator must **synthesize** findings — never "lazy delegate"
- Scratchpad directory for cross-worker knowledge sharing

### Concurrency Rules

| Task Type | Parallelism |
|---|---|
| Read-only research | Unlimited parallel |
| Write-heavy implementation | One at a time per file set |
| Verification | Can run alongside implementation on different files |

---

## 7. Conversation Recovery & Session Resume

> Source: `src/utils/conversationRecovery.ts` (21KB)

### What It Does

Robustly restores a conversation from transcript files on `--continue` or `--resume`, handling:

- **Mid-turn interruption detection** (tool use in progress vs. user prompt submitted)
- **Legacy attachment migration** (`new_file` → `file`, backfill `displayPath`)
- **Unresolved tool use filtering** (strip tool_use blocks without matching results)
- **Orphaned thinking removal** (thinking blocks left by streaming fragmentation)
- **Skill state restoration** (from `invoked_skills` attachments)
- **Cross-directory resume** (via `.jsonl` path)
- **Worktree session restoration** (metadata in log)
- **Content replacement reconstruction** (for tool result budget stability)

### Interruption States

```ts
type TurnInterruptionState =
  | { kind: 'none' }
  | { kind: 'interrupted_prompt'; message: NormalizedUserMessage }
  // Internal only — transformed before return:
  | { kind: 'interrupted_turn' }  → appends "Continue from where you left off"
```

---

## 8. Tool Result Persistence & Budget

> Source: `src/utils/toolResultStorage.ts` (38KB)

### What It Does

Manages tool result sizes to prevent context window bloat:

1. **Per-tool persistence**: Results exceeding tool-specific thresholds are saved to disk and replaced with a preview + file path reference
2. **Per-message budget**: Aggregate tool result size per API message is capped; largest fresh results are persisted first
3. **State stability**: Replacement decisions are frozen once made — re-applied identically each turn for prompt cache stability

### Key Mechanisms

```ts
// Per-tool: large results saved to disk
async function maybePersistLargeToolResult(block, toolName, threshold)

// Per-message: aggregate budget enforcement
async function enforceToolResultBudget(messages, state, skipToolNames)
  → partitionByPriorDecision()  // mustReapply | frozen | fresh
  → selectFreshToReplace()       // Largest first until under budget
  → replaceToolResultContents()  // Swap in previews

// Empty tool results get a marker to prevent model confusion
if (isToolResultContentEmpty(content)) {
  return `(${toolName} completed with no output)`
}
```

### ContentReplacementState

```ts
type ContentReplacementState = {
  seenIds: Set<string>              // Results that have passed through budget check
  replacements: Map<string, string> // Persisted results → exact preview string
}
// Cloned for cache-sharing forks; reconstructed on resume from transcript records
```

---

## 9. Cost Tracking & Model Usage

> Source: `src/cost-tracker.ts` (11KB)

### What It Does

Tracks cumulative session costs across API calls, including:
- Per-model usage breakdown (input, output, cache read, cache write tokens)
- USD cost calculation with model-specific pricing
- Session persistence via project config (survives resume)
- OTel counter integration for observability
- Advisor usage tracking (nested model calls)

---

## 10. Effort System (Thinking Budget)

> Source: `src/utils/effort.ts` (12KB)

### What It Does

Controls how much "thinking" the model does, with 4 levels: `low`, `medium`, `high`, `max`.

### Precedence Chain

```
env CLAUDE_CODE_EFFORT_LEVEL → appState.effortValue → model default
```

### Model-Specific Defaults

- **Opus 4.6**: `medium` for Pro/Max/Team subscribers
- **With ultrathink**: `medium` (ultrathink bumps to high when needed)
- **Other models**: `undefined` (API defaults to `high`)

### `max` Effort

Only supported on Opus 4.6. Automatically downgrades to `high` on other models.

---

## 11. Prompt Suggestions

> Source: `src/services/PromptSuggestion/promptSuggestion.ts` (17KB)

After each model turn, a forked agent generates predicted next prompts:
- Uses parent's CacheSafeParams for cache sharing
- Multiple prompt variants via feature flags
- Suppressed during compaction, background tasks, etc.
- Can feed into speculation (§3) for pre-execution

---

## 12. Session Memory Service

> Source: `src/services/SessionMemory/` (35KB)

Runs as a post-turn forked agent to extract and persist noteworthy facts from the current conversation. Distinct from the Dream engine (which consolidates across sessions) — this is within-session extraction.

### Compaction Integration

When auto-compact fires, session memory is tried first (`trySessionMemoryCompaction`) as a lighter alternative to full conversation summarization.

---

## 13. Agent Summary (Post-Turn Summary)

> Source: `src/services/AgentSummary/agentSummary.ts` (6KB)

After sub-agent completion, generates a dense summary of what the agent accomplished. This summary is what the parent sees in the `<task_result>` block — keeping the parent's context lean.

---

## 14. Cron Scheduler & Background Tasks

> Source: `src/utils/cronScheduler.ts` (21KB), `cronTasks.ts` (17KB)

When `AGENT_TRIGGERS` feature is enabled:
- Persistent cron task storage
- `CronCreateTool` / `CronDeleteTool` / `CronListTool`
- Jitter configuration to prevent thundering herd
- Lock-based execution to prevent concurrent runs

---

## 15. Commit Attribution

> Source: `src/utils/commitAttribution.ts` (30KB)

Tracks which files and lines were generated/modified by the AI agent:
- Installs `prepare-commit-msg` git hook
- Tags commits with attribution metadata
- Provides `Co-Authored-By` trailers
- Works across worktrees

---

## Summary: Priority Guide for Porting

| Feature | Complexity | Value | Priority |
|---|---|---|---|
| **Context Compaction** | High | Critical — prevents session death | P0 (Phase 1-2) |
| **Tool Result Persistence** | Medium | High — prevents context bloat | P0 (Phase 2) |
| **Hooks System** | Very High | High — extensibility cornerstone | P1 (Phase 3) |
| **Conversation Recovery** | High | High — reliability essential | P1 (Phase 3) |
| **Coordinator Mode** | High | High — parallel work | P2 (Phase 3-4) |
| **Worktree Isolation** | High | Medium-High — safe parallel edits | P2 (Phase 4) |
| **Cost Tracking** | Low | Medium — operational visibility | P1 (Phase 2) |
| **Effort System** | Low | Medium — quality tuning | P1 (Phase 2) |
| **Agent Summary** | Medium | Medium — context efficiency | P2 (Phase 5) |
| **Session Memory** | Medium | Medium — within-session learning | P2 (Phase 7) |
| **Speculation** | Very High | Medium — latency optimization | P3 (Phase 8+) |
| **Prompt Suggestions** | Medium | Low-Medium — UX polish | P3 (Phase 8+) |
| **Context Collapse** | Very High | Medium — experimental | P3 (Phase 8+) |
| **Cron Scheduler** | Medium | Low-Medium — KAIROS dependency | P3 (Phase 8) |
| **Commit Attribution** | Medium | Low — compliance/audit | P3 (optional) |
