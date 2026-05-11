---
title: Settings
description: "Complete reference for LiteAI's settings.json configuration file."
---

# Settings reference

LiteAI uses `settings.json` files for configuration. Settings are merged from global (`~/.liteai/settings.json`) and project (`.liteai/settings.json`) levels, with project settings taking precedence.

## File format

Standard JSON with comment support (no trailing commas):

```json
{
  // Provider configuration
  "provider": "anthropic",
  "model": "claude-sonnet-4-20250514",

  // Session behavior
  "permission": "default",
  "coordinatorMode": false,
  "autoCompact": true,
  "memory": "project",

  // Extensions
  "plugins": [],
  "hooks": {},
  "mcp": {}
}
```

## Core settings

| Key | Type | Default | Description |
|---|---|---|---|
| `provider` | string | auto-detect | LLM provider (`anthropic`, `openai`, `google`, `bedrock`, `vertex`, `openai-compatible`) |
| `model` | string | provider default | Model identifier (e.g., `claude-sonnet-4-20250514`) |
| `permission` | string | `"default"` | Permission mode (`default`, `auto`, `bypass`, `plan`) |
| `coordinatorMode` | boolean | `false` | Enable coordinator mode |
| `autoCompact` | boolean | `true` | Enable auto-compaction |
| `memory` | string | `"project"` | Memory scope (`user`, `project`, `local`, `disabled`) |

## Extension settings

| Key | Type | Description |
|---|---|---|
| `plugins` | string[] | Plugin packages or paths to load |
| `hooks` | object | Hook definitions (see [Hooks](/build/hooks)) |
| `mcp` | object | MCP server configuration (see [MCP](/build/mcp)) |
| `instructions` | string[] | Additional instruction file paths |

## Server settings

| Key | Type | Description |
|---|---|---|
| `port` | number | HTTP server port (default: 3000) |
| `host` | string | Bind address (default: `localhost`) |

## Resolution chain

```
CLI flags > Environment variables > Project settings > Global settings
```

See [Explore the .liteai directory](/getting-started/explore-liteai-directory) for the full resolution chain.

## What's next?

- [**Project setup**](/configuration/project-setup) — Initialize a project
- [**Environment variables**](/reference/environment-variables) — Env var reference
