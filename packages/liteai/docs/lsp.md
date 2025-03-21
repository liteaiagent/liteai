# LiteAI — LSP (Language Server Protocol) Integration

LiteAI ships with **out-of-the-box LSP support**, one of its key differentiators from other AI coding agents. The LSP system provides the AI model with real compiler/linter diagnostics so it can detect and fix errors immediately after editing files — no user intervention required.

---

## How It Works — The Big Picture

```
┌──────────────────────────────────────────────────────────────────┐
│                      AI Model (LLM)                              │
│                                                                  │
│  ❶ Model calls a tool (write, edit, apply_patch, or lsp)         │
│  ❺ Model receives diagnostics/results in the tool response       │
│     and auto-fixes errors in the next step                       │
└──────────┬──────────────────────────────────────────┬────────────┘
           │                                          │
     ❷ Passive path                             ❷ Active path
     (automatic)                              (experimental tool)
           │                                          │
    ┌──────▼──────┐                            ┌──────▼──────┐
    │ write/edit/ │                            │   lsp tool  │
    │ apply_patch │                            │ (9 ops)     │
    └──────┬──────┘                            └──────┬──────┘
           │                                          │
           │  ❸ Both paths call into the LSP          │
           │     orchestrator (LSP namespace)         │
           └─────────────┬────────────────────────────┘
                         │
                  ┌──────▼──────┐
                  │     LSP     │   lsp/index.ts
                  │ Orchestrator│   • touchFile()
                  │             │   • diagnostics()
                  │             │   • definition(), hover(), ...
                  └──────┬──────┘
                         │
              ❹ Lazy spawn + JSON-RPC
                         │
           ┌─────────────┼──────────────┐
           │             │              │
    ┌──────▼──────┐ ┌────▼─────┐ ┌─────▼──────┐
    │ LSPClient   │ │ LSPClient│ │ LSPClient  │   lsp/client.ts
    │ (typescript)│ │ (gopls)  │ │ (pyright)  │   • JSON-RPC via
    └──────┬──────┘ └────┬─────┘ └─────┬──────┘     vscode-jsonrpc
           │             │             │
    ┌──────▼──────┐ ┌────▼─────┐ ┌─────▼──────┐
    │ LS Process  │ │ LS Proc  │ │ LS Process │   lsp/server.ts
    │ (stdio)     │ │ (stdio)  │ │ (stdio)    │   • 25+ built-in defs
    └─────────────┘ └──────────┘ └────────────┘   • auto-download
```

---

## Two Integration Modes

### 1. Passive Mode — Automatic Diagnostics (Default)

Every time the AI edits a file via `write`, `edit`, or `apply_patch` tools, the LSP system is **automatically consulted**:

1. **File is "touched"** — `LSP.touchFile(filepath, true)` opens or updates the file in all matching language servers, then waits for fresh diagnostics to arrive.
2. **Diagnostics collected** — `LSP.diagnostics()` gathers errors/warnings from all active clients.
3. **Errors injected into tool response** — Only severity-1 (ERROR) diagnostics are appended to the tool output in an XML format the model can read:

```
Wrote file successfully.

LSP errors detected in this file, please fix:
<diagnostics file="/path/to/file.ts">
ERROR [15:3] Property 'foo' does not exist on type 'Bar'.
ERROR [22:10] Cannot find name 'baz'.
</diagnostics>
```

The model then sees these errors and self-corrects in its next step — creating a **tight feedback loop** without human intervention.

**Limits:**
- Max **20 diagnostics** per file
- Max **5 files** with project-wide diagnostics
- Only `severity === 1` (ERROR) issues are reported (warnings, hints ignored)

**Source:** [write.ts](../packages/liteai/src/tool/write.ts), [edit.ts](../packages/liteai/src/tool/edit.ts), [apply_patch.ts](../packages/liteai/src/tool/apply_patch.ts)

### 2. Active Mode — The `lsp` Tool (Experimental)

