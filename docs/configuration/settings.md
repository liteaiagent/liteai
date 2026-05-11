---
title: Settings
description: "Complete reference for LiteAI's settings.json configuration file — all keys, types, defaults, and examples."
---

# Settings reference

LiteAI uses `settings.json` files for configuration. Settings are merged from global (`~/.liteai/settings.json`) and project (`.liteai/settings.json`) levels, with project settings taking precedence.

## Resolution chain

```
CLI flags > Environment variables > Project settings > Global settings
```

See [Explore the .liteai directory](/getting-started/explore-liteai-directory) for the full resolution chain.

## File format

Standard JSON with comment support. Trailing commas are allowed:

```json
{
  "$schema": "./config.schema.json",
  // Model selection
  "model": "anthropic/claude-sonnet-4-20250514",
  "small_model": "anthropic/claude-haiku-3",

  // Server
  "server": {
    "port": 3000,
    "hostname": "localhost"
  }
}
```

> The `$schema` key enables IDE autocompletion and validation. LiteAI auto-generates the schema at `~/.liteai/config.schema.json`.

---

## Core settings

| Key | Type | Default | Description |
|---|---|---|---|
| `$schema` | string | — | JSON schema reference for IDE validation |
| `logLevel` | string | — | Log level (`debug`, `info`, `warn`, `error`, `silent`) |
| `model` | string | auto-detect | Default model in `provider/model` format (e.g., `anthropic/claude-sonnet-4-20250514`) |
| `small_model` | string | — | Small model for background tasks (titles, summaries, compaction) |
| `default_agent` | string | `"build"` | Default primary agent when none specified |
| `username` | string | system username | Custom display name in conversations |
| `snapshot` | boolean | — | Enable file snapshot checkpointing |
| `share` | `"manual"` \| `"auto"` \| `"disabled"` | — | Session sharing behavior |
| `autoupdate` | boolean \| `"notify"` | — | Auto-update behavior (`true`, `false`, or `"notify"`) |
| `outputStyle` | string | — | Active output style name (loaded from `.liteai/styles/`) |

---

## Server settings

Nested under the `server` key:

```json
{
  "server": {
    "port": 3000,
    "hostname": "localhost",
    "mdns": true,
    "mdnsDomain": "liteai.local",
    "cors": ["https://my-dashboard.example.com"]
  }
}
```

| Key | Type | Default | Description |
|---|---|---|---|
| `server.port` | number | 3000 | HTTP server port |
| `server.hostname` | string | `"localhost"` | Bind address |
| `server.mdns` | boolean | — | Enable mDNS service discovery |
| `server.mdnsDomain` | string | `"liteai.local"` | Custom domain for mDNS |
| `server.cors` | string[] | — | Additional allowed CORS origins |

---

## Provider settings

Nested under the `provider` key. Each entry configures a provider by ID:

```json
{
  "provider": {
    "anthropic": {
      "options": {
        "apiKey": "sk-ant-...",
        "baseURL": "https://api.anthropic.com",
        "timeout": 300000,
        "chunkTimeout": 30000
      }
    },
    "openrouter": {
      "options": {
        "apiKey": "sk-or-...",
        "baseURL": "https://openrouter.ai/api/v1"
      },
      "dynamicModels": true
    }
  },
  "disabled_providers": ["azure"],
  "enabled_providers": ["anthropic", "openai"]
}
```

| Key | Type | Description |
|---|---|---|
| `provider.<id>.options.apiKey` | string | API key for this provider |
| `provider.<id>.options.baseURL` | string | Custom API base URL |
| `provider.<id>.options.enterpriseUrl` | string | GitHub Enterprise URL (Copilot auth) |
| `provider.<id>.options.setCacheKey` | boolean | Enable `promptCacheKey` for this provider |
| `provider.<id>.options.timeout` | number \| `false` | Request timeout in ms (default: 300000). Set `false` to disable |
| `provider.<id>.options.chunkTimeout` | number | Timeout in ms between streamed SSE chunks |
| `provider.<id>.whitelist` | string[] | Only allow these model IDs |
| `provider.<id>.blacklist` | string[] | Block these model IDs |
| `provider.<id>.dynamicModels` | boolean \| object | Fetch models from provider's `/v1/models` endpoint |
| `provider.<id>.models` | object | Per-model overrides (context size, variants, etc.) |
| `disabled_providers` | string[] | Providers to exclude from auto-detection |
| `enabled_providers` | string[] | When set, **only** these providers are enabled |

