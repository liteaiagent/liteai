# LanguageCapability Proxy — Hosted Mode LSP Strategy

> **Goal:** Restore full AI tool diagnostic and navigation feedback in VSCode hosted mode by proxying language features through the existing HostedCapabilities pattern — eliminating the need to spawn duplicate language servers.

---

## Problem Statement

In hosted mode (VSCode), `bootstrap.ts` disables Core's LSP client engine to avoid spawning duplicate language servers:

```ts
// bootstrap.ts:27
if (!Capabilities.isHosted()) {
  await LSP.init()
} else {
  Log.Default.info("hosted mode — skipping LSP client engine (IDE provides language servers)")
}
```

This is the **correct decision** for resource efficiency, but it has an unintended consequence: all AI tools that consume LSP data return empty results in hosted mode.

### Impact on AI Tool Quality

| AI Tool Action | Standalone (CLI/Web) | Hosted (VSCode) |
|----------------|---------------------|-----------------|
| Post-edit diagnostics (`write`, `edit`, `apply_patch`) | ✅ Full feedback via `LSP.touchFile()` + `LSP.diagnostics()` | ❌ Empty — no clients |
| Go-to-definition (`tool/lsp.ts`) | ✅ Works | ❌ Empty |
| Find references | ✅ Works | ❌ Empty |
| Workspace symbol search | ✅ Works | ❌ Empty |
| Document symbols | ✅ Works | ❌ Empty |
| Hover information | ✅ Works | ❌ Empty |
| Call hierarchy | ✅ Works | ❌ Empty |

The DR-1 tool result attribution system is also ineffective — there are no LSP results to attribute.

---

## Design Decision: Proxy, Don't Duplicate

### Options Evaluated

| Option | Description | Verdict |
|--------|-------------|---------|
| **A. Keep Core LSP active** | Spawn duplicate language servers alongside VSCode's | ❌ **Rejected** — wastes 500MB+ per project, risks diagnostic conflicts |
| **B. Disable and accept the gap** | Current behavior — AI flies blind | ❌ **Rejected** — degrades AI code quality significantly |
| **C. Proxy through HostedCapabilities** | Extension server exposes VSCode language API via HTTP | ✅ **Selected** — zero duplication, richer results, consistent pattern |

### Why Proxy Wins

1. **Pattern consistency** — `HostedCapabilities` already proxies `fs`, `git`, `workspace` through the extension server. Language features are the same category.
2. **Zero duplication** — no duplicate TypeScript servers, no conflicting diagnostics.
3. **Richer results** — user may have specialized extensions (Pylance, Rust Analyzer, etc.) that Core's built-in server list doesn't cover.
4. **User-aligned diagnostics** — the AI sees the exact same errors the user sees in their editor.

---

## Architecture

### Current HostedCapabilities

```
HostCapabilities
├── hosted: boolean
├── fs: FilesystemCapability       ← proxied via extension server
├── git: GitCapability             ← proxied via extension server
└── workspace: WorkspaceCapability ← proxied via extension server
```

### Proposed Extension

```
HostCapabilities
├── hosted: boolean
├── fs: FilesystemCapability       ← existing
├── git: GitCapability             ← existing
├── workspace: WorkspaceCapability ← existing
└── language: LanguageCapability   ← NEW
```

### LanguageCapability Interface

```ts
interface LanguageCapability {
  /** Get diagnostics for a specific file. Waits for analysis to settle if file was recently written. */
  diagnostics(file: string): Promise<Diagnostic[]>

  /** Wait for diagnostics to stabilize after a file change, then return them. */
  waitForDiagnostics(file: string, timeoutMs?: number): Promise<Diagnostic[]>

  /** Get hover information at a position. */
  hover(file: string, line: number, character: number): Promise<HoverResult | null>

  /** Go-to-definition at a position. */
  definition(file: string, line: number, character: number): Promise<Location[]>

  /** Find all references at a position. */
  references(file: string, line: number, character: number): Promise<Location[]>

  /** Find implementations at a position. */
  implementation(file: string, line: number, character: number): Promise<Location[]>

  /** Search workspace symbols by query. */
  workspaceSymbol(query: string, limit?: number): Promise<Symbol[]>

  /** Get symbols in a document. */
  documentSymbol(uri: string): Promise<DocumentSymbol[]>
}
```

### VSCode Extension Server Endpoints

