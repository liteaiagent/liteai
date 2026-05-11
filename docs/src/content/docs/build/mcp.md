---
title: Model Context Protocol (MCP)
description: "Configure external tool servers using the Model Context Protocol — transports, OAuth, and agent-scoped servers."
---

# Model Context Protocol (MCP)

MCP lets LiteAI connect to external tool servers, giving the agent access to databases, APIs, file systems, and any other capability exposed through the protocol.

## Configuration

### Project-level (`.mcp.json`)

Create a `.mcp.json` file in your project root:

```json
{
  "servers": {
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

### Global-level (`settings.json`)

Add MCP servers to your global configuration:

```json
{
  "mcp": {
    "servers": {
      "filesystem": {
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem", "/allowed/path"]
      }
    }
  }
}
```

## Transport types

| Transport | Config | Use case |
|---|---|---|
| **stdio** | `command` + `args` | Local CLI-based servers (most common) |
| **HTTP/SSE** | `url` | Remote servers with SSE streaming |
| **Streamable HTTP** | `url` | Modern stateless HTTP transport |

### stdio example

```json
{
  "servers": {
    "my-server": {
      "command": "node",
      "args": ["./path/to/server.js"],
      "env": { "API_KEY": "..." }
    }
  }
}
```

### HTTP/SSE example

```json
{
  "servers": {
    "remote-server": {
      "url": "http://localhost:8080/sse"
    }
  }
}
```

## OAuth support

MCP servers that require OAuth authentication are supported. LiteAI handles the OAuth flow:

1. Server advertises OAuth requirement
2. LiteAI opens the authorization URL
3. User completes login
4. LiteAI stores and refreshes tokens

## Agent-scoped MCP

MCP servers can be scoped to specific agents, making their tools available only when that agent is active:

```json
{
  "servers": {
    "test-db": {
      "command": "npx",
      "args": ["-y", "@mcp/test-database"],
      "agents": ["tester"]
    }
  }
}
```

## Lifecycle management

LiteAI manages MCP server processes:
- **Startup** — Servers are started when the session begins
- **Health checks** — Periodic connectivity verification
- **Restart** — Automatic restart on crash
- **Shutdown** — Graceful termination when the session ends

## What's next?

- [**Discover and install plugins**](/build/discover-plugins) — Plugin marketplace
- [**Extend LiteAI**](/getting-started/extend-liteai) — All extension points
