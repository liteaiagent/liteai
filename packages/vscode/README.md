# LiteAI VS Code Extension

A Visual Studio Code extension that integrates LiteAI directly into your development workflow. Chat with AI agents, submit prompts, stream responses in real-time, and manage sessions — all from a native VSCode side panel.

## Supported Features

### Chat Interface
- Full chat UI with the same `ChatPane` component used in the web app
- Send prompts to AI agents with model/agent selection
- Real-time streaming responses via SSE (Server-Sent Events)
- View reasoning, tool calls, file edits, and text output
- Session management: create, rename, archive, delete, share/unshare
- Abort running requests

### Model & Agent Selection
- Lists all connected AI providers and their models (fetched from Core's `/provider` endpoint)
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
- Automatically registers `vscode.workspace.workspaceFolders` with Core on startup
- Listens to `onDidChangeWorkspaceFolders` for real-time sync

### File Navigation
- Click file references in chat output to open them in the editor
- `openFile(path)` wired end-to-end: webview → postMessage → Extension Host → `vscode.window.showTextDocument`

### Human-in-the-Loop (HITL)
- **Inline diff decorations** — green (added) / blue (modified) gutter markers on agent file edits
- **CodeLens controls** — `✓ Accept Changes` / `✗ Reject Changes` at the top of edited files
- **Permission system** — tool calls requiring approval render an inline gate in the chat panel
- **Question tool** — agent-initiated questions render as forms in the chat panel
- Accept/reject keybindings: `Ctrl+Shift+Y` / `Ctrl+Shift+Backspace`

### Inline AI Completions
- Ghost-text fill-in-the-middle completions via the built-in LSP server
- Incremental document sync — no full-document transfer on each keystroke

### SSE Event Streaming
Full real-time event coverage: session lifecycle, messages, streaming parts, permissions, questions, TODO tracking, VCS updates.

## Development

### Prerequisites

```bash
bun install   # from repository root
```

### Running in Dev Mode

**Dev Mode (recommended):** Open `packages/vscode` in VS Code → press **`F5`**. The extension spawns the core dev server with full `--hosted` and `--lsp` capabilities.

**Remote Mode:** Set `liteai.server.url` in VS Code settings to connect to a remote server (hosted features unavailable).

**Production Mode (default):** Extension spawns the bundled `liteai-core` binary with `--hosted`.

> **Tip:** Webview changes → right-click → **Reload Webview**. Extension Host changes → **Developer: Reload Window**.

### Building for Production

```bash
cd packages/vscode
bun run package
```

## Architecture & Specs

Detailed architecture docs, hosted mode internals, and feature roadmap are maintained in [`roadmap/hosted-language-proxy/spec/`](../../roadmap/hosted-language-proxy/spec/):

| Document | Contents |
|----------|----------|
| [vscode-extension-architecture.md](../../roadmap/hosted-language-proxy/spec/vscode-extension-architecture.md) | Three-layer architecture, hosted mode mechanics, HITL internals |
| [vscode-extension-roadmap.md](../../roadmap/hosted-language-proxy/spec/vscode-extension-roadmap.md) | Planned features: terminal integration, persistent server, pane extractions |
| [language-capability-proxy.md](../../roadmap/hosted-language-proxy/spec/language-capability-proxy.md) | Proxying VSCode's native LSP results to Core's AI tools |
| [ai-lsp-features.md](../../roadmap/hosted-language-proxy/spec/ai-lsp-features.md) | AI-powered code actions, hover, diagnostics, code lens |
