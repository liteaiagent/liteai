# Subagent Architecture — liteai2

> Source: `C:\Users\aghassan\Documents\workspace\liteai2\src\tools\AgentTool\`

---

## Overview

liteai2 treats sub-agents as **fully orchestrated parallel workers** with their own system prompts, tool pools, permission scopes, MCP connections, skills, memory, and sidechain transcripts. This is in contrast to liteai's current approach where `TaskTool` creates a clean-slate `Session.create({ parentID })` with no inherited context.

---

## 1. Agent Definition System

**Source:** [`loadAgentsDir.ts`](../../liteai2/src/tools/AgentTool/loadAgentsDir.ts)

### Type Hierarchy

```
AgentDefinition = BuiltInAgentDefinition | CustomAgentDefinition | PluginAgentDefinition
```

| Type | Source | Example |
|---|---|---|
| `BuiltInAgentDefinition` | `source: 'built-in'` | Explore, Plan, general-purpose |
| `CustomAgentDefinition` | `source: SettingSource` | User-defined `.md` agents |
| `PluginAgentDefinition` | `source: 'plugin'` | Plugin-bundled agents |

### Agent Configuration Fields

Every agent definition supports:

| Field | Purpose |
|---|---|
| `tools` / `disallowedTools` | Tool whitelist/blacklist |
| `skills` | Skill names to preload into context |
| `mcpServers` | Agent-scoped MCP servers (by reference or inline) |
| `hooks` | Session-scoped hooks registered on agent start |
| `model` | Override model (or `'inherit'` from parent) |
| `effort` | Effort level override |
| `permissionMode` | Override permission mode (`plan`, `auto`, `bubble`, etc.) |
| `maxTurns` | Maximum agentic turns |
| `memory` | Persistent memory scope: `'user'`, `'project'`, `'local'` |
| `background` | Always run as background task |
| `isolation` | `'worktree'` (git worktree) or `'remote'` (CCR) |
| `omitClaudeMd` | Strip CLAUDE.md from context (Explore/Plan agents) |
| `criticalSystemReminder_EXPERIMENTAL` | Short reminder re-injected every user turn |

### Loading Priority

```
built-in < plugin < userSettings < projectSettings < flagSettings < policySettings
```

Later sources override earlier ones by `agentType` name via `getActiveAgentsFromList()`.

---

## 2. Context Forking — `createSubagentContext()`

**Source:** [`forkedAgent.ts`](../../liteai2/src/utils/forkedAgent.ts)

This is the **critical architectural difference** from liteai. Instead of a clean-slate session, liteai2 creates an isolated `ToolUseContext` that inherits the parent's state selectively:

### Isolation Model

| State | Default Behavior | Override Option |
|---|---|---|
| `readFileState` | **Cloned** from parent | `readFileState` override |
| `abortController` | New child linked to parent | `shareAbortController: true` |
| `getAppState` | Wrapped + `shouldAvoidPermissionPrompts: true` | `getAppState` override |
| `setAppState` | **No-op** (isolated) | `shareSetAppState: true` |
| `setResponseLength` | **No-op** (isolated) | `shareSetResponseLength: true` |
| `contentReplacementState` | **Cloned** from parent (prompt cache stability) | `contentReplacementState` override |
| `toolDecisions` | Fresh `undefined` | — |
| Messages | Override or parent's | `messages` override |

### Forked Agent Pattern (`runForkedAgent`)

Used for background tasks like `/dream`, session memory extraction, prompt suggestions:

```
parent CacheSafeParams → createSubagentContext() → query() loop → sidechain transcript
```

Key insight: **CacheSafeParams** (system prompt, user/system context, tools, messages prefix) must be **byte-identical** to the parent's for Anthropic API prompt cache hits. This is why the fork clones rather than recreating.

---

## 3. Context Pruning — Intelligent Stripping

**Source:** [`runAgent.ts:L386-L410`](../../liteai2/src/tools/AgentTool/runAgent.ts#L386)

liteai2 actively prunes heavy context for read-only agents:

### CLAUDE.md Stripping

```ts
// Read-only agents don't need commit/PR/lint rules from CLAUDE.md
const shouldOmitClaudeMd = agentDefinition.omitClaudeMd && !override?.userContext
// Saves ~5-15 Gtok/week across 34M+ Explore spawns
const { claudeMd: _omittedClaudeMd, ...userContextNoClaudeMd } = baseUserContext
```

### Git Status Stripping

```ts
// Explore/Plan are read-only — stale parent gitStatus is dead weight
const { gitStatus: _omittedGitStatus, ...systemContextNoGit } = baseSystemContext
// Saves ~1-3 Gtok/week fleet-wide
```

### Kill-switch

Feature flag `tengu_slim_subagent_claudemd` (defaults true) — can revert instantly.

---

## 4. Dynamic MCP Server Mounting

**Source:** [`runAgent.ts:L95-L218`](../../liteai2/src/tools/AgentTool/runAgent.ts#L95)

Agents declare MCP servers in frontmatter. On spawn:

1. **String reference** — looks up existing server config, reuses memoized connection
2. **Inline definition** `{ name: config }` — creates a new connection just for this agent

```ts
// Agent-scoped MCP lifecycle
const { clients: mergedMcpClients, tools: agentMcpTools, cleanup: mcpCleanup } =
  await initializeAgentMcpServers(agentDefinition, parentClients)
