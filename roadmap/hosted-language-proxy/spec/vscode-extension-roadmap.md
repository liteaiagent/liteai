# VSCode Extension — Feature Roadmap

> **Purpose:** Consolidated backlog of planned VSCode extension features. Items are sourced from the original `packages/vscode/doc/TODO.md` and `packages/vscode/README.md`. Language-related items are tracked separately in their own spec docs within this directory.

---

## Hosted Capability Expansions

### Terminal Integration (`TerminalCapability`)
**Priority:** Medium

Route agent terminal commands (`bash`, `npm run`, etc.) through VSCode's integrated terminal panel instead of Core's built-in PTY.

**Benefits:**
- Terminal output visible to the user in the IDE
- User can gracefully kill processes via the terminal panel
- Execution runs in the IDE's exact context (SSH Remote, DevContainer, WSL)
- Leverages VSCode's shell integration API for richer command tracking

**Implementation direction:**
- New `TerminalCapability` interface in `capabilities/types.ts`
- `POST /terminal/run` endpoint on the Extension Server
- Uses `vscode.window.createTerminal()` + shell integration API
- Core delegates `Process.run()` calls through the proxy when hosted

### Persistent Server
**Priority:** Low

Option to keep the Core server running after VSCode closes, so sessions persist across IDE restarts.

**Implementation direction:**
- Extension spawns Core without tying lifecycle to VSCode
- Reconnection logic in `ServerManager` on extension activate
- Health-check endpoint polling
- Graceful shutdown on explicit user action

---

## UI / Pane Extractions

### TracePane Extraction
**Priority:** Low

Extract the trace/debugging view from `packages/web` to `packages/ui/panes` so it can render in the VSCode webview panel.

### SettingsPane Extraction
**Priority:** Low

Extract the settings UI to shared panes so users can configure LiteAI from within VSCode without opening the web dashboard.

### Storybook Mock Providers
**Priority:** Low

Create `MockPaneProviders` for Storybook stories of pane components with fake data, enabling isolated development and visual testing of UI components.

---

## Data & UX

### Message History Pagination
**Priority:** Low

Implement `loadMore()` for sessions with very long message histories. Currently all messages are loaded at once, which degrades performance for extended conversations.

---

## Cross-Reference

| Item | Spec Document |
|------|---------------|
| Language Capability Proxy (diagnostics, navigation forwarding) | [language-capability-proxy.md](./language-capability-proxy.md) |
| AI-Augmented LSP Features (code actions, hover, code lens) | [ai-lsp-features.md](./ai-lsp-features.md) |
| Extension Architecture & Dev Workflow | [vscode-extension-architecture.md](./vscode-extension-architecture.md) |
