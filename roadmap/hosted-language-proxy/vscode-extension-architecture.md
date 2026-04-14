# VSCode Extension — Architecture & Development Reference

> **Purpose:** Single-source reference for the LiteAI VSCode extension's architecture, hosted mode mechanics, human-in-the-loop systems, and development workflow.

---

## Architecture Overview

The extension follows a **three-layer architecture**:

```
┌──────────────────────────────────────────────────┐
│            Webview (SolidJS in iframe)           │
│  ChatPane ← Controllers ← VscodeStore ← SSE      │
└────────────────────┬─────────────────────────────┘
                     │ postMessage (fetch proxy)
┌────────────────────▼─────────────────────────────┐
│           Extension Host (Node.js)               │
│  WebviewBridge · ExtensionServer · ServerManager │
└──────┬─────────────────────────────┬─────────────┘
       │ HTTP (Core API)             │ HTTP (Callbacks)
┌──────▼─────────────────────────────▼─────────────┐
│              LiteAI Core (--hosted)              │
│  Agent engine · Tools · Providers · SSE stream   │
└──────────────────────────────────────────────────┘
```

1. **Webview** — SolidJS application rendering the ChatPane UI. All HTTP/SSE requests are proxied through `vscodePlatform.fetch` → postMessage → Extension Host.
2. **Extension Host** — Manages the Core process lifecycle (`ServerManager`), proxies webview fetch requests to Core (`WebviewBridge`), and serves filesystem/git/workspace callbacks (`ExtensionServer`).
3. **LiteAI Core** — Runs in `--hosted` mode, delegating filesystem reads (including unsaved editor buffers), git commands, and workspace discovery back to the Extension Host via HTTP callbacks.

---

## Hosted Mode

When the extension spawns Core, it passes:
- `--hosted` — tells Core to delegate fs/git operations to the IDE
- `--callback-port <port>` — the Extension Server's port for callbacks
- `--callback-csrf-token <token>` — CSRF token for callback authentication

Core then calls back to the Extension Server for:
- **File reads** → returns live editor buffer content (unsaved changes), not stale disk
- **File writes** → writes through `vscode.workspace.fs` (works over Remote SSH/WSL)
- **Git commands** → runs `git` via `child_process.execFile` in the correct remote environment
- **Workspace folders** → returns `vscode.workspace.workspaceFolders` so Core registers projects automatically

---

## Implemented Features

### Chat Interface
- Full chat UI with the `ChatPane` component (shared with web app)
- Send prompts to AI agents with model/agent selection
- Real-time streaming responses via SSE
- View reasoning, tool calls, file edits, and text output
- Session management: create, rename, archive, delete, share/unshare
- Abort running requests