// ... agent runs ...
// On exit: only clean up newly-created inline connections
await mcpCleanup()
```

Policy guard: `isRestrictedToPluginOnly('mcp')` blocks user-defined agents from attaching MCP servers, but admin-trusted agents (plugin, built-in, policySettings) are always allowed.

---

## 5. Permission Sandboxing

**Source:** [`runAgent.ts:L412-L498`](../../liteai2/src/tools/AgentTool/runAgent.ts#L412)

### Async Prompt Blocking

```ts
const shouldAvoidPrompts = canShowPermissionPrompts !== undefined
  ? !canShowPermissionPrompts
  : agentPermissionMode === 'bubble' ? false : isAsync

if (shouldAvoidPrompts) {
  toolPermissionContext = { ...toolPermissionContext, shouldAvoidPermissionPrompts: true }
}
```

Background agents that hit a blocking permission → **silent deny** rather than hanging.

### Permission Mode Inheritance

Agent's `permissionMode` overrides parent **unless** parent is `bypassPermissions`, `acceptEdits`, or `auto` (these always take precedence).

### Tool Allow-list Scoping

When `allowedTools` is provided, session-level permissions are replaced (not merged) — parent approvals don't leak through. SDK-level `--allowedTools` (cliArg) are preserved.

---

## 6. Sidechain Transcripts

**Source:** [`sessionStorage.ts → recordSidechainTranscript()`](../../liteai2/src/utils/sessionStorage.ts)

Sub-agent messages are recorded to an **isolated transcript** file, not polluted into the parent's message chain:

```ts
// Record initial messages before the query loop starts
void recordSidechainTranscript(initialMessages, agentId)

// Each turn is appended incrementally (O(1) per message)
await recordSidechainTranscript([message], agentId, lastRecordedUuid)
```

The parent only receives the **final dense result** via the `<task_result>` block — preserving the parent's KV cache.

### Transcript Grouping

`setAgentTranscriptSubdir(agentId, transcriptSubdir)` — workflow sub-agents write to `subagents/workflows/<runId>/` for organized debugging.

---

## 7. Hierarchical Tracing

```ts
if (isPerfettoTracingEnabled()) {
  const parentId = toolUseContext.agentId ?? getSessionId()
  registerPerfettoAgent(agentId, agentDefinition.agentType, parentId)
}
```

Perfetto spans create parent-child links for visualizing swarm execution trees.

---

## Comparison: liteai vs liteai2 (Subagents)

| Dimension | liteai | liteai2 |
|---|---|---|
| Context sharing | Empty slate — no parent history | Selective fork with intelligent pruning |
| MCP lifecycle | Static project-wide pool | Dynamic per-agent mount + cleanup |
| Prompt blocking | No async protection | Silent deny for background agents |
| Transcript storage | Written to parent session | Sidechain — isolated per agent |
| Tool scoping | Explicit deny-list at init | Contextually isolated permission scopes |
| Memory | None | Persistent scoped memory (user/project/local) |
| Tracing | Within session logs | Perfetto parent-child span hierarchy |
| File state | Fresh cache | Cloned from parent |
| Model selection | Parent fallback | Per-agent model with fallback chain |
