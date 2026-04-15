# Fork Subagent & Agent Durability

This document describes the **fork subagent spawning model** and **agent resume** capability — the prompt-cache-optimized spawning path and the durability mechanism that enables background agents to survive interruptions.

> **Related spec:** `specs/003-fork-subagent-durability/spec.md`  
> **Source:** [`src/agent/fork.ts`](../src/agent/fork.ts), [`src/agent/resume.ts`](../src/agent/resume.ts)  
> **Context:** For how fork spawning relates to other agent modes (Normal, Coordinator, Plan), see [Agent Execution Modes](./agent-execution-modes.md).

---

## Overview

Fork spawning is a cost/performance optimization where sub-agents inherit the parent's full conversation context and rendered system prompt, enabling the upstream provider's prompt cache to be shared between parent and child. When a fork child (or any background agent) is interrupted, the resume system reconstructs its execution state from persisted artifacts and continues from where it left off.

```mermaid
flowchart LR
    subgraph Fork Spawning
        Parent["Parent Turn\nassistant + tool_use"] -->|buildForkedMessages| Fork["Fork Child\nplaceholder results + directive"]
        Parent -->|saveCacheSafeParams| Cache["Session Params Cache\n(LRU, 256 entries)"]
    end

    subgraph Resume
        Interrupt["Agent Interrupted"] --> Read["Read JSONL transcript\n+ .meta.json sidecar"]
        Read --> Filter["Filter orphaned messages"]
        Filter --> Reconstruct["Reconstruct optimization state"]
        Reconstruct --> Resume["Resume execution"]
    end
```

---

## Fork Subagent Model

### Feature Gate

**Source:** [`src/agent/fork.ts`](../src/agent/fork.ts) — `isForkSubagentEnabled()`

Fork spawning is controlled by the `LITEAI_FORK_SUBAGENT` feature flag and automatically disabled in certain modes:

| Condition | Fork Status |
|---|---|
| `LITEAI_FORK_SUBAGENT` flag not set | Disabled |
| Coordinator mode *(Phase 5 — not yet implemented)* | Disabled |
| Non-interactive session | Disabled |
| All above pass | **Enabled** |

> [!NOTE]
> The coordinator mode gate (`ForkGateContext.isCoordinator`) is a forward declaration for the **Phase 5: Coordinator Mode + Agent Swarms** feature. At runtime it is always `undefined`. See [`roadmap/agents-archi-roadmap.md`](../../../../roadmap/agents-archi-roadmap.md) for the planned implementation.

When disabled, the system falls back to standard sub-agent spawning silently (no user-visible error).

When fork spawning is enabled, **all** agent spawns are forced into async mode (fire-and-forget with task notification), ensuring a unified interaction model.

### Fork Agent Configuration

```typescript
const ForkAgentConfig = {
  agentType: "fork",
  tools: "*",          // Parent's exact tool pool for cache compatibility
  maxTurns: 200,
  model: "inherit",    // Parent's model for context length parity
  permissionMode: "bubble",  // Overridden by elevated parent modes
  wallClockTimeout: 1_800_000,  // 30 minutes
  background: true,
  source: "builtIn",
}
```

**Permission override:** If the parent session uses an elevated mode (`bypassPermissions`, `acceptEdits`, `auto`), the fork child inherits that mode instead of `bubble`. This prevents background agents from blocking on permission prompts.

### Cache-Compatible Message Construction

**Source:** [`src/agent/fork.ts`](../src/agent/fork.ts) — `buildForkedMessages()`

For prompt cache sharing, all fork children must produce **byte-identical API request prefixes**. The function constructs:

```
[
  assistant_message(all tool_use blocks + thinking + text from parent),
  user_message(placeholder tool_results + per-child directive)
]
```

Only the final text block (the directive) differs between siblings:

```
┌─────────────────────────────────────────────────────────┐
│  System prompt (parent's byte-exact)                    │  ═══╗
│  Parent conversation history                            │     ║ cache-
│  Assistant message (all tool_use blocks)                │     ║ compatible
│  User message:                                          │     ║ prefix
│    tool_result[0]: "Fork started — processing..."       │     ║
│    tool_result[1]: "Fork started — processing..."       │     ║
│    ...                                                  │  ═══╝
│    text: <fork-boilerplate>RULES...</fork-boilerplate>  │  ← shared
│          Your directive: <per-child task>                │  ← differs
└─────────────────────────────────────────────────────────┘
```

### Fork Behavioral Contract

Every fork child receives a strict behavioral contract (via `buildChildMessage()`):

