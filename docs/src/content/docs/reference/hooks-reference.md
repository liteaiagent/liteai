---
title: Hooks reference
description: "Complete hook API — event types, configuration, and lifecycle phases."
---

# Hooks reference

## Event types

| Event | Trigger | Payload |
|---|---|---|
| `onSessionStart` | Session created | `{ sessionId, projectId }` |
| `onSessionEnd` | Session terminated | `{ sessionId, reason }` |
| `onTurnStart` | Agent begins a turn | `{ sessionId, turnNumber }` |
| `onTurnComplete` | Agent finishes a turn | `{ sessionId, turnNumber, toolCalls }` |
| `onToolExecute` | Tool executed | `{ sessionId, tool, args, result }` |
| `onError` | Error occurred | `{ sessionId, error }` |

## Hook types

### Shell

```json
{
  "command": "bun test",
  "type": "shell",
  "timeout": 30000,
  "cwd": "./",
  "env": { "CI": "true" }
}
```

### HTTP

```json
{
  "url": "https://example.com/webhook",
  "type": "http",
  "method": "POST",
  "headers": { "Authorization": "Bearer ${TOKEN}" },
  "timeout": 10000
}
```

## Configuration

```json
{
  "hooks": {
    "<event>": [
      { "type": "shell", "command": "..." },
      { "type": "http", "url": "..." }
    ]
  }
}
```

Multiple hooks per event are supported and execute in order.
