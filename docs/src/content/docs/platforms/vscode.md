---
title: VS Code
description: "Using LiteAI through the VS Code extension — setup, hosted mode, and IDE features."
---

# VS Code

The LiteAI VS Code extension provides a fully integrated AI coding experience within the editor.

## Installation

Install from the VS Code marketplace:

```
ext install liteai.liteai-vscode
```

## Features

- **Chat panel** — Conversational interface in the sidebar
- **Inline completions** — Context-aware code suggestions
- **Diagnostics integration** — Agent uses VS Code diagnostics for error detection
- **Code actions** — AI-powered quick fixes
- **Terminal integration** — Agent can run commands in the VS Code terminal

## Hosted mode

When running inside VS Code, LiteAI uses **Extension Callbacks** instead of HTTP:

| Feature | Local mode (HTTP) | Hosted mode (Extension) |
|---|---|---|
| File I/O | Direct filesystem | VS Code workspace API |
| Terminal | PTY subprocess | VS Code terminal API |
| Diagnostics | LSP client | VS Code diagnostics API |
| Notifications | SSE events | VS Code notification API |

Hosted mode automatically uses the correct capabilities based on the execution environment.

## LSP integration

LiteAI acts as a Language Server, providing:
- Real-time diagnostics
- Hover information
- Go-to-definition
- Code completions

The LSP integration supports 40 language servers for comprehensive language coverage.

## What's next?

- [**Platforms overview**](/platforms/overview) — Feature comparison
- [**Architecture: Transport channels**](/architecture/transport-channels) — How extension callbacks work
