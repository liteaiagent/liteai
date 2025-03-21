# Server-Sent Events (SSE)

liteai exposes real-time event streams over **Server-Sent Events**. Clients (web UI, desktop app, SDK consumers) connect to one of two endpoints and receive a continuous stream of JSON messages as things happen in the system.

## Endpoints

### Instance events — `GET /event`

Returns all events scoped to the current project instance. The server calls `Bus.subscribeAll()` and pipes every published `BusEvent` to the stream. This is the primary endpoint used by the web UI.

**Headers set by the server:**

| Header | Value |
|---|---|
| `Content-Type` | `text/event-stream` |
| `X-Accel-Buffering` | `no` |
| `X-Content-Type-Options` | `nosniff` |

### Global events — `GET /global/event`

Returns events emitted on the `GlobalBus`. These include cross-instance events such as `project.updated`, `worktree.ready`, and `workspace.ready`. The global endpoint wraps each payload in an envelope that also carries the originating `directory`.

## Wire format

Each SSE frame has a single `data:` field containing a JSON object.

### Instance `/event` payload

```jsonc
{
  "type": "<event-type>",       // e.g. "session.updated"
  "properties": { /* … */ }     // event-specific fields
}
```

### Global `/global/event` payload

```jsonc
{
  "directory": "<path>",        // originating project directory
  "payload": {
    "type": "<event-type>",
    "properties": { /* … */ }
  }
}
```

## Connection lifecycle

1. The client opens an SSE connection.
2. The server immediately sends a synthetic `server.connected` event (`properties: {}`).
3. A **heartbeat** (`server.heartbeat`, `properties: {}`) is sent every **10 seconds** to keep the connection alive through proxies.
4. On the instance endpoint, when the underlying project instance is disposed, an `instance.disposed` event is sent and the stream is closed.
5. When the client disconnects, listeners are cleaned up automatically.

## Event catalog

Every event in the system is created with `BusEvent.define(type, schema)`. The `type` string is the SSE event type; the Zod schema describes `properties`.

### Session

| Type | Properties | Source |
|---|---|---|
| `session.created` | `Session.Info` | `session/index.ts` |
| `session.updated` | `Session.Info` | `session/index.ts` |
| `session.deleted` | `{ id: SessionID }` | `session/index.ts` |
| `session.diff` | `{ sessionID, diff: Diff[] }` | `session/index.ts` |

### Message

| Type | Properties | Source |
|---|---|---|
| `message.updated` | `Message.Info` | `session/message.ts` |
| `message.removed` | `{ sessionID, messageID }` | `session/message.ts` |
| `message.part.updated` | `{ sessionID, messageID, part }` | `session/message.ts` |
| `message.part.delta` | `{ sessionID, messageID, partID, delta }` | `session/message.ts` |
| `message.part.removed` | `{ sessionID, messageID, partID }` | `session/message.ts` |

### Session status

| Type | Properties | Source |
|---|---|---|
| `session.status` | `{ sessionID, status }` | `session/status.ts` |
| ~~`session.idle`~~ | `{ sessionID }` | `session/status.ts` (deprecated) |

### Todo

| Type | Properties | Source |
|---|---|---|
| `todo.updated` | `{ sessionID, todos, title }` | `session/todo.ts` |

### Compaction

| Type | Properties | Source |
|---|---|---|
| `session.compacted` | `{ sessionID }` | `session/compaction.ts` |

### PTY (terminal)

| Type | Properties | Source |
|---|---|---|
| `pty.created` | `{ info: Pty.Info }` | `pty/index.ts` |
| `pty.updated` | `{ info: Pty.Info }` | `pty/index.ts` |
| `pty.exited` | `{ id: PtyID, exitCode }` | `pty/index.ts` |
| `pty.deleted` | `{ id: PtyID }` | `pty/index.ts` |

### Version control

| Type | Properties | Source |
|---|---|---|
| `vcs.branch.updated` | `{ branch? }` | `project/vcs.ts` |

### Project

| Type | Properties | Source |
|---|---|---|
| `project.updated` | `Project.Info` | `project/project.ts` |

> `project.updated` is emitted on **GlobalBus** (not the instance Bus), so it appears on the global `/global/event` stream.

### Permission

| Type | Properties | Source |
|---|---|---|
| `permission.asked` | `PermissionNext.Request` | `permission/next.ts` |
| `permission.replied` | `{ sessionID, requestID, reply }` | `permission/next.ts` |
| `permission.updated` | `Permission.Info` | `permission/index.ts` |
| `permission.replied` | `{ sessionID, permissionID, response }` | `permission/index.ts` |