Behind the feature flag `LITEAI_EXPERIMENTAL_LSP_TOOL`, the model can directly invoke LSP operations:

| Operation | LSP Method | Description |
|---|---|---|
| `goToDefinition` | `textDocument/definition` | Jump to where a symbol is defined |
| `findReferences` | `textDocument/references` | Find all usages of a symbol |
| `hover` | `textDocument/hover` | Get type info & documentation |
| `documentSymbol` | `textDocument/documentSymbol` | List all symbols in a file |
| `workspaceSymbol` | `workspace/symbol` | Search symbols across workspace |
| `goToImplementation` | `textDocument/implementation` | Find interface implementations |
| `prepareCallHierarchy` | `textDocument/prepareCallHierarchy` | Get call hierarchy items |
| `incomingCalls` | `callHierarchy/incomingCalls` | Who calls this function? |
| `outgoingCalls` | `callHierarchy/outgoingCalls` | What does this function call? |

**Parameters:** `filePath`, `line` (1-based), `character` (1-based), `operation`

The `read` tool also silently warms up LSP clients when opening files (`LSP.touchFile(file, false)` — no diagnostic wait) so servers are ready when the model later edits.

**Source:** [tool/lsp.ts](../packages/liteai/src/tool/lsp.ts), [tool/lsp.txt](../packages/liteai/src/tool/lsp.txt)

---

## Architecture Deep-Dive

### Source Files

| File | Lines | Role |
|---|---|---|
| [lsp/index.ts](../packages/liteai/src/lsp/index.ts) | ~487 | **Orchestrator** — public API, lazy client management, LSP operations |
| [lsp/client.ts](../packages/liteai/src/lsp/client.ts) | ~252 | **Client** — JSON-RPC connection, notifications, diagnostics collection |
| [lsp/server.ts](../packages/liteai/src/lsp/server.ts) | ~2098 | **Server definitions** — 25+ built-in language servers with auto-install |
| [lsp/language.ts](../packages/liteai/src/lsp/language.ts) | ~121 | **Language map** — file extension → LSP `languageId` mapping |

---

### `LSPServer` — Server Definitions (`lsp/server.ts`)

Each server is an `Info` object with:

```ts
interface Info {
  id: string                                          // unique identifier
  extensions: string[]                                // file extensions it handles
  root: (file: string) => Promise<string | undefined> // workspace root detection
  spawn(root: string): Promise<Handle | undefined>    // process spawning logic
}
```

**Root detection** uses `NearestRoot(patterns)` — walks up from the file looking for marker files (e.g., `package.json`, `Cargo.toml`, `go.mod`) and stops at the project/instance directory.

**Auto-download:** Many servers auto-install themselves if not found on PATH. This can be disabled with `LITEAI_DISABLE_LSP_DOWNLOAD`.

#### Built-in Servers

