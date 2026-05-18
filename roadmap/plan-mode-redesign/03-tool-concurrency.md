# Phase 5: Tool Concurrency Redesign

> **Goal**: Redesign the `StreamingToolExecutor` from a passive monitoring layer into an active dispatch engine with per-tool concurrency classification and narrowly-scoped error propagation.

---

## Current State Analysis

### LiteAI's Current Design (`streaming-tool-executor.ts`)

**Architecture**: Passive monitoring layer (line 186: "Always forward the event to the persister — the executor is a monitoring/tracking layer, not an interceptor")

**Concurrency classification**: Static hardcoded Set

```typescript
// streaming-tool-executor.ts:11
const CONCURRENT_SAFE_TOOLS = new Set([
  "glob", "grep", "read", "ls", "websearch", "webfetch", "codesearch", "lsp"
])
```

**Missing from the set** (should be concurrent-safe):
- `agent` — ALL agent calls should be safe (they delegate permission to underlying tools)
- `run_command` — when read-only (git log, ls, find, etc.)
- `command_status` — pure status check, no side effects
- `send_command_input` — sends input to existing command
- `send_message` — sends message to another agent
- `question` — asks user a question (UI operation, no system mutation)
- `plan_enter` — spawns subagent (isolated session)
- `plan_exit` — permission mode switch

**Sibling abort** (lines 169-173): ANY non-concurrent-safe tool error aborts ALL siblings:
```typescript
if (!tool.isConcurrencySafe) {
  this.hasErrored = true
  this.siblingAbortController.abort("sibling_error")
}
```

**No execution gating**: The AI SDK starts ALL tool calls concurrently via `Promise.allSettled`. The executor can't prevent a tool from starting — it can only observe and propagate errors.

**`siblingAbortController`** (lines 64-73):
- Child `AbortController` of the parent query's `AbortController`
- Aborting it does NOT abort the parent query — just kills sibling tools
- Connected to parent: `abort.addEventListener("abort", () => this.siblingAbortController.abort("parent_abort"))`
- Exposed via `get siblingAbortSignal()` — BUT this signal is **not actually consumed by any tool** (checked: only `query.ts:556` reads `hasSiblingError()` for logging)

### Critical Gap: siblingAbortSignal is unused

The `siblingAbortSignal` getter exists (line 215) but grep shows it's NEVER consumed by any tool's execute callback. This means:
1. Sibling abort is **tracked** but not **enforced** on the tool execution side
2. The AI SDK continues running all parallel tool callbacks regardless
3. The only effect is that `hasSiblingError()` returns true, logged at line 556 of `query.ts`
4. This is purely observational — a significant design gap

---

## Claude Code's Design (`services/tools/StreamingToolExecutor.ts`)

### Per-tool `isConcurrencySafe(input)` method

Every tool defines its own concurrency safety as a **method that receives the parsed input**:

```typescript
// Tool.ts:402 — interface definition
isConcurrencySafe(input: z.infer<Input>): boolean

// Tool.ts:759 — default (all tools not explicitly marked = unsafe)
isConcurrencySafe: (_input?: unknown) => false
```

**Claude Code's concurrency-safe tools (complete list)**:

| Tool | `isConcurrencySafe()` | Notes |
|------|----------------------|-------|
| `AgentTool` | `return true` | Always safe — delegates permission to underlying tools |
| `BashTool` | `return this.isReadOnly?.(input) ?? false` | **Input-aware**: only safe if command is read-only |
| `GrepTool` | `return true` | |
| `GlobTool` | `return true` | |
| `FileReadTool` | `return true` | |
| `LSPTool` | `return true` | |
| `WebSearchTool` | `return true` | |
| `WebFetchTool` | `return true` | |
| `TaskCreateTool` | `return true` | |
| `TaskListTool` | `return true` | |
| `TaskGetTool` | `return true` | |
| `TaskUpdateTool` | `return true` | |
| `TaskStopTool` | `return true` | |
| `EnterPlanModeTool` | `return true` | Plan lifecycle is safe |
| `ExitPlanModeV2Tool` | `return true` | |
| `ConfigTool` | `return true` | |
| `BriefTool` | `return true` | |
| `SyntheticOutputTool` | `return true` | |
| `CronListTool` | `return true` | |
| `ToolSearchTool` | `return true` | |
| `RemoteTriggerTool` | `return true` | |
| `ReadMcpResourceTool` | `return true` | |
| `ListMcpResourcesTool` | `return true` | |
| `FileEditTool` | default (`false`) | Write operation |
| `FileWriteTool` | default (`false`) | Write operation |
| `McpAuthTool` | explicit `false` | Auth mutation |
| All others (not listed) | default (`false`) | |

