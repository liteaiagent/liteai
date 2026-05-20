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

## Remaining Core Imports (run.ts) — Legitimate

```
import { Agent }    from "@liteai/core/agent/agent"     — Agent.get() to validate agent
import { Flag }     from "@liteai/core/flag/flag"        — Feature flags
import { Provider } from "@liteai/core/provider/provider" — Provider.parseModel()
import { Server }   from "@liteai/core/server/server"    — In-process server
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
- Brand, Config, ConfigPaths, Flag, Global, Instance, Filesystem — config management TUI

### tui/state/*.ts
- Snapshot, PermissionModeCyclable — TUI state management

### tui/hooks/*.ts, tui/routes/*.ts
- Snapshot, LANGUAGE_EXTENSIONS — TUI display

---

## Future Considerations

> [!NOTE]
> The remaining core imports in `run.ts` (`Agent`, `Flag`, `Provider`, `Server`) are legitimate
> runtime dependencies for local server mode. If CLI ever becomes a pure remote-only client
> (always connecting to a running server via `--attach`), these could also be removed — but
> that's a separate architectural decision.
