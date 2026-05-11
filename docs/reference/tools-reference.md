---
title: Tools reference
description: "Complete inventory of LiteAI's native tools with descriptions, parameters, and permission levels."
---

# Tools reference

> **Source:** `src/tool/`
> **Last verified against code:** 2026-05-13

LiteAI includes 35+ built-in tools organized by category. The tool pool is assembled at runtime by the `ToolRegistry` and can be filtered by agent configuration, model capabilities, and user settings.

## File operations

| Tool | ID | Description | Permission |
|---|---|---|---|
| **Read** | `read` | Read file or directory contents with pagination (`offset`/`limit`) | Auto-approved |
| **Write** | `write` | Create or overwrite a file | Requires approval |
| **Edit** | `edit` | Edit a specific section of a file via `oldString`→`newString` replacement | Requires approval |
| **Multi-edit** | `multiedit` | Apply multiple sequential edits to one file in a single call | Requires approval |
| **Apply patch** | `apply_patch` | Apply a unified diff patch to create, update, move, or delete files | Requires approval |
| **List** | `list` | List directory tree structure (ignores common build/cache dirs) | Auto-approved |
| **Glob** | `glob` | Find files matching a glob pattern (via ripgrep) | Auto-approved |
| **Grep** | `grep` | Full-text regex search across files (via ripgrep) | Auto-approved |

:::note
`apply_patch` and `edit`/`write`/`multiedit` are mutually exclusive at runtime. The registry selects `apply_patch` for GPT-5+ models and the edit/write tools for all other models.
:::

## Shell

| Tool | ID | Description | Permission |
|---|---|---|---|
| **Run command** | `run_command` | Execute a shell command. Returns inline or backgrounds with a task ID | Requires approval |
| **Command status** | `command_status` | Check status and output of a backgrounded command by task ID | Auto-approved |
| **Send command input** | `send_command_input` | Send stdin input to or terminate a running background process | Requires approval |

The `run_command` tool automatically backgrounds commands that exceed the `WaitMsBeforeAsync` threshold, returning a task ID for use with `command_status` and `send_command_input`.

## Web

| Tool | ID | Description | Permission |
|---|---|---|---|
| **Web fetch** | `webfetch` | Fetch content from a URL (supports text, markdown, HTML, and image formats) | Varies |
| **Web search** | `websearch` | Search the web via Exa (or Google Code Assist when using that provider) | Varies |
| **Code search** | `codesearch` | Semantic code search for API/library documentation via Exa | Varies |

:::note
`codesearch` is registered in the tool source but currently **commented out** in the registry. It may be re-enabled in a future release.
:::

## Memory

| Tool | ID | Description | Permission |
|---|---|---|---|
| **Read memory** | `readMemory` | Read agent memory files | Auto-approved |
| **Write memory** | `writeMemory` | Write a memory file | Auto-approved |
| **Edit memory** | `editMemory` | Edit memory content | Auto-approved |

Memory tools are conditionally loaded — they only appear in the tool pool when auto-memory is enabled via `AgentMemory.isAutoMemoryEnabled()`.

## Planning

| Tool | ID | Description | Permission |
|---|---|---|---|
| **Plan enter** | `plan_enter` | Enter plan mode — agent researches and designs before coding | Requires approval |
| **Plan exit** | `plan_exit` | Exit plan mode by submitting a plan for user approval | Requires approval |

Plan tools support two workflow types:
- **5-phase workflow** — structured subagent-driven planning (default)
- **Interview mode** — iterative pair-planning with the user via the question tool

Plan tools are excluded from the tool pool when `toolProfile` is set to `"Fast"`.

## Task management

| Tool | ID | Description | Permission |
|---|---|---|---|
| **Todo write** | `todowrite` | Create or update the session's todo/checklist | Auto-approved |
| **Skill** | `skill` | Load a specialized skill that provides domain-specific instructions and workflows | Requires approval |

## Agent

| Tool | ID | Description | Permission |
|---|---|---|---|
| **Ask user** | `ask_user` | Ask the user one or more questions (only in app/cli/desktop clients) | Auto-approved |

## Coordinator-only

These tools are only available to coordinator agents in multi-agent (swarm) sessions:

| Tool | ID | Description | Permission |
|---|---|---|---|
| **Task** | `task` | Spawn a worker agent | Coordinator only |
| **Send message** | `send_message` | Send a message to a teammate | Coordinator only |
| **Task stop** | `task_stop` | Stop a worker agent | Coordinator only |
| **Team create** | `team_create` | Create a new team | Coordinator only |
| **Team delete** | `team_delete` | Disband a team | Coordinator only |
| **Yield turn** | `yield_turn` | Pause and wait for workers to complete | Coordinator only |

## LSP

| Tool | ID | Description | Permission |
|---|---|---|---|
| **LSP** | `lsp` | Perform Language Server Protocol operations | Auto-approved |

The LSP tool supports these operations: `goToDefinition`, `findReferences`, `hover`, `documentSymbol`, `workspaceSymbol`, `goToImplementation`, `prepareCallHierarchy`, `incomingCalls`, `outgoingCalls`, `codeAction`, `diagnostics`.

:::note
The LSP tool is registered but currently **commented out** in the registry. LSP diagnostics are still used internally by file editing tools.
:::

## Experimental & special tools

| Tool | ID | Description | Availability |
|---|---|---|---|
| **Batch** | `batch` | Execute multiple tool calls in parallel (up to 25) | Requires `experimental.batch_tool = true` in config |
| **Structured output** | `StructuredOutput` | Return a structured JSON response matching a required schema | Injected only when `json_schema` format is active |

### Batch tool

The batch tool enables parallel execution of native tools. External tools (MCP, environment) cannot be batched — they must be called directly. The batch tool itself cannot be nested.

### Structured output

The `StructuredOutput` tool is intentionally excluded from the default tool pool. It is dynamically injected by the query loop only when a `json_schema` output format is active. The agent must call it exactly once at the end of its response.

## Tool configuration

### Disabling tools

Individual tools can be disabled via `settings.json`:

```json
{
  "disabledTools": {
    "websearch": true,
    "webfetch": true
  }
}
```

### Agent-scoped tools

Agents can restrict their tool pool via the `tools` and `disallowedTools` fields in agent configuration. See [Agent configuration](/build/agents) for details.

### Output truncation

Long tool outputs are automatically truncated to prevent context window exhaustion. The truncation system (`Truncate` namespace) enforces:

- **Max lines:** 2,000
- **Max bytes:** 50 KB

When output is truncated, the full content is saved to `~/.liteai/tool-output/` with a 7-day retention policy. The agent is instructed to use `grep` or `read` with offset/limit to inspect the full output.
