---
title: "Roadmap: Addons & configuration"
description: "Implementation status of MCP, plugins, skills, hooks, providers, server, and infrastructure."
---

# Addons & configuration roadmap

All addon and configuration subsystems are **fully implemented** (242/242 ✅).

## MCP integration (12/12 ✅)

Fully operational with stdio/HTTP/SSE transports, OAuth, agent-scoped servers, lifecycle management, and the `.mcp.json` configuration format.

## Plugin system (10/10 ✅)

Plugin manifest, lifecycle hooks, environment variable injection, npm distribution, and runtime loading from `LITEAI_PLUGIN_DIR`.

## Skill system (6/6 ✅)

SKILL.md discovery, global + project scoping, agent-specific skills, and built-in skills (debug, simplify).

## Hook system (8/8 ✅)

Lifecycle hooks, command hooks, HTTP hooks, and agent-scoped hook definitions.

## Command system (7/7 ✅)

Built-in commands, custom command loading from `.liteai/commands/`, parameter schema validation.

## Provider system (14/14 ✅)

| Provider | Status |
|---|---|
| Anthropic | ✅ |
| OpenAI | ✅ |
| Google (Gemini) | ✅ |
| AWS Bedrock | ✅ |
| Google Vertex | ✅ |
| OpenAI-Compatible | ✅ |

Plus: Model loader, capability detection, streaming normalization, token counting.

## Server & API (43/43 ✅)

- HTTP server (Hono) with mDNS discovery
- 7-layer middleware stack (CSRF, auth, CORS, tracing, logging, project context, error handler)
- 30+ API routes across 3 tiers (server, project CRUD, project-scoped)
- Configuration system with layered merge and Zod schema
- Feedback service

## Infrastructure (78/78 ✅)

| Category | Features |
|---|---|
| Storage | SQLite, full-text search, schema migrations |
| Telemetry | OpenTelemetry, Perfetto, diagnostics |
| Project management | Workspace detection, VCS, bootstrap |
| Control plane | Multi-workspace, SSE, router middleware |
| File system | Ripgrep, .gitignore, protected files, watcher |
| LSP | 40 language server adapters |
| Isolation | Docker, worktree, registry |
| ACP | Agent Communication Protocol (6 modules) |
| Auth | Provider interface, registry, service |
| Account | Repository, schema, service |
| Event bus | Bus events, global events, TUI events |
| Misc | Shell detection, PTY, IDE, feature flags, scheduler |
