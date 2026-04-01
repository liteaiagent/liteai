# liteai core

The core backend package for LiteAI — an AI coding agent for the terminal, web, and IDE. This package contains the agent loop, provider integrations, LSP client, and all server logic. It compiles into self-contained native binaries via Bun.

## Requirements

- [Bun](https://bun.sh) (see root `package.json` → `packageManager` for the required version)

## Install dependencies

From the repo root:

```bash
bun install
```

---

## Running

### Standard dev server

```bash
bun run dev
```

Starts the HTTP/SSE server on `http://127.0.0.1:9000`. Used by the web app and CLI.

### Hosted mode (spawned by VS Code extension — production)

```bash
liteai-core \
  --hosted \
  --port 0 \
  --csrf-token <csrf> \
  --extension-port <callbackPort> \
  --extension-server-csrf-token <callbackCsrf>
```

Core delegates filesystem, git, and workspace operations back to the VS Code extension via HTTP callbacks. See [Communication Channels](./docs/channels.md) for details.

### Hosted mode + LSP (spawned by VS Code extension — with AI editor features)

```bash
liteai-core \
  --hosted \
  --port 0 \
  --csrf-token <csrf> \
  --extension-port <callbackPort> \
  --extension-server-csrf-token <callbackCsrf> \
  --lsp
```

Adds an LSP server on `stdin/stdout` alongside the HTTP server. The VS Code extension's `LanguageClient` connects to this stdio pipe for AI inline completions. The HTTP server and hosted callback behaviour are unchanged.

> **Note:** When `--lsp` is active, the `"listening on http://..."` startup message is written to **stderr** instead of stdout (stdout is owned by LSP JSON-RPC framing).

### All flags

| Flag | Default | Description |
|---|---|---|
| `--port` / `-p` | `0` | HTTP port (`0` = OS auto-assigns) |
| `--hostname` / `-H` | `127.0.0.1` | HTTP bind address |
| `--csrf-token` | — | Bearer token required for all API requests |
| `--debug` / `-d` | `false` | Enable `DEBUG`-level logging |
| `--print-logs` | `false` | Print structured logs to stderr |
| `--hosted` | `false` | Delegate fs/git/workspace to IDE via HTTP callbacks |
| `--extension-port` | — | IDE callback server port (required with `--hosted`) |
| `--extension-server-csrf-token` | — | CSRF token for IDE callback server (required with `--hosted`) |
| `--lsp` | `false` | Start LSP server on stdio for AI editor features (inline completions) |

---

## Building

### Dev build — current platform only (fast, for local testing)

```bash
bun run build:exe
```

Produces a native binary at:
```
dist/liteai-core-<os>-<arch>/bin/liteai-core[.exe]
```

You can run it directly:
```bash
./dist/liteai-core-linux-x64/bin/liteai-core --version
# Windows:
.\dist\liteai-core-windows-x64\bin\liteai-core.exe --version
```

### Build all platforms (needed before releasing)

```bash
bun run build:exe --all
```

This builds **12 targets** across all platforms:

| Target | For |
|--------|-----|
| `liteai-core-linux-arm64` | Linux ARM64 (glibc) |
| `liteai-core-linux-x64` | Linux x64 (glibc, AVX2) |
| `liteai-core-linux-x64-baseline` | Linux x64 (glibc, no AVX2 — older CPUs) |
| `liteai-core-linux-arm64-musl` | Linux ARM64 (Alpine/musl) |
| `liteai-core-linux-x64-musl` | Linux x64 (Alpine/musl, AVX2) |
| `liteai-core-linux-x64-baseline-musl` | Linux x64 (Alpine/musl, no AVX2) |
| `liteai-core-darwin-arm64` | macOS Apple Silicon |
| `liteai-core-darwin-x64` | macOS Intel (AVX2) |
| `liteai-core-darwin-x64-baseline` | macOS Intel (no AVX2 — older Macs) |
| `liteai-core-windows-arm64` | Windows ARM64 |
| `liteai-core-windows-x64` | Windows x64 (AVX2) |
| `liteai-core-windows-x64-baseline` | Windows x64 (no AVX2 — older CPUs) |

---

## Releasing

The `@liteai/core` package is not released independently. To release the full LiteAI application, use the scripts from the repository root:

```bash
# Run from the repository root
bun run release
```

---

## Type checking

```bash
bun run typecheck
```

## Tests

```bash
bun test
```

> Tests must be run from this directory (`packages/core`), not the repo root.

### Running specific test suites

```bash
# LSP handler unit tests (prompt building, edge cases)
bun test test/lsp/lsp-handler.test.ts

# LSP handler integration tests (subprocess JSON-RPC handshake)
bun test test/lsp/lsp-handler-integration.test.ts

# All LSP tests
bun test test/lsp
```

---

## Documentation

- [Communication Channels](./docs/channels.md) — all transports used between core, the IDE, and clients
- [Architecture Overview](./docs/README.md) — module directory and high-level design