1. Execute directly — do **NOT** spawn sub-agents
2. Do NOT converse, ask questions, or suggest next steps
3. Do NOT editorialize or add meta-commentary
4. Use tools directly and silently
5. Commit changes before reporting (include commit hash)
6. Do NOT emit text between tool calls
7. Stay strictly within the directive's scope
8. Keep report under **500 words**
9. Response MUST begin with `"Scope:"`
10. Report structured facts, then stop

**Output format:**

```
Scope: <echo assigned scope>
Result: <answer or key findings>
Key files: <relevant file paths>
Files changed: <list with commit hash>
Issues: <list, if any>
```

### Fork Recursion Guard

**Source:** [`src/agent/fork.ts`](../src/agent/fork.ts) — `isInForkChild()`

Fork children retain the Agent tool in their pool (for cache-compatible tool definitions), but **fork spawning is blocked at call time**. Detection works by scanning user messages for the `<fork-boilerplate>` sentinel tag — its presence means the current agent is already a fork child.

When a recursion attempt is detected, the system falls back to standard sub-agent spawning.

### Worktree Path Translation

**Source:** [`src/agent/fork.ts`](../src/agent/fork.ts) — `buildWorktreeNotice()`

When a fork child operates in an isolated worktree, a path translation notice is injected:

> *You've inherited the conversation context above from a parent agent working in `<parentCwd>`. You are operating in an isolated git worktree at `<worktreePath>` — same repository, same relative file structure, separate working copy. Paths in the inherited context refer to the parent's working directory; translate them to your worktree root. Re-read files before editing...*

---

## Cache-Safe Parameters

**Source:** [`src/agent/fork.ts`](../src/agent/fork.ts)

### What They Are

`CacheSafeParams` are the parameters whose identity between parent and child determines prompt cache sharing:

```typescript
interface CacheSafeParams {
  systemPrompt: string[] | string   // Parent's rendered system prompt (byte-exact)
  toolConfig: Record<string, unknown>  // Tool definitions (parent's exact pool)
  forkContextMessages: Message.WithParts[]  // Parent context messages
}
```

### Session-Scoped LRU Cache

Unlike the MVP (which used a module-level global), LiteAI stores cache-safe params in a **session-scoped LRU cache** to prevent cross-tenant cache pollution:

| Setting | Value |
|---|---|
| Max entries | `256` |
| Eviction | LRU (Map insertion-order) |
| Scope | Per-session (`sessionId` key) |

**Save:** Called after each main agent loop turn via `saveCacheSafeParams(sessionId, params)`.  
**Read:** Used by post-turn system forks (summarization, memory extraction) to share the main loop's prompt cache via `getLastCacheSafeParams(sessionId)`.

---

## Agent Resume from Sidechain Transcripts

**Source:** [`src/agent/resume.ts`](../src/agent/resume.ts)

### Persistence Model

Agent durability relies on two persisted artifacts:

| Artifact | Format | Path | Content |
|---|---|---|---|
| **Sidechain Transcript** | `.jsonl` (append-only) | `<dir>/<sessionId>/subagents/<type>/agent-<id>.jsonl` | All messages, tool interactions |
| **Metadata Sidecar** | `.meta.json` | `<dir>/<sessionId>/subagents/<type>/agent-<id>.meta.json` | Identity, worktree path, rendered system prompt |

The metadata sidecar (`AgentMeta`) contains:

```typescript
interface AgentMeta.Data {
  agentType: string            // "fork", "explore", "code", etc.
  agentId: string              // Unique agent ID
  worktreePath?: string        // If isolation: "worktree" was used
  description?: string         // Original task description
  renderedSystemPrompt?: string // Byte-exact system prompt (fork children only)
}
```

The sidecar is written **once at agent spawn time** by `runner.ts` and read on resume. No database schema changes are needed.

### Resume Pipeline

```
resumeAgentBackground(agentId, prompt, sessionContext)
│
├── 1. Dedup guard (Set<agentId>) — prevent concurrent resume
├── 2. Load metadata sidecar (.meta.json)
│   ├── Fast path: probe known subdir from subsession title
│   └── Fallback: enumerate all subagent subdirectories
├── 3. Load JSONL transcript (SidechainTranscript.read)
├── 4. Filter orphaned messages (3-pass pipeline)
│   ├── filterUnresolvedToolUses — tool calls without matching responses
│   ├── filterOrphanedThinkingOnlyMessages — assistant msgs with only thinking blocks
│   └── filterWhitespaceOnlyAssistantMessages — assistant msgs with no visible content
├── 5. Reconstruct content optimization state
├── 6. Validate worktree (stat + mtime refresh)
├── 7. System prompt re-threading (fork children only)
│   ├── Tier 1: CacheSafeParams LRU (in-memory, byte-exact)
│   ├── Tier 2: .meta.json sidecar (on-disk, byte-exact)
│   └── Tier 3: Throw (unrecoverable)
├── 8. Create SubagentContext with invocationKind: "resume"
├── 9. Resolve sidechain subsession (existing or fresh)
├── 10. Set up JSONL audit recording + timeout + bus listeners
└── 11. Execute via SessionPrompt.prompt() (fire-and-forget)
```

