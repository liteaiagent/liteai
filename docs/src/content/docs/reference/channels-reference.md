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
| `GET` | `/` | Server info |
| `GET` | `/system` | System information |
| `POST` | `/auth` | Authentication |
| `GET` | `/provider` | List providers |
| `POST` | `/provider` | Add provider |
| `GET` | `/doc` | OpenAPI spec |

### Project CRUD

| Method | Path | Description |
|---|---|---|
| `GET` | `/project` | List projects |
| `POST` | `/project` | Create project |
| `GET` | `/project/:id` | Get project |
| `DELETE` | `/project/:id` | Delete project |

### Project-scoped routes

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
| `POST` | `/config/mcp` | Add MCP server |
| `GET` | `/permission` | Get permission rules |
| `POST` | `/question/:id/answer` | Answer HITL prompt |
| `GET` | `/tool` | List tools |

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
