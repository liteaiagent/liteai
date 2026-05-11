---
title: Web UI
description: "Using LiteAI through the browser-based web interface."
---

# Web UI

LiteAI includes a web-based interface for browser-based interaction.

## Setup

1. Start the LiteAI server:

```bash
liteai --port 3000
```

2. Open your browser to `http://localhost:3000`

The Web UI connects to the running server via HTTP/SSE.

## Features

- **Multi-session tabs** — Run multiple conversations simultaneously
- **Real-time streaming** — See responses as they're generated
- **Permission prompts** — Approve/deny tool actions in the browser
- **File preview** — View files the agent is working with
- **Session history** — Browse and resume past sessions

## Configuration

The Web UI uses the same configuration as the CLI — all settings from `settings.json` and environment variables apply.

## CORS

When accessing the Web UI from a different origin, ensure CORS is configured:

```json
{
  "cors": {
    "origins": ["http://localhost:5173"]
  }
}
```

## What's next?

- [**Platforms overview**](/platforms/overview) — Feature comparison
- [**Remote control**](/platforms/remote-control) — Access from other devices
