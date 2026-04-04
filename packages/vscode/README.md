# LiteAI VS Code Extension

A Visual Studio Code extension that integrates LiteAI directly into your development workflow. Chat with AI agents, submit prompts, stream responses in real-time, and manage sessions — all from a native VSCode side panel.

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

### How Hosted Mode Works

When the extension spawns Core, it passes:
- `--hosted` — tells Core to delegate fs/git operations to the IDE
- `--callback-port <port>` — the Extension Server's port for callbacks
- `--callback-csrf-token <token>` — CSRF token for callback authentication

Core then calls back to the Extension Server for:
- **File reads** → returns live editor buffer content (unsaved changes), not stale disk
- **File writes** → writes through `vscode.workspace.fs` (works over Remote SSH/WSL)
- **Git commands** → runs `git` via `child_process.execFile` in the correct remote environment
- **Workspace folders** → returns `vscode.workspace.workspaceFolders` so Core registers projects automatically

## Supported Features

### ✅ Chat Interface
- Full chat UI with the same `ChatPane` component used in the web app
- Send prompts to AI agents with model/agent selection
- Real-time streaming responses via SSE (Server-Sent Events)
- View reasoning, tool calls, file edits, and text output
- Session management: create, rename, archive, delete
- Session sharing (share/unshare)
- Abort running requests