---

## Agent settings

Nested under the `agent` key. Built-in agents: `plan`, `build`, `general`, `explore`, `title`, `summary`, `compaction`. Custom agents are added as additional keys:

```json
{
  "agent": {
    "build": {
      "model": "anthropic/claude-sonnet-4-20250514",
      "thinking": true,
      "thinkingBudget": 8192,
      "steps": 50,
      "permission": { "bash": "allow" }
    },
    "my-reviewer": {
      "prompt": "You are a code reviewer. Only suggest improvements.",
      "mode": "subagent",
      "model": "openai/gpt-4o",
      "color": "#FF5733",
      "tools": ["read", "grep", "glob", "ls"]
    }
  }
}
```

| Key | Type | Default | Description |
|---|---|---|---|
| `model` | string | — | Model override for this agent |
| `variant` | string | — | Default model variant |
| `temperature` | number | — | Sampling temperature |
| `top_p` | number | — | Top-p sampling |
| `prompt` | string | — | System prompt override |
| `description` | string | — | When-to-use description |
| `mode` | `"subagent"` \| `"primary"` \| `"all"` | — | Agent scope |
| `hidden` | boolean | `false` | Hide from @ autocomplete (subagents only) |
| `color` | string | — | UI color: hex (`#FF5733`), theme (`primary`), or CSS name (`red`) |
| `steps` | number | — | Maximum agentic iterations before forcing text-only response |
| `disable` | boolean | — | Disable this agent entirely |
| `toolChoice` | `"auto"` \| `"required"` \| `"none"` | — | Force tool calling behavior |
| `thinking` | boolean | — | Enable thinking/reasoning for models that support it |
| `thinkingBudget` | number | — | Token budget for thinking blocks |
| `effort` | `"low"` \| `"medium"` \| `"high"` \| `"max"` | — | Reasoning effort level |
| `timeout` | number | 1800000 | Agent execution timeout in ms |
| `criticalSystemReminder` | string | — | System reminder injected every turn |
| `initialPrompt` | string | — | Initial prompt injected after agent load |
| `omitLiteaiMd` | boolean | — | Omit project AGENTS.md from context |

### Agent permission overrides

