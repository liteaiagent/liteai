# CLI → Core Import Deep Audit

Exhaustive trace of **every** `@liteai/core` import in `packages/cli/src/`.
Each entry answers: *does CLI actually need this, or is it avoidable?*

---

## ~~🔴~~ ✅ `Flag` — Environment Variable Reader — DONE

**Files**: [run.ts](file:///d:/liteai/packages/cli/src/cli/cmd/run.ts), [serve.ts](file:///d:/liteai/packages/cli/src/cli/cmd/serve.ts), [session.ts](file:///d:/liteai/packages/cli/src/cli/cmd/session.ts), [local-server.ts](file:///d:/liteai/packages/cli/src/cli/cmd/tui/local-server.ts), [config/tui.ts](file:///d:/liteai/packages/cli/src/cli/config/tui.ts)

**What `Flag` actually is**: A namespace that reads `LITEAI_*` env vars via `process.env`. It's just a thin wrapper around `process.env[Brand.env + key]`:

```typescript
// The entire implementation pattern:
function env(key: string) { return process.env[`LITEAI_${key}`] }
function truthy(key: string) { return env(key)?.toLowerCase() === "true" || env(key) === "1" }
```

### Specific usages:

| Flag | File | What It Does | Verdict |
|------|------|-------------|---------|
| `LITEAI_AUTO_SHARE` | run.ts:375 | Decides whether to auto-share sessions | **Redundant** — the server already knows this flag. The `sdk.project.session.share()` call on line 376 is the real action; the guard on line 375 is CLI duplicating server-side logic. The server's share endpoint should decide, not the client. |
| `LITEAI_GIT_BASH_PATH` | session.ts:27-28 | Finds `less.exe` in Git Bash for paging | **Legitimate** — purely client-side pager resolution. But should read `process.env.LITEAI_GIT_BASH_PATH` directly instead of importing Flag. |
| `LITEAI_SERVER_PASSWORD` | serve.ts:13, local-server.ts:21 | Auth header for local server | **Legitimate** — but could read `process.env.LITEAI_SERVER_PASSWORD` directly. |
| `LITEAI_SERVER_USERNAME` | local-server.ts:23 | Auth header for local server | Same as above. |
| `LITEAI_TUI_CONFIG` | config/tui.ts:48 | Custom TUI config path | **Legitimate** — but it's just `process.env.LITEAI_TUI_CONFIG`. |
| `LITEAI_CONFIG_DIR` | config/tui.ts:76 | Config directory override | Same as above. |

> **RESOLVED**: Created `cli/env.ts` — a CLI-local env reader with zero core dependencies.
> All 5 files updated to use `Env.*` instead of `Flag.LITEAI_*`.
>
> The `LITEAI_AUTO_SHARE` duplication remains architecturally (CLI still guards before calling SDK),
> but the core import is eliminated.

---

## 🟡 `Provider.parseModel()` — String Splitting — PARTIALLY DONE

**Files**: [run.ts](file:///d:/liteai/packages/cli/src/cli/cmd/run.ts):634, [agent.ts](file:///d:/liteai/packages/cli/src/cli/cmd/agent.ts):125, [github.ts](file:///d:/liteai/packages/cli/src/cli/cmd/github.ts):698

**What it actually does**:
```typescript
export function parseModel(model: string) {
  const [providerID, ...rest] = model.split("/")
  return {
    providerID: ProviderID.make(providerID),
    modelID: ModelID.make(rest.join("/")),
  }
}
```

> [!NOTE]
> **Removed from `run.ts`** via `cli/parse-model.ts` (passes to SDK plain strings).
> **Kept in `agent.ts` and `github.ts`** — they pass the result to core APIs (`Agent.generate()`,
> `SessionPrompt.prompt()`) that require Effect-branded `ProviderID`/`ModelID` types.
> Since those files already import 5+ other core modules, removing Provider there provides
> negligible decoupling.

---

## 🟡 `Agent.get()` / `Agent.list()` / `Agent.generate()` — Core Domain Access

**Files**: [run.ts](file:///d:/liteai/packages/cli/src/cli/cmd/run.ts):591, [agent.ts](file:///d:/liteai/packages/cli/src/cli/cmd/agent.ts):126,236

### run.ts:591 — `Agent.get(args.agent)`
Used to validate agent exists before starting a session. But **attach mode on line 555 already uses `sdk.project.agent.list()`** for the same purpose. Local mode could use the same SDK call since it has an in-process fetch handler.

**Verdict**: **Replaceable with SDK** — unify local and attach mode to both use the SDK path.

### agent.ts:236 — `Agent.list()` 
Lists all agents. The SDK has `sdk.project.agent.list()`.

**Verdict**: **Replaceable with SDK**.

### agent.ts:126 — `Agent.generate()`
LLM-generates a new agent definition. This is a more complex operation that touches the provider layer.

**Verdict**: **Could become an SDK endpoint** (e.g., `sdk.project.agent.generate()`), but lower priority.

---

## 🟡 `Session` / `Message` — Direct Database Access

**Files**: [session.ts](file:///d:/liteai/packages/cli/src/cli/cmd/session.ts):63-93, [github.ts](file:///d:/liteai/packages/cli/src/cli/cmd/github.ts):548

### session.ts — `Session.get()`, `Session.remove()`, `Session.list()`
The CLI `session` command directly calls these core functions. The SDK already has `sdk.project.session.*` endpoints.

**Verdict**: **Replaceable with SDK**.

### github.ts — `Session.create()`, `Session.share()`, `SessionPrompt`, `Message`
The GitHub action runner creates sessions, prompts them, and reads message parts directly through core. This is the heaviest direct core consumer in CLI.

**Verdict**: **Legitimately complex** — the GitHub runner operates in-process and uses low-level session engine APIs (`SessionPrompt`). Would require significant SDK expansion to replace. **Keep for now.**

---

## 🟡 `Config` / `ConfigMarkdown` / `ConfigPaths` — Config Internals

**Files**: [error.ts](file:///d:/liteai/packages/cli/src/cli/error.ts), [network.ts](file:///d:/liteai/packages/cli/src/cli/network.ts), [config/tui.ts](file:///d:/liteai/packages/cli/src/cli/config/tui.ts), [providers.ts](file:///d:/liteai/packages/cli/src/cli/cmd/providers.ts), [upgrade.ts](file:///d:/liteai/packages/cli/src/cli/upgrade.ts), [local-server.ts](file:///d:/liteai/packages/cli/src/cli/cmd/tui/local-server.ts)

### error.ts — Error type checking
Uses `Config.JsonError.isInstance()`, `Config.InvalidError.isInstance()`, `ConfigMarkdown.FrontmatterError.isInstance()` to format user-facing error messages.

**Verdict**: These are **error class identity checks**. The error types could be exported from a shared `@liteai/core/errors` barrel or re-exported via SDK. But they're type-safe — removing them would mean string-matching on error names.

### config/tui.ts — `Config.get()`, `ConfigPaths.directories()`, `Config.updateGlobal()`
TUI config resolution. Deeply integrated with core's config cascade.

**Verdict**: **Legitimately deep** — TUI config merges from multiple sources using core's config resolution. Would need a dedicated "config resolution" API endpoint.

### providers.ts — `Config.get()` for `disabled_providers`, `enabled_providers`
Used during provider login to filter the provider list.

**Verdict**: **Replaceable** — could be a query parameter on a provider list API endpoint.

---

## 🟢 Irreducible — Server Embedding

These exist because CLI runs the core server in-process. Can't remove without making CLI attach-only.

| Module | File | Purpose |
|--------|------|---------|
| `Server` | index.ts, serve.ts, run.ts, local-server.ts | `Server.Default().fetch()`, `Server.listen()`, `Server.shutdown()` |
| `Instance` | index.ts, bootstrap.ts, many commands | `Instance.provide()`, `Instance.project`, `Instance.dispose()` |
| `Runtime` | bootstrap.ts, serve.ts, local-server.ts | `Runtime.boot()`, `Runtime.shutdown()` |
| `Database` | index.ts | `Database.Client()` initialization |
| `Installation` | index.ts, upgrade.ts, uninstall.ts | `Installation.VERSION`, `Installation.isLocal()` |
| `InstanceBootstrap` | bootstrap.ts, local-server.ts | Init function for `Instance.provide()` |
| `Global` | index.ts, config/tui.ts, agent.ts, providers.ts, contexts | `Global.Path.*` directories |
| `GlobalBus` | local-server.ts | In-process event bus |

---

## 🟢 Irreducible — TUI Internals

| Module | Files | Purpose |
|--------|-------|---------|
| `Snapshot` | 5 TUI state files, hooks, components | Core data model for TUI rendering |
| `PermissionModeCyclable` | 2 TUI state files | Permission mode cycling in TUI |
| `LANGUAGE_EXTENSIONS` | tui/routes/session/utils.ts | File icon/syntax mapping |
| `Tool` (type) | tui/routes/session/tools.tsx | Tool type definition for TUI tool display |

---

## 🔴 Remaining Questionable Imports

| Module | File | What It Does | Verdict |
|--------|------|-------------|---------|
| `Brand` | agent.ts, config/tui.ts, uninstall.ts | `Brand.dir` (the `.liteai` dir name) | **Could be a constant in CLI** — it's just a string like `".liteai"` |
| ~~`Filesystem` (core)~~ | ~~config/tui.ts~~ | ~~`Filesystem.readText()`, `Filesystem.write()`~~ | ✅ **DONE** — replaced with `Fs` from `@liteai/util/fs` |
| `Auth` | providers.ts | `Auth.set()`, `Auth.all()`, `Auth.remove()` | **Could become SDK endpoints** |
| `AUTH_PROVIDERS` | providers.ts | Provider auth registry | **Tightly coupled** — contains auth flow implementations |
| `MCP` | error.ts | `MCP.Failed.isInstance()` | Error type check only |
| `ModelsDev` | models.ts, providers.ts, github.ts | Models database fetch/refresh | **Could become SDK endpoint** |
| `ACP` | acp.ts | Agent Communication Protocol | **Core domain** — legitimate |
| `WorkspaceServer` | workspace-serve.ts | Dev-only workspace server | **Legitimate** — only loaded when `Installation.isLocal()` |
| `AccountService` | account.ts | Account login/poll | **Could become SDK endpoint** |

---

## Summary — What Can Actually Be Removed

### Quick wins (no architecture change needed):

1. ~~**`Flag`**~~ ✅ Created `cli/env.ts` — eliminated core import from 5 files
2. ~~**`Provider.parseModel()`**~~ ✅ Created `cli/parse-model.ts` — eliminated from `run.ts` (kept in agent.ts, github.ts due to branded types)
3. **`Brand.dir`** → Use string constant `".liteai"` (saves 1 core import in 3 files) — deferred
4. ~~**`Filesystem` (core)**~~ ✅ Replaced with `@liteai/util/fs` in `config/tui.ts`

### Medium effort (route through SDK):

5. **`Agent.get()` / `Agent.list()`** → `sdk.project.agent.*` (run.ts, agent.ts)
6. **`Session.get()` / `Session.list()` / `Session.remove()`** → `sdk.project.session.*` (session.ts)
7. **`Auth.*`** → New SDK auth endpoints (providers.ts)
8. **`ModelsDev.*`** → New SDK models endpoint (models.ts, providers.ts)

### Hard / keep as-is:

9. **Server lifecycle** (Server, Instance, Runtime, Database, Global) — irreducible while CLI embeds core
10. **GitHub runner** (Session, Message, SessionPrompt, Bus) — deeply integrated, would need major SDK expansion
11. **TUI types** (Snapshot, PermissionModeCyclable, Tool) — rendering data model
12. **Config cascade** (Config, ConfigPaths, TuiConfig) — deeply integrated with core's resolution logic

### Import count impact:

| Category | Before | After Quick Wins | After SDK Migration |
|----------|--------|-------------------|---------------------|
| Distinct core submodules | 49 | 46 (-3: Flag, Filesystem, Provider in run.ts) | ~25 |
| Files with core imports | 52 | 46 (-6: 5 Flag files + 1 Filesystem file) | ~30 |
