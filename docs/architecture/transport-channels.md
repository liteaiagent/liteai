---
title: "Architecture: Transport channels"
description: "How LiteAI delivers events to clients — HTTP/SSE, Extension Callbacks, and LSP stdio."
---

# Transport channels

> **Source:** `src/server/`, `src/lsp/`, `src/acp/`, `src/capabilities/`
> **Last verified against code:** 2026-05-13

LiteAI uses three transport channels to communicate with clients. Each channel serves different deployment contexts, but all share the same session engine underneath.

## Channel overview

```mermaid
graph TB
    subgraph "Session Engine"
        Engine[Agent Loop]
        Bus[Event Bus]
    end

    subgraph "Channel 1: HTTP/SSE"
        Server[Hono HTTP Server]
        SSE[SSE Event Stream]
        REST[REST Endpoints]
    end

    subgraph "Channel 2: Extension Callbacks"
        Host[Host IDE Process]
        CB[Callback Interface]
    end

    subgraph "Channel 3: LSP stdio"
        LSPServer[LSP Server]
        STDIO[stdin/stdout]
    end

    Engine --> Bus
    Bus --> SSE
    Bus --> CB
    Bus --> STDIO
    
    Server --> REST
    Server --> SSE
```

## Channel 1: HTTP/SSE (Local & Remote)

**Used by:** CLI, Web UI, Remote Control

The primary channel for standalone deployments. LiteAI runs a Hono HTTP server that exposes REST endpoints for session management and SSE streams for real-time event delivery.

### Middleware stack

Every request passes through (in registration order):

| Middleware | Purpose |
|---|---|
| `errorHandler()` | Structured error responses — `NamedError` → JSON, `HTTPException` passthrough |
| `csrfMiddleware()` | CSRF token validation via `Authorization: Bearer <token>` against `LITEAI_SERVER_CSRF_TOKEN` |
| `authMiddleware()` | HTTP Basic Auth (username/password), with OPTIONS bypass for CORS preflight |
| `requestTracer()` | OpenTelemetry span creation (`liteai-server` tracer, `SpanKind.SERVER`) |
| `requestLogger()` | Request/response logging with SSE-aware timer (skips `/log`, `/health`, `OPTIONS`) |
| `corsMiddleware()` | CORS — allows `localhost`, `127.0.0.1`, `tauri://localhost`, custom origins |

### API route tiers

Routes are organized in three tiers based on required context:

**Tier 1 — Server-level** (no project context needed):

| Route | Module | Purpose |
|---|---|---|
| `GET /` | `GlobalRoutes` | Server info, health, log streaming |
| `GET /system` | `SystemRoutes` | System information |
| `POST /auth` | `AuthRoutes` | Authentication |
| `GET /provider` | `ProviderRoutes` | Provider CRUD |
| `GET /feedback` | `FeedbackRoutes` | Feedback submission |
| `GET /doc` | inline | OpenAPI specification (3.1.1) |

**Tier 2 — Project CRUD** (no instance required):

| Route | Purpose |
|---|---|
| `GET /project` | List all registered projects |
| `POST /project` | Create/register a project (idempotent) |
| `/project/*` | Project management via `ProjectRoutes` |

**Tier 3 — Project-scoped** (requires `:projectID` in path, boots Instance context):

| Route | Module | Purpose |
|---|---|---|
| `/session` | `SessionRoutes` | Session CRUD & SSE streaming |
| `/config` | `ConfigRoutes` | Project configuration |
| `/config/mcp` | `McpRoutes` | MCP server management |
| `/config/plugin` | `PluginRoutes` | Plugin management |
| `/permission` | `PermissionRoutes` | Permission management |
| `/question` | `QuestionRoutes` | HITL question/answer |
| `/tool` | `ToolRoutes` | Tool registry |
| `/pty` | `PtyRoutes` | PTY terminal access |
| `/style` | `StyleRoutes` | Output style management |
| `/experimental` | `ExperimentalRoutes` | Experimental features |
| `/` | `FileRoutes` | File operations |
| `/` | `InstanceRoutes` | Instance-level operations (diagnostics, agent) |

Project-scoped routes also apply:
- `projectContextMiddleware()` — Resolves `:projectID` → project → `Instance.provide()`
- `WorkspaceRouterMiddleware` — Multi-workspace context
- Query parameter validation (`workspace` optional)

### SSE event stream

Session events are delivered via Server-Sent Events:

```
GET /session/:id/events

event: message
data: {"type": "text_delta", "content": "Here's the fix..."}

event: tool_use
data: {"type": "tool_start", "name": "write_file", "id": "call_123"}

event: tool_result
data: {"type": "tool_result", "id": "call_123", "content": "File written."}

event: permission_request
data: {"type": "permission_ask", "tool": "run_command", "args": {...}}
```

### HITL (Human-in-the-Loop)

Permission prompts flow through the question/answer system:

```mermaid
sequenceDiagram
    participant Engine
    participant Bus as Event Bus
    participant Client

    Engine->>Bus: Permission request
    Bus->>Client: SSE: permission_request
    Client->>Engine: POST /question/:id/answer
    Engine->>Engine: Resume tool execution
```

## Channel 2: Extension Callbacks (Hosted)

**Used by:** VS Code extension, IDE integrations

When LiteAI runs inside a host process (e.g., VS Code), it uses callback interfaces instead of HTTP. The host provides capability implementations:

| Capability | Local (HTTP) | Hosted (Extension) |
|---|---|---|
| File I/O | Direct filesystem | Host-mediated |
| Terminal | PTY subprocess | Host terminal API |
| Diagnostics | LSP client | Host diagnostics API |
| UI feedback | SSE events | Host notification API |

### Capability interface

```typescript
interface Capabilities {
  readFile(path: string): Promise<string>
  writeFile(path: string, content: string): Promise<void>
  runCommand(command: string): Promise<CommandResult>
  showDiagnostics(diagnostics: Diagnostic[]): void
  askPermission(request: PermissionRequest): Promise<boolean>
}
```

The `LocalCapabilities` implementation uses direct filesystem and process APIs. The `HostedCapabilities` implementation delegates to the extension host.

## Channel 3: LSP stdio

**Used by:** IDE language server integration

LiteAI can run as an LSP (Language Server Protocol) server communicating over stdin/stdout. This enables:

- Inline code completions
- Diagnostic integration
- Code action suggestions
- Hover documentation

### LSP adapters

LiteAI ships with 40 language server adapters for diagnostics and code intelligence:

TypeScript, Python (Pyright/Ty), Rust, Go, Java, Kotlin, C#, F#, C/C++, Dart, Elixir, Gleam, Haskell, Julia, Lua, Nix, OCaml, PHP, Ruby, Swift, Zig, Bash, Clojure, Vue, Svelte, Astro, Prisma, Terraform, Docker, YAML, LaTeX/TeX, Typst, Deno, ESLint, Biome, OxLint, RuboCop, and more.

## mDNS discovery

**Source:** `src/server/mdns.ts`

For remote access, LiteAI advertises itself via mDNS (multicast DNS), allowing clients on the same network to discover running instances automatically. mDNS is only published when:
- The `mdns` option is enabled
- The server is bound to a non-loopback address (not `127.0.0.1`, `localhost`, or `::1`)

## What's next?

- [**Security model**](/architecture/security-model) — Middleware stack and auth details
- [**Platforms overview**](/platforms/overview) — Which platforms use which channel
- [**Channels reference**](/reference/channels-reference) — Complete endpoint listing