### Active queue-based dispatch

Unlike LiteAI, Claude Code's executor **controls when tools start**:

```typescript
// StreamingToolExecutor.ts:129-134
private canExecuteTool(isConcurrencySafe: boolean): boolean {
  const executingTools = this.tools.filter(t => t.status === 'executing')
  return (
    executingTools.length === 0 ||
    (isConcurrencySafe && executingTools.every(t => t.isConcurrencySafe))
  )
}

// StreamingToolExecutor.ts:140-151
private async processQueue(): Promise<void> {
  for (const tool of this.tools) {
    if (tool.status !== 'queued') continue
    if (this.canExecuteTool(tool.isConcurrencySafe)) {
      await this.executeTool(tool)
    } else {
      // Can't execute this tool yet — maintain order for non-concurrent tools
      if (!tool.isConcurrencySafe) break
    }
  }
}
```

**Rules**:
1. Concurrent-safe tools can execute in parallel with other concurrent-safe tools
2. Non-concurrent tools must execute alone (exclusive access)
3. When a non-concurrent tool is queued, it blocks ALL subsequent tools (even concurrent-safe ones after it)
4. When concurrent-safe tools are queued after a non-concurrent one, they can skip ahead ONLY if they come BEFORE the non-concurrent tool in order

### Narrowly-scoped sibling abort

Only **BashTool errors** trigger sibling abort:

```typescript
// StreamingToolExecutor.ts:354-363
if (isErrorResult) {
  thisToolErrored = true
  // Only Bash errors cancel siblings. Bash commands often have implicit
  // dependency chains (e.g. mkdir fails → subsequent commands pointless).
  // Read/WebFetch/etc are independent — one failure shouldn't nuke the rest.
  if (tool.block.name === BASH_TOOL_NAME) {
    this.hasErrored = true
    this.erroredToolDescription = this.getToolDescription(tool)
    this.siblingAbortController.abort('sibling_error')
  }
}
```

### Per-tool abort controller

Each tool gets its own child abort controller:

```typescript
// StreamingToolExecutor.ts:301-318
const toolAbortController = createChildAbortController(this.siblingAbortController)
toolAbortController.signal.addEventListener('abort', () => {
  // If aborted by sibling error, DON'T bubble up to parent query
  if (
    toolAbortController.signal.reason !== 'sibling_error' &&
    !this.toolUseContext.abortController.signal.aborted &&
    !this.discarded
  ) {
    // Permission rejection → bubble up to parent to end the turn
    this.toolUseContext.abortController.abort(toolAbortController.signal.reason)
  }
}, { once: true })
```

This creates a hierarchy:
```
Parent Query AbortController
  └── siblingAbortController (fires on BashTool error)
       ├── toolAbortController for tool A
       ├── toolAbortController for tool B
       └── toolAbortController for tool C
```

### Interrupt behavior per tool

```typescript
// StreamingToolExecutor.ts:233-241
private getToolInterruptBehavior(tool: TrackedTool): 'cancel' | 'block' {
  const definition = findToolByName(this.toolDefinitions, tool.block.name)
  if (!definition?.interruptBehavior) return 'block'
  try {
    return definition.interruptBehavior()
  } catch {
    return 'block'
  }
}
```

When user presses ESC (sends "interrupt" reason):
- `cancel` tools → get synthetic error, stop immediately
- `block` tools → keep running, user can't type until they finish

---

## Proposed LiteAI Redesign

