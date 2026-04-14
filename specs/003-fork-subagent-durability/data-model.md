# Data Model: Fork Subagent + Agent Durability

**Feature**: 003-fork-subagent-durability
**Date**: 2026-04-14

## MVP Grounding

> Entity schemas are derived from the MVP reference implementation's runtime types. Each entity references the MVP source where its shape is defined.

---

## Entities

### 1. ForkAgentConfig

Synthetic agent definition for the fork path. Not registered in the agent list — used only when fork spawning is triggered by omitting `subagent_type` and the fork feature gate is active.

**MVP Reference**: `tools/AgentTool/forkSubagent.ts:60-71` — `FORK_AGENT`

| Field | Type | Description | Validation |
|-------|------|-------------|------------|
| `agentType` | `'fork'` (literal) | Synthetic agent type name used for analytics | Hardcoded constant |
| `tools` | `'*'` (wildcard) | Inherit parent's exact tool pool for cache compatibility | Must be wildcard |
| `maxTurns` | `200` | Maximum API round-trips | Positive integer |
| `model` | `'inherit'` | Inherit parent's model for context length parity | Must be 'inherit' |
| `permissionMode` | `'bubble'` | Default — overridden by elevated parent modes | Valid permission mode |
| `wallClockTimeout` | `1_800_000` (30min) | Configurable wall-clock timeout in ms | Positive integer |
| `background` | `true` | Fork children are always background agents | Must be true |
| `source` | `'builtIn'` | Internal agent, not user-defined | Hardcoded |

**State transitions**: N/A (static configuration)

---

### 2. ForkedMessageSet

The constructed context given to a fork child. Designed so the shared portion between parent and child is cache-compatible with the parent's API request.

**MVP Reference**: `tools/AgentTool/forkSubagent.ts:107-169` — `buildForkedMessages()`

| Field | Type | Description | Validation |
|-------|------|-------------|------------|
| `fullAssistantMessage` | `TranscriptMessage` | Cloned parent assistant message with all tool_use blocks | Must have role=assistant |
| `toolResultPlaceholders` | `Array<{tool_use_id: string, content: string}>` | Identical placeholder results for all tool_use blocks | All texts must be identical |
| `childDirective` | `string` | Per-child text block with behavioral contract + directive | Non-empty |
| `worktreeNotice` | `string \| undefined` | Path translation notice if worktree isolation is active | Present only when worktree active |

**Invariant**: `toolResultPlaceholders` must use identical placeholder text (`"Fork started — processing in background"`) across all fork children to maximize cache hits. Only `childDirective` differs per sibling.

**Relationships**:
- Consumed by fork spawn flow
- Prepended to `CacheSafeParams.forkContextMessages`

---

### 3. CacheSafeParams

Parameters that must be identical between the fork and parent API requests to share the parent's prompt cache.

**MVP Reference**: `utils/forkedAgent.ts:57-68` — `CacheSafeParams`

