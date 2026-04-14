# Tools Architecture — liteai_cli_mvp

> Source: `~\Documents\workspace\liteai_cli_mvp\src\tools.ts`, `src\Tool.ts`, `src\constants\prompts.ts`

---

## Overview

liteai_cli_mvp has a **40+ tool ecosystem** with feature-flag gating, deny-rule filtering, REPL mode hiding, permission-aware assembly, and MCP tool merging. Each tool is a self-contained module with its own prompt, implementation, and UI components.

---

## 1. Tool Registration & Discovery

**Source:** [`tools.ts`](../../liteai_cli_mvp/src/tools.ts)

### `getAllBaseTools()` — The Source of Truth

Every tool is registered in a single function. Tools are conditionally included based on:

| Condition | Examples |
|---|---|
| `feature('FLAG')` | SleepTool, BriefTool, WorkflowTool, MonitorTool |
| `process.env.USER_TYPE === 'ant'` | REPLTool, ConfigTool, TungstenTool |
| Runtime checks | `isWorktreeModeEnabled()`, `isAgentSwarmsEnabled()`, `isTodoV2Enabled()` |
| Always included | BashTool, FileReadTool, FileEditTool, FileWriteTool, AgentTool, SkillTool |

### Dead-Code Elimination (DCE)

For feature-gated tools, liteai_cli_mvp uses lazy `require()` inside `feature()` guards:

```ts
const SleepTool = feature('PROACTIVE') || feature('KAIROS')
  ? require('./tools/SleepTool/SleepTool.js').SleepTool
  : null
```

The bundler constant-folds `feature()` calls, so in external builds the `require()` arm is completely eliminated. **This prevents dead code from shipping.**

---

## 2. Tool Pipeline

### Assembly Chain

```
getAllBaseTools()                     ← All possible tools
  → getTools(permissionContext)      ← Filter: isEnabled() + deny rules + REPL filtering
    → assembleToolPool(perms, mcp)   ← Merge with MCP tools, dedup, sort for cache stability
```

### Deny Rule Filtering

```ts
export function filterToolsByDenyRules(tools, permissionContext) {
  return tools.filter(tool => !getDenyRuleForTool(permissionContext, tool))
}
```

Blanket deny rules (no `ruleContent`) strip tools **before the model sees them** — not just at call time.

### MCP Tool Merging

```ts
export function assembleToolPool(permissionContext, mcpTools): Tools {
  const builtInTools = getTools(permissionContext)
  const allowedMcpTools = filterToolsByDenyRules(mcpTools, permissionContext)
  
  // Sort each partition for prompt-cache stability
  // Built-ins stay as contiguous prefix (cache breakpoint after last built-in)
  // uniqBy preserves insertion order — built-ins win on name conflict
  return uniqBy(
    [...builtInTools].sort(byName).concat(allowedMcpTools.sort(byName)),
    'name',
  )
}
```

---

## 3. Tool Prompt System

**Source:** [`prompts.ts`](../../liteai_cli_mvp/src/constants/prompts.ts)

### System Prompt Structure

The system prompt is composed of **sections** — both static (cached) and dynamic:

```
┌─────────────────────────────────────────┐
│   Static Sections (cacheable globally)  │
│   ├── Intro (identity + cyber risk)     │
│   ├── System (formatting, hooks)        │
│   ├── Doing Tasks (code style)          │
│   ├── Executing Actions (risk guidance) │
│   ├── Using Your Tools (tool guidance)  │
│   ├── Tone and Style                    │
│   └── Output Efficiency                 │
├─── SYSTEM_PROMPT_DYNAMIC_BOUNDARY ──────┤
│   Dynamic Sections (per-session)        │
│   ├── Session-specific guidance         │
│   ├── Memory (CLAUDE.md)                │
│   ├── Environment info                  │
│   ├── Language preference               │
│   ├── Output style                      │
│   ├── MCP instructions (uncached!)      │
│   ├── Scratchpad instructions           │
│   ├── Function result clearing          │
│   └── Brief/Kairos section              │
└─────────────────────────────────────────┘
```

