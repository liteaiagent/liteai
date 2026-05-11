---
title: Model Context Protocol (MCP)
description: "Configure external tool servers using the Model Context Protocol — transports, OAuth, and agent-scoped servers."
---

# Model Context Protocol (MCP)

> **Source:** `src/mcp/`
> **Last verified against code:** 2026-05-13

MCP lets LiteAI connect to external tool servers, giving the agent access to databases, APIs, file systems, and any other capability exposed through the protocol.

## Configuration

### Project-level (`.mcp.json`)

Create a `.mcp.json` file in your project root. LiteAI auto-detects this file and scans upward to the workspace root:

```json
{
  "mcpServers": {
    "postgres": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-postgres"],
      "env": {
        "DATABASE_URL": "postgresql://localhost/mydb"
      }
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_TOKEN": "${GITHUB_TOKEN}"
      }
    }
  }
}
```

:::note
The `.mcp.json` format is compatible with Claude Code. LiteAI auto-adapts entries: `command`-based entries become `type: "local"`, `url`-based entries become `type: "remote"`.
:::

### Global-level (`settings.json`)

Add MCP servers to your global configuration under the `mcpServers` key (top-level, **not** nested under `mcp`):

```json
{
  "mcpServers": {
    "filesystem": {
      "type": "local",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/allowed/path"]
    }
  }
}
```

## Transport types

### Local (stdio)

Spawns a child process and communicates via stdin/stdout:

```json
{
  "mcpServers": {
    "my-server": {
      "type": "local",
      "command": "node",
      "args": ["./path/to/server.js"],
      "env": { "API_KEY": "..." },
      "timeout": 10000
    }
  }
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `"local"` | Auto-inferred | Transport type |
| `command` | `string` | Yes | Command to run |
| `args` | `string[]` | No | Command arguments |
| `env` | `Record<string, string>` | No | Extra environment variables |
| `disabled` | `boolean` | No | Disable without removing config |
| `timeout` | `number` | No | Connection timeout in ms (default: 30,000) |

### Remote (HTTP/SSE or Streamable HTTP)

Connects to a remote MCP server. LiteAI tries **Streamable HTTP** first, then falls back to **SSE**:

```json
{
  "mcpServers": {
    "remote-server": {
      "type": "remote",
      "url": "https://mcp.example.com/sse",
      "headers": { "Authorization": "Bearer ${API_TOKEN}" }
    }
  }
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `"remote"` | Auto-inferred | Transport type |
| `url` | `string` | Yes | Server URL |
| `headers` | `Record<string, string>` | No | Custom HTTP headers |
| `oauth` | `object \| false` | No | OAuth config (see below) |
| `disabled` | `boolean` | No | Disable without removing config |
| `timeout` | `number` | No | Request timeout in ms (default: 30,000) |

:::tip
You can omit the `type` field — LiteAI auto-infers `"local"` from `command` and `"remote"` from `url`.
:::

## OAuth support

Remote MCP servers that require OAuth authentication are supported natively. OAuth is **enabled by default** for remote servers.

### Automatic OAuth

When a remote server requires authentication, LiteAI:

1. Detects the `UnauthorizedError` from the MCP SDK
2. Attempts dynamic client registration (RFC 7591)
3. Opens the authorization URL in the browser
4. Handles the callback and stores tokens
5. Refreshes tokens automatically

### Manual OAuth configuration

For servers that require pre-registered clients:

```json
{
  "mcpServers": {
    "enterprise-server": {
      "type": "remote",
      "url": "https://mcp.corp.com/api",
      "oauth": {
        "clientId": "my-client-id",
        "clientSecret": "my-secret",
        "scope": "read write"
      }
    }
  }
}
```

| Field | Type | Description |
|---|---|---|
| `clientId` | `string` | Pre-registered OAuth client ID |
| `clientSecret` | `string` | Client secret (if required) |
| `scope` | `string` | OAuth scopes to request |

### Disabling OAuth

Set `oauth: false` to disable OAuth for a specific remote server:

```json
{
  "mcpServers": {
    "internal-api": {
      "type": "remote",
      "url": "http://localhost:8080/mcp",
      "oauth": false
    }
  }
}
```

## MCP server status

Each server can be in one of these states:

| Status | Meaning |
|---|---|
| `connected` | Successfully connected and listing tools |
| `disabled` | Disabled via config (`disabled: true`) |
| `failed` | Connection or tool listing failed |
| `needs_auth` | OAuth authentication required |
| `needs_client_registration` | Server requires pre-registered client ID |

## Agent-scoped MCP

MCP servers can be scoped to specific agents, making their tools available only when that agent is active:

```json
{
  "agent": {
    "tester": {
      "mcpServers": ["test-db"]
    }
  }
}
```

Agent-scoped servers from `.mcp.json` use the `agents` field:

```json
{
  "mcpServers": {
    "test-db": {
      "command": "npx",
      "args": ["-y", "@mcp/test-database"],
      "agents": ["tester"]
    }
  }
}
```

## Tool naming

MCP tool names are prefixed with the server name to avoid collisions:

```
{server_name}_{tool_name}
```

Non-alphanumeric characters in both names are replaced with underscores. For example, server `my-db` with tool `query` becomes `my_db_query`.

## Environment variable expansion

All string values in MCP config support `${VAR}` and `${VAR:-default}` expansion:

```json
{
  "mcpServers": {
    "api": {
      "type": "remote",
      "url": "${MCP_API_URL}",
      "headers": { "X-API-Key": "${MCP_API_KEY}" }
    }
  }
}
```

## Lifecycle management

LiteAI manages MCP server processes automatically:

- **Startup** — Global servers connect on boot; project servers connect via `MCP.sync()` during project bootstrap
- **Process tracking** — All child process PIDs are tracked for cleanup
- **Reconnection** — Use `MCP.connect(name)` to reconnect failed servers
- **Shutdown** — Graceful `client.close()` on disconnect; force-kill (`SIGKILL` / `taskkill`) orphaned processes on exit
- **Auth flow** — `MCP.startAuth(name)` opens browser for OAuth, `MCP.finishAuth(name, code)` completes the flow

## Global timeout

Set a default timeout for all MCP tool calls:

```json
{
  "experimental": {
    "mcp_timeout": 60000
  }
}
```

Per-server `timeout` overrides this global setting.

## What's next?

- [**Automate with hooks**](/build/hooks) — Lifecycle event hooks
- [**Settings reference**](/configuration/settings) — Full configuration schema
