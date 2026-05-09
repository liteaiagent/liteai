# CLI → Filesystem Direct Access Audit

> **Context**: Core can be deployed on a remote server (the `attach` command already supports this). Any filesystem access in `packages/cli` that touches the **project workspace** without going through core's HTTP API will break in remote mode.

## Classification Key

| Category | Meaning |
|----------|---------|
| 🔴 **VIOLATION** | Accesses **project workspace** files directly — breaks in remote mode |
| 🟡 **BORDERLINE** | Accesses **project-adjacent** config — may break depending on deployment |
| 🟢 **LEGITIMATE** | Accesses **CLI-local** state (user home, tmp, clipboard) — inherently local |

---

## 🔴 VIOLATIONS — Project Workspace FS Access in CLI

### 1. `dialog-search.tsx` → Workspace Search (via SDK ✅)

> [!TIP]
> This one is actually **already correct**. The `DialogSearch` component calls `sdk.fetch(${sdk.url}/find?pattern=...)` which goes through core's `/find` route. Ripgrep executes server-side. **No violation here.**

### 2. `directory-completion.ts` → Direct `readdir()` on workspace paths

[directory-completion.ts](file:///d:/liteai/packages/cli/src/tui/components/prompt/utils/directory-completion.ts)

```
import { readdir } from "node:fs/promises"
```

- `scanDirectory()` (L110) — calls `readdir(dirPath)` for `@directory` tab-completion
- `scanDirectoryForPaths()` (L172) — calls `readdir(dirPath)` for `@file` tab-completion
- `parsePartialPath()` (L89) — uses `process.cwd()` as base

**Impact**: When CLI is attached to a remote core, `process.cwd()` is the local machine's CWD, not the remote project. Tab-completion of `@file` and `@directory` mentions will list local files, not remote project files.

**Fix**: Route through core's existing `/file/find/file` route (which uses `Ripgrep.files()`) or a new `/file/list` route.

---

### 3. `use-memory-files.ts` (Planned in Phase 6A) → Direct `readdir()`/`stat()`

[implementation_plan_6a.md § 6.3](file:///d:/liteai/roadmap/ui_refactoring/implementation_plan_6a.md#L498-L542)

```typescript
import fs from "node:fs/promises"
import { Instance } from "@liteai/core/project/instance"
// ...
const baseDir = path.join(Instance.directory, ".liteai", "memory")
const entries = await fs.readdir(baseDir, { withFileTypes: true })
```

**Impact**: Directly imports `Instance.directory` and reads `node:fs` in CLI. This is a **hard violation** — Instance.directory is the core server's project root, and even if the symbol resolves in the same process today, the CLI shouldn't depend on it for remote mode.

**Fix**: Create a `GET /memory` route in core that discovers and returns memory file listings. CLI fetches via SDK.
> [!IMPORTANT]
> **Prerequisite Gate**: Any implementation of `use-memory-files.ts` in `packages/cli` MUST NOT import `Instance`, `node:fs`, or any core runtime module. The `GET /memory` route must be created in core before this CLI feature can be implemented.

---

### 4. `tools.tsx` → `Filesystem.normalizePath()` + `Global.Path.home`

[tools.tsx:L330](file:///d:/liteai/packages/cli/src/tui/routes/session/tools.tsx#L330)

```typescript
const normalized = Filesystem.normalizePath(filePath)
// ...
const home = Global.Path.home  // L395
```

**Impact**: Minor — these are used only for **display purposes** (rendering tool call paths relative to home dir). `normalizePath` is a pure string operation. `Global.Path.home` is the CLI user's home, which is correct for display even in remote mode. **Borderline but acceptable for rendering.**

---

## 🟡 BORDERLINE — Project-Adjacent Config Access

### 5. `theme.tsx` → `getCustomThemes()` reads `.liteai/themes/*.json`

[theme.tsx:L385-L404](file:///d:/liteai/packages/cli/src/tui/context/theme.tsx#L385-L404)

```typescript
const directories = [
  Global.Path.config,
  ...(await Array.fromAsync(Filesystem.up({ targets: [".liteai"], start: process.cwd() }))),
]
// ... scans for themes/*.json
```

**Impact**: Walks up from `process.cwd()` looking for `.liteai/themes/`. In remote mode, this scans the local machine's directory tree, not the remote project. Custom project themes would not be found.

**Severity**: Low — themes are a UI preference, and `Global.Path.config` (user home config) will still work. Project-scoped themes are a nice-to-have.

**Fix**: Either accept this as CLI-local (themes are a CLI concern), or add a `GET /config/themes` route to core.

---

### 6. `tui.ts` (config) → `ConfigPaths.directories(Instance.directory, ...)`

[tui.ts:L49](file:///d:/liteai/packages/cli/src/cli/config/tui.ts#L49)

```typescript
const directories = await ConfigPaths.directories(Instance.directory, Instance.worktree)
```

**Impact**: Reads `Instance.directory` to find config files. In remote mode, Instance is the local project, which is correct for local-start but wrong for remote-attach.

---

## 🟢 LEGITIMATE — Inherently CLI-Local

### 7. `editor.ts` → tmp file for `$EDITOR`
Opens the user's local editor with a temp file. Inherently local — you can't open a remote editor from the CLI.

### 8. `image-paste.ts` → Clipboard + local file read
Reads images from the local clipboard or local file paths. Inherently a client-side operation.

### 9. `kv.tsx` → `Global.Path.state/kv.json`
Local key-value state for CLI preferences (theme selection, etc). Correctly stored in user's home config dir.

### 10. `local.tsx` → `Global.Path.state/model.json`
Local model preferences. Same as KV — correctly CLI-local.

### 11. Debug commands (`cli/cmd/debug/ripgrep.ts`, `file.ts`)
These are explicit debug/admin tools meant for local development. Not used in TUI runtime path.

### 12. CLI admin commands (`agent.ts`, `uninstall.ts`, `mcp.ts`, `session.ts`, `run.ts`)
CLI-only administration commands. Not part of the TUI render path. These inherently run where the CLI binary is.

---

## Summary: Action Items

| # | File | Issue | Priority | Fix Strategy |
|---|------|-------|----------|-------------|
| 1 | `directory-completion.ts` | Direct `readdir()` for `@file`/`@dir` completion | 🔴 High | Route through `GET /file/find/file` or `GET /file/file` |
| 2 | `implementation_plan_6a.md` § 6.3 | Planned `use-memory-files.ts` uses `node:fs` | 🔴 High | Design a `GET /memory` core route before implementing |
| 3 | `theme.tsx` | Scans local `.liteai/` for project themes | 🟡 Low | Accept as CLI-local, or add `GET /config/themes` |
| 4 | `tui.ts` | Config discovery uses `Instance.directory` | 🟡 Low | Already handled by `attach` command's directory passthrough |

---

## Architectural Observation

> [!IMPORTANT]
> **The boundary principle**: The CLI TUI should treat core as a **black-box HTTP service**. Any `import` from `@liteai/core` that accesses runtime state (`Instance`, `Global`, `Ripgrep`) is a coupling violation. Safe imports are limited to:
> - **Type-only** imports (`import type { ... }`)
> - **Pure constants** (language extensions, schema definitions)
> - **Display utilities** (path normalization, color helpers)

Currently the TUI has these `@liteai/core` runtime imports:
- `Global.Path.home` / `Global.Path.config` / `Global.Path.state` — **acceptable** (CLI-local paths)
- `Instance.directory` — **violation** (project server path)
- `Provider.parseModel()` — **acceptable** (pure function)
- `Installation` — needs investigation
- `Config` — used in skill-usage-tracking, needs investigation

The `dialog-search.tsx` you flagged is actually already **correctly** decoupled — it uses `sdk.fetch()`. The real problem child is **directory-completion.ts**.