### Tool-Aware Prompt Sections

The `getUsingYourToolsSection()` dynamically generates guidance based on which tools are enabled:

```ts
function getUsingYourToolsSection(enabledTools: Set<string>): string {
  // Tells the model to prefer dedicated tools over Bash:
  // - FileReadTool instead of cat
  // - FileEditTool instead of sed
  // - FileWriteTool instead of heredoc
  // - GlobTool instead of find
  // - GrepTool instead of grep
  // - Reserve Bash for system commands only
}
```

### Agent-Specific Enhancement

Sub-agents get a modified prompt via `enhanceSystemPromptWithEnvDetails()`:

```ts
const notes = `Notes:
- Agent threads always have their cwd reset between bash calls — use absolute file paths only.
- In your final response, share file paths (always absolute). Include code snippets only when the exact text is load-bearing.
- Avoid emojis.
- Do not use a colon before tool calls.`
```

---

## 4. Tool Interface

Each tool implements the `Tool` interface:

```ts
interface Tool {
  name: string
  description: string | (() => Promise<string>)
  inputSchema: JSONSchema
  isEnabled: () => boolean
  
  // Permission & UI
  isReadOnly?: () => boolean
  needsPermissions?: (input: unknown) => boolean
  
  // Execution
  call: (input: unknown, context: ToolUseContext) => Promise<ToolResult>
  
  // MCP metadata (for MCP-originated tools)
  mcpInfo?: { serverName: string; toolName: string }
}
```

---

## 5. Key Tool Categories

### File Operations
- `Read`, `Edit`, `Write`, `NotebookEdit`

### Search & Navigation
- `Glob` — file search (replaces `find`)
- `Grep` — content search (replaces `grep`)
- Embedded search: ant-only `bfs`/`ugrep` aliases that hide these tools

### Agent & Task
- `AgentTool` — spawn sub-agents/forks
- `TaskCreateTool`, `TaskGetTool`, `TaskUpdateTool`, `TaskListTool` — todo v2
- `TodoWriteTool` — legacy todo
- `TaskStopTool` — terminate running tasks
- `TaskOutputTool` — view task output

### Plan Mode
- `EnterPlanModeTool`, `ExitPlanModeV2Tool`

### Execution
- `BashTool` — shell commands
- `REPLTool` — sandbox VM execution (ant-only)
- `PowerShellTool` — Windows shell

### Communication
- `AskUserQuestionTool` — structured questions
- `SendMessageTool` — peer-to-peer messaging
- `PushNotificationTool` — push notifications (Kairos)

### MCP & Resources
- `ListMcpResourcesTool`, `ReadMcpResourceTool`
- `ToolSearchTool` — dynamic tool discovery

### Skills
- `SkillTool` — execute registered skills

### Specialized (Feature-Gated)
- `BriefTool` — Kairos brief generation
- `SleepTool` — Kairos sleep/wake cycles
- `WorkflowTool` — workflow script execution
- `MonitorTool` — monitoring
- `CronCreateTool`, `CronDeleteTool`, `CronListTool` — scheduled triggers
- `SnipTool` — history snipping
- `WebBrowserTool` — browser automation
- `TerminalCaptureTool` — terminal panel

---

## Comparison: liteai vs liteai_cli_mvp (Tools)

| Dimension | liteai | liteai_cli_mvp |
|---|---|---|
| Tool count | ~15 tools | 40+ tools |
| Registration | Static array | Conditional DCE-enabled registration |
| Deny rules | Not implemented | Pre-model filtering via deny-rule matcher |
| MCP merging | Static concat | Sorted + deduped for cache stability |
| Prompt guidance | Bundled prompt files | Dynamic sections based on enabled tool set |
| REPL mode | Not implemented | Hides primitive tools behind VM sandbox |
| Feature gating | Environment variables | Build-time `feature()` + runtime `isEnabled()` |
