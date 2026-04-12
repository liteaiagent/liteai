# Agent API Contract

**Feature**: 002-subagent-architecture  
**Date**: 2026-04-11  
**Type**: Internal API (consumed by session engine and tools)

## Overview

This contract defines the public interfaces exposed by the sub-agent architecture for consumption by the session engine (`session/engine/`), tool implementations (`tool/`), and the HTTP/SSE server layer (`server/`).

---

## Agent Runner API

### `runAgent(input: RunAgentInput): Promise<RunAgentResult>`

The primary orchestrator for spawning and executing a sub-agent.

```typescript
interface RunAgentInput {
  // Required
  agentDefinition: AgentDefinition    // Resolved agent configuration
  parentContext: ParentContext         // Parent session state for forking
  userMessage: string                 // The task/prompt for the sub-agent

  // Optional overrides
  overrides?: SubagentContextOverrides
  isAsync?: boolean                   // Background execution (default: false)
  worktreeInfo?: WorktreeInfo         // Pre-created worktree (for isolation: "worktree")
}

interface ParentContext {
  sessionId: string
  agentId?: string                    // undefined = root session, string = nested sub-agent
  abortController: AbortController
  readFileState: Map<string, FileStateEntry>
  contentReplacementState: ContentReplacementState
  getAppState: () => AppState
  setAppState: (updater: (state: AppState) => AppState) => void
  model?: { providerID: string; modelID: string } | Provider.Model // Parent's active model
  thinkingConfig?: ThinkingConfig
}

interface RunAgentResult {
  agentId: string
  status: "completed" | "failed" | "killed"
  result: string                      // Dense task result text
  usage: UsageMetrics
  partialResult?: string              // Last meaningful output for killed agents
  error?: Error                       // Present when status=failed
}
```

**Lifecycle guarantee**: `runAgent` always executes the full cleanup sequence, even if the query loop throws or is aborted. The caller receives a `RunAgentResult` in all cases (including abort/timeout).

**Error contract**:
- `ConcurrentAgentLimitError`: Thrown if spawning exceeds the session's concurrent agent limit
- `AgentDisabledError`: Thrown if the agent is disabled
- `McpConnectionError`: Thrown if any required/declared MCP server fails to connect
- `RequiredMcpServerError`: Thrown if `requiredMcpServers` validation fails at spawn-time
- `AgentSpawnError`: Thrown for general spawn failures (e.g., invalid configuration, missing dependencies) not covered by specific error types
- `AgentTimeoutError`: Thrown when the wall-clock timeout fires — wraps the abort reason with the configured timeout duration and agent ID

---

## Context Forking API

### `createSubagentContext(parent: ParentContext, agent: AgentDefinition, overrides?: SubagentContextOverrides): SubagentContext`

Creates an isolated execution context from the parent's state.

**Guarantees**:
- `readFileState` is shallow-cloned (Map entries are shared, Map itself is independent)
- `abortController` is a child of the parent's (unidirectional cancellation)
- `getAppState` wraps the parent's to set `shouldAvoidPermissionPrompts` for background agents
- `setAppState` is a no-op by default (prevents state leaks to parent)
- `toolDecisions` is fresh `undefined` (no parent decisions leak)
- `thinkingConfig` is `undefined` unless agent explicitly sets `thinking: true`
- `setAppStateForTasks` exposes only `registerTask`, `killTask`, `deleteTodo`
- `queryTracking.depth` is incremented from parent's depth

---

## Agent Tool Integration

### Tool: `agent` (registered in tool registry)

The LLM-invocable tool for spawning sub-agents.

```typescript
// Tool input schema
const AgentToolInput = z.object({
  agent: z.string().describe("Agent type to invoke"),
  prompt: z.string().describe("Task description for the agent"),
  background: z.boolean().optional().describe("Run as background task"),
})

// Tool output format
interface AgentToolOutput {
  title: string             // Short summary of result
  output: string            // Full task_result block
  metadata: {
    agentId: string
    agentType: string
    status: "completed" | "failed" | "killed"
    duration: number         // ms
    tokenUsage: number
  }
}
```