### 5A. Per-tool `isConcurrencySafe` method

Add `isConcurrencySafe` to the tool definition interface:

```typescript
// tool/types.ts (or wherever ToolDefinition is defined)
interface ToolDefinition {
  // ... existing fields
  
  /**
   * Whether this tool can safely execute concurrently with other concurrent-safe tools.
   * Receives the parsed input so the decision can be input-aware (e.g., bash read-only).
   * Default: false (exclusive execution).
   */
  isConcurrencySafe?: (input: unknown) => boolean
}
```

**LiteAI's proposed concurrent-safe tools**:

| Tool | `isConcurrencySafe()` | Rationale |
|------|----------------------|-----------|
| `agent` | `return true` | Always — delegates to subagent's own tools |
| `run_command` | Input-aware: `return isReadOnlyCommand(input.command)` | Read-only bash (git log, ls, find, cat) is safe |
| `command_status` | `return true` | Pure status check |
| `send_command_input` | `return true` | Sends to existing process |
| `send_message` | `return true` | Inter-agent communication |
| `question` / `ask_user` | `return true` | UI operation |
| `plan_enter` | `return true` | Spawns isolated subagent |
| `plan_exit` | `return true` | Permission mode switch |
| `glob` | `return true` | Read-only |
| `grep` | `return true` | Read-only |
| `read` | `return true` | Read-only |
| `ls` | `return true` | Read-only |
| `websearch` | `return true` | External fetch |
| `webfetch` | `return true` | External fetch |
| `codesearch` | `return true` | Read-only |
| `lsp` | `return true` | Read-only |
| `edit` | `return false` | Write — exclusive |
| `write` | `return false` | Write — exclusive |
| `multiedit` | `return false` | Write — exclusive |
| `apply_patch` | `return false` | Write — exclusive |

### 5B. StreamingToolExecutor → Active Dispatch

Transform from monitoring layer to active dispatch engine. Two options:

#### Option A: Queue-based dispatch (Claude Code model)

The executor manages a queue and controls when tools start:

```typescript
class StreamingToolExecutor {
  private queue: TrackedTool[] = []
  
  addTool(toolCall: ToolCall): void {
    const isSafe = this.resolveIsConcurrencySafe(toolCall)
    this.queue.push({ ...toolCall, status: 'queued', isConcurrencySafe: isSafe })
    void this.processQueue()
  }
  
  private canExecuteTool(isSafe: boolean): boolean {
    const executing = this.queue.filter(t => t.status === 'executing')
    return executing.length === 0 || (isSafe && executing.every(t => t.isConcurrencySafe))
  }
  
  private async processQueue(): Promise<void> {
    for (const tool of this.queue) {
      if (tool.status !== 'queued') continue
      if (this.canExecuteTool(tool.isConcurrencySafe)) {
        this.executeTool(tool)  // fire-and-forget
      } else if (!tool.isConcurrencySafe) {
        break  // non-concurrent tool blocks subsequent tools
      }
    }
  }
}
```

**Challenge**: LiteAI uses AI SDK which handles tool execution internally via `execute()` callbacks. The executor doesn't control when tools start — AI SDK does.

#### Option B: AI SDK integration layer (adapted for LiteAI's architecture)

Since AI SDK starts all tool calls concurrently, the executor can't prevent execution. Instead:

1. **Classify at registration time** — when `start/tool` event arrives, determine `isConcurrencySafe`
2. **Gate via per-tool abort controllers** — for non-concurrent tools that shouldn't run in parallel, abort them if a concurrent constraint is violated
3. **Track and log** — monitor execution patterns for debugging

```typescript
class StreamingToolExecutor {
  private tools: TrackedTool[] = []
  private siblingAbortController: AbortController
  private perToolAbortControllers = new Map<string, AbortController>()
  
  registerTool(event: StartEvent): void {
    const isSafe = this.resolveIsConcurrencySafe(event.toolName)
    // Create per-tool abort controller (child of sibling controller)
    const toolAbort = new AbortController()
    this.siblingAbortController.signal.addEventListener('abort', 
      () => toolAbort.abort(this.siblingAbortController.signal.reason), 
      { once: true }
    )
    this.perToolAbortControllers.set(event.id, toolAbort)
    this.tools.push({ ...event, isConcurrencySafe: isSafe })
  }
  
  getToolAbortSignal(toolId: string): AbortSignal {
    return this.perToolAbortControllers.get(toolId)!.signal
  }
}
```