| Field | Type | Description | Validation |
|-------|------|-------------|------------|
| `systemPrompt` | `string` | Parent's rendered system prompt (byte-exact) | Non-empty |
| `userContext` | `Record<string, unknown>` | User context prepended to messages | May be empty |
| `systemContext` | `Record<string, unknown>` | System context appended to system prompt | May be empty |
| `toolConfig` | `unknown[]` | Tool definitions (must match parent's exact pool) | Array |
| `forkContextMessages` | `TranscriptMessage[]` | Parent context messages for cache sharing | Array |

**Storage**: Session-scoped slot on the session's engine context. Written after each main loop turn by the post-sampling hook. Read by post-turn forks (summarization, memory extraction, speculation).

**Relationships**:
- Written by main agent loop post-turn hook
- Read by post-turn fork consumers
- Threaded through fork spawn → child agent lifecycle

---

### 4. AgentResumeState

Reconstructed execution state for agent resume from sidechain transcript.

**MVP Reference**: `tools/AgentTool/resumeAgent.ts:63-97` — resume state assembly

| Field | Type | Description | Validation |
|-------|------|-------------|------------|
| `resumedMessages` | `TranscriptMessage[]` | Cleaned transcript (orphans filtered) | Post-filter array |
| `agentMetadata` | `AgentMetadata` | Agent identity and lifecycle metadata | Must have agentType |
| `contentReplacementState` | `Record<string, unknown> \| undefined` | Reconstructed optimization state | Matches original decisions |
| `worktreePath` | `string \| undefined` | Validated worktree path (mtime refreshed) | Stat check passed, mtime bumped |
| `parentSystemPrompt` | `string \| undefined` | Re-threaded system prompt (fork resume only) | Required for fork resume |
| `invocationKind` | `'resume'` (literal) | Marks this as a resume for telemetry | Hardcoded |

**State transitions**: N/A (assembled once, consumed by resume flow)

---

### 5. AgentMetadata

Observability and lifecycle data persisted alongside the sidechain transcript.

**MVP Reference**: `utils/sessionStorage.ts` — `readAgentMetadata()` / `writeAgentMetadata()`

| Field | Type | Description | Validation |
|-------|------|-------------|------------|
| `agentId` | `string` | Unique agent identifier | Non-empty |
| `agentType` | `string` | Agent definition name (e.g., 'fork', 'general') | Non-empty |
| `description` | `string \| undefined` | Human-readable task description | Optional |
| `worktreePath` | `string \| undefined` | Path to agent's isolated worktree | Optional, valid path |
| `startTime` | `number` | Epoch ms when agent was spawned | Positive |
| `model` | `string` | Resolved model ID used by the agent | Non-empty |
| `parentAgentId` | `string \| undefined` | Parent agent's ID (for fork children) | Optional |
| `status` | `'running' \| 'completed' \| 'interrupted' \| 'killed'` | Last known lifecycle status | Valid enum |

**Storage**: JSON file alongside the JSONL transcript file.

---

### 6. AgentNameRegistry

Session-scoped mapping of human-readable agent names to agent IDs for teammate re-engagement.

**MVP Reference**: `tools/SendMessageTool/SendMessageTool.ts:804` — `appState.agentNameRegistry.get(input.to)`

| Field | Type | Description | Validation |
|-------|------|-------------|------------|
| `registry` | `Map<string, string>` | Name → agent ID mapping | Unique names |

**Operations**:
- `register(name, agentId)` — Called at spawn time
- `lookup(name)` — Called by messaging tool for routing
- Names persist across session lifecycle

**Relationships**:
- Updated by agent spawn flow
- Consumed by messaging tool's 3-way routing
- Session-scoped (no cross-session leakage)

---

### 7. ForkBehavioralContract

The set of rules injected into fork children constraining their behavior.

**MVP Reference**: `tools/AgentTool/forkSubagent.ts:171-198` — `buildChildMessage()`

| Field | Type | Description |
|-------|------|-------------|
| `boilerplateTag` | `string` | XML tag wrapping all rules (`<fork_boilerplate>`) |
| `rules` | `string[]` | 10 non-negotiable behavioral rules |
| `outputFormat` | `string` | Structured report format (Scope, Result, Key files, Files changed, Issues) |
| `directivePrefix` | `string` | Prefix before the per-child directive |

**Invariant**: The contract text is identical for all fork children (only the appended directive differs). This is critical for cache sharing — the contract is part of the cache-compatible prefix.

---

### 8. AgentLifecycleState

Background agent lifecycle state model.

**States**:
```
running → completed | interrupted | killed → resumable (after transcript validation)
```

| State | Description | Valid Transitions |
|-------|-------------|-------------------|
| `running` | Agent is actively executing | → completed, interrupted, killed |
| `completed` | Agent finished successfully | → resumable (via MessageTool re-engagement) |
| `interrupted` | Agent interrupted by process restart/crash | → resumable |
| `killed` | Agent terminated by user or timeout | → resumable |
| `resumable` | Transcript validated, ready for resume | → running |

**Transition guard**: `resumable` requires:
1. Valid persisted sidechain transcript exists on disk
2. Orphaned message filtering passes without errors
3. For fork children: parent system prompt can be resolved

---

### 9. WorktreeReference

Association between an agent and its isolated filesystem clone.

| Field | Type | Description | Validation |
|-------|------|-------------|------------|
| `worktreePath` | `string` | Absolute path to the worktree directory | Must exist on disk |
| `parentCwd` | `string` | Parent agent's working directory | Non-empty |
| `lastActivity` | `Date` | Last mtime (refreshed on resume) | Recent timestamp |

**Operations**:
- `validate(path)` — stat check, returns boolean
- `refreshMtime(path)` — utimes to current time
- `buildNotice(parentCwd, worktreePath)` — generates path translation notice

---

## Relationships

```
ForkAgentConfig ──defines──> ForkedMessageSet ──produces──> CacheSafeParams
                                                              │
                                                              ├──consumed by──> PostTurnForks
                                                              └──consumed by──> ForkChildLifecycle

AgentMetadata ──persisted with──> SidechainTranscript ──reconstructed into──> AgentResumeState

AgentNameRegistry ──resolves──> AgentMetadata.agentId ──routes to──> MessagingTool (3-way)

WorktreeReference ──injected into──> ForkedMessageSet.worktreeNotice
                  ──validated for──> AgentResumeState.worktreePath
```
