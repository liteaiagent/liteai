---
title: Automate with hooks
description: "Use lifecycle, command, and HTTP hooks to automate workflows in LiteAI."
---

# Automate with hooks

Hooks let you run custom logic in response to LiteAI events — session starts, turn completions, tool executions, and more.

## Configuration

Define hooks in `settings.json`:

```json
{
  "hooks": {
    "onSessionStart": [
      {
        "command": "echo 'Session started'",
        "type": "shell"
      }
    ],
    "onTurnComplete": [
      {
        "url": "http://localhost:8080/webhook",
        "type": "http",
        "method": "POST"
      }
    ]
  }
}
```

## Hook types

### Shell hooks

Run a shell command when an event fires:

```json
{
  "command": "bun test",
  "type": "shell",
  "timeout": 30000
}
```

### HTTP hooks

Send an HTTP request when an event fires:

```json
{
  "url": "https://example.com/webhook",
  "type": "http",
  "method": "POST",
  "headers": { "Authorization": "Bearer ${WEBHOOK_TOKEN}" }
}
```

## Lifecycle events

| Event | When it fires |
|---|---|
| `onSessionStart` | A new session begins |
| `onSessionEnd` | A session is terminated |
| `onTurnStart` | The agent begins processing a turn |
| `onTurnComplete` | The agent finishes processing a turn |
| `onToolExecute` | A tool is executed |
| `onError` | An error occurs during processing |

## Agent-scoped hooks

Hooks can be scoped to specific agents:

```json
{
  "hooks": {
    "onTurnComplete": [
      {
        "command": "bun test",
        "type": "shell",
        "agents": ["tester"]
      }
    ]
  }
}
```

## What's next?

- [**Hooks reference**](/reference/hooks-reference) — Full hook API
- [**Push external events**](/build/external-events) — Inject events into sessions
