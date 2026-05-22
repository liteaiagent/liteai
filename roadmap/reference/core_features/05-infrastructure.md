# LiteAI Core — Infrastructure & Platform

> **Scope:** `src/storage/`, `src/telemetry/`, `src/project/`, `src/control-plane/`, `src/worktree/`, `src/isolation/`, `src/lsp/`, `src/file/`, `src/acp/`, `src/capabilities/`, `src/auth/`, `src/account/`, `src/share/`, `src/snapshot/`, `src/scheduler/`, `src/bus/`, `src/env/`, `src/flag/`, `src/shell/`, `src/pty/`, `src/ide/`, `src/installation/`, `src/global/`, `src/id/`, `src/effect/`, `src/bun/`  
> **Last audited:** 2026-05-09

---

## 1. Storage Layer

📁 **Scanned:** `src/storage/`

| Feature | Status | Source |
|---|:---:|---|
| SQLite Database Client | ✅ | [`storage/db.ts`](../../packages/core/src/storage/db.ts) |
| Full-Text Search (FTS) | ✅ | [`storage/fts.ts`](../../packages/core/src/storage/fts.ts) |
| Storage Schema (SQL) | ✅ | [`storage/schema.sql.ts`](../../packages/core/src/storage/schema.sql.ts) |
| Storage Schema (Zod) | ✅ | [`storage/schema.ts`](../../packages/core/src/storage/schema.ts) |
| Storage Service | ✅ | [`storage/storage.ts`](../../packages/core/src/storage/storage.ts) |

---

## 2. Telemetry & Observability

📁 **Scanned:** `src/telemetry/`

| Feature | Status | Source |
|---|:---:|---|
| OTel Instrumentation | ✅ | [`telemetry/instrumentation.ts`](../../packages/core/src/telemetry/instrumentation.ts) (10KB) |
| Exporter Factories | ✅ | [`telemetry/factories.ts`](../../packages/core/src/telemetry/factories.ts) |
| Perfetto Trace Export | ✅ | [`telemetry/perfetto.ts`](../../packages/core/src/telemetry/perfetto.ts) |
| Diagnostic Service | ✅ | [`telemetry/diagnostic.ts`](../../packages/core/src/telemetry/diagnostic.ts) |
| Index | ✅ | [`telemetry/index.ts`](../../packages/core/src/telemetry/index.ts) |

---

## 3. Project Management

📁 **Scanned:** `src/project/`

| Feature | Status | Source |
|---|:---:|---|
| Project Model | ✅ | [`project/project.ts`](../../packages/core/src/project/project.ts) (18KB) |
| Project Instance (per-project runtime) | ✅ | [`project/instance.ts`](../../packages/core/src/project/instance.ts) |
| Project Bootstrap | ✅ | [`project/bootstrap.ts`](../../packages/core/src/project/bootstrap.ts) |
| Project Schema | ✅ | [`project/schema.ts`](../../packages/core/src/project/schema.ts) |
| Project SQL | ✅ | [`project/project.sql.ts`](../../packages/core/src/project/project.sql.ts) |
| Project State | ✅ | [`project/state.ts`](../../packages/core/src/project/state.ts) |
| VCS Detection (Git) | ✅ | [`project/vcs.ts`](../../packages/core/src/project/vcs.ts) |

---

## 4. Control Plane (Multi-Workspace)

📁 **Scanned:** `src/control-plane/`

| Feature | Status | Source |
|---|:---:|---|
| Workspace Model | ✅ | [`control-plane/workspace.ts`](../../packages/core/src/control-plane/workspace.ts) |
| Workspace Context | ✅ | [`control-plane/workspace-context.ts`](../../packages/core/src/control-plane/workspace-context.ts) |
| Workspace Router Middleware | ✅ | [`control-plane/workspace-router-middleware.ts`](../../packages/core/src/control-plane/workspace-router-middleware.ts) |
| Workspace SQL | ✅ | [`control-plane/workspace.sql.ts`](../../packages/core/src/control-plane/workspace.sql.ts) |
| Workspace SSE | ✅ | [`control-plane/sse.ts`](../../packages/core/src/control-plane/sse.ts) |
| Control Plane Schema | ✅ | [`control-plane/schema.ts`](../../packages/core/src/control-plane/schema.ts) |
| Control Plane Types | ✅ | [`control-plane/types.ts`](../../packages/core/src/control-plane/types.ts) |
| Workspace Server | ✅ | [`control-plane/workspace-server/`](../../packages/core/src/control-plane/workspace-server/) |
| Worktree Adaptor | ✅ | [`control-plane/adaptors/worktree.ts`](../../packages/core/src/control-plane/adaptors/worktree.ts) |

