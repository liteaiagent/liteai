---
title: Channels reference
description: "Complete API endpoint listing for HTTP/SSE, Extension Callbacks, and LSP stdio channels."
---

# Channels reference

LiteAI communicates through three transport channels.

## Channel 1: HTTP/SSE

### Server-level routes (no project context)

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | Server info, health, log streaming |
| `GET` | `/system` | System information |
| `POST` | `/auth` | Authentication |
| `GET` | `/provider` | List providers |
| `POST` | `/provider` | Add provider |
| `GET` | `/feedback` | Feedback submission |
| `GET` | `/doc` | OpenAPI spec (3.1.1) |

### Project CRUD

| Method | Path | Description |
|---|---|---|
| `GET` | `/project` | List projects |
| `POST` | `/project` | Create project (idempotent) |
| `GET` | `/project/:id` | Get project |
| `DELETE` | `/project/:id` | Delete project |

### Project-scoped routes (under `/project/:projectID/`)

| Method | Path | Description |
|---|---|---|
| `GET` | `/session` | List sessions |
| `POST` | `/session` | Create session |
| `GET` | `/session/:id` | Get session |
| `DELETE` | `/session/:id` | Delete session |
| `POST` | `/session/:id/message` | Send message |
| `GET` | `/session/:id/events` | SSE event stream |
| `GET` | `/config` | Get configuration |
| `PUT` | `/config` | Update configuration |
| `GET` | `/config/mcp` | MCP server status |
| `POST` | `/config/mcp` | Add/configure MCP server |
| `GET` | `/config/plugin` | List plugins |
| `POST` | `/config/plugin` | Configure plugins |
| `GET` | `/permission` | Get permission rules |
| `POST` | `/question/:id/answer` | Answer HITL prompt |
| `GET` | `/tool` | List tools |
| `GET` | `/style` | Get output style |
| `PUT` | `/style` | Set output style |
| `GET` | `/pty` | PTY terminal access |
| `GET` | `/experimental` | Experimental features |

### SSE event types

| Event | Description |
|---|---|
| `text_delta` | Incremental response text |
| `tool_use` | Tool call started/completed |
| `tool_result` | Tool execution result |
| `permission_request` | Permission prompt |
| `message_complete` | Response finished |
| `error` | Error occurred |

## Channel 2: Extension Callbacks

Used by hosted environments (VS Code). Implements the `Capabilities` interface for file I/O, terminal, diagnostics, and UI feedback through the host process.

## Channel 3: LSP stdio

Language Server Protocol over stdin/stdout for IDE integration. Supports completions, diagnostics, hover, and code actions.
