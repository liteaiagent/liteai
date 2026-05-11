---
title: Programmatic usage
description: "Use the LiteAI SDK to create sessions, send messages, and process responses programmatically."
---

# Programmatic usage

LiteAI can be used programmatically via the `@liteai/sdk` package or directly through the HTTP API.

## SDK usage

```typescript
import { LiteAI } from '@liteai/sdk'

const client = new LiteAI({
  baseUrl: 'http://localhost:3000',
})

// Create a session
const session = await client.sessions.create({
  projectId: 'my-project',
  model: 'claude-sonnet-4-20250514',
})

// Send a message
const response = await client.sessions.sendMessage(session.id, {
  content: 'Explain the authentication flow in this project.',
})

// Stream the response
for await (const event of response.stream()) {
  if (event.type === 'text_delta') {
    process.stdout.write(event.content)
  }
}
```

## Headless mode

Run LiteAI non-interactively for automation:

```bash
liteai --headless --message "Run all tests and fix any failures" --output results.md
```

## HTTP API

For direct API usage without the SDK:

```bash
# Create session
curl -X POST http://localhost:3000/session \
  -H "Content-Type: application/json" \
  -d '{"projectId": "my-project"}'

# Send message
curl -X POST http://localhost:3000/session/<id>/message \
  -H "Content-Type: application/json" \
  -d '{"content": "Your prompt here"}'

# Stream events
curl -N http://localhost:3000/session/<id>/events
```

## What's next?

- [**Push external events**](/build/external-events) — Inject context into sessions
- [**Channels reference**](/reference/channels-reference) — Full API documentation
