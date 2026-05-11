---
title: Platforms overview
description: "Where LiteAI runs — CLI, Web UI, VS Code, and remote access."
---

# Platforms overview

LiteAI runs on multiple platforms through different transport channels. The core engine is the same — only the client interface changes.

## Platform matrix

| Feature | CLI / TUI | Web UI | VS Code | Remote |
|---|:---:|:---:|:---:|:---:|
| Interactive chat | ✅ | ✅ | ✅ | ✅ |
| File editing | ✅ | ✅ | ✅ | ✅ |
| Terminal commands | ✅ | ✅ | ✅ | ✅ |
| Plan mode | ✅ | ✅ | ✅ | ✅ |
| Coordinator mode | ✅ | ✅ | ✅ | ✅ |
| Checkpointing | ✅ | ✅ | ✅ | ✅ |
| MCP servers | ✅ | ✅ | ✅ | ✅ |
| Inline completions | ❌ | ❌ | ✅ | ❌ |
| Diagnostics panel | ❌ | ❌ | ✅ | ❌ |
| Multi-session tabs | ❌ | ✅ | ✅ | ✅ |
| Headless mode | ✅ | ❌ | ❌ | ❌ |

## Transport channels

| Platform | Transport | Description |
|---|---|---|
| CLI / TUI | Direct process | In-process communication |
| Web UI | HTTP/SSE | Browser-based client |
| VS Code | Extension Callbacks + LSP | Hosted within the IDE |
| Remote | HTTP/SSE + mDNS | Network-accessible server |

See [Architecture: Transport channels](/architecture/transport-channels) for technical details.