### ✅ Model & Agent Selection
- Lists all connected AI providers and their models (fetched from Core's `/provider` endpoint)
- Auto-selects the first available connected model on startup
- Switch between agents configured for the current project
- Model variant selection

### ✅ Hosted Filesystem (Live Editor Buffers)
- Core reads **unsaved editor content** via the Extension Server's `/fs/readFile` callback
- The agent sees your actual working state, not stale files on disk
- Works transparently over **Remote SSH**, **WSL**, and **DevContainers** via `vscode.workspace.fs`
- File writes go through the same `vscode.workspace.fs` API

### ✅ Git Integration
- Git commands execute via `child_process.execFile("git", ...)` in the Extension Host
- Works correctly in Remote environments (git runs on the remote machine)
- Branch detection, diff generation, and VCS status available to agents

### ✅ Workspace Registration
- The extension automatically registers `vscode.workspace.workspaceFolders` with Core on startup
- Listens to `onDidChangeWorkspaceFolders` for real-time sync
- Eliminates the "Project not found in registry" error

### ✅ File Navigation
- `openFile(path)` wired end-to-end: webview → postMessage → Extension Host → `vscode.window.showTextDocument`
- Click file references in chat output to open them in the editor

### ✅ SSE Event Streaming
All real-time events are handled:
- Session lifecycle: `session.created`, `session.updated`, `session.deleted`
- Session status: `session.status` (idle / busy / retry)
- Messages: `message.updated`, `message.removed`
- Streaming parts: `message.part.updated`, `message.part.delta`, `message.part.removed`
- Permission requests: `permission.asked`, `permission.replied`
- Question requests: `question.asked`, `question.replied`, `question.rejected`
- TODO tracking: `todo.updated`
- VCS updates: `vcs.branch.updated`

## Human-in-the-Loop (HITL)

### How Edits Work

When the AI agent edits a file:

1. The agent's tool calls (e.g., `write_file`, `edit_file`) execute inside Core
2. In **hosted mode**, Core delegates the file write back to the Extension Server's `/fs/writeFile` endpoint
3. The Extension Server snapshots the file's original content, then writes the new content via `vscode.workspace.fs.writeFile()`
4. The file edit appears as a `tool` part in the chat message stream, showing the tool name, input, and output
5. **Inline diff decorations** highlight what changed — green gutter for added lines, blue for modified lines
6. **CodeLens controls** appear at the top of the file: `✓ Accept Changes` and `✗ Reject Changes`
7. The agent continues running immediately — edits are not blocked

> **Accept** clears the decorations and keeps the changes. **Reject** reverts the file to its state before the agent's first edit and clears the decorations.

### Inline Diff Decorations

When `liteai.editApproval` is enabled (default: `true`), every agent file edit is tracked and displayed with inline editor decorations:

- **Green left border** — lines that were added
- **Blue left border** — lines that were modified
- **Overview ruler markers** — colored marks in the scrollbar showing where changes are

The decorations persist across tab switches. You can accept or reject changes at any time, even while the agent is still running.

**Keybindings:**
- `Ctrl+Shift+Y` / `⌘+Shift+Y` — Accept changes for the active file
- `Ctrl+Shift+Backspace` / `⌘+Shift+Backspace` — Reject changes for the active file

**Commands** (via Command Palette):
- `LiteAI: Accept File Changes` — accept the active file
- `LiteAI: Reject File Changes` — reject the active file
- `LiteAI: Accept All Changes` — accept all pending file edits
- `LiteAI: Reject All Changes` — reject all pending file edits

To disable decorations entirely, set `liteai.editApproval` to `false` in VS Code settings.

### Permission System

The VSCode extension fully supports the Core's permission system. Tool calls requiring permission (e.g., `bash` commands with `ask` configuration) will stream a `permission.asked` event. A permission approval gate renders directly in the VSCode chat panel, allowing you to approve or deny the action seamlessly within your workflow.

### Question Tool

The VSCode extension fully supports agent-initiated questions. When an agent needs more information or user clarification, a question form will render directly in the VSCode chat panel, allowing users to answer the question through multiple choice or text inputs.

## Future Features

| Feature | Priority | Description |
|---------|:--------:|-------------|
| **Terminal integration** | Medium | Route agent terminal commands (`bash`, `npm run`, etc.) through VSCode's terminal panel instead of Core's built-in PTY. This would make terminal output visible in the IDE and support VSCode's shell integration API |
| **Persistent server** | Low | Option to keep the Core server running after VSCode closes, so sessions persist across IDE restarts |
| **TracePane extraction** | Low | Extract the trace/debugging view from `packages/web` to `packages/ui/panes` so it can render in the VSCode panel |
| **SettingsPane extraction** | Low | Extract the settings UI to shared panes so users can configure LiteAI from within VSCode |
| **Storybook mock providers** | Low | Create `MockPaneProviders` for Storybook stories of pane components with fake data |
| **Message history pagination** | Low | Implement `loadMore()` for sessions with very long message histories |

## Development

The LiteAI VS Code Extension consists of two main parts:
1. **Extension Host**: Runs the VS Code API logic, manages the ServerManager, and handles IPC.
2. **Webview UI**: A SolidJS application built with Vite that renders the Chat interface.

### Prerequisites
Before starting the extension development server, ensure you have built the local `liteai-core` executable, as the extension will attempt to spawn it.

```bash
# From the repository root
bun install
```

### Running in Dev Mode

The extension supports three server connection modes:

#### 1. Dev Mode (recommended for development)

The extension spawns its own core dev server directly from the `packages/core` directory. This is the fastest workflow for iterating on both the extension and the core server.

**Step 1**: Open the `packages/vscode` directory in VS Code.

**Step 2**: Press **`F5`** to launch the Extension Development Host.

The extension will automatically spawn the core dev server (`bun --watch run ...`) in the background.

> **Note:** Because the extension manages spawning the core dev server natively in Development Mode, it now runs with full **`--hosted`** and **`--lsp`** capabilities. Hosted features like live editor buffers, automatic workspace registration, and AI inline completions are natively active during development, mirroring production!

#### 2. Remote Mode

Set the `liteai.server.url` VS Code setting to connect to a remote server:

```json
{
  "liteai.server.url": "http://your-server:9000"
}
```

> **Note:** When using Remote Mode, Core runs independently without `--hosted`, so hosted features like live editor buffers and automatic workspace registration are not available.

#### 3. Production Mode (default)

If no dev URL or remote URL is configured, the extension spawns the bundled `liteai-core` binary from `bin/<platform>-<arch>/` **with `--hosted`**, enabling all Extension Server callbacks (unsaved buffer reads, workspace registration, git delegation).

### F5 Development Workflow

1. Open the workspace (`liteai.code-workspace`) or the `packages/vscode` directory in VS Code.
2. Press **`F5`** to launch the Extension Development Host window. This will automatically run `--watch` builds for both the webview and the extension host in the background, as well as seamlessly spawn the core server.

> **Tip**: If you make changes to the Webview UI, right-click inside the Webview in the debug window and select **Reload Webview** to see changes without restarting the extension host. For Extension Host changes, use `Cmd+Shift+P` -> **Developer: Reload Window**.

## Building for Production

To compile everything and build the final `.vsix` package:

1. Ensure the core executable can be built on your machine:
   ```bash
   cd packages/vscode
   ```
2. Run the automated build script which handles the complete production lifecycle:
   - Builds the `liteai-core` exes
   - Copies the exes into `packages/vscode/bin/`
   - Compiles the webview to `dist/webview/`
   - Typechecks and Lints
   - Builds the extension host to `dist/extension.js`
   - Generates the VSIX package using `vsce`

   ```bash
   bun run package
   ```