---

## 5. Worktree (Git Working Directory)

📁 **Scanned:** `src/worktree/`

| Feature | Status | Source |
|---|:---:|---|
| Worktree Manager | ✅ | [`worktree/index.ts`](../../packages/core/src/worktree/index.ts) (20KB) |

---

## 6. Isolation (Sandboxing)

📁 **Scanned:** `src/isolation/`

| Feature | Status | Source |
|---|:---:|---|
| Docker Isolation | ✅ | [`isolation/docker.ts`](../../packages/core/src/isolation/docker.ts) |
| Isolation Registry | ✅ | [`isolation/registry.ts`](../../packages/core/src/isolation/registry.ts) |

---

## 7. LSP Integration

📁 **Scanned:** `src/lsp/` — 40 language server adapters

| Feature | Status | Source |
|---|:---:|---|
| LSP Client | ✅ | [`lsp/client.ts`](../../packages/core/src/lsp/client.ts) |
| LSP Index (lifecycle) | ✅ | [`lsp/index.ts`](../../packages/core/src/lsp/index.ts) (17KB) |
| Language Detection | ✅ | [`lsp/language.ts`](../../packages/core/src/lsp/language.ts) |
| LSP Handler | ✅ | [`lsp/lsp-handler.ts`](../../packages/core/src/lsp/lsp-handler.ts) |
| Language Servers (40 adapters) | ✅ | [`lsp/server/`](../../packages/core/src/lsp/server/) — TypeScript, Python (Pyright/Ty), Rust, Go, Java, Kotlin, C#, F#, C/C++, Dart, Elixir, Gleam, Haskell, Julia, Lua, Nix, OCaml, PHP, Ruby, Swift, Zig, Bash, Clojure, Vue, Svelte, Astro, Prisma, Terraform, Docker, YAML, LaTeX/TeX, Typst, Deno, ESLint, Biome, OxLint, RuboCop |

---

## 8. File System

📁 **Scanned:** `src/file/`

| Feature | Status | Source |
|---|:---:|---|
| File Service | ✅ | [`file/index.ts`](../../packages/core/src/file/index.ts) (18KB) |
| File Ignore (.gitignore) | ✅ | [`file/ignore.ts`](../../packages/core/src/file/ignore.ts) |
| Protected Files | ✅ | [`file/protected.ts`](../../packages/core/src/file/protected.ts) |
| Ripgrep Integration | ✅ | [`file/ripgrep.ts`](../../packages/core/src/file/ripgrep.ts) (12KB) |
| File Timestamps | ✅ | [`file/time.ts`](../../packages/core/src/file/time.ts) |
| File Watcher | ✅ | [`file/watcher.ts`](../../packages/core/src/file/watcher.ts) |

---

## 9. ACP (Agent Communication Protocol)

📁 **Scanned:** `src/acp/`

| Feature | Status | Source |
|---|:---:|---|
| ACP Agent | ✅ | [`acp/agent.ts`](../../packages/core/src/acp/agent.ts) (26KB) |
| ACP Events | ✅ | [`acp/events.ts`](../../packages/core/src/acp/events.ts) (26KB) |
| ACP Session | ✅ | [`acp/session.ts`](../../packages/core/src/acp/session.ts) |
| ACP Model | ✅ | [`acp/model.ts`](../../packages/core/src/acp/model.ts) |
| ACP Mapper | ✅ | [`acp/mapper.ts`](../../packages/core/src/acp/mapper.ts) |
| ACP Types | ✅ | [`acp/types.ts`](../../packages/core/src/acp/types.ts) |

---

## 10. Capabilities (Local / Hosted)

📁 **Scanned:** `src/capabilities/`

| Feature | Status | Source |
|---|:---:|---|
| Capabilities Interface | ✅ | [`capabilities/types.ts`](../../packages/core/src/capabilities/types.ts) |
| Capabilities Context | ✅ | [`capabilities/context.ts`](../../packages/core/src/capabilities/context.ts) |
| Local Capabilities | ✅ | [`capabilities/local.ts`](../../packages/core/src/capabilities/local.ts) |
| Hosted Capabilities (IDE) | ✅ | [`capabilities/hosted.ts`](../../packages/core/src/capabilities/hosted.ts) |

---

## 11. Authentication

📁 **Scanned:** `src/auth/`

| Feature | Status | Source |
|---|:---:|---|
| Auth Index | ✅ | [`auth/index.ts`](../../packages/core/src/auth/index.ts) |
| Auth Provider Interface | ✅ | [`auth/provider.ts`](../../packages/core/src/auth/provider.ts) |
| Auth Registry | ✅ | [`auth/registry.ts`](../../packages/core/src/auth/registry.ts) |
| Auth Service | ✅ | [`auth/service.ts`](../../packages/core/src/auth/service.ts) |

