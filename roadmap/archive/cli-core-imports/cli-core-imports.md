# CLI → Core Import Analysis

## Tool Type Imports (run.ts) — ✅ RESOLVED

**Problem**: CLI imported 14 tool type definitions from `@liteai/core/tool/*` purely
to cast `{ [key: string]: unknown }` into typed shapes via a generic `props<T>()` function.
This created tight coupling — when core renamed `task` → `agent`, CLI broke.

**Resolution**: Removed all tool type imports. Each rendering function now takes `ToolPart`
directly and accesses `state.input` / `state.metadata` as plain `Record<string, unknown>`.
This follows the same pattern as Vercel AI SDK — match on tool name string, access args directly.

### Before (14 imports + generic machinery)
```typescript
import type { GrepTool } from "@liteai/core/tool/grep"
// ... 13 more imports

type ToolProps<T extends Tool.Info> = {
  input: Tool.InferParameters<T>    // cosmetic cast
  metadata: Tool.InferMetadata<T>   // cosmetic cast
  part: ToolPart
}

function grep(info: ToolProps<typeof GrepTool>) {
  info.input.pattern  // typed via cast, not validation
}
```

### After (zero tool imports, direct access)
```typescript
function grep(part: ToolPart) {
  const input = toolInput(part)     // Record<string, unknown>
  const meta = toolMetadata(part)   // Record<string, unknown>
  input.pattern                     // direct access
}
```

---

## `Flag` Import — ✅ RESOLVED

**Problem**: CLI imported `Flag` from `@liteai/core/flag/flag` across 5 files.
`Flag` is a trivial `process.env` reader that pulled in `@liteai/core/brand` transitively.
Every usage was just reading `process.env.LITEAI_*`.

**Resolution**: Created `cli/env.ts` — a CLI-local env reader with identical semantics
(same prefix, same `truthy()` check) and zero core dependencies. All 5 files updated:
`run.ts`, `serve.ts`, `session.ts`, `local-server.ts`, `config/tui.ts`.

---

## `Provider.parseModel()` — ✅ PARTIALLY RESOLVED

**Problem**: CLI imported `Provider` from `@liteai/core/provider/provider` in 3 files
solely for `parseModel()` — a 4-line string split on `/`.

**Resolution**: Created `cli/parse-model.ts` and replaced `Provider.parseModel()` in `run.ts`
(the only file that passes the result to SDK which accepts plain strings).

`agent.ts` and `github.ts` retained `Provider.parseModel()` because they pass the result
to core APIs (`Agent.generate()`, `SessionPrompt.prompt()`) that require Effect-branded
`ProviderID`/`ModelID` types. Since those files already import 5+ other core modules,
removing Provider there provides negligible decoupling.

---

## `Filesystem` (core) — ✅ RESOLVED

**Problem**: `config/tui.ts` imported `Filesystem` from `@liteai/core/util/filesystem`
for `readText()` and `write()`. The core version adds hosted-FS dispatch, but CLI always
runs locally. CLI already imports `Fs` from `@liteai/util/fs` in other files.

**Resolution**: Replaced with `Fs` from `@liteai/util/fs`.

---

## Remaining Core Imports (run.ts)

```
import { Agent }  from "@liteai/core/agent/agent"   — Agent.get() to validate agent
import { Server } from "@liteai/core/server/server"  — In-process server
```

These are runtime dependencies — CLI embeds the core server for local mode.

## Other Files — Legitimate Core Imports

### index.ts
- Installation, Instance, Server, Database — bootstrapping the local server

### bootstrap.ts
- InstanceBootstrap, Instance, Runtime — project initialization

### error.ts
- Config, ConfigMarkdown, MCP, Provider — error diagnostics

### cmd/account.ts, cmd/acp.ts, cmd/db.ts, cmd/export.ts
- Account, ACP, Database, Session — CLI commands that operate on core directly

### cmd/github.ts
- Bus, Instance, Provider, Session, Message — GitHub integration command

### config/tui.ts
- Brand, Config, ConfigPaths, Global, Instance — config management TUI

### tui/state/*.ts
- Snapshot, PermissionModeCyclable — TUI state management

### tui/hooks/*.ts, tui/routes/*.ts
- Snapshot, LANGUAGE_EXTENSIONS — TUI display

---

## Future Considerations

> [!NOTE]
> The remaining core imports in `run.ts` (`Agent`, `Server`) are legitimate
> runtime dependencies for local server mode. If CLI ever becomes a pure remote-only client
> (always connecting to a running server via `--attach`), these could also be removed — but
> that's a separate architectural decision.

### Medium-effort reductions (route through SDK):

- **`Agent.get()` / `Agent.list()`** → `sdk.project.agent.*` (run.ts, agent.ts)
- **`Session.get()` / `Session.list()` / `Session.remove()`** → `sdk.project.session.*` (session.ts)
- **`Auth.*`** → New SDK auth endpoints (providers.ts)
- **`ModelsDev.*`** → New SDK models endpoint (models.ts, providers.ts)

### Keep as-is:

- **Server lifecycle** (Server, Instance, Runtime, Database, Global) — irreducible while CLI embeds core
- **GitHub runner** (Session, Message, SessionPrompt, Bus) — deeply integrated
- **TUI types** (Snapshot, PermissionModeCyclable, Tool) — rendering data model
- **Config cascade** (Config, ConfigPaths) — deeply integrated with core's resolution logic