### Model & Agent Selection
- Lists all connected AI providers and their models (from Core's `/provider` endpoint)
- Auto-selects the first available connected model on startup
- Switch between agents configured for the current project
- Model variant selection

### Hosted Filesystem (Live Editor Buffers)
- Core reads **unsaved editor content** via the Extension Server's `/fs/readFile` callback
- The agent sees your actual working state, not stale files on disk
- Works transparently over **Remote SSH**, **WSL**, and **DevContainers** via `vscode.workspace.fs`
- File writes go through the same `vscode.workspace.fs` API

### Git Integration
- Git commands execute via `child_process.execFile("git", ...)` in the Extension Host
- Works correctly in Remote environments (git runs on the remote machine)
- Branch detection, diff generation, and VCS status available to agents

### Workspace Registration
- The extension automatically registers `vscode.workspace.workspaceFolders` with Core on startup
- Listens to `onDidChangeWorkspaceFolders` for real-time sync
- Eliminates the "Project not found in registry" error

### File Navigation
- `openFile(path)` wired end-to-end: webview → postMessage → Extension Host → `vscode.window.showTextDocument`
- Click file references in chat output to open them in the editor

### SSE Event Streaming
All real-time events are handled:
- Session lifecycle: `session.created`, `session.updated`, `session.deleted`
- Session status: `session.status` (idle / busy / retry)
- Messages: `message.updated`, `message.removed`
- Streaming parts: `message.part.updated`, `message.part.delta`, `message.part.removed`
- Permission requests: `permission.asked`, `permission.replied`
- Question requests: `question.asked`, `question.replied`, `question.rejected`
- TODO tracking: `todo.updated`
- VCS updates: `vcs.branch.updated`

### Inline AI Completions (LSP Server)
- **`textDocumentSync` (Incremental):** Tracks document lifecycle events (open, change, close) asynchronously to maintain up-to-date buffer state.
- **`inlineCompletionProvider`:** Triggers on text changes, pulls prefix (last 100 lines) and suffix (first 20 lines) around the cursor, queries the AI model for fill-in-the-middle ghost-text completions.

---

## Human-in-the-Loop (HITL)

### How Edits Work

When the AI agent edits a file:

1. The agent's tool calls (e.g., `write_file`, `edit_file`) execute inside Core
2. In **hosted mode**, Core delegates the file write back to the Extension Server's `/fs/writeFile` endpoint
3. The Extension Server snapshots the file's original content, then writes the new content via `vscode.workspace.fs.writeFile()`
4. The file edit appears as a `tool` part in the chat message stream
5. **Inline diff decorations** highlight the changes — green gutter for added lines, blue for modified
6. **CodeLens controls** appear at the top: `✓ Accept Changes` and `✗ Reject Changes`
7. The agent continues running immediately — edits are not blocked

> **Accept** clears the decorations and keeps the changes. **Reject** reverts the file to its state before the agent's first edit.

### Inline Diff Decorations

When `liteai.editApproval` is enabled (default: `true`):
- **Green left border** — added lines
- **Blue left border** — modified lines
- **Overview ruler markers** — colored marks in the scrollbar

Decorations persist across tab switches. Accept or reject at any time, even while the agent is running.

**Keybindings:**
- `Ctrl+Shift+Y` / `⌘+Shift+Y` — Accept changes for the active file
- `Ctrl+Shift+Backspace` / `⌘+Shift+Backspace` — Reject changes for the active file

**Commands** (via Command Palette):
- `LiteAI: Accept File Changes` / `LiteAI: Reject File Changes`
- `LiteAI: Accept All Changes` / `LiteAI: Reject All Changes`

Set `liteai.editApproval` to `false` to disable decorations.

### Permission System

Tool calls requiring permission (e.g., `bash` commands with `ask` configuration) stream a `permission.asked` event. A permission approval gate renders directly in the VSCode chat panel.

### Question Tool

Agent-initiated questions render as forms directly in the VSCode chat panel — supporting multiple choice and text inputs.

---

## Development

### Prerequisites

```bash
# From the repository root
bun install
```

Ensure you have built the local `liteai-core` executable, as the extension spawns it.

### Running in Dev Mode

#### 1. Dev Mode (recommended)

The extension spawns its own core dev server from `packages/core`. Fastest workflow for iterating on both extension and core.

1. Open `packages/vscode` in VS Code
2. Press **`F5`** to launch the Extension Development Host

The extension automatically spawns the core dev server (`bun --watch run ...`) with full `--hosted` and `--lsp` capabilities.

#### 2. Remote Mode

Set `liteai.server.url` to connect to a remote server:
```json
{
  "liteai.server.url": "http://your-server:9000"
}
```

> Remote Mode runs Core without `--hosted` — hosted features (live buffers, workspace registration) are not available.

#### 3. Production Mode (default)

No dev/remote URL configured → extension spawns the bundled `liteai-core` binary from `bin/<platform>-<arch>/` with `--hosted`.

### F5 Development Workflow

1. Open the workspace (`liteai.code-workspace`) or `packages/vscode` in VS Code
2. Press **`F5`** — launches Extension Development Host with `--watch` builds for webview and extension host

> **Tip:** Webview changes → right-click → **Reload Webview**. Extension Host changes → `Cmd+Shift+P` → **Developer: Reload Window**.

### Building for Production

```bash
cd packages/vscode
bun run package
```

This runs the automated build:
1. Builds `liteai-core` executables
2. Copies exes into `packages/vscode/bin/`
3. Compiles webview to `dist/webview/`
4. Typechecks and lints
5. Builds extension host to `dist/extension.js`
6. Generates the VSIX package via `vsce`