**Recommendation**: Start with **Option B** (AI SDK integration layer) since it requires minimal changes to the existing architecture. Option A requires deeper AI SDK integration that may not be possible without forking the SDK.

### 5C. Sibling Abort Scope Narrowing

Replace the blanket "all non-concurrent tools abort siblings" with targeted abort:

```typescript
// Current (LiteAI): ANY non-concurrent error → abort all
if (!tool.isConcurrencySafe) {
  this.siblingAbortController.abort("sibling_error")
}

// Proposed: ONLY catastrophic errors abort siblings
private shouldAbortSiblings(tool: TrackedTool): boolean {
  // Bash/command errors may have dependency chains
  if (tool.toolName === 'run_command') return true
  // Agent errors are isolated — one failing explore shouldn't kill others
  if (tool.toolName === 'agent') return false
  // Write tool errors should abort siblings (filesystem consistency)
  if (['edit', 'write', 'multiedit', 'apply_patch'].includes(tool.toolName)) return true
  // Everything else: don't abort
  return false
}
```

### 5D. Parallel Agent Execution

With the concurrency redesign, parallel agents work naturally:

```
Model turn emits: agent("explore", "check API") + agent("explore", "check DB") + agent("explore", "check UI")
  │
  ├─ AI SDK starts all 3 execute() callbacks concurrently
  ├─ StreamingToolExecutor classifies all as isConcurrencySafe: true
  ├─ Each calls SessionPrompt.runSubagent() — blocks independently
  ├─ 3 separate sessions run in parallel
  ├─ If explore_2 errors → isConcurrencySafe: true → NO sibling abort
  ├─ explore_1 and explore_3 continue unaffected
  ├─ All 3 return results
  └─ AI SDK collects all 3 results into next turn
```

**Prompt update** — add to `liteai.md` (root agent prompt):

```markdown
## Parallel Exploration
When you need to explore multiple aspects of the codebase, launch multiple `agent("explore", ...)` 
calls in a SINGLE turn. They execute concurrently for maximum speed.

Example — exploring a feature that touches 3 layers:
```
agent("explore", "Analyze the API route handlers for user authentication")
agent("explore", "Examine the database schema and migration files for user tables")
agent("explore", "Review the React components for the login/signup UI")
```
All three run in parallel. You'll receive all results at once in your next turn.
```

---

## Code References

| File | Lines | What |
|------|-------|------|
| `d:\liteai\packages\core\src\session\engine\streaming-tool-executor.ts` | 1-274 | LiteAI's current executor (full file) |
| `d:\claude-code\src\services\tools\StreamingToolExecutor.ts` | 1-531 | Claude Code's active dispatch executor |
| `d:\claude-code\src\services\tools\toolOrchestration.ts` | 1-175 | Claude Code's `runToolsConcurrently` with max concurrency |
| `d:\claude-code\src\Tool.ts` | 402, 709, 750, 759 | `isConcurrencySafe` interface + default |
| `d:\claude-code\src\tools\AgentTool\AgentTool.tsx` | 1273-1275 | Agent tool: `isConcurrencySafe() { return true }` |
| `d:\claude-code\src\tools\BashTool\BashTool.tsx` | 434-436 | Bash tool: input-aware concurrency |
| `d:\liteai\packages\core\src\session\engine\query.ts` | 556 | Only consumer of `hasSiblingError()` (logging only) |

## Deliverables

- Per-tool `isConcurrencySafe()` method on all tool definitions
- `StreamingToolExecutor` upgraded with per-tool abort controllers
- Sibling abort scoped to catastrophic errors only (bash, write tools)
- Parallel agent execution verified (3 explore agents, no cross-abort)
- Root agent prompt updated to encourage parallel explore calls