| Key | Type | Description |
|---|---|---|
| `permission` | object | Per-tool permission rules (see [Permission settings](#permission-settings)) |
| `permissionMode` | string | Preset: `"default"`, `"acceptEdits"`, `"dontAsk"`, `"bypassPermissions"`, `"plan"`, `"bubble"` |
| `tools` | string \| string[] \| object | Allowed tools (mapped to permission allow rules) |
| `disallowedTools` | string \| string[] | Denied tools (mapped to permission deny rules) |

### Agent extension points

| Key | Type | Description |
|---|---|---|
| `skills` | string[] | Preloaded skills injected on agent init |
| `mcpServers` | array | Agent-scoped MCP servers |
| `memory` | `"user"` \| `"project"` \| `"local"` | MEMORY.md scope |
| `background` | boolean | Run concurrently (requires background task infrastructure) |
| `isolation` | `"worktree"` \| `"remote"` | Git worktree or remote Docker isolation |
| `containerImage` | string | Docker image for remote isolation |
| `hooks` | object | Per-agent hooks |
| `requiredMcpServers` | string[] | MCP servers that must be available |
| `maxTurns` | number | Alias for `steps` |

---

## MCP server settings

Nested under the `mcpServers` key. Each entry is a local or remote MCP server:

```json
{
  "mcpServers": {
    "postgres": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-postgres"],
      "env": { "DATABASE_URL": "postgresql://localhost/mydb" },
      "timeout": 10000
    },
    "remote-api": {
      "url": "https://mcp.example.com/sse",
      "headers": { "Authorization": "Bearer ${API_TOKEN}" },
      "oauth": {
        "clientId": "my-app",
        "scope": "read write"
      }
    },
    "disabled-server": {
      "disabled": true
    }
  }
}
```

### Local MCP servers (`type: "local"`)

| Key | Type | Description |
|---|---|---|
| `command` | string | Command to run the MCP server |
| `args` | string[] | Command arguments |
| `env` | object | Environment variables for the server process |
| `disabled` | boolean | Disable this server on startup |
| `timeout` | number | Request timeout in ms (default: 5000) |

### Remote MCP servers (`type: "remote"`)

| Key | Type | Description |
|---|---|---|
| `url` | string | Server URL (SSE or Streamable HTTP) |
| `headers` | object | HTTP headers sent with requests |
| `disabled` | boolean | Disable this server on startup |
| `timeout` | number | Request timeout in ms (default: 5000) |
| `oauth` | object \| `false` | OAuth config (`clientId`, `clientSecret`, `scope`) or `false` to disable OAuth auto-detection |

> The `type` field is auto-inferred: `command` → local, `url` → remote.

---

## Permission settings

Nested under the `permission` key. Controls tool approval behavior:

```json
{
  "permission": {
    "read": "allow",
    "edit": "ask",
    "bash": {
      "*": "ask",
      "bun test": "allow",
      "git status": "allow"
    },
    "webfetch": "deny",
    "task": "allow"
  }
}
```

**Permission actions:** `"allow"` (auto-approve), `"ask"` (prompt user), `"deny"` (block).

**Per-tool permission keys:**

| Key | Tools covered |
|---|---|
| `read` | File read operations |
| `edit` | File edit/write operations |
| `bash` | Shell command execution |
| `glob` | File glob matching |
| `grep` | Text search |
| `list` | Directory listing |
| `task` | Agent/task spawning |
| `webfetch` | URL fetching |
| `websearch` | Web search |
| `codesearch` | Code search |
| `lsp` | Language server operations |
| `skill` | Skill invocation |
| `external_directory` | External directory access |
| `todowrite` | Todo write |
| `todoread` | Todo read |
| `question` | User questions |
| `doom_loop` | Loop detection override |

For `bash`, values can be an object mapping command patterns to actions.

---

## Hook settings

Nested under the `hooks` key. Hooks fire on lifecycle events:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "write_file|edit_file",
        "hooks": [
          {
            "type": "command",
            "command": "echo 'File modification detected'",
            "timeout": 30,
            "async": true
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "hooks": [
          {
            "type": "http",
            "url": "https://webhook.example.com/notify",
            "headers": { "Authorization": "Bearer ${WEBHOOK_TOKEN}" },
            "allowedEnvVars": ["WEBHOOK_TOKEN"]
          }
        ]
      }
    ]
  },
  "disableAllHooks": false
}
```

### Hook handler fields

| Key | Type | Description |
|---|---|---|
| `type` | `"command"` \| `"prompt"` \| `"agent"` \| `"http"` | Handler type |
| `command` | string | Shell command (type: `command`) |
| `prompt` | string | Prompt text (type: `prompt` or `agent`) |
| `url` | string | URL to POST to (type: `http`) |
| `headers` | object | HTTP headers (type: `http`) |
| `allowedEnvVars` | string[] | Environment variables allowed for expansion in headers |
| `timeout` | number | Timeout in seconds (default: 600) |
| `statusMessage` | string | Message shown while hook runs |
| `once` | boolean | Only fire once per session |
| `async` | boolean | Run in background without blocking |

### Hook group fields

| Key | Type | Description |
|---|---|---|
| `matcher` | string | Regex pattern to filter when this hook group fires |
| `hooks` | array | Array of hook handlers |

---

## Compaction settings

Nested under the `compaction` key:

```json
{
  "compaction": {
    "auto": true,
    "prune": true,
    "reserved": 4096
  }
}
```

| Key | Type | Default | Description |
|---|---|---|---|
| `compaction.auto` | boolean | `true` | Enable automatic compaction when context is full |
| `compaction.prune` | boolean | `true` | Enable pruning of old tool outputs |
| `compaction.reserved` | number | — | Token buffer for compaction (prevents overflow during compaction) |

---

## Telemetry settings

Nested under the `telemetry` key:

```json
{
  "telemetry": {
    "disabled": false,
    "perfetto": true,
    "otel": {
      "endpoint": "http://localhost:4318",
      "protocol": "http/protobuf"
    },
    "langfuse": {
      "publicKey": "pk-...",
      "secretKey": "sk-...",
      "baseUrl": "https://cloud.langfuse.com"
    }
  }
}
```

| Key | Type | Description |
|---|---|---|
| `telemetry.disabled` | boolean | Opt out of all telemetry |
| `telemetry.perfetto` | boolean | Enable Perfetto trace export |
| `telemetry.otel.endpoint` | string | OpenTelemetry collector endpoint |
| `telemetry.otel.protocol` | `"http/protobuf"` \| `"http/json"` \| `"grpc"` | OTLP protocol |
| `telemetry.otel.traceExporter` | string | Custom trace exporter |
| `telemetry.otel.metricExporter` | string | Custom metric exporter |
| `telemetry.otel.logExporter` | string | Custom log exporter |
| `telemetry.otel.exportIntervalMs` | number | Export interval in ms |
| `telemetry.langfuse.publicKey` | string | Langfuse public key |
| `telemetry.langfuse.secretKey` | string | Langfuse secret key |
| `telemetry.langfuse.baseUrl` | string | Langfuse instance URL |

---

## Extension management

```json
{
  "skills": {
    "paths": ["/path/to/custom/skills"],
    "urls": ["https://example.com/.well-known/skills/"]
  },
  "instructions": ["./RULES.md", "https://example.com/team-rules.md"],
  "enabledPlugins": {
    "my-plugin": true,
    "legacy-plugin": false
  },
  "disabledTools": {
    "websearch": true
  },
  "disabledSkills": {
    "deprecated-skill": true
  },
  "extraKnownMarketplaces": {
    "team-plugins": {
      "source": {
        "source": "github",
        "repo": "my-org/liteai-plugins"
      }
    }
  }
}
```

| Key | Type | Description |
|---|---|---|
| `skills.paths` | string[] | Additional skill folder paths |
| `skills.urls` | string[] | URLs to fetch skills from |
| `instructions` | string[] | Additional instruction files or URLs to include |
| `enabledPlugins` | object | Plugin enabled/disabled state (`plugin-id → boolean`) |
| `disabledTools` | object | Tool disabled state (`tool-id → boolean`) |
| `disabledSkills` | object | Skill disabled state (`skill-id → boolean`) |
| `extraKnownMarketplaces` | object | Team-shared plugin marketplace sources |

---

## Formatter and LSP settings

```json
{
  "formatter": {
    "prettier": {
      "command": ["npx", "prettier", "--write"],
      "extensions": [".ts", ".tsx", ".js"]
    }
  },
  "lsp": {
    "custom-lsp": {
      "command": ["my-lsp-server", "--stdio"],
      "extensions": [".myext"],
      "env": { "LSP_DEBUG": "true" }
    },
    "typescript": {
      "disabled": true
    }
  }
}
```

| Key | Type | Description |
|---|---|---|
| `formatter` | object \| `false` | Formatter configurations per ID. Set to `false` to disable all formatters |
| `formatter.<id>.command` | string[] | Formatter command |
| `formatter.<id>.extensions` | string[] | File extensions to format |
| `formatter.<id>.disabled` | boolean | Disable this formatter |
| `lsp` | object \| `false` | LSP server configurations. Set to `false` to disable all LSP servers |
| `lsp.<id>.command` | string[] | LSP server command |
| `lsp.<id>.extensions` | string[] | File extensions (required for custom servers) |
| `lsp.<id>.disabled` | boolean | Disable this LSP server |
| `lsp.<id>.env` | object | Environment variables |
| `lsp.<id>.initialization` | object | LSP initialization options |

---

## Experimental settings

Nested under the `experimental` key. These features may change or be removed:

```json
{
  "experimental": {
    "batch_tool": true,
    "continue_loop_on_deny": false,
    "mcp_timeout": 10000,
    "agent_memory": true,
    "agent_memory_snapshot": false,
    "primary_tools": ["apply_patch"],
    "disable_paste_summary": false
  }
}
```

| Key | Type | Description |
|---|---|---|
| `experimental.batch_tool` | boolean | Enable the batch tool (multiple tool calls in one) |
| `experimental.continue_loop_on_deny` | boolean | Continue agent loop when a tool call is denied |
| `experimental.mcp_timeout` | number | MCP request timeout in ms |
| `experimental.agent_memory` | boolean | Enable agent memory integration |
| `experimental.agent_memory_snapshot` | boolean | Enable local agent memory snapshots |
| `experimental.primary_tools` | string[] | Tools only available to primary agents |
| `experimental.disable_paste_summary` | boolean | Disable paste content summarization |

---

## Other settings

| Key | Type | Description |
|---|---|---|
| `command` | object | Custom slash commands (`name → { template, description, agent, model, subtask }`) |
| `watcher.ignore` | string[] | File watcher ignore patterns |
| `skillUsage` | object | Tracked skill usage frequency (auto-managed) |
| `enterprise.url` | string | Enterprise URL for organization features |

---

## What's next?

- [**Project setup**](/configuration/project-setup) — Initialize a project
- [**Environment variables**](/reference/environment-variables) — Env var reference
- [**Explore the .liteai directory**](/getting-started/explore-liteai-directory) — Directory structure
