---
title: Automate with hooks
description: "Use lifecycle, command, HTTP, prompt, and agent hooks to automate workflows in LiteAI."
---

# Automate with hooks

> **Source:** `src/hook/`
> **Last verified against code:** 2026-05-13

Hooks let you run custom logic in response to LiteAI events — tool usage, session lifecycle, permissions, compaction, and more. Hooks are **Claude Code compatible**.

## Configuration

Define hooks in `settings.json` under the `hooks` key. The structure is `event → groups[]`, where each group has an optional `matcher` regex and an array of hook handlers:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "edit|write",
        "hooks": [
          {
            "type": "command",
            "command": "echo 'File modification detected'",
            "timeout": 30
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "http",
            "url": "https://example.com/webhook",
            "headers": { "Authorization": "Bearer ${WEBHOOK_TOKEN}" },
            "allowedEnvVars": ["WEBHOOK_TOKEN"]
          }
        ]
      }
    ]
  }
}
```

:::note
Set `"disableAllHooks": true` in settings to disable all hooks globally.
:::

## Hook types

### Command hooks

Run a shell command when an event fires. The hook input context is piped to stdin as JSON.

```json
{
  "type": "command",
  "command": "bun run my-hook.ts",
  "timeout": 30
}
```

**Exit codes:**
| Code | Behavior |
|---|---|
| `0` | Proceed — stdout added as context |
| `2` | **Blocked** — stderr fed back as feedback, action denied |
| Other | Proceed — stderr is logged but not surfaced |

**Structured output:** If stdout is valid JSON with a `hookSpecificOutput` key, it is parsed for permission decisions (`permissionDecision: "allow" | "deny" | "ask"`).

**Environment variables available to commands:**
- `$LITEAI_PROJECT_DIR` / `$CLAUDE_PROJECT_DIR` — Project working directory
- `$LITEAI_WORKTREE` — Workspace root

### HTTP hooks

Send an HTTP POST request when an event fires:

```json
{
  "type": "http",
  "url": "https://example.com/webhook",
  "headers": { "Authorization": "Bearer ${WEBHOOK_TOKEN}" },
  "allowedEnvVars": ["WEBHOOK_TOKEN"],
  "timeout": 30
}
```

Response handling matches command hooks: JSON with `hookSpecificOutput` is parsed for permission decisions. Non-2xx responses are non-blocking.

:::tip
Use `allowedEnvVars` to restrict which environment variables can be expanded in HTTP headers. Without this, no variables are expanded.
:::

### Prompt hooks

Inject prompt text into the conversation as context:

```json
{
  "type": "prompt",
  "prompt": "Always check for type errors before committing."
}
```

### Agent hooks

Delegate to an agent — currently acts as a prompt passthrough:

```json
{
  "type": "agent",
  "prompt": "Review the changes for security issues."
}
```

## Handler fields

| Field | Type | Default | Description |
|---|---|---|---|
| `type` | `"command" \| "prompt" \| "agent" \| "http"` | Required | Hook handler type |
| `command` | `string` | — | Shell command (type: command) |
| `prompt` | `string` | — | Prompt text (type: prompt/agent) |
| `url` | `string` | — | URL to POST to (type: http) |
| `headers` | `Record<string, string>` | — | HTTP headers (type: http) |
| `allowedEnvVars` | `string[]` | — | Env vars allowed for expansion in headers |
| `timeout` | `number` | `600` | Timeout in **seconds** |
| `statusMessage` | `string` | — | Message shown while hook runs |
| `once` | `boolean` | `false` | Fire only once per session |
| `async` | `boolean` | `false` | Run in background without blocking |

## Group matchers

Each hook group has an optional `matcher` field — a regex pattern that filters when the group fires. For tool events, it matches against the tool name:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "^(edit|write|run_command)$",
        "hooks": [{ "type": "command", "command": "echo 'write op'" }]
      }
    ]
  }
}
```

If `matcher` is omitted, the group fires for all events.

## Lifecycle events

| Event | When it fires | Matcher target |
|---|---|---|
| `PreToolUse` | Before a tool executes | Tool name |
| `PostToolUse` | After a tool completes successfully | Tool name |
| `PostToolUseFailure` | After a tool fails | Tool name |
| `Notification` | When a notification is sent | — |
| `Stop` | The agent loop completes | — |
| `SubagentStart` | A subagent is spawned | — |
| `SubagentStop` | A subagent finishes | — |
| `SessionStart` | A new session begins | — |
| `SessionEnd` | A session is terminated | — |
| `UserPromptSubmit` | User sends a message | — |
| `PreCompact` | Before compaction runs | — |
| `PostCompact` | After compaction completes | — |
| `PermissionRequest` | A permission prompt is shown | Tool name |
| `PrePermissionDeny` | Before a permission denial | Tool name |
| `InstructionsLoaded` | Project instructions loaded | — |
| `ConfigChange` | Configuration changed | — |
| `StopFailure` | Stop hook itself failed | — |
| `TaskCompleted` | Background task completed | — |
| `TeammateIdle` | Coordinator teammate is idle | — |
| `WorktreeCreate` | Git worktree created | — |
| `WorktreeRemove` | Git worktree removed | — |
| `Elicitation` | User prompt elicitation | — |
| `ElicitationResult` | Elicitation result received | — |

## Agent-scoped hooks

Hooks can be defined per-agent in `settings.json`:

```json
{
  "agent": {
    "tester": {
      "hooks": {
        "Stop": [
          {
            "hooks": [
              {
                "type": "command",
                "command": "bun test"
              }
            ]
          }
        ]
      }
    }
  }
}
```

Agent hooks are loaded from the agent's `hooks` field in config and merged with global hooks at dispatch time.

## Hook input context

Every hook receives a JSON input object on stdin (command) or POST body (http):

```json
{
  "session_id": "01JABC...",
  "cwd": "/path/to/project",
  "hook_event_name": "PreToolUse",
  "tool_name": "edit",
  "tool_input": { "file_path": "src/main.ts", "old_string": "...", "new_string": "..." }
}
```

| Field | Present when |
|---|---|
| `session_id` | Always (if session exists) |
| `cwd` | Always |
| `hook_event_name` | Always |
| `tool_name` | Tool events |
| `tool_input` | `PreToolUse` |
| `tool_output` | `PostToolUse` |
| `prompt` | `UserPromptSubmit` |

## What's next?

- [**MCP servers**](/build/mcp) — Connect external tools
- [**Settings reference**](/configuration/settings) — Full hooks schema