### Orphaned Message Filtering

**Source:** [`src/agent/filter.ts`](../src/agent/filter.ts)

Before resuming, three filters clean the reconstructed transcript:

| Filter | Removes | Rationale |
|---|---|---|
| `filterUnresolvedToolUses` | Assistant messages with tool calls that have no matching tool response | Prevents model confusion from incomplete exchanges |
| `filterOrphanedThinkingOnlyMessages` | Assistant messages containing only `thinking`/`redacted-thinking` blocks | No actionable content for the model |
| `filterWhitespaceOnlyAssistantMessages` | Assistant messages with empty or whitespace-only text | No actionable content |

### System Prompt Recovery (3-Tier)

For fork children, the parent's rendered system prompt must be restored byte-exactly to maintain cache sharing:

| Tier | Source | Availability | Cache-safe? |
|---|---|---|---|
| **Tier 1** | `CacheSafeParams` LRU cache | Warm server, same process | ✅ Byte-exact |
| **Tier 2** | `.meta.json` sidecar on disk | Cold server restart, LRU eviction | ✅ Byte-exact |
| **Tier 3** | Throw | — | N/A (unrecoverable) |

This is **strictly better** than the MVP, which degraded to prompt reconstruction on Tier 2 (risking cache busting from divergent dynamic content).

### Worktree Validation on Resume

```
1. stat(meta.worktreePath) → exists?
   ├── YES: refreshWorktreeMtime() to prevent GC race
   └── NO:  fall back to parent's working directory (log diagnostic)
```

The mtime refresh occurs **before** the agent begins execution, preventing a race condition where the garbage collector could clean up the worktree between validation and first use.

### Content Optimization State Reconstruction

**Source:** [`src/agent/resume.ts`](../src/agent/resume.ts) — `reconstructContentOptimizationState()`

The optimization state (tracking which tool results were persisted to disk and replaced with previews) must be reconstructed identically to maintain cache stability:

1. **Gap-fill** from parent's live optimization state (inherited entries)
2. **Merge** any persisted replacement records
3. **Scan** transcript messages for `contentReplacementId` references
4. Unresolvable references are set to `null` as a deterministic sentinel

### Concurrent Resume Guard

```typescript
const activeResumes = new Set<string>()
```

A simple dedup guard prevents multiple simultaneous resume attempts for the same agent ID. Without this, concurrent `routeMessage()` calls for a stopped agent would spawn duplicate execution contexts.

---

## Teammate Re-engagement via Messaging

Users can re-engage background agents through the messaging tool with 3-way routing:

| Agent State | Behavior |
|---|---|
| **Running** | Message queued for delivery at next tool round |
| **Stopped** (task tracked in session) | Auto-resume with message as new prompt |
| **Evicted** (task no longer in session) | Resume from disk transcript with message as new prompt |

An **agent name registry** maps human-readable agent names to agent IDs, enabling re-engagement by name.

---

## Post-Turn Cache Sharing

After each main agent loop turn, cache-safe parameters are saved via `saveCacheSafeParams()`. System-internal forks that run after the turn (summarization, memory extraction, prompt suggestion) can then share the main loop's prompt cache by reading via `getLastCacheSafeParams()`.

This avoids each post-turn fork creating its own cache entry, reducing cost by ~70% for system-internal work.

### Ephemeral Forks

System-internal forks (summarization, speculation) can skip transcript recording entirely by setting `skipTranscript: true`, reducing I/O overhead for fire-and-forget operations.

---

## Observability

### Invocation Kind Marking

Resumed agents are marked with `invocationKind: "resume"` in their `AgentContext`, distinguishing them from freshly-spawned agents in telemetry and analytics.

### Diagnostics

| Scenario | Diagnostic |
|---|---|
| Prompt cache miss on fork child | Telemetry event (no user error) |
| Resume transcript > 2000 messages | Telemetry warning (no rejection) |
| Worktree GC'd before resume | Debug log + fallback to parent cwd |
| Metadata sidecar not found at expected subdir | Info log + enumerate all subdirs |

---

## Feature Flags

| Flag | Default | Effect |
|---|---|---|
| `LITEAI_FORK_SUBAGENT` | `false` | Enable fork spawning model |
| `liteai_slim_subagent_liteaimd` | `true` | Enable context pruning for read-only agents |
| `LITEAI_ISOLATION_TTL_MS` | `3600000` | TTL for worktree/container artifacts (ms) |
