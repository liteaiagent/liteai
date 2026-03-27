# LiteAI SDK (`@liteai-ai/sdk`)

## Overview

The LiteAI SDK is an auto-generated TypeScript client for the LiteAI server API. It is generated from `openapi.json` using `@hey-api/openapi-ts` and provides a fully-typed, class-based client for interacting with all LiteAI server endpoints.

## Package Structure

```
packages/liteai-sdk/
├── openapi.json              # OpenAPI spec (source of truth)
├── js/
│   ├── package.json          # Published as @liteai-ai/sdk
│   ├── tsconfig.json
│   ├── src/
│   │   ├── index.ts          # Convenience: re-exports client + server
│   │   ├── client.ts         # createLiteaiClient() factory + type re-exports
│   │   ├── server.ts         # createLiteaiServer() / createLiteaiTui()
│   │   └── gen/              # Auto-generated (DO NOT EDIT)
│   │       ├── sdk.gen.ts    # LiteaiClient class + all resource classes
│   │       ├── types.gen.ts  # All request/response types
│   │       ├── client.gen.ts # Low-level HTTP client config
│   │       └── client/       # Core HTTP client utilities
│   ├── example/
│   │   └── example.ts        # Usage example
│   └── script/
│       ├── build.ts          # Regenerate SDK from OpenAPI spec
│       └── publish.ts        # Publish to npm
```

## Exports

The package has three entry points:

| Import path | Description |
|---|---|
| `@liteai-ai/sdk` | Full SDK: client + server + types |
| `@liteai-ai/sdk/client` | Client-only: `createLiteaiClient`, `LiteaiClient`, all types |
| `@liteai-ai/sdk/server` | Server-only: `createLiteaiServer`, `createLiteaiTui` |

## Creating a Client

### Client-only (connect to existing server)

```ts
import { createLiteaiClient } from "@liteai-ai/sdk/client"

const client = createLiteaiClient({
  baseUrl: "http://localhost:4096",
  directory: "/path/to/project",          // optional: sets x-liteai-directory header
  throwOnError: true,                     // optional: throw instead of returning errors
})
```

### Client + Server (full setup)

```ts
import { createLiteai } from "@liteai-ai/sdk"

const { client, server } = await createLiteai({
  hostname: "127.0.0.1",
  port: 4096,
})

// Use client...
// When done:
server.close()
```

## Client API

The `LiteaiClient` instance provides namespaced access to all API resources:

```
client.global          – Health, events, dispose, browse, log
client.global.config   – Get/update global config
client.auth            – Set/remove auth credentials
client.project         – List, get current, update, archive/unarchive, init git
client.session         – CRUD, prompt, fork, abort, revert, share, etc.
client.session.trace   – List, get, search, export traces
client.part            – Delete, update message parts
client.permission      – List, respond, reply to permissions
client.question        – List, reply, reject questions
client.provider        – List providers, auth methods
client.provider.oauth  – OAuth authorize/callback
client.config          – Instance-level config get/update
client.tool            – List, get tool IDs
client.file            – List, read, status
client.find            – Search text, files, symbols
client.mcp             – Add, status, tools, connect/disconnect
client.mcp.auth        – MCP auth remove/start/callback/authenticate
client.plugin          – List, enable, disable, uninstall plugins
client.plugin.marketplace – List, add, remove marketplaces; list/install plugins
client.pty             – List, create, remove, get, update, connect
client.worktree        – List, create, remove, reset
client.tui             – TUI control methods (prompts, sessions, themes, etc.)
client.tui.control     – Next, response
client.instance        – Dispose instance
client.path            – Get path info
client.vcs             – Get VCS info
client.command         – List commands
client.app             – Log, agents, skills
client.lsp             – LSP status
client.formatter       – Formatter status
client.event           – Subscribe to SSE events
client.experimental    – Experimental workspaces, sessions, resources
```

## Response Shape

All methods return a promise that resolves to `{ data, error, request, response }`:

```ts
const result = await client.session.list()
const sessions = result.data  // typed response body
```

When `throwOnError: true` is set, failed requests throw instead of populating `error`, and `data` is always defined on success.

## Common Patterns

### Session lifecycle

```ts
// Create a session
const { data: session } = await client.session.create({ title: "My Session" })

// Send a prompt
await client.session.prompt({
  sessionID: session.id,
  parts: [{ type: "text", text: "Hello!" }],
})

// Get messages
const { data: messages } = await client.session.messages({ sessionID: session.id })

// Abort a running session
await client.session.abort({ sessionID: session.id })

// Revert to a specific message
await client.session.revert({ sessionID: session.id, messageID: "msg_123" })

// Fork a session
const { data: forked } = await client.session.fork({ sessionID: session.id })
```

### Traces

```ts
// List all traces (deep = include sub-agent traces)
const { data: traces } = await client.session.trace.list({
  sessionID: "sess_123",
  deep: true,
})

// Get trace detail
const { data: detail } = await client.session.trace.get({
  sessionID: "sess_123",
  traceID: "trace_456",
})

// Search traces
const { data: results } = await client.session.trace.search({
  sessionID: "sess_123",
  q: "search query",
})
// results.ids → matching trace IDs

// Export traces
const { data } = await client.session.trace.export({
  sessionID: "sess_123",
  format: "json",  // or "md"
})
```

### File operations

```ts
// List directory
const { data: files } = await client.file.list({ path: "/src" })

// Read file
const { data: content } = await client.file.read({ path: "/src/index.ts" })

// Search files
const { data: found } = await client.find.files({ query: "utils" })

// Search text in files
const { data: matches } = await client.find.text({ query: "TODO", path: "/src" })
```

### MCP servers

```ts
const { data: status } = await client.mcp.status()
const { data: tools } = await client.mcp.tools()
await client.mcp.connect({ name: "my-server" })
await client.mcp.disconnect({ name: "my-server" })
```

### Providers

```ts
const { data: providers } = await client.provider.list()
// providers.all → array of providers with their models
// providers.connected → array of connected provider IDs
// providers.default → default model mapping
```

### PTY (terminals)

```ts
const { data: pty } = await client.pty.create({ title: "Build", command: "npm", args: ["run", "build"] })
await client.pty.remove({ ptyID: pty.id })
```

## Key Types

All types are exported from `@liteai-ai/sdk/client`:

```ts
import type {
  // Messages
  Message,
  UserMessage,
  AssistantMessage,
  Part,

  // Sessions
  Session,

  // Traces
  Trace,
  TraceDetail,

  // Providers
  // (inline types from ProviderListResponses)

  // Events (SSE)
  Event,

  // Config
  Config,
} from "@liteai-ai/sdk/client"
```

## In the LiteAI App (SolidJS)

Inside `packages/liteai-app`, the SDK is accessed via context:

```tsx
import { useSDK } from "@/context/sdk"

// Inside a component:
const sdk = useSDK()

// Access the typed client:
sdk.client.session.list()
sdk.client.file.read({ path: "/README.md" })
sdk.client.session.trace.get({ sessionID: id, traceID: tid })

// The client is pre-configured with:
//   - baseUrl from the active server
//   - x-liteai-directory header from the current project directory
//   - throwOnError: true
//   - platform-appropriate fetch (webview or native)
```

**Do NOT use raw `fetch()` for API calls.** Always use `sdk.client.*` — it handles URL construction, authentication, directory headers, and provides full type safety.

## Regenerating the SDK

When the server API changes, regenerate the SDK:

```bash
cd packages/liteai-sdk/js
bun run build
```

This will:
1. Generate a fresh `openapi.json` from the server source
2. Re-generate all files in `src/gen/` via `@hey-api/openapi-ts`
3. Format the output with biome
4. Compile TypeScript declarations to `dist/`

> **Never edit files in `src/gen/` directly.** They are auto-generated and will be overwritten.