| Server ID | Language(s) | Root Markers | Auto-Download? |
|---|---|---|---|
| `typescript` | `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.mts`, `.cts` | `package-lock.json`, `bun.lock`, etc. | Via `bun x typescript-language-server` |
| `deno` | `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs` | `deno.json`, `deno.jsonc` | Requires `deno` in PATH |
| `vue` | `.vue` | Lock files | Auto-installs `@vue/language-server` |
| `eslint` | `.ts`, `.tsx`, `.js`, `.jsx`, `.vue`, etc. | Lock files | Downloads & builds VS Code ESLint server |
| `oxlint` | `.ts`, `.tsx`, `.js`, `.jsx`, `.vue`, `.astro`, `.svelte` | Lock files, `.oxlintrc.json` | Requires `oxlint` in PATH or node_modules |
| `biome` | JS/TS, JSON, CSS, GraphQL, HTML, Vue, Astro, Svelte | `biome.json`/`.jsonc`, lock files | Via `bun x biome` |
| `gopls` | `.go` | `go.mod`, `go.sum`, `go.work` | `go install golang.org/x/tools/gopls@latest` |
| `pyright` | `.py`, `.pyi` | `pyproject.toml`, `requirements.txt`, etc. | Auto-installs via `bun install pyright` |
| `ty` | `.py`, `.pyi` | Same as pyright | Experimental (flag `LITEAI_EXPERIMENTAL_LSP_TY`) |
| `rust` | `.rs` | `Cargo.toml`, `Cargo.lock` (walks up to workspace) | Requires `rust-analyzer` in PATH |
| `clangd` | `.c`, `.cpp`, `.cc`, `.h`, `.hpp`, etc. | `compile_commands.json`, `CMakeLists.txt`, `Makefile` | Downloads from GitHub releases |
| `zls` | `.zig`, `.zon` | `build.zig` | Downloads from GitHub releases |
| `jdtls` | `.java` | `pom.xml`, `build.gradle`, `.project` | Downloads Eclipse JDT.LS |
| `kotlin-ls` | `.kt`, `.kts` | Gradle/Maven markers | Downloads from JetBrains CDN |
| `csharp` | `.cs` | `.sln`, `.csproj`, `global.json` | `dotnet tool install csharp-ls` |
| `fsharp` | `.fs`, `.fsi`, `.fsx` | `.sln`, `.fsproj`, `global.json` | `dotnet tool install fsautocomplete` |
| `ruby-lsp` | `.rb`, `.rake`, `.gemspec`, `.ru` | `Gemfile` | `gem install rubocop` |
| `elixir-ls` | `.ex`, `.exs` | `mix.exs`, `mix.lock` | Downloads from GitHub, compiles with Mix |
| `sourcekit-lsp` | `.swift` | `Package.swift`, `*.xcodeproj` | Via Xcode/Swift toolchain |
| `svelte` | `.svelte` | Lock files | Auto-installs `svelte-language-server` |
| `astro` | `.astro` | Lock files | Auto-installs `@astrojs/language-server` |
| `yaml-ls` | `.yaml`, `.yml` | Lock files | Auto-installs `yaml-language-server` |
| `lua-ls` | `.lua` | `.luarc.json`, `.stylua.toml`, etc. | Downloads from GitHub releases |
| `php intelephense` | `.php` | `composer.json`, `composer.lock` | Auto-installs `intelephense` |
| `prisma` | `.prisma` | `schema.prisma` | — |
| + more... | | | |

> **Note:** `deno` and `typescript` are mutually exclusive — if `deno.json` is detected, the TypeScript server is skipped for that workspace root.

---

### `LSPClient` — JSON-RPC Client (`lsp/client.ts`)

Uses `vscode-jsonrpc` to communicate with language server processes over stdio.

**Lifecycle:**

1. **Connection created** via `StreamMessageReader`/`StreamMessageWriter` on the server process's stdin/stdout
2. **Initialize handshake** — sends `initialize` request with capabilities, workspace folders, and root URI (45s timeout)
3. **Capabilities declared:** text document sync (open/change), diagnostics, work-done progress, workspace configuration
4. **Notification handlers:**
   - `textDocument/publishDiagnostics` → stores diagnostics per file path and publishes bus events
   - `workspace/configuration` → returns server initialization options
   - `workspace/workspaceFolders` → returns workspace root
   - `window/workDoneProgress/create` → acknowledged
5. **File sync:** `notify.open(path)` either sends `textDocument/didOpen` (first time) or `textDocument/didChange` + `workspace/didChangeWatchedFiles` (subsequent), tracking version numbers internally

**Diagnostic waiting:** `waitForDiagnostics(path)` subscribes to the bus event and uses a **150ms debounce** (so semantic diagnostics can follow syntax ones), with a **3-second timeout**.

---

### `LSP` Namespace — Orchestrator (`lsp/index.ts`)

The main module tying everything together.

**Key behaviors:**