> There are two permission subsystems (`Permission` and `PermissionNext`). Both define `permission.replied` with slightly different schemas.

### Question

| Type | Properties | Source |
|---|---|---|
| `question.asked` | `Question.Request` | `question/index.ts` |
| `question.replied` | `{ sessionID, requestID, answers }` | `question/index.ts` |
| `question.rejected` | `{ sessionID, requestID }` | `question/index.ts` |

### File

| Type | Properties | Source |
|---|---|---|
| `file.edited` | `{ file }` | `file/index.ts` |
| `file.watcher.updated` | `{ file, event }` | `file/watcher.ts` |

### LSP

| Type | Properties | Source |
|---|---|---|
| `lsp.client.diagnostics` | `{ serverID, path }` | `lsp/client.ts` |

### Installation

| Type | Properties | Source |
|---|---|---|
| `installation.updated` | `{ version }` | `installation/index.ts` |
| `installation.update-available` | `{ version }` | `installation/index.ts` |

### MCP

| Type | Properties | Source |
|---|---|---|
| `mcp.tools.changed` | `{ server }` | `mcp/index.ts` |
| `mcp.browser.open.failed` | `{ mcpName, url }` | `mcp/index.ts` |

### Worktree

| Type | Properties | Source |
|---|---|---|
| `worktree.ready` | `{ name, branch }` | `worktree/index.ts` |
| `worktree.failed` | `{ message }` | `worktree/index.ts` |

### Workspace

| Type | Properties | Source |
|---|---|---|
| `workspace.ready` | `{ name }` | `control-plane/workspace.ts` |
| `workspace.failed` | `{ message }` | `control-plane/workspace.ts` |

### IDE

| Type | Properties | Source |
|---|---|---|
| `ide.installed` | `{ ide }` | `ide/index.ts` |

### Command

| Type | Properties | Source |
|---|---|---|
| `command.executed` | `{ name, sessionID, arguments, messageID }` | `command/index.ts` |

### Server

| Type | Properties | Source |
|---|---|---|
| `server.connected` | `{}` | `server/event.ts` |
| `global.disposed` | `{}` | `server/event.ts` |
| `instance.disposed` | `{}` | `bus/index.ts` |

### TUI (terminal UI only)

These events are consumed by the built-in TUI and are **not** sent over SSE to external clients.

| Type | Properties | Source |
|---|---|---|
| `tui.prompt.append` | `{ text }` | `cli/cmd/tui/event.ts` |
| `tui.command.execute` | `{ command }` | `cli/cmd/tui/event.ts` |
| `tui.toast.show` | `{ title?, message, variant, duration? }` | `cli/cmd/tui/event.ts` |
| `tui.session.select` | `{ sessionID }` | `cli/cmd/tui/event.ts` |

## Architecture overview

```
┌────────────────────────────────────────────┐
│                  Modules                   │
│  (session, message, pty, permission, …)    │
│                                            │
│  Bus.publish(Event.Type, properties)       │
│       │                                    │
└───────┼────────────────────────────────────┘
        │
        ▼
┌───────────────────┐    emit("event")    ┌──────────────┐
│       Bus         │ ─────────────────▶  │   GlobalBus  │
│  (per-instance)   │                     │  (singleton) │
└───────────────────┘                     └──────────────┘
        │                                        │
        │  subscribeAll()                        │  on("event")
        ▼                                        ▼
  GET /event                              GET /global/event
  (instance SSE)                          (global SSE)
```

- **`Bus`** is scoped to a project instance. Every `Bus.publish()` also forwards the event to `GlobalBus`.
- **`GlobalBus`** is a process-wide `EventEmitter`. Some modules (e.g. `Project`, `Worktree`) emit directly to `GlobalBus` instead of going through `Bus`.
- **`BusEvent.define(type, schema)`** registers the event type and its Zod schema in a global registry. `BusEvent.payloads()` returns a discriminated union of all registered event schemas, which is used to generate the OpenAPI spec for the SSE endpoints.

## Consuming events

### JavaScript / TypeScript

```ts
const source = new EventSource("http://localhost:3000/event")

source.onmessage = (e) => {
  const event = JSON.parse(e.data)
  console.log(event.type, event.properties)
}
```

### Global stream

```ts
const source = new EventSource("http://localhost:3000/global/event")

source.onmessage = (e) => {
  const { directory, payload } = JSON.parse(e.data)
  console.log(directory, payload.type, payload.properties)
}
```