| Endpoint | VSCode API | Purpose |
|----------|-----------|---------|
| `POST /language/diagnostics` | `vscode.languages.getDiagnostics(uri)` | File diagnostics |
| `POST /language/waitForDiagnostics` | Subscribe to `onDidChangeDiagnostics`, debounce, return | Post-edit diagnostics with settle |
| `POST /language/hover` | `vscode.commands.executeCommand('vscode.executeHoverProvider', ...)` | Hover info |
| `POST /language/definition` | `vscode.commands.executeCommand('vscode.executeDefinitionProvider', ...)` | Go-to-definition |
| `POST /language/references` | `vscode.commands.executeCommand('vscode.executeReferenceProvider', ...)` | Find references |
| `POST /language/implementation` | `vscode.commands.executeCommand('vscode.executeImplementationProvider', ...)` | Find implementations |
| `POST /language/workspaceSymbol` | `vscode.commands.executeCommand('vscode.executeWorkspaceSymbolProvider', ...)` | Symbol search |
| `POST /language/documentSymbol` | `vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider', ...)` | Document symbols |

### Core-side Integration

The `LSP` namespace functions (`touchFile`, `diagnostics`, `hover`, etc.) would check `Capabilities.isHosted()` and delegate to `LanguageCapability` instead of the client engine:

```ts
// Pseudocode — LSP.touchFile() in hosted mode
export async function touchFile(input: string, waitForDiagnostics?: boolean) {
  if (Capabilities.isHosted()) {
    const caps = Capabilities.get()
    if (caps.language && waitForDiagnostics) {
      await caps.language.waitForDiagnostics(input)
    }
    return
  }
  // ... existing client engine path
}
```

---

## Phased Implementation

### Phase A — Post-Edit Diagnostics (High Priority)

**Scope:** After the AI writes/edits a file in hosted mode, Core reads diagnostics from VSCode via the proxy.

**Why high priority:** This directly impacts AI code quality on every file write. The tool result attribution system (DR-1) depends on it.

**Components:**
1. `LanguageCapability` interface in `capabilities/types.ts`
2. `POST /language/diagnostics` + `POST /language/waitForDiagnostics` in extension server
3. `HostedLanguage` implementation in `capabilities/hosted.ts`
4. `LSP.touchFile()` and `LSP.diagnostics()` delegation when hosted
5. `LSP.fileDiagnostics()` delegation when hosted

**Timing concern:** When the AI writes a file via `HostedCapabilities.fs.writeFile()`, VSCode will:
1. Detect the file change (via its file watcher)
2. Re-analyze via its extensions
3. Update diagnostics

The `waitForDiagnostics` endpoint must subscribe to `vscode.languages.onDidChangeDiagnostics`, debounce (150ms, matching Core's existing `DIAGNOSTICS_DEBOUNCE_MS`), and return once diagnostics settle. Same pattern as `LSPClient.waitForDiagnostics()` — just proxied via HTTP.

### Phase B — Navigation Features (Medium Priority)

**Scope:** Proxy go-to-definition, references, symbols, hover through the extension server.

**Why medium priority:** These enhance AI navigation quality but aren't required for basic file editing feedback.

**Components:**
1. Remaining `POST /language/*` endpoints in extension server
2. `LanguageCapability` methods for hover, definition, references, etc.
3. `LSP.*()` delegation when hosted

### Phase C — User-Edit Async Notifications (Deferred)

**Scope:** When the user edits files directly in VSCode, the AI is notified so it can react.

**Why deferred:** Requires new infrastructure — an async notification channel into the active conversation. This is the infrastructure mentioned in DR-1 line 19.

**Components:**
1. Async notification channel (WebSocket or SSE push from extension → Core)
2. Extension subscribes to `vscode.workspace.onDidChangeTextDocument`
3. Core surfaces the notification as a system-injected message or context update
4. AI can then propose fixes for user-introduced errors

---

## Relationship to Existing Design Records

- **DR-1** (line 19): The "future consideration" for VSCode LSP server mode. Phase A+B of this roadmap resolves the *AI-initiated* half. Phase C resolves the *user-initiated* half (the async notification channel).
- **DR-2** (file watcher): The file watcher could feed into Phase C's notification channel in standalone mode. In hosted mode, VSCode's own file watcher + `onDidChangeTextDocument` handles this.
- **LSP Handler** (`lsp-handler.ts`): Completely unrelated — that's Core acting as an LSP *server* for AI inline completions. It remains active in hosted mode and is not affected by this roadmap item.

---

## Success Criteria

1. In VSCode hosted mode, AI tools receive diagnostic feedback after file edits (identical to standalone mode)
2. Zero duplicate language server processes
3. Tool result attribution (DR-1) shows LSP source information in hosted mode
4. All existing LSP-powered AI tools work in hosted mode with results from user's installed extensions
