# Feature Specification: Sub-Agent Architecture

**Feature Branch**: `002-subagent-architecture`  
**Created**: 2026-04-11  
**Status**: Draft  
**Input**: User description: "Refactor sub-agent architecture to support context forking, agent definition types, sidechain transcripts, context pruning, permission sandboxing, and agent-scoped MCP server mounting"

## Reference Implementation

> All references point to the liteai2 source at `C:\Users\aghassan\Documents\workspace\liteai2\src`

### Agent Definition Type System

- **[loadAgentsDir.ts](../../liteai2/src/tools/AgentTool/loadAgentsDir.ts)** — Defines the complete agent type hierarchy: `BaseAgentDefinition`, `BuiltInAgentDefinition`, `CustomAgentDefinition`, `PluginAgentDefinition`, and the union `AgentDefinition`. Contains `AgentJsonSchema` (Zod, L73–99), `AgentMcpServerSpecSchema` (L63–68), type guards (`isBuiltInAgent`, `isCustomAgent`, `isPluginAgent`), and `getActiveAgentsFromList()` (L193–221) which implements deterministic priority ordering: `builtIn < plugin < userSettings < projectSettings < flagSettings < policySettings`.
- **[loadAgentsDir.ts:parseAgentFromMarkdown](../../liteai2/src/tools/AgentTool/loadAgentsDir.ts#L541)** — Parses `.md` frontmatter into a `CustomAgentDefinition`, handling all expanded config fields: tools, disallowedTools, skills, mcpServers, hooks, model (with `'inherit'` transform), effort, permissionMode, maxTurns, memory, background, isolation, color, initialPrompt.
- **[builtInAgents.ts](../../liteai2/src/tools/AgentTool/builtInAgents.ts)** — Registers built-in agents (Explore, Plan, general-purpose) as `BuiltInAgentDefinition` with dynamic `getSystemPrompt()` closures.

### Context Forking (`createSubagentContext`)

- **[forkedAgent.ts](../../liteai2/src/utils/forkedAgent.ts)** — Core context forking implementation. Key exports:
  - `createSubagentContext()` (L345–462): Creates an isolated `ToolUseContext` from the parent. Isolation model: `readFileState` cloned (L379–381), `abortController` child-linked or shared (L350–354), `getAppState` wrapped to set `shouldAvoidPermissionPrompts` (L358–374), `setAppState` no-op by default (L410–412), `toolDecisions` fresh undefined (L387), `contentReplacementState` cloned for cache stability (L399–403), `queryTracking` with incremented depth (L452–455).
  - `SubagentContextOverrides` type (L260–304): All possible override fields including `shareSetAppState`, `shareSetResponseLength`, `shareAbortController` opt-ins.
  - `CacheSafeParams` type (L57–68): Carries system prompt, user/system context, tool use context, and fork context messages — must be byte-identical to parent for prompt cache hits.
  - `runForkedAgent()` (L489–626): The actual query loop for forked agents with usage tracking, sidechain transcript recording, and analytics.
- **[forkSubagent.ts](../../liteai2/src/tools/AgentTool/forkSubagent.ts)** — Fork subagent experiment: `FORK_AGENT` definition (L60–71), `buildForkedMessages()` (L107–169) for constructing byte-identical API prefixes, `isInForkChild()` (L78–89) recursion guard, `buildWorktreeNotice()` (L205–210) for git worktree isolation.

### Context Pruning

- **[runAgent.ts:L385–410](../../liteai2/src/tools/AgentTool/runAgent.ts#L385)** — Intelligent stripping for read-only agents:
  - ClaudeMd stripping (L390–398): `shouldOmitClaudeMd = agentDefinition.omitClaudeMd && !override?.userContext && featureFlag('tengu_slim_subagent_claudemd', true)`. Destructures `{ claudeMd: _omitted, ...userContextNoClaudeMd }`.
  - Git status stripping (L400–410): `{ gitStatus: _omitted, ...systemContextNoGit }` for Explore/Plan agents. Saves ~1–3 Gtok/week fleet-wide.
  - Kill-switch: feature flag `tengu_slim_subagent_claudemd` defaults true.

### Permission Sandboxing

- **[runAgent.ts:L412–498](../../liteai2/src/tools/AgentTool/runAgent.ts#L412)** — Full permission sandboxing implementation:
  - Permission mode inheritance (L421–434): Agent's mode overrides parent **unless** parent is `bypassPermissions`, `acceptEdits`, or `auto` (feature-gated).
  - Async prompt blocking (L440–451): `shouldAvoidPrompts` derived from `canShowPermissionPrompts` param, `bubble` mode, and `isAsync` flag. Sets `shouldAvoidPermissionPrompts: true` on the permission context.
  - Automated check gating (L458–463): Background agents that *can* show prompts get `awaitAutomatedChecksBeforeDialog: true`.
  - Tool allow-list scoping (L465–479): When `allowedTools` is provided, session-level rules are replaced entirely. CLI-level (`cliArg`) rules from SDK `--allowedTools` are preserved.

### Sidechain Transcripts

- **[sessionStorage.ts:recordSidechainTranscript](../../liteai2/src/utils/sessionStorage.ts#L1451)** — Writes messages to an isolated agent transcript file (L1451–1462). Uses `insertMessageChain()` with `isSidechain=true` and the agent's unique ID.
- **[sessionStorage.ts:setAgentTranscriptSubdir](../../liteai2/src/utils/sessionStorage.ts#L236)** — Routes agent transcripts to grouping subdirectories (L236–241). Path: `<projectDir>/<sessionId>/subagents/<subdir>/agent-<agentId>.jsonl`.
- **[sessionStorage.ts:getAgentTranscriptPath](../../liteai2/src/utils/sessionStorage.ts#L247)** — Resolves the sidechain file path by agent ID and optional subdir (L247–258).
- **[runAgent.ts:L735–800](../../liteai2/src/tools/AgentTool/runAgent.ts#L735)** — Recording pattern: initial messages recorded before query loop (fire-and-forget), each turn appended incrementally with `lastRecordedUuid` for parent chain continuity.

### Dynamic MCP Server Mounting

- **[runAgent.ts:initializeAgentMcpServers](../../liteai2/src/tools/AgentTool/runAgent.ts#L95)** — Agent-scoped MCP lifecycle (L95–218):
  - String reference path (L140–151): Looks up existing config via `getMcpConfigByName()`, reuses memoized `connectToServer()`.
  - Inline definition path (L152–170): Creates new scoped connection, tracked in `newlyCreatedClients[]`.
  - Cleanup function (L197–210): Only cleans up `newlyCreatedClients`, not shared referenced connections.
  - Policy guard (L117–127): `isRestrictedToPluginOnly('mcp')` blocks user-defined agents' MCP; admin-trusted sources always allowed.
- **[loadAgentsDir.ts:AgentMcpServerSpec](../../liteai2/src/tools/AgentTool/loadAgentsDir.ts#L58)** — Type definition: `string` (reference) | `{ [name]: McpServerConfig }` (inline).

### Agent Persistent Memory

Agent memory is a **filesystem-backed persistent knowledge store** where agents accumulate learnings across sessions. It is **not** the system prompt, and **not** AGENTS.md — it is a dedicated `MEMORY.md` file (plus optional supporting files) in a scoped directory, managed via auto-injected Read/Write/Edit tools.

**Scope model** (configured per-agent via `memory: 'user' | 'project' | 'local'`):
- `user` scope: Global across all projects. Path: `~/.liteai/agent-memory/<agentType>/MEMORY.md`
- `project` scope: Shared via version control. Path: `<cwd>/.liteai/agent-memory/<agentType>/MEMORY.md`
- `local` scope: Machine-local, not checked in. Path: `<cwd>/.liteai/agent-memory-local/<agentType>/MEMORY.md`

**Behavior when enabled:**
1. At agent spawn, the system calls `loadAgentMemoryPrompt(agentType, scope)` which appends memory contents to the agent's system prompt, along with scope-specific guidelines (e.g., "keep learnings general" for user scope, "tailor to this project" for project scope).
2. Memory Read/Write/Edit tools are **auto-injected** into the agent's tool pool when `memory` is configured and `isAutoMemoryEnabled()` returns true.
3. The memory directory is created lazily (fire-and-forget `ensureMemoryDirExists()` at spawn time).

**Forking behavior:** Memory is keyed by **agent type**, not by session lineage. When a parent spawns a sub-agent of type "explore", the sub-agent reads **explore's own memory** — it does not inherit or access the parent agent's memory. This is by design: memory scopes are per-agent-type persistent storage, orthogonal to context forking.

**Snapshot system** (`agentMemorySnapshot.ts`): Project-level snapshots can seed initial agent memory. When `AGENT_MEMORY_SNAPSHOT` feature flag is enabled, the system checks for newer snapshots and copies them to local memory on first load.

- **[agentMemory.ts](../../liteai2/src/tools/AgentTool/agentMemory.ts)** — Core memory module: `AgentMemoryScope` type, `getAgentMemoryDir()` (path resolution by scope), `loadAgentMemoryPrompt()` (system prompt injection with scope-specific guidelines), `isAgentMemoryPath()` (security boundary check with path traversal prevention).
- **[agentMemorySnapshot.ts](../../liteai2/src/tools/AgentTool/agentMemorySnapshot.ts)** — Snapshot lifecycle: `checkAgentMemorySnapshot()` detects newer project snapshots, `copyProjectSnapshotToLocal()` seeds local memory from project-level snapshots.
- **[loadAgentsDir.ts:L455–484](../../liteai2/src/tools/AgentTool/loadAgentsDir.ts#L455)** — Auto-injection of memory tools: when `isAutoMemoryEnabled() && parsed.memory`, the system injects Read/Write/Edit tools scoped to the agent's memory directory and appends `loadAgentMemoryPrompt()` to the system prompt.

### Critical System Reminder

A **short, static text string** configured per-agent that gets **re-injected on every user turn** as a `critical_system_reminder` attachment. Its primary purpose is to reinforce the agent's operational mode and critical behavioral constraints that the model might "forget" over long multi-turn conversations.

**Primary use cases:**
- **Plan mode agents**: Remind the agent it is in read-only mode and must follow the plan without making edits
- **Execution mode agents**: Remind the agent to follow and update the plan as it implements
- **Verification agents**: Remind the agent it is verification-only (e.g., `"CRITICAL: This is a VERIFICATION-ONLY task. You CANNOT edit files IN THE PROJECT DIRECTORY. You MUST end with VERDICT: PASS, VERDICT: FAIL, or VERDICT: PARTIAL."`)
- **Any agent with strict behavioral boundaries** that must be maintained across long conversations

**Injection mechanism:**
1. Agent defines `criticalSystemReminder_EXPERIMENTAL: string` in its configuration (built-in or frontmatter).
2. During context forking, the reminder is propagated to the `SubagentContext` via `SubagentContextOverrides.criticalSystemReminder_EXPERIMENTAL`.
3. On each turn, `getCriticalSystemReminderAttachment()` reads the reminder from `toolUseContext` and emits it as a `{ type: 'critical_system_reminder', content: string }` attachment.
4. The attachment is rendered into the conversation as a `<system-reminder>` wrapped user message, placed after all other attachments for maximum recency.

**Related but distinct:** The broader `<system-reminder>` wrapping mechanism (used by plan mode, auto mode, ephemeral user message reminders in `query.ts`) serves a similar purpose but is dynamically generated from the current mode state. The `criticalSystemReminder` field is the **agent-scoped, static** variant configured at definition time.

- **[attachments.ts:getCriticalSystemReminderAttachment](../../liteai2/src/utils/attachments.ts#L1587)** — Reads `toolUseContext.criticalSystemReminder_EXPERIMENTAL` and emits it as a `critical_system_reminder` attachment on every turn.
- **[forkedAgent.ts:SubagentContextOverrides](../../liteai2/src/utils/forkedAgent.ts#L295)** — Propagates the reminder through context forking: `criticalSystemReminder_EXPERIMENTAL?: string`.
- **[verificationAgent.ts](../../liteai2/src/tools/AgentTool/built-in/verificationAgent.ts#L150)** — Example usage: verification agent uses it to reinforce read-only constraints and require a VERDICT.
- **[runAgent.ts:L711–712](../../liteai2/src/tools/AgentTool/runAgent.ts#L711)** — Passes `agentDefinition.criticalSystemReminder_EXPERIMENTAL` into the subagent context overrides.

### Root vs Sub-Agent Discriminator

The system distinguishes the **root agent** (main session thread) from **sub-agents** via the presence of `agentId` on the execution context:
- **Root agent**: `toolUseContext.agentId` is `undefined` — the top-level session with no parent.
- **Sub-agent**: `toolUseContext.agentId` is a `string` — a spawned agent with an assigned identity.

This discriminator is a **first-class architectural contract** that gates numerous behaviors:
- **Attachment filtering**: `isMainThread = !toolUseContext.agentId` (attachments.ts L770) — certain attachments (MCP delta, agent listing, date change) are only emitted for the root thread.
- **Plan mode scoping**: `isSubAgent: !!toolUseContext.agentId` (attachments.ts L1236) — sub-agents in plan mode get simplified instructions.
- **Stop hooks**: Only fire for the root agent (`!toolUseContext.agentId` guards in stopHooks.ts L112, L143, L154).
- **MCP lifecycle**: Server-level events (connect/disconnect notifications) only propagate from the root agent.
- **Title generation**: Only the root agent triggers session title generation.
- **Compaction**: Sub-agents manage their own context window independently; compaction notifications don't bubble to the parent.
- **Memory extraction**: Sub-agents skip memory extraction (`if (context.toolUseContext.agentId)` guard in extractMemories.ts L532).
- **Tracing**: `parentId = toolUseContext.agentId ?? getSessionId()` — the agentId doubles as the parent reference in the tracing tree.

- **[attachments.ts:L770](../../liteai2/src/utils/attachments.ts#L770)** — `isMainThread = !toolUseContext.agentId` — gates root-only attachment injection.
- **[query.ts:L342](../../liteai2/src/query.ts#L342)** — `if (!toolUseContext.agentId)` — root-only session lifecycle operations.
- **[stopHooks.ts:L112–164](../../liteai2/src/query/stopHooks.ts#L112)** — Multiple `!toolUseContext.agentId` guards for root-only stop hooks.
- **[PermissionContext.ts:L159](../../liteai2/src/hooks/toolPermission/PermissionContext.ts#L159)** — `const sub = !!toolUseContext.agentId` — sub-agent permission scoping.

### Hierarchical Tracing

- **[runAgent.ts:L356–359](../../liteai2/src/tools/AgentTool/runAgent.ts#L356)** — Perfetto span registration: `registerPerfettoAgent(agentId, agentDefinition.agentType, parentId)` with `parentId = toolUseContext.agentId ?? getSessionId()`.

### Async Agent Lifecycle Management

- **[agentToolUtils.ts:runAsyncAgentLifecycle](../../liteai2/src/tools/AgentTool/agentToolUtils.ts#L508)** — Drives background agents from spawn to terminal notification (L508–686). Key lifecycle stages:
  - Progress tracking: `ProgressTracker` with `createActivityDescriptionResolver()` mapping tool names to human-readable descriptions.
  - Agent summarization: `startAgentSummarization()` triggered via `onCacheSafeParams` callback — periodic summaries for background agents.
  - Terminal notifications: `enqueueAgentNotification()` with status (completed/failed/killed), usage metrics, and worktree info.
  - Handoff classification: `classifyHandoffIfNeeded()` — auto-mode safety classifier reviews sub-agent output on handoff (L607–620).
  - Partial results: `extractPartialResult()` (L488–500) — preserves last meaningful output from killed agents.
  - Cache eviction: `tengu_cache_eviction_hint` event on agent completion (L338–346).
  - Retain mode: Live message appending to AppState when UI holds the task (L559–570).
- **[agentToolUtils.ts:filterToolsForAgent](../../liteai2/src/tools/AgentTool/agentToolUtils.ts#L70)** — Tool filtering with disallow lists (`ALL_AGENT_DISALLOWED_TOOLS`, `CUSTOM_AGENT_DISALLOWED_TOOLS`, `ASYNC_AGENT_ALLOWED_TOOLS`). MCP tools always allowed.
- **[agentToolUtils.ts:resolveAgentTools](../../liteai2/src/tools/AgentTool/agentToolUtils.ts#L122)** — Validates agent tool specs against available tools, supports wildcard expansion, and extracts `allowedAgentTypes` from `Agent(type1, type2)` spec syntax.

### Agent Execution Context (`AsyncLocalStorage`)

- **[agentContext.ts](../../liteai2/src/utils/agentContext.ts)** — Process-level agent identity isolation using `AsyncLocalStorage<AgentContext>` (L93). Key exports:
  - `SubagentContext` type (L32–54): Tracks `agentId`, `parentSessionId`, `subagentName`, `isBuiltIn`, `invokingRequestId`, `invocationKind` (spawn|resume), `invocationEmitted` flag.
  - `TeammateAgentContext` type (L60–85): For in-process swarm teammates with `teamName`, `agentColor`, `planModeRequired`, `isTeamLead`.
  - `runWithAgentContext(context, fn)` (L108–110): Wraps entire agent execution for analytics attribution isolation.
  - `consumeInvokingRequestId()` (L163–178): Returns invocation boundary info exactly once per spawn/resume for sparse edge telemetry.
  - **Why ALS over AppState (L17–21)**: Multiple background agents share the same process. AppState is shared mutable state — writes from Agent A would be visible to Agent B's analytics events.

### Hooks Integration at Agent Spawn

- **[runAgent.ts:L530–575](../../liteai2/src/tools/AgentTool/runAgent.ts#L530)** — Hook lifecycle at agent spawn:
  - `executeSubagentStartHooks()` (L533–545): Runs hooks and collects additional context messages.
  - Frontmatter hook registration (L547–570): Registers hooks from agent definition with `isAgent=true` flag, which converts `Stop` hook events to `SubagentStop` (agent-scoped lifecycle).
  - Admin-trust gating (L549): `isRestrictedToPluginOnly('hooks')` blocks user-defined agent hooks from registering if policy restricts.
  - Cleanup: `clearSessionHooks(rootSetAppState, agentId)` in the finally block (L825).

### Skills Preloading at Agent Spawn

- **[runAgent.ts:L577–646](../../liteai2/src/tools/AgentTool/runAgent.ts#L577)** — Skill loading at agent spawn:
  - Skills declared in agent frontmatter are loaded and added to `initialMessages` as pre-turn user messages.
  - Plugin skill resolution via `resolveSkillName()` with 3 strategies: exact match, plugin-prefix match, suffix match.
  - `clearInvokedSkillsForAgent(agentId)` cleanup in finally block (L683–684).

### Deterministic Cleanup Lifecycle

- **[runAgent.ts:L816–858](../../liteai2/src/tools/AgentTool/runAgent.ts#L816)** — 12-step teardown in `runAgent` finally block:
  1. MCP cleanup: `mcpCleanup()` — terminates agent-scoped inline connections.
  2. Session hooks: `clearSessionHooks(rootSetAppState, agentId)` — removes agent-registered hooks.
  3. Prompt cache tracking: `cleanupAgentTracking(agentId)` — releases cache entry references.
  4. File state cache: `subagentContext.readFileState.clear()` — frees cloned file data from memory.
  5. Context messages: `initialMessages.length = 0` — releases fork context message references.
  6. Perfetto tracing: `unregisterPerfettoAgent(agentId)` — removes from tracing tree.
  7. Transcript subdir: `clearAgentTranscriptSubdir(agentId)` — cleans up subdir mapping.
  8. Todos entry: `deletePendingAgentTodo(agentId, setAppState)` — prevents memory leak in whale sessions (hundreds of agents).
  9. Shell tasks: `killAgentShellTasks(agentId, rootSetAppState)` — prevents PPID=1 zombie processes from fire-and-forget bash.
  10. Monitor MCP tasks: Feature-gated cleanup for monitor tool connections.
  11. Invoked skills: `clearInvokedSkillsForAgent(agentId)` — resets skill tracking.
  12. Dump state: `clearDumpState(agentId)` — clears debug dump state.

## Clarifications

### Session 2026-04-11

- Q: Should there be a maximum concurrent sub-agent limit per parent session? → A: Configurable limit with a sensible default (e.g., 5–10 concurrent sub-agents per session)
- Q: Are isolation modes (`worktree`, `remote`) in-scope or explicitly deferred? → A: Fully in-scope — implement worktree and remote isolation in this phase
- Q: Should sub-agents have a configurable wall-clock timeout in addition to maxTurns? → A: Yes, configurable wall-clock timeout per agent (default: ~30 min)
- Enrichment: Added detailed Agent Persistent Memory documentation (filesystem-backed per-agent-type knowledge store with 3 scopes, orthogonal to context forking)
- Q: What is `critical system reminder` in the agent configuration? → A: A per-turn mode-reinforcement mechanism — a short static string re-injected every turn to remind the agent of its operational mode (plan mode = read-only, execution mode = follow/update plan, verification = no edits)
- Q: When a worktree/remote sub-agent crashes or loses connectivity, what should happen to its isolation artifacts? → A: Cleanup with retention — artifacts preserved for a configurable TTL (~1 hour) for post-mortem debugging, then garbage collected lazily on next session start
- Enrichment: Added Root vs Sub-Agent Discriminator documentation (`agentId` presence on execution context as the first-class contract for gating root-only behaviors)
- Architecture review vs liteai2 (2026-04-11): Identified 11 gaps. 9 integrated into spec (hooks at spawn, skills preloading, async lifecycle management, agent execution context ALS, thinking config, cleanup lifecycle, setAppStateForTasks, requiredMcpServers, effort override). 2 deferred to Phase 4 (fork subagent model, agent resume).
- Q: Which container runtime should `remote` isolation target? → A: Docker containers (local Docker daemon via CLI/API)
- Q: Should sub-agents have configurable extended thinking? → A: Thinking disabled by default for all sub-agents; opt-in via `thinking: true` per agent definition, with optional `thinkingBudget` (number of tokens) to cap thinking cost
- Q: When should `requiredMcpServers` be validated? → A: Dual enforcement — filter at load-time AND re-validate at spawn-time
- Q: When wall-clock timeout fires during active tool execution, should the tool get a grace period? → A: Hard-kill — signal abort immediately, no grace period; rely on partial result extraction
- Q: Should `setAppStateForTasks` be scoped or a full `setAppState` alias? → A: Scoped — expose only task-specific operations (`registerTask`, `killTask`, `deleteTodo`), not a full `setAppState`
- Enrichment: Added explicit liteai2 agent format compatibility guarantee — all liteai2 `.md` agent definitions must run in liteai without modification; new config fields are strictly additive with sensible defaults

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Context-Aware Sub-Agent Spawning (Priority: P1)

When the AI model delegates a task to a sub-agent (e.g., Explore, Plan, or a custom agent), the system creates an isolated execution context that selectively inherits the parent's relevant state. The sub-agent operates with its own message chain, tool decisions, and abort lifecycle while benefiting from the parent's cached file state and active project context. The parent session continues unaffected by the sub-agent's mutations.

**Why this priority**: This is the core enabler for all other sub-agent capabilities. Without context forking, sub-agents cannot have isolated state, sidechain transcripts, or independent permission scoping. Every other user story depends on this foundation.

**Independent Test**: Can be fully tested by spawning a sub-agent within an active session, verifying that the sub-agent inherits file state from the parent, operates with its own message history, and that the parent's state remains unmodified after the sub-agent completes. Delivers value by eliminating the current clean-slate penalty where sub-agents lose all parent context.

**Acceptance Scenarios**:

1. **Given** an active session with cached file state and in-progress messages, **When** the model spawns a sub-agent, **Then** the sub-agent's context contains the parent's file state cache and a fresh, isolated message history
2. **Given** a sub-agent is running, **When** it modifies its tool decisions or app state, **Then** the parent session's tool decisions and app state remain unchanged
3. **Given** a parent session with an active abort controller, **When** a sub-agent is spawned, **Then** the sub-agent receives a child abort controller linked to the parent's — cancelling the parent also cancels the sub-agent, but cancelling the sub-agent does not cancel the parent
4. **Given** a sub-agent completes its task, **When** the parent receives the result, **Then** the parent's context window contains only the dense task result, not the sub-agent's full transcript
5. **Given** the parent session is using a specific model with prompt cache, **When** the sub-agent constructs its system prompt, **Then** the sub-agent uses the section-based resolver from Phase 1 to build its system prompt independently

---

### User Story 2 — Typed Agent Definitions with Source Priority (Priority: P2)

Administrators, plugin developers, and the system itself define agents from multiple sources: built-in definitions bundled with the application, plugin-provided definitions, user-level settings, and project-level settings. The system loads all agent definitions with a deterministic priority ordering where later sources override earlier ones. Each agent supports an expanded configuration schema covering tool scoping, skills, MCP server declarations, model selection with inheritance, permission modes, and execution constraints.

**Why this priority**: The type hierarchy and expanded configuration schema define the contract that all other sub-agent features consume. Context forking needs to know which state to inherit (from agent config), permission sandboxing reads permissionMode, MCP mounting reads mcpServers, and context pruning reads omitClaudeMd.

**Independent Test**: Can be tested by defining agents across all four source levels, verifying the correct merge priority produces the expected final configuration, and confirming that expanded fields (tools, skills, mcpServers, model, permissionMode, maxTurns) are correctly parsed and available at runtime. Delivers value by enabling rich, customizable agent behavior without code changes.

**Acceptance Scenarios**:

1. **Given** a built-in agent "explore" with default configuration, **When** a user defines an "explore" override in project settings with a different model and permission mode, **Then** the project-level settings override the built-in defaults for those fields while preserving unmodified fields
2. **Given** an agent definition specifying `tools: ["read_file", "search"]` and `disallowedTools: ["write_file"]`, **When** the agent is loaded, **Then** the agent's tool pool contains only the allowed tools and excludes all disallowed tools
3. **Given** an agent definition specifying `model: 'inherit'`, **When** the agent is spawned as a sub-agent, **Then** the agent uses the parent session's model rather than the system default
4. **Given** a plugin agent and a user-settings agent with the same identifier, **When** agents are loaded, **Then** the user-settings agent takes precedence according to the loading priority: `built-in < plugin < userSettings < projectSettings`
5. **Given** a protected system agent (hidden: true), **When** a user attempts to override it via project settings, **Then** the system ignores the override and logs a warning
6. **Given** an agent definition declaring `hooks` in frontmatter, **When** the agent is spawned, **Then** `executeSubagentStartHooks()` runs and hooks are registered with `isAgent=true`, converting `Stop` events to `SubagentStop` for agent-scoped lifecycle
7. **Given** an agent definition declaring `skills: ["code-review"]` in frontmatter, **When** the agent is spawned, **Then** the skill is resolved (exact > plugin-prefix > suffix match), loaded, and injected into the agent's initial messages
8. **Given** an agent definition declaring `requiredMcpServers: ["github"]`, **When** the "github" MCP server is not connected or has no tools, **Then** the agent is excluded from the available agent list at load-time and rejected with a structured error at spawn-time if a stale reference is used

---

### User Story 3 — Permission Sandboxing for Background Agents (Priority: P3)

When a sub-agent runs as a background task (no interactive user session), any operation that would normally require user permission is silently denied rather than blocking indefinitely. Permission mode inheritance follows strict rules: parent elevated permissions (bypass, auto, accept-edits) always take precedence over the sub-agent's declared mode. When a sub-agent specifies an allowed-tools list, session-level tool permissions are replaced entirely — parent approvals do not leak through to the sub-agent.

**Why this priority**: Security-critical. Without permission sandboxing, background sub-agents can hang indefinitely on permission prompts, and tool permissions from parent sessions can leak through to sub-agents, violating the principle of least privilege.

**Independent Test**: Can be tested by spawning a background sub-agent that invokes a permission-requiring tool, verifying it receives an immediate denial without blocking. Verify that tool allow-lists replace rather than merge parent permissions. Delivers value by preventing hung background agents and closing permission leakage vectors.

**Acceptance Scenarios**:

1. **Given** a sub-agent running as a background task, **When** it invokes a tool that requires user permission (e.g., file write outside approved directories), **Then** the operation is silently denied and the sub-agent receives an immediate "permission denied" response without any user prompt
2. **Given** a parent session with `permissionMode: 'auto'`, **When** a sub-agent is spawned with `permissionMode: 'plan'`, **Then** the parent's 'auto' mode takes precedence and the sub-agent inherits auto-approval
3. **Given** a sub-agent configured with `allowedTools: ["read_file", "search"]`, **When** the parent session has approved "write_file" in its tool decisions, **Then** the sub-agent cannot access "write_file" — the allow-list replaces, not merges
4. **Given** a sub-agent with no explicit permission mode, **When** it runs as a foreground task, **Then** permission prompts bubble up to the user normally
5. **Given** a sub-agent using `permissionMode: 'bubble'`, **When** it requires permission, **Then** prompts bubble to the user terminal regardless of async status

---

### User Story 3b — Background Agent Lifecycle & Observability (Priority: P3)

When a sub-agent runs in the background, the system maintains a structured lifecycle: progress tracking with activity descriptions, periodic summarization for long-running agents, terminal notifications on completion/failure/kill with usage metrics, and partial result preservation for killed agents. Concurrent background agents in the same process have isolated analytics attribution via AsyncLocalStorage.

**Why this priority**: Without structured lifecycle management, background agents are fire-and-forget black boxes — no progress visibility, no completion notifications, and analytics events from concurrent agents would cross-contaminate.

**Independent Test**: Can be tested by spawning 3 concurrent background agents, verifying each has isolated analytics context, progress is tracked independently, and each triggers a terminal notification with correct usage metrics on completion.

**Acceptance Scenarios**:

1. **Given** a background sub-agent is running, **When** it executes tools, **Then** progress is tracked with human-readable activity descriptions derived from tool names
2. **Given** a background sub-agent completes successfully, **When** the result is ready, **Then** a terminal notification is enqueued with status='completed', description, usage summary (tokens, tool calls, duration), and optional worktree info
3. **Given** a background sub-agent is killed via abort, **When** the kill occurs, **Then** the last meaningful assistant text is extracted as a partial result and included in the notification with status='killed'
4. **Given** a background sub-agent fails with an error, **When** the error occurs, **Then** a notification is enqueued with status='failed' and the structured error message
5. **Given** 3 concurrent background agents in the same process, **When** each emits analytics events, **Then** each event is attributed to the correct agent via AsyncLocalStorage-isolated context — no cross-contamination
6. **Given** a long-running background sub-agent and summarization is enabled, **When** cache-safe params are captured, **Then** periodic summarization starts and summary updates are pushed to AppState
7. **Given** a completed background agent in auto permission mode, **When** the result is returned to the parent, **Then** the handoff classifier reviews the sub-agent's transcript and flags any security-relevant actions

---

### User Story 4 — Sidechain Transcript Isolation (Priority: P4)

Sub-agent messages are recorded to dedicated, isolated transcript files rather than being appended to the parent session's message chain. The parent session receives only the dense `<task_result>` block summarizing the sub-agent's work. Transcripts are organized by agent ID and optionally grouped by workflow run for structured debugging. Transcripts are recorded incrementally (append-only per message) to avoid re-serialization overhead.

**Why this priority**: Sidechain transcripts prevent sub-agent messages from polluting the parent's context window and provide structured debugging artifacts. This is critical for maintaining parent prompt cache efficiency and for observability of complex multi-agent workflows.

**Independent Test**: Can be tested by spawning a sub-agent that produces 50+ messages, verifying the parent's message chain contains only the task result block, and confirming the full transcript exists as a separate file. Delivers value by keeping parent context windows lean and enabling post-hoc debugging of sub-agent behavior.

**Acceptance Scenarios**:

1. **Given** a sub-agent that generates 20 messages during execution, **When** it completes, **Then** the parent session receives exactly one result block and the 20 messages are written to an isolated transcript file
2. **Given** a sub-agent with ID "explore-abc123", **When** messages are recorded, **Then** transcript files are named/organized by agent ID for easy retrieval
3. **Given** a workflow with 3 sequential sub-agent invocations, **When** transcripts are recorded, **Then** each sub-agent's transcript is grouped under the workflow's run directory
4. **Given** a sub-agent that is aborted mid-execution, **When** the abort occurs, **Then** the partial transcript is preserved for debugging and is not deleted

---

### User Story 5 — Context Pruning for Read-Only Agents (Priority: P5)

Read-only agents such as Explore and Plan have heavy, unnecessary context automatically stripped before execution. This includes project-level configuration sections, git status information, and specific system prompt sections that are irrelevant to their read-only purpose. Pruning is controlled by agent configuration flags and can be disabled via a feature flag (kill-switch) for instant rollback.

**Why this priority**: Performance optimization. Read-only agents are spawned frequently (Explore is the most common sub-agent) and sending them the full parent context wastes tokens and increases latency. However, correctness requires the other features to be in place first.

**Independent Test**: Can be tested by spawning an Explore agent with and without pruning, comparing token consumption, and verifying that the pruned agent still answers correctly for read-only queries. Delivers value by reducing per-invocation cost for high-frequency sub-agents.

**Acceptance Scenarios**:

1. **Given** an agent with `omitClaudeMd: true`, **When** the agent's context is constructed, **Then** project configuration content is stripped from the context
2. **Given** a read-only agent, **When** the agent's system context is constructed, **Then** git status information is stripped from the context
3. **Given** pruning is active, **When** the user or a parent agent explicitly provides context override, **Then** the override is respected and pruning does not strip the user-provided context
4. **Given** the pruning feature flag is set to disabled, **When** a read-only agent is spawned, **Then** full context is provided and no pruning occurs

---

### User Story 6 — Dynamic MCP Server Lifecycle (Priority: P6)

Agents declare MCP servers in their configuration. When a sub-agent is spawned, string references resolve to existing project-wide MCP server connections (reusing memoized connections), while inline definitions create new connections scoped to the agent's lifetime. On agent exit, only the newly-created inline connections are cleaned up; shared referenced connections remain active for other agents and the parent session.

**Why this priority**: Extends the agent capability model with dynamic tool discovery. While important for advanced use cases, it builds on the agent configuration system (P2) and context forking (P1) and is not required for the core sub-agent orchestration to function.

**Independent Test**: Can be tested by defining an agent with both a string MCP reference and an inline MCP definition, spawning it, verifying both connections are active during execution, and confirming only the inline connection is cleaned up on exit. Delivers value by enabling agents to bring their own tool ecosystems.

**Acceptance Scenarios**:

1. **Given** an agent configuration declaring `mcpServers: ["existing-server"]`, **When** the agent is spawned, **Then** the system reuses the existing project-wide MCP connection for "existing-server"
2. **Given** an agent configuration with an inline MCP server definition, **When** the agent is spawned, **Then** a new MCP connection is created exclusively for this agent instance
3. **Given** an agent with an inline MCP connection is running, **When** the agent exits (normally or via abort), **Then** the inline MCP connection is terminated and resources are released within 5 seconds
4. **Given** an agent references an MCP server that fails to connect, **When** spawn is attempted, **Then** the agent start fails with a clear error identifying the unavailable MCP server, and no partial connections are leaked
5. **Given** two sub-agents simultaneously reference the same MCP server by string, **When** both are active, **Then** they share the same underlying connection without interference

---

### Edge Cases

- What happens when a sub-agent attempts to spawn its own sub-agent (nested forking)? The system supports arbitrary nesting — each level creates a new fork from its parent's context.
- How does the system handle an MCP server connection failure during agent spawn? Spawn fails fast with a structured error; no partial connections are leaked.
- What happens when a background agent's tool requires permission and silent-deny produces an incorrect result? The agent receives the denial as a tool error and must adapt its approach. The denial is logged for observability.
- How does context pruning interact with agents that explicitly need a pruned section? User-provided context overrides always take precedence over pruning rules.
- What happens when multiple agents reference the same MCP server simultaneously? Shared connections are reused via memoization; lifecycle reference counting ensures cleanup only when no agents remain.
- How does the system handle agent config conflicts between plugin and user settings? Deterministic priority ordering resolves conflicts: later sources override earlier ones field-by-field.
- What happens when a worktree or remote sub-agent crashes or loses connectivity mid-execution? Isolation artifacts (worktree directories, Docker container instances) are preserved for a configurable TTL (~1 hour) for post-mortem debugging, then garbage collected lazily on the next session start. Sidechain transcripts are always preserved regardless of crash state.
- What happens when a background agent spawns its own bash tasks as fire-and-forget? The cleanup lifecycle kills all shell tasks registered under the agent's ID to prevent PPID=1 zombie processes.
- What happens in whale sessions where hundreds of agents have been spawned over time? The cleanup lifecycle removes todos entries and clears invoked skills to prevent unbounded memory growth.
- What happens when an agent declares hooks but the hook source is not admin-trusted? If `isRestrictedToPluginOnly('hooks')` returns true, user-defined agent hooks are blocked from registration. Only plugin and built-in agent hooks are allowed.
- What happens when an agent declares a skill that doesn't exist? `resolveSkillName()` attempts 3 resolution strategies (exact, plugin-prefix, suffix). If all fail, the skill is silently skipped with a debug log.
- What happens when two concurrent background agents emit the same analytics event? AsyncLocalStorage ensures each agent's context is isolated — events are attributed to the correct agent without locking or coordination.
- What happens when a wall-clock timeout fires while a sub-agent is mid-tool-execution (e.g., long shell command, MCP API call)? The abort signal fires immediately with no grace period. Tools must handle `AbortSignal` cooperatively. The partial result extraction mechanism preserves the last meaningful assistant output for the parent.

---

### User Story 7 — Deterministic Cleanup Lifecycle (Priority: P7)

When a sub-agent exits — whether normally, via abort, or due to an error — the system executes a deterministic cleanup sequence in a `finally` block that releases all resources acquired during the agent's execution. This includes MCP connections, session hooks, prompt cache tracking, file state caches, context message references, tracing registrations, transcript mappings, background task entries, and shell processes. The cleanup must be idempotent and must not throw.

**Why this priority**: Without deterministic cleanup, long-running sessions accumulate resource leaks — orphaned MCP connections, stale tracing entries, zombie shell processes, and unbounded memory growth from cached file state. The cleanup lifecycle is the safety net.

**Independent Test**: Can be tested by spawning and killing 100 agents in rapid succession, then verifying zero resource leaks (no orphaned MCP connections, no stale perfetto entries, no zombie processes, memory returns to baseline).

**Acceptance Scenarios**:

1. **Given** a sub-agent with an inline MCP connection exits normally, **When** the finally block runs, **Then** the inline MCP connection is closed and the cleanup function reports success
2. **Given** a sub-agent that registered session hooks exits via abort, **When** the finally block runs, **Then** all agent-scoped hooks are cleared from AppState
3. **Given** a sub-agent that cloned file state cache exits, **When** the finally block runs, **Then** the cloned file state map is cleared and references are released for GC
4. **Given** a sub-agent that spawned background bash tasks exits, **When** the finally block runs, **Then** all shell tasks registered under the agent's ID are killed
5. **Given** 100 agents spawned and killed in rapid succession, **When** all cleanup sequences complete, **Then** process memory returns to within 10% of pre-test baseline and zero zombie processes exist

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST support three distinct agent definition source types (built-in, custom, plugin) with tracked provenance for each loaded agent. Agents declaring `requiredMcpServers` MUST be excluded from the available agent list at load-time when any required server is not connected or has no tools, AND MUST be re-validated at spawn-time to catch servers that disconnected after loading
- **FR-002**: System MUST load agent definitions with deterministic priority ordering: `built-in < plugin < userSettings < projectSettings`, where later sources override earlier ones by agent identifier
- **FR-003**: System MUST support the following agent configuration fields: tool allow/deny lists, skills, MCP server declarations, hooks, model (with `'inherit'` support), effort level, permission mode, maximum turns, wall-clock timeout, memory scopes, background execution flag, isolation mode, context stripping flags (`omitClaudeMd`), critical system reminder, `requiredMcpServers`, `thinking` (boolean, default `false`), and `thinkingBudget` (optional number, tokens)
- **FR-004**: System MUST provide a context forking mechanism that selectively inherits the parent session's state (file state cache, abort controller linkage, app state) while isolating mutable state (tool decisions, messages, set-app-state mutations). Context forking MUST disable `thinkingConfig` by default for all sub-agents to control output token costs, unless the agent definition explicitly sets `thinking: true`, in which case the parent's thinking config is inherited. When `thinkingBudget` is also specified, the inherited thinking config MUST use the agent's budget instead of the parent's (`{ type: 'enabled', budgetTokens: thinkingBudget }`). Context forking MUST also provide a scoped `setAppStateForTasks` root-store bypass exposing only task-specific operations (`registerTask`, `killTask`, `deleteTodo`) — not a full `setAppState` alias — for task registration when `setAppState` is a no-op (nested async agents), and apply effort level overrides from the agent definition at runtime.
- **FR-005**: System MUST link sub-agent abort controllers to the parent's abort controller in a unidirectional hierarchy: parent cancellation propagates to children, but child cancellation does not propagate to the parent
- **FR-006**: System MUST strip heavy context (project configuration, git status, non-essential system prompt sections) from agents configured with context pruning flags
- **FR-007**: System MUST record sub-agent messages to isolated sidechain transcript files, delivering only the dense task result to the parent session's message chain
- **FR-008**: System MUST support incremental (append-only) transcript recording per message to avoid re-serialization of the full transcript on each write
- **FR-009**: System MUST resolve agent-declared MCP servers on spawn: reusing existing connections for string references and creating new scoped connections for inline definitions
- **FR-010**: System MUST clean up agent-scoped (inline) MCP connections on agent exit, including abnormal termination, without affecting shared referenced connections
- **FR-011**: System MUST silently deny permission-requiring operations for sub-agents running as background tasks, returning an immediate denial response rather than blocking
- **FR-012**: System MUST enforce permission mode inheritance where parent elevated modes (`bypass`, `auto`, `accept-edits`) always take precedence over the sub-agent's declared mode
- **FR-013**: When a sub-agent specifies an allowed-tools list, session-level tool permissions MUST be replaced entirely — parent approvals MUST NOT leak through to the sub-agent
- **FR-014**: System MUST support nested sub-agent spawning (sub-agent spawning its own sub-agent) using the same forking model recursively
- **FR-015**: System MUST maintain hierarchical tracing metadata for sub-agent execution trees, recording parent-child relationships for observability
- **FR-016**: System MUST enforce a configurable maximum concurrent sub-agent limit per parent session (default: 5–10), rejecting spawn attempts that exceed the limit with a structured error rather than silently queuing or dropping them
- **FR-017**: System MUST implement `worktree` isolation mode: when an agent declares `isolation: 'worktree'`, the system creates a git worktree for the agent's execution, providing filesystem isolation from the parent session's working directory
- **FR-018**: System MUST implement `remote` isolation mode: when an agent declares `isolation: 'remote'`, the system spawns the agent's execution in a Docker container via the local Docker daemon (CLI/API), providing full process and filesystem isolation
- **FR-019**: System MUST enforce a configurable wall-clock timeout per sub-agent (default: ~30 minutes), triggering an immediate hard-kill abort via the agent's abort controller when exceeded — no grace period for in-flight tool execution. Partial result extraction (FR-023) preserves the last meaningful output. This ensures no sub-agent can run indefinitely regardless of turn count
- **FR-020**: System MUST support a `criticalSystemReminder` configuration field per agent definition that gets re-injected as a `<system-reminder>` attachment on every user turn during the agent's execution, reinforcing the agent's operational mode and behavioral constraints
- **FR-021**: System MUST implement retention-based cleanup for isolation artifacts (worktrees, remote containers): artifacts are preserved for a configurable TTL (default: ~1 hour) after sub-agent exit (normal, crash, or timeout) for post-mortem debugging, then garbage collected lazily on the next session start
- **FR-022**: System MUST distinguish the root agent from sub-agents via the presence of `agentId` on the execution context (`undefined` = root session, `string` = sub-agent). This discriminator MUST gate behaviors that apply only to the root session, including: title generation, stop hooks, MCP lifecycle notifications, attachment filtering (agent listing deltas, date change), compaction notifications, and memory extraction
- **FR-023**: System MUST implement a structured async agent lifecycle manager covering: progress tracking with human-readable activity descriptions, optional periodic summarization for long-running agents, terminal notifications (completed/failed/killed) with usage metrics (tokens, tool calls, duration), handoff classification for auto-mode security review, partial result extraction for killed agents, and prompt cache eviction signaling on completion
- **FR-024**: System MUST isolate agent execution context using `AsyncLocalStorage<AgentContext>` to prevent analytics attribution cross-contamination between concurrent background agents in the same process. Context MUST be wrapped via `runWithAgentContext()` around the entire agent execution and MUST support invocation boundary detection via single-fire `consumeInvokingRequestId()`
- **FR-025**: System MUST execute a deterministic cleanup sequence on agent exit (normal, abort, or error) in a `finally` block covering at minimum: MCP connection cleanup, session hook removal, prompt cache tracking release, file state cache clearing, context message reference release, tracing registry cleanup, transcript subdir mapping cleanup, pending todo entry deletion, shell task killing, and invoked skill state clearing. Cleanup MUST be idempotent and MUST NOT throw.
- **FR-026**: System MUST execute `executeSubagentStartHooks()` at agent spawn time, register agent-declared hooks with `isAgent=true` flag (converting Stop→SubagentStop events), enforce admin-trust gating via `isRestrictedToPluginOnly('hooks')`, and clean up all agent-scoped hooks on exit
- **FR-027**: System MUST preload skills declared in agent frontmatter at spawn time, resolve skill names using namespace-aware lookup (exact match > plugin-prefix match > suffix match), inject loaded skills into the agent's initial messages, and clean up invoked skill state on agent exit

### Key Entities

- **AgentDefinition**: The core definition type representing an agent's identity and configuration. Supports three source variants (built-in, custom, plugin) with a unified configuration surface. Key attributes include agent type identifier, source provenance, expanded configuration fields (tool scoping, skills, MCP servers, model, permissions, execution constraints), and a prompt/instruction payload.
- **SubagentContext**: A forked execution context created when the parent spawns a sub-agent. Encapsulates the isolation model: which parent state is cloned (file cache, content replacement state), which is linked (abort controller), which is wrapped (app state with permission avoidance), and which is fresh (tool decisions, messages). Includes a scoped `setAppStateForTasks` interface limited to task registration/kill/todo operations to prevent full state mutation from nested agents. Lifecycle-bound to the sub-agent's execution.
- **SidechainTranscript**: An isolated, append-only message recording tied to a sub-agent's execution. Identified by agent ID and optionally grouped under a workflow run directory. Persisted to the filesystem independently of the parent session's message chain.
- **AgentMcpSession**: A lifecycle-managed MCP server connection scoped to a single agent's execution. Distinguished between "referenced" connections (shared, not cleaned up) and "inline" connections (agent-scoped, cleaned up on exit). Tracks connection health and cleanup responsibility.
- **AgentMemory**: A filesystem-backed persistent knowledge store scoped to an agent type. Three scope levels (`user`, `project`, `local`) determine storage location and sharing behavior. Contents are injected into the agent's system prompt at spawn time, and Read/Write/Edit tools are auto-injected into the agent's tool pool. Keyed by agent type — orthogonal to session lineage and context forking.
- **AgentExecutionContext**: An `AsyncLocalStorage`-backed execution context that isolates agent identity across concurrent async operations. Discriminated union of `SubagentContext` (for Agent tool spawns, tracking agentId, parentSessionId, subagentName, isBuiltIn, invocation boundary) and `TeammateAgentContext` (for in-process swarm teammates with teamName, agentColor, planModeRequired, isTeamLead). Required because multiple background agents share the same Node.js process — without ALS, analytics events from Agent A would incorrectly use Agent B's context via shared AppState.
- **AsyncAgentLifecycle**: The complete background agent execution lifecycle from spawn to terminal notification. Encompasses progress tracking (tool-to-description mapping), optional summarization (periodic cache-sharing summaries), handoff classification (auto-mode safety review), partial result extraction (for killed agents), cache eviction signaling, and notification enqueueing. Shared between initial spawn and resume paths.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Sub-agents spawn with inherited parent context (file state, app state) in under 100ms for standard configurations, eliminating the cold-start penalty of clean-slate sessions
- **SC-002**: Read-only sub-agents with context pruning enabled consume at least 30% fewer input tokens per invocation compared to full-context sub-agents
- **SC-003**: Background sub-agents never block on permission prompts — all permission-requiring operations resolve (approve or deny) within the sub-agent's turn without user intervention, verified across 100% of test scenarios
- **SC-004**: Agent-scoped MCP connections are cleaned up within 5 seconds of sub-agent exit, with zero leaked connections observed across 1000 sequential spawns in a stress test
- **SC-005**: Parent sessions receive only the dense task result from sub-agents — parent context window growth per sub-agent invocation stays constant regardless of sub-agent transcript length (verified with transcripts of 10, 50, and 200 messages)
- **SC-006**: Agent definition loading with all four source levels merges correctly, verified by 100% of merge-priority test cases passing across all configuration fields
- **SC-007**: After 100 sequential agent spawn-and-exit cycles, process memory returns to within 10% of pre-test baseline, confirming no resource leaks from the cleanup lifecycle
- **SC-008**: Background agents produce terminal notifications within 1 second of reaching a terminal state (completed, failed, killed), with correct usage metrics
- **SC-009**: Three concurrent background agents in the same process emit analytics events with correct agent attribution (zero cross-contamination), verified via AsyncLocalStorage isolation

## Assumptions

- Phase 1 (Unified System Prompt Resolution) is complete and the section-based resolver, `SectionRegistry`, and `SectionParser` are available for sub-agents to construct their system prompts
- The existing session infrastructure (`Session.create`, `Message` types, `SessionProcessor`) will be extended, not replaced, to support context forking
- Agent configuration schema changes are additive — existing `.md` frontmatter that doesn't use new fields continues to work without modification
- **liteai2 agent format compatibility**: Any agent `.md` file from liteai2 MUST work in liteai without modification (copy-paste compatible). New config fields (`thinking`, `thinkingBudget`, etc.) are strictly additive with sensible defaults. The frontmatter parser MUST silently ignore unknown fields to ensure forward compatibility with liteai2 agents that may use fields not yet implemented in liteai
- MCP server infrastructure already exists for project-wide connections; this feature adds per-agent lifecycle management on top of the existing connection pool
- The current permission system (`PermissionNext`) can be extended for sub-agent scoping without a full rewrite
- Nested sub-agent depth is unbounded but practically limited by available context window and token budget (no artificial depth limit is enforced)
- Concurrent sub-agent count per session is bounded by a configurable limit (default 5–10) to prevent resource exhaustion; the limit is enforced at spawn time with a fail-fast rejection
- Memory scopes (`user`, `project`, `local`) define persistence boundaries for agent-scoped data. Memory is keyed by agent type (not session lineage), so context forking does not affect memory access — each agent type reads/writes its own memory independently. The filesystem-backed persistence model (MEMORY.md in scoped directories) is the target implementation
- Isolation modes (`worktree`, `remote`) are fully in-scope for this phase, including runtime implementation of git worktree creation and Docker container spawning via local Docker daemon (CLI/API). Isolation artifacts follow a retention-based cleanup model: preserved for a configurable TTL (~1 hour) for debugging, then garbage collected on next session start
- Fork subagent model (cache-identical context sharing with byte-identical API prefixes) and agent resume from sidechain transcripts are deferred to Phase 4 and are NOT in scope for this phase
- The cleanup lifecycle assumes all resource acquisitions are tracked at acquisition time (e.g., MCP connections in `newlyCreatedClients[]`, hooks via `agentId` key, shell tasks via agent registration). Cleanup of untracked resources is out of scope.
