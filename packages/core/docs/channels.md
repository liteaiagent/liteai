# Communication Channels

This document describes every communication channel used by LiteAI — between the core server, its clients (web, CLI, VS Code extension), and the IDE.

---

## Overview

LiteAI core exposes **three distinct communication channels** depending on how it is launched and who is connecting:

```
┌──────────────────────────────────────────────────────────────┐
│                    LiteAI Core Process                       │
│                                                              │
│  ┌──────────────────┐   ┌──────────────────────────────┐    │
│  │  HTTP/SSE Server │   │   LSP Handler (stdio)        │    │
│  │  (Hono on port)  │   │   textDocument/inlineCompl.  │    │
│  └────────┬─────────┘   └──────────────┬───────────────┘    │
└───────────┼──────────────────────────── ┼────────────────────┘
            │                             │
       ┌────┴────┐                   ┌────┴────┐
       │  HTTP   │                   │  stdio  │
       └────┬────┘                   └────┬────┘
            │                             │
   ┌────────┴──────────┐       ┌──────────┴────────────────┐
   │  Web App (fetch)  │       │  VS Code LanguageClient   │
   │  CLI / TUI        │       │  (inline completions)     │
   │  VS Code Webview  │       └───────────────────────────┘
   │  (proxy via host) │
   └───────────────────┘
```

---

## Channel 1: HTTP + SSE (primary API)

**Direction:** Clients → Core  
**Protocol:** HTTP (REST) + Server-Sent Events (SSE)  
**When active:** Always (all run modes)

### What it carries

| Endpoint pattern | Purpose |
|---|---|
| `POST /project/:id/session` | Create a new chat session |
| `POST /project/:id/session/:sid/chat` | Send a message, stream SSE response |
| `GET  /project/:id/event` | Subscribe to project-wide SSE stream |
| `GET  /provider` | List AI providers and models |
| `GET  /agent` | List configured agents |
| `POST /auth/:providerID` | Authenticate with an AI provider |
| `...` | All other API routes |

### Who uses it

| Client | How |
|---|---|
| **Web app** | Direct `fetch()` to `http://127.0.0.1:<port>` |
| **CLI / TUI** | Direct HTTP requests (when running as separate process) |
| **VS Code extension** | Webview → `postMessage` → Extension Host `WebviewBridge` → `fetch()` proxy |
| **SDK** | Direct HTTP from `@liteai/sdk` |

### Authentication

When `--csrf-token <token>` is passed, all requests must include:
```
Authorization: Bearer <token>
```

### SSE streaming

The `GET /project/:id/event` stream delivers all real-time events:
- `session.created/updated/deleted`
- `message.updated`, `message.part.delta` (streaming tokens)
- `permission.asked`, `question.asked` (human-in-the-loop)
- `vcs.branch.updated`, `todo.updated`

---

## Channel 2: HTTP Callbacks — Extension Server (`--hosted`)

**Direction:** Core → VS Code Extension  
**Protocol:** HTTP (localhost loopback)  
**When active:** Production VS Code only (when core is spawned with `--hosted`)

### Purpose

In `--hosted` mode, the VS Code extension runs a local HTTP server (the `ExtensionServer`) that core calls back into for IDE-aware operations. This enables:

- **Live editor buffer reads** — returns unsaved content, not stale disk files
- **Remote-transparent fs/git** — works over SSH, WSL, DevContainers via `vscode.workspace.fs`
- **Workspace discovery** — returns `vscode.workspace.workspaceFolders`

### Launch command

```bash
liteai-core \
  --hosted \
  --port 0 \
  --csrf-token <coreCsrf> \
  --extension-port <callbackPort> \
  --extension-server-csrf-token <callbackCsrf>
```

Two CSRF tokens are needed — one for each direction:

| Token | Direction | Used by |
|---|---|---|
| `--csrf-token` | Client → Core | Web app, VS Code webview, any HTTP client |
| `--extension-server-csrf-token` | Core → Extension | Core's `HostedCapabilities` HTTP callbacks |

### Callback routes

| Route | What it does |
|---|---|
| `POST /fs/readFile` | Read a file (checks unsaved editor buffer first) |
| `POST /fs/readFileBytes` | Read a file as binary |
| `POST /fs/writeFile` | Write a file via `vscode.workspace.fs` |
| `POST /fs/exists` | Check if a path exists |
| `POST /fs/stat` | Get file metadata |
| `POST /fs/readDirectory` | List directory entries |
| `POST /git/run` | Run a git command in the correct environment |
| `GET  /workspace/folders` | List active workspace folders |

### Security

- All callback requests include `X-CSRF-Token: <callbackCsrf>`
- The `ExtensionServer` rejects any request without a matching token (HTTP 403)
- Both servers bind exclusively to `127.0.0.1` — never exposed to the network

