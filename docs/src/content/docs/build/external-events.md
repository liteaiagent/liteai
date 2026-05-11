---
title: Push external events
description: "Inject context, messages, and tool results into running LiteAI sessions via the API."
---

# Push external events

LiteAI's HTTP API lets external systems inject messages, context, and events into running sessions.

## Send a message to a session

```bash
curl -X POST http://localhost:3000/session/<id>/message \
  -H "Content-Type: application/json" \
  -d '{"content": "The CI pipeline just failed on the auth module."}'
```

## Subscribe to session events

```bash
curl -N http://localhost:3000/session/<id>/events
```

Returns an SSE stream with events:
- `text_delta` — Incremental response text
- `tool_use` — Tool call started/completed
- `permission_request` — Permission prompt
- `message_complete` — Response finished

## Use cases

| Scenario | API usage |
|---|---|
| CI/CD failure notification | POST message with error context |
| File watcher | POST message when files change |
| Custom UI | Subscribe to SSE events |
| Chatbot integration | POST messages, subscribe to responses |

## What's next?

- [**Programmatic usage**](/build/programmatic-usage) — SDK for building on LiteAI
- [**Channels reference**](/reference/channels-reference) — Full API endpoint listing