---

## Sidechain Transcript API

### `SidechainTranscript.create(agentId: string, sessionId: string, subdir?: string): SidechainTranscript`

Creates a transcript recorder for a sub-agent.

### `SidechainTranscript.recordMessage(message: TranscriptMessage): Promise<void>`

Appends a single message to the transcript file. Fire-and-forget safe — errors are logged but do not propagate.

### `SidechainTranscript.getPath(agentId: string, sessionId: string, subdir?: string): string`

Resolves the transcript file path without creating it.

---

## Permission Sandbox API

### `PermissionSandbox.apply(parent: PermissionContext, agent: AgentDefinition, options: SandboxOptions): PermissionContext`

Creates a sandboxed permission context for a sub-agent.

```typescript
interface SandboxOptions {
  isAsync: boolean                    // Background agent flag
  canShowPermissionPrompts: boolean   // UI interaction availability
}
```

**Behavior rules**:
1. If parent mode is `bypass`/`auto`/`acceptEdits`, parent mode wins (no downgrade)
2. If `isAsync && !canShowPermissionPrompts`, set `shouldAvoidPermissionPrompts: true`
3. If agent specifies `allowedTools`, replace (not merge) session-level rules
4. CLI-level (`cliArg`) rules from SDK `--allowedTools` are always preserved

---

## Agent MCP Lifecycle API

### `initializeAgentMcpServers(agent: AgentDefinition, existingConnections: McpConnectionPool): Promise<AgentMcpSession>`

Resolves and connects agent-declared MCP servers.

### `AgentMcpSession.cleanup(): Promise<void>`

Terminates only inline (agent-scoped) connections. Referenced connections are untouched.

---

## Agent Memory API

### `loadAgentMemoryPrompt(agentType: string, scope: MemoryScope): Promise<string>`

Loads memory content formatted for system prompt injection.

### `injectAgentMemoryTools(agentType: string, scope: MemoryScope, toolPool: ToolSet): ToolSet`

Auto-injects Read/Write/Edit tools scoped to the agent's memory directory.

---

## Cleanup API

### `AgentCleanup.execute(context: SubagentContext, resources: AcquiredResources): Promise<void>`

Executes the deterministic 12-step cleanup sequence. **Must not throw** — each step is wrapped in try-catch.

```typescript
interface AcquiredResources {
  mcpSession?: AgentMcpSession        // Step 1: MCP cleanup
  hookRegistrations?: string[]        // Step 2: Session hooks
  cacheTracking?: string              // Step 3: Prompt cache
  // Steps 4-12 are derived from SubagentContext fields
}
```

**Cleanup order**:
1. MCP connection cleanup
2. Session hook removal (`clearSessionHooks(agentId)`)
3. Prompt cache tracking release
4. File state cache clear
5. Context message reference release
6. Perfetto tracing unregister
7. Transcript subdir mapping cleanup
8. Pending todo entry deletion
9. Shell task killing
10. Monitor MCP task cleanup (feature-gated)
11. Invoked skill state clearing
12. Debug dump state clearing

---

## Event Bus Events

New events published via the `Bus` system:

```typescript
const AgentEvent = {
  Spawned: BusEvent.define("agent.spawned", z.object({
    agentId: z.string(),
    agentType: z.string(),
    parentId: z.string(),        // Parent agentId or sessionId
    isAsync: z.boolean(),
  })),

  Completed: BusEvent.define("agent.completed", z.object({
    agentId: z.string(),
    agentType: z.string(),
    status: z.enum(["completed", "failed", "killed"]),
    duration: z.number(),
    usage: z.object({
      totalTokens: z.number(),
      toolCalls: z.number(),
      duration: z.number(),
    }),
  })),

  Progress: BusEvent.define("agent.progress", z.object({
    agentId: z.string(),
    activity: z.string(),
  })),
}
```