- **Lazy initialization** — servers are only spawned when a matching file is first touched
- **Instance state** — managed per `Instance` (project), with cleanup on shutdown
- **Broken tracking** — if a server fails to spawn or initialize, it's marked as `broken` and skipped for that root
- **Deduplication** — `spawning` map prevents simultaneous spawns of the same server for the same root
- **Config merge** — built-in servers can be overridden or supplemented by user config; custom servers require only `command` + `extensions`
- **Bus events** — `lsp.updated` published when new clients connect; `lsp.client.diagnostics` per diagnostic update

---

## Configuration

### In `liteai.json` / `.liteai/config.json`

```jsonc
{
  // Disable ALL LSP servers
  "lsp": false,

  // Or configure per server:
  "lsp": {
    // Disable a specific built-in server
    "eslint": { "disabled": true },

    // Override a built-in server's command
    "typescript": {
      "command": ["custom-tsserver", "--stdio"]
    },

    // Add a completely custom server
    "my-custom-lsp": {
      "command": ["my-lsp-binary", "--stdio"],
      "extensions": [".myext", ".myext2"],
      "env": { "MY_VAR": "value" },
      "initialization": { "some": "setting" }
    }
  }
}
```

**Schema for each entry:**

| Field | Type | Required | Description |
|---|---|---|---|
| `command` | `string[]` | Yes (for custom) | The command to spawn the server |
| `extensions` | `string[]` | Yes (for custom) | File extensions this server handles |
| `disabled` | `boolean` | No | Set `true` to disable |
| `env` | `Record<string, string>` | No | Extra environment variables |
| `initialization` | `Record<string, any>` | No | Initialization options sent to the server |

> For built-in servers, you can omit `command` and `extensions` — only overridden fields are applied.

### Environment Flags

| Flag | Effect |
|---|---|
| `LITEAI_DISABLE_LSP_DOWNLOAD` | Prevent auto-downloading of LSP server binaries |
| `LITEAI_EXPERIMENTAL_LSP_TOOL` | Enable the `lsp` tool for the AI model |
| `LITEAI_EXPERIMENTAL_LSP_TY` | Use `ty` instead of `pyright` for Python |

### Permissions

LSP operations require the `lsp` permission in agent config:

```jsonc
{
  "agent": {
    "build": {
      "permission": {
        "lsp": "allow"   // or "deny", or rules with patterns
      }
    }
  }
}
```

---

## Language ID Mapping (`lsp/language.ts`)

The `LANGUAGE_EXTENSIONS` map translates ~80+ file extensions to LSP `languageId` strings (e.g., `.tsx` → `"typescriptreact"`, `.rs` → `"rust"`, `.go` → `"go"`). This is used when sending `textDocument/didOpen` to tell the server what language the file is in.

Supported languages include: TypeScript/JavaScript, Python, Go, Rust, C/C++, C#, F#, Java, Kotlin, Ruby, Elixir, Erlang, Swift, Zig, Lua, PHP, Dart, Scala, Haskell, OCaml, Vue, Svelte, Astro, Terraform, Nix, Typst, and 50+ more.

---

## Debug Command

```bash
liteai debug lsp    # or: bun dev debug lsp
```

Source: [cli/cmd/debug/lsp.ts](../packages/liteai/src/cli/cmd/debug/lsp.ts)

---

## Summary

| Aspect | Detail |
|---|---|
| **Integration style** | Passive (auto-diagnostics) + Active (experimental tool) |
| **Transport** | JSON-RPC over stdio via `vscode-jsonrpc` |
| **Server management** | Lazy spawn, auto-download, per-project instances |
| **Built-in servers** | 25+ languages |
| **Diagnostic feedback** | Injected into tool output → model self-corrects |
| **Configuration** | `liteai.json` `lsp` field — disable, override, or add servers |
| **Feature flags** | `LITEAI_EXPERIMENTAL_LSP_TOOL`, `LITEAI_DISABLE_LSP_DOWNLOAD` |
