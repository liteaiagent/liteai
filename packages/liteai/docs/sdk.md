# TypeScript SDK (`@liteai-ai/sdk`)

The **`@liteai-ai/sdk`** package is a fully typed TypeScript client for the liteai HTTP API. It is **auto-generated** from the OpenAPI specification using [`@hey-api/openapi-ts`](https://heyapi.dev) and published to npm as `@liteai-ai/sdk`.

## Architecture

```
packages/sdk/openapi.json          ← source OpenAPI 3.1 spec (~12 000 lines)
packages/sdk/js/script/build.ts    ← generation script (bun run build)
packages/sdk/js/src/gen/           ← generated code
packages/sdk/js/src/client.ts      ← createliteaiClient wrapper
packages/sdk/js/src/server.ts      ← createliteaiServer + createliteaiTui
packages/sdk/js/src/index.ts       ← convenience createliteai (server + client)
```

The build script runs `liteai dev generate` to produce a fresh `openapi.json`, then feeds it to `@hey-api/openapi-ts` which emits:

| Generated file | Purpose |
|---|---|
| `types.gen.ts` | All request/response TypeScript types & schemas |
| `sdk.gen.ts` | `liteaiClient` class with typed methods per endpoint |
| `client.gen.ts` | Low-level HTTP client factory |

## Entry Points

The package exposes several entry points:

| Import path | What it exports |
|---|---|
| `@liteai-ai/sdk` | `createliteai`, `createliteaiClient`, `createliteaiServer` |
| `@liteai-ai/sdk/client` | `createliteaiClient` + all exported types |
| `@liteai-ai/sdk/server` | `createliteaiServer`, `createliteaiTui` |

## Quick Start

### All-in-one (spawn server + get client)

```ts
import { createliteai } from "@liteai-ai/sdk"

const { client, server } = await createliteai()
// client is an liteaiClient instance, server.url is the base URL
```

### Connect to an existing server

```ts
import { createliteaiClient } from "@liteai-ai/sdk"

const client = createliteaiClient({
  baseUrl: "http://localhost:9000",
  directory: "/path/to/project",          // optional, sets x-liteai-directory header
  experimental_workspaceID: "ws_abc123",  // optional, sets x-liteai-workspace header
})
```

### Spawn a server programmatically

```ts
import { createliteaiServer } from "@liteai-ai/sdk/server"

const server = await createliteaiServer({
  hostname: "127.0.0.1",
  port: 4096,
  timeout: 5000,
  config: { logLevel: "debug" },
})
// server.url → "http://127.0.0.1:4096"
// server.close() to stop
```

### Launch the TUI programmatically

```ts
import { createliteaiTui } from "@liteai-ai/sdk/server"

const tui = createliteaiTui({
  project: "/my/project",
  model: "anthropic/claude-sonnet-4-20250514",
  session: "session_id",
  agent: "coder",
})
// tui.close() to kill
```

## liteaiClient API Reference

All methods return a typed response object with `.data` (success) or `.error` (failure). The `liteaiClient` class groups endpoints into resource sub-clients:

### `client.session` — Session Management

The richest API surface. Sessions are long-lived conversations with the AI agent.

| Method | Description |
|---|---|
| `.list()` | List all sessions |
| `.create({ body })` | Create a new session |
| `.get({ path: { id } })` | Get session by ID |
| `.update({ path: { id }, body })` | Update session properties |
| `.delete({ path: { id } })` | Delete a session and all its data |
| `.status()` | Get status of the current session |
| `.prompt({ path: { id }, body })` | Send a message and wait for full response |
| `.promptAsync({ path: { id }, body })` | Send a message and return immediately |
| `.messages({ path: { id } })` | List all messages in a session |
| `.message({ path: { id, messageID } })` | Get a specific message |
| `.command({ path: { id }, body })` | Send a slash command |
| `.shell({ path: { id }, body })` | Run a shell command within a session |
| `.fork({ path: { id }, body })` | Fork a session from a specific message |
| `.children({ path: { id } })` | Get child sessions (from forks) |
| `.abort({ path: { id } })` | Abort a running session |
| `.diff({ path: { id } })` | Get the file diff for a session |
| `.revert({ path: { id }, body })` | Revert a message's changes |
| `.unrevert({ path: { id } })` | Restore all reverted messages |
| `.share({ path: { id } })` | Share a session publicly |
| `.unshare({ path: { id } })` | Unshare a session |
| `.summarize({ path: { id }, body })` | Summarize the session |
| `.todo({ path: { id } })` | Get the todo list for a session |
| `.init({ path: { id }, body })` | Analyze the app and create an AGENTS.md |

### `client.project` — Project Management

| Method | Description |
|---|---|
| `.list()` | List all projects |
| `.current()` | Get the current project |

### `client.config` — Configuration

| Method | Description |
|---|---|
| `.get()` | Get current configuration |
| `.update({ body })` | Update configuration |
| `.providers()` | List all configured providers |

### `client.provider` — Provider Management

| Method | Description |
|---|---|
| `.list()` | List available LLM providers |
| `.auth()` | Get provider authentication methods |
| `.oauth.authorize({ path: { id }, body })` | Start OAuth flow for a provider |
| `.oauth.callback({ path: { id }, body })` | Handle OAuth callback |

### `client.auth` — Authentication

| Method | Description |
|---|---|
| `.set({ path: { id }, body })` | Set auth credentials (API key) |
| `.remove({ path: { id } })` | Remove OAuth credentials for MCP server |
| `.start({ path: { name } })` | Start MCP OAuth authentication flow |
| `.callback({ path: { name }, body })` | Complete MCP OAuth with auth code |
| `.authenticate({ path: { name } })` | Full MCP OAuth flow (opens browser) |

### `client.pty` — Pseudo-Terminal Sessions

| Method | Description |
|---|---|
| `.list()` | List all PTY sessions |
| `.create({ body })` | Create a new PTY session |
| `.get({ path: { id } })` | Get PTY session info |
| `.update({ path: { id }, body })` | Update PTY (title, resize) |
| `.remove({ path: { id } })` | Terminate a PTY session |
| `.connect({ path: { id } })` | Connect to a PTY session for I/O |

### `client.mcp` — Model Context Protocol Servers

| Method | Description |
|---|---|
| `.status()` | Get status of all MCP servers |
| `.add({ body })` | Dynamically add an MCP server |
| `.connect({ path: { name } })` | Connect to an MCP server |
| `.disconnect({ path: { name } })` | Disconnect from an MCP server |

### `client.find` — Search & Discovery

| Method | Description |
|---|---|
| `.text({ query })` | Search text in project files (ripgrep) |
| `.files({ query })` | Find files by name |
| `.symbols({ query })` | Find workspace symbols (LSP) |

### `client.file` — File Operations

| Method | Description |
|---|---|
| `.list({ query })` | List files and directories |
| `.read({ query })` | Read file contents |
| `.status()` | Get git file status |

### `client.event` — Server-Sent Events

| Method | Description |
|---|---|
| `.subscribe()` | Subscribe to real-time SSE event stream |

Returns an async iterable stream of typed events. Used for real-time UI updates.

### `client.global` — Global Operations

| Method | Description |
|---|---|
| `.event()` | Subscribe to global SSE events |

### `client.app` — Application Info

| Method | Description |
|---|---|
| `.log({ body })` | Write a log entry to server logs |
| `.agents()` | List all available agents |

### `client.tool` — Tool Inspection (Experimental)

| Method | Description |
|---|---|
| `.ids()` | List all tool IDs (built-in + dynamic) |
| `.list({ query })` | List tools with JSON schema parameters |

### `client.vcs` — Version Control

| Method | Description |
|---|---|
| `.get()` | Get VCS info (git branch, status, etc.) |

### `client.path` — Path Info

| Method | Description |
|---|---|
| `.get()` | Get the current working path |

### `client.instance` — Instance Lifecycle

| Method | Description |
|---|---|
| `.dispose()` | Dispose the current liteai instance |

### `client.command` — Slash Commands

| Method | Description |
|---|---|
| `.list()` | List all registered slash commands |

### `client.lsp` — Language Server Protocol

| Method | Description |
|---|---|
| `.status()` | Get LSP server status |

### `client.formatter` — Code Formatter

| Method | Description |
|---|---|
| `.status()` | Get formatter status |

### `client.tui` — Terminal UI Control

For programmatic control of the TUI interface:

| Method | Description |
|---|---|
| `.appendPrompt({ body })` | Append text to the prompt |
| `.submitPrompt()` | Submit the current prompt |
| `.clearPrompt()` | Clear the prompt |
| `.openHelp()` | Open the help dialog |
| `.openSessions()` | Open the sessions dialog |
| `.openThemes()` | Open the theme picker |
| `.openModels()` | Open the model selector |
| `.executeCommand({ body })` | Execute a TUI command (e.g. `agent_cycle`) |
| `.showToast({ body })` | Show a toast notification |
| `.publish({ body })` | Publish a TUI event |
| `.control.next()` | Get next TUI request from the queue |
| `.control.response({ body })` | Submit a response to TUI request queue |

## Message Parts

When sending messages via `session.prompt()`, the body accepts an array of `parts`:

```ts
body: {
  parts: [
    { type: "text", text: "Your prompt text" },
    { type: "file", mime: "text/plain", url: "file:///path/to/file.ts" },
  ]
}
```

Part types include:
- **`text`** — plain text content
- **`file`** — file attachment with MIME type and URL

## Real-Time Events (SSE)

The SDK supports Server-Sent Events for real-time updates:

```ts
const events = await client.event.subscribe()
for await (const event of events.stream) {
  console.log(event.type, event)
}
```

Event types include session updates, message streaming, permission requests, and more.

## Example: Batch Test Generation

From `packages/sdk/js/example/example.ts` — create sessions in parallel to generate tests for every file:

```ts
import { createliteaiClient, createliteaiServer } from "@liteai-ai/sdk"
import { pathToFileURL } from "bun"

const server = await createliteaiServer()
const client = createliteaiClient({ baseUrl: server.url })

const files = await Array.fromAsync(new Bun.Glob("packages/core/*.ts").scan())

await Promise.all(
  files.map(async (file) => {
    const session = await client.session.create()
    await client.session.prompt({
      path: { id: session.data.id },
      body: {
        parts: [
          { type: "file", mime: "text/plain", url: pathToFileURL(file).href },
          { type: "text", text: "Write tests for every public function in this file." },
        ],
      },
    })
  }),
)
```

## Regenerating the SDK

To regenerate after API changes:

```bash
cd packages/sdk/js
bun run build
```

This runs `build.ts` which:
1. Executes `bun dev generate` (from `packages/liteai`) to produce a fresh `openapi.json`
2. Runs `@hey-api/openapi-ts` to generate types, SDK class, and HTTP client
3. Formats the output with Biome
4. Compiles TypeScript declarations