---

## 12. Account System

📁 **Scanned:** `src/account/`

| Feature | Status | Source |
|---|:---:|---|
| Account Index | ✅ | [`account/index.ts`](../../packages/core/src/account/index.ts) |
| Account Repository | ✅ | [`account/repo.ts`](../../packages/core/src/account/repo.ts) |
| Account Schema | ✅ | [`account/schema.ts`](../../packages/core/src/account/schema.ts) |
| Account Service | ✅ | [`account/service.ts`](../../packages/core/src/account/service.ts) (13KB) |
| Account SQL | ✅ | [`account/account.sql.ts`](../../packages/core/src/account/account.sql.ts) |

---

## 13. Session Sharing

📁 **Scanned:** `src/share/`

| Feature | Status | Source |
|---|:---:|---|
| Share Service (Next) | ✅ | [`share/share-next.ts`](../../packages/core/src/share/share-next.ts) |
| Share SQL | ✅ | [`share/share.sql.ts`](../../packages/core/src/share/share.sql.ts) |

---

## 14. Snapshot System

📁 **Scanned:** `src/snapshot/`

| Feature | Status | Source |
|---|:---:|---|
| Snapshot Manager | ✅ | [`snapshot/index.ts`](../../packages/core/src/snapshot/index.ts) (11KB) |

---

## 15. Event Bus

📁 **Scanned:** `src/bus/`

| Feature | Status | Source |
|---|:---:|---|
| Event Bus | ✅ | [`bus/index.ts`](../../packages/core/src/bus/index.ts) |
| Bus Event Definitions | ✅ | [`bus/bus-event.ts`](../../packages/core/src/bus/bus-event.ts) |
| Global Bus Events | ✅ | [`bus/global.ts`](../../packages/core/src/bus/global.ts) |
| TUI Bus Events | ✅ | [`bus/tui-event.ts`](../../packages/core/src/bus/tui-event.ts) |

---

## 16. Miscellaneous Infrastructure

| Feature | Status | Source |
|---|:---:|---|
| Shell Detection | ✅ | [`shell/shell.ts`](../../packages/core/src/shell/shell.ts) |
| PTY Service | ✅ | [`pty/index.ts`](../../packages/core/src/pty/index.ts) |
| PTY Schema | ✅ | [`pty/schema.ts`](../../packages/core/src/pty/schema.ts) |
| IDE Integration | ✅ | [`ide/index.ts`](../../packages/core/src/ide/index.ts) |
| Installation Metadata | ✅ | [`installation/index.ts`](../../packages/core/src/installation/index.ts) |
| Global Paths | ✅ | [`global/index.ts`](../../packages/core/src/global/index.ts) |
| Feature Flags | ✅ | [`flag/flag.ts`](../../packages/core/src/flag/flag.ts) |
| Environment Config | ✅ | [`env/index.ts`](../../packages/core/src/env/index.ts) |
| Effect Runtime | ✅ | [`effect/runtime.ts`](../../packages/core/src/effect/runtime.ts) |
| Runtime Bootstrap | ✅ | [`runtime.ts`](../../packages/core/src/runtime.ts) |
| Scheduler | ✅ | [`scheduler/index.ts`](../../packages/core/src/scheduler/index.ts) |
| Entrypoint | ✅ | [`main.ts`](../../packages/core/src/main.ts) |

---

## Summary

| Category | ✅ | 🔶 | ❌ | Total |
|---|:---:|:---:|:---:|:---:|
| Storage | 5 | 0 | 0 | 5 |
| Telemetry | 5 | 0 | 0 | 5 |
| Project | 7 | 0 | 0 | 7 |
| Control Plane | 9 | 0 | 0 | 9 |
| Worktree | 1 | 0 | 0 | 1 |
| Isolation | 2 | 0 | 0 | 2 |
| LSP | 5 | 0 | 0 | 5 |
| File System | 6 | 0 | 0 | 6 |
| ACP | 6 | 0 | 0 | 6 |
| Capabilities | 4 | 0 | 0 | 4 |
| Authentication | 4 | 0 | 0 | 4 |
| Account | 5 | 0 | 0 | 5 |
| Session Sharing | 2 | 0 | 0 | 2 |
| Snapshot | 1 | 0 | 0 | 1 |
| Event Bus | 4 | 0 | 0 | 4 |
| Misc Infrastructure | 12 | 0 | 0 | 12 |
| **Total** | **78** | **0** | **0** | **78** |