### Dev / remote mode

In dev mode (F5), core is spawned seamlessly by the extension via `bun --watch run` from the core directory and **includes** the `--hosted` and `--lsp` flags. This means dev mode runs exactly like production, with full Extension Callbacks and editor-native features active.

In remote mode (when `liteai.server.url` is set), core runs independently without `--hosted`. Callbacks are not available — core reads files directly from disk.

---

## Channel 3: LSP over stdio (`--lsp`)

**Direction:** Bidirectional  
**Protocol:** JSON-RPC 2.0 with LSP framing (`Content-Length: N\r\n\r\n{...}`)  
**When active:** VS Code extension production mode (alongside Channel 1 + 2)

### Purpose

Provides **AI-powered editor-native features** that go beyond the chat interface:

| LSP method | Feature | Status |
|---|---|---|
| `textDocument/inlineCompletion` | Ghost-text code completions (Copilot-style) | ✅ Phase 1 |
| `textDocument/codeAction` | "AI: Fix", "AI: Explain", "AI: Refactor" | 🔜 Phase 2 |
| `textDocument/hover` | AI-augmented type/doc tooltips | 🔜 Phase 2 |

### Launch command

```bash
liteai-core \
  --hosted \
  --port 0 \
  --csrf-token <csrf> \
  --extension-port <callbackPort> \
  --extension-server-csrf-token <callbackCsrf> \
  --lsp         # ← new flag
```

### How it works

```
VS Code Extension Host
│
├─ ServerManager ──fork──► Core Process
│       │                     │
│       │                     ├─ HTTP server on port (Channel 1)
│       │                     ├─ HostedCapabilities callbacks (Channel 2)
│       │                     └─ LSP handler on stdin/stdout (Channel 3)
│       │
└─ LanguageClient ──pipe──► Core stdin/stdout
        │
        └─ Sends/receives LSP JSON-RPC messages
```

No extra process. No extra port. The `LanguageClient` in the extension host attaches directly to the forked child process's `stdin` and `stdout` pipes.

### stdout ownership

When `--lsp` is active, `stdout` belongs entirely to the LSP JSON-RPC framing. The HTTP server's "listening on..." startup message is redirected to **stderr** so `ServerManager` can still parse it.

```
stdout  →  LSP JSON-RPC messages only
stderr  →  logs + "listening on http://..." startup message
```

`ServerManager` watches stderr for the ready URL instead of stdout.

### AI model used

Inline completions use `Provider.getSmallModel(providerID)`:

1. If `small_model` is set in user config → uses that
2. Otherwise picks the best known fast model for the provider:
   - Anthropic → `claude-haiku-4.5`
   - Google → `gemini-2.5-flash`
   - OpenAI → `gpt-5-nano`
   - GitHub Copilot → `gpt-5-mini`
   - AWS Bedrock → `global.` prefixed Haiku

This keeps completions fast (<1s) without consuming the user's main model quota.

### Document synchronization

The LSP handler uses `TextDocuments` (incremental sync) to maintain an up-to-date view of all open files. VS Code sends `textDocument/didOpen` and `textDocument/didChange` notifications automatically — the completion handler reads the in-memory document, not disk.

---

## Channel comparison

| | HTTP/SSE | Extension Callbacks | LSP stdio |
|---|---|---|---|
| **Transport** | TCP (loopback) | TCP (loopback) | OS pipe |
| **Protocol** | HTTP + SSE | HTTP | JSON-RPC 2.0 |
| **Direction** | Client → Core (mostly) | Core → IDE | Bidirectional |
| **Auth** | Bearer token | CSRF header | None (process-owned pipe) |
| **Ports needed** | 1 (HTTP) | 1 (callback) | 0 |
| **Active in dev mode** | ✅ | ❌ | ❌ |
| **Active in production** | ✅ | ✅ | ✅ |
| **Carries chat/sessions** | ✅ | ❌ | ❌ |
| **Carries editor features** | ❌ | ❌ | ✅ |
| **Carries fs/git ops** | ❌ | ✅ | ❌ |

---

## Run mode summary

| Mode | Who starts core | Channels active | Command |
|---|---|---|---|
| **Local dev** | Developer via `bun dev` | HTTP/SSE only | `bun run dev` |
| **VS Code dev** | Extension (`ServerManager`) | HTTP/SSE + Callbacks + LSP | `bun --watch run ... --hosted --lsp` |
| **VS Code production** | Extension (`ServerManager`) | HTTP/SSE + Callbacks + LSP | `liteai-core --hosted --lsp ...` |
| **Remote** | External server | HTTP/SSE only | `liteai-core --port 9000` |
| **CLI / TUI** | `@liteai/cli` package | HTTP/SSE (or direct import) | `bun dev` or binary |
