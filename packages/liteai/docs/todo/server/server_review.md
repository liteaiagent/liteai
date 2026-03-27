# Code Review: `server.ts`

**File:** [server.ts](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/liteai/src/server/server.ts)
**Lines:** 709 | **Size:** ~22 KB

---

## Summary Verdict

The file has a **solid foundation** — good framework choice (Hono), proper use of Zod validation, OpenAPI documentation, and well-structured error handling. However, it suffers from a **significant SRP violation**: `createApp` is a ~560-line monolith that mixes middleware setup, inline route definitions, OpenAPI spec, and static-file serving in a single chained call. The inconsistency between extracted and inline routes is the most impactful issue.

---

## 🔴 Critical Issues

### 1. `createApp` is a ~560-line God Function (SRP Violation)

The entire HTTP API — middleware, auth, 15+ inline route handlers, SSE streaming, static file serving — is defined inside a single chained expression. This makes the function extremely hard to read, test, or modify in isolation.

```
createApp() currently owns:
  ├── Error handler
  ├── Auth middleware
  ├── Logging middleware
  ├── CORS middleware
  ├── Instance context middleware
  ├── OpenAPI doc route
  ├── ~12 inline route handlers (auth, project, path, vcs, command, log, agent, skill, lsp, formatter, event, instance)
  ├── ~12 extracted route modules (provider, session, trace, mcp, plugin, etc.)
  └── Static file / dev-proxy catch-all
```

> [!IMPORTANT]
> **Recommendation:** Extract the inline routes into dedicated route modules (e.g., `AuthRoutes`, `AgentRoutes`, `PathRoutes`, `ToolRoutes`) to match the pattern already established by `ProviderRoutes`, `SessionRoutes`, etc.

### 2. Inconsistent Route Organization

Some routes are properly extracted into `./routes/*` modules, but many are defined inline. This hybrid approach is confusing for anyone new to the codebase.

| Extracted (Good ✅) | Inline (Inconsistent ⚠️) |
|---|---|
| `ProviderRoutes` | `PUT /auth/:providerID` |
| `SessionRoutes` | `DELETE /auth/:providerID` |
| `ProjectRoutes` | `GET /project` (list) |
| `ConfigRoutes` | `GET /path` |
| `McpRoutes` | `GET /vcs` |
| `PluginRoutes` | `GET /command` |
| `FileRoutes` | `POST /log` |
| `PtyRoutes` | `GET /agent` |
| `QuestionRoutes` | `GET /skill` |
| `GlobalRoutes` | `GET /lsp` |
| `ExperimentalRoutes` | `GET /formatter` |
| `PermissionRoutes` | `GET /event` (SSE) |
| `TuiRoutes` | `POST /instance/dispose` |
| `TraceRoutes` | catch-all `/*` static serving |

### 3. Confusing Route Mounting

```typescript
.route("/session", SessionRoutes())   // line 282
.route("/session", TraceRoutes())     // line 283  ← same prefix!
```

Mounting `TraceRoutes` under `/session` is non-obvious. If traces are a sub-resource of sessions, this should be a single `SessionRoutes` module. If they're separate concepts, they need separate prefixes.

---

## 🟡 Moderate Issues

### 4. OpenAPI Version Mismatch

```typescript
// In createApp (line 262)
info: { title: "liteai", version: "0.0.3" }

// In openapi() (line 631)
info: { title: "liteai", version: "1.0.0" }
```

Two different API version strings. Should be a single constant.

### 5. Magic Values Scattered Throughout

| Value | Location | Issue |
|---|---|---|
| `9000` | [L671](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/liteai/src/server/server.ts#L671) | Hardcoded fallback port |
| `10_000` | [L581](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/liteai/src/server/server.ts#L581) | Heartbeat interval |
| `"server.connected"` | [L561](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/liteai/src/server/server.ts#L561) | Synthetic event type string |
| `"server.heartbeat"` | [L578](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/liteai/src/server/server.ts#L578) | Synthetic event type string |
| `"http://localhost:3000"` | [L599](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/liteai/src/server/server.ts#L599) | Dev server URL |
| `"liteai"` | [L91](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/liteai/src/server/server.ts#L91) | Default basic auth username |

> [!TIP]
> Extract these into named constants or configuration. e.g.:
> ```typescript
> const DEFAULT_PORT = 9000
> const HEARTBEAT_INTERVAL_MS = 10_000
> const DEV_SERVER_URL = "http://localhost:3000"
> ```

### 6. Monkey-Patching `server.stop`

```typescript
const originalStop = server.stop.bind(server)
server.stop = async (close?: boolean) => {
  if (shouldPublishMDNS) MDNS.unpublish()
  active = undefined
  return originalStop(close)
}
```

This is fragile. A wrapper class or a dedicated `shutdown()` orchestrator (which already exists at [L698](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/liteai/src/server/server.ts#L698)!) would be cleaner. Currently `stop()` and `shutdown()` both exist with overlapping responsibilities.

### 7. Module-Level Side Effect

```typescript
globalThis.AI_SDK_LOG_WARNINGS = false  // line 53
```

This mutates a global as a side effect of importing the module. This should be handled closer to the SDK initialization point, or guarded by a setup function.

### 8. Complex IIFE in Middleware

The [directory-decoding middleware](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/liteai/src/server/server.ts#L230-L239) uses a nested IIFE:

```typescript
const directory = Filesystem.resolve(
  (() => {
    try {
      return decodeURIComponent(raw)
    } catch (e) {
      log.debug("decodeURIComponent failed, using raw directory", { raw, error: e })
      return raw
    }
  })(),
)
```

A simple helper function like `safeDecodeURIComponent(raw)` would eliminate the cognitive overhead.

---

## 🟢 What's Done Well

| Aspect | Notes |
|---|---|
| **Error handling** | Structured catch-all with proper status code mapping and logging differentiation (warn vs error) |
| **Auth middleware** | Clean OPTIONS bypass with good comment explaining CORS preflight |
| **Logging middleware** | Smart SSE detection to avoid misleading timing logs |
| **Zod validation** | Consistent request validation with proper OpenAPI schema integration |
| **OpenAPI documentation** | Every inline route has `describeRoute` metadata — thorough |
| **Lazy initialization** | `lazy(() => createApp({}))` for the default app is a nice pattern |
| **SSE implementation** | Proper heartbeat, cleanup on abort, and unsubscribe handling |
| **CORS policy** | Reasonable origin checking with tauri:// protocol support |

---

## 🏗️ Refactoring Roadmap

If you decide to act on this, here's a prioritized approach:

### Phase 1 — Extract Inline Routes (High Impact, Low Risk)
1. Create `AuthRoutes`, `AgentRoutes`, `PathRoutes`, `MiscRoutes` (or similar groupings)
2. Move all inline handlers into their respective route modules
3. Reduce `createApp` to middleware setup + `.route()` calls only

### Phase 2 — Constants & Config (Medium Impact, Zero Risk)
1. Extract magic values into named constants
2. Unify the OpenAPI version string

### Phase 3 — Clean Up Patterns (Lower Priority)
1. Replace the `server.stop` monkey-patch with a proper lifecycle wrapper
2. Extract `safeDecodeURIComponent` helper
3. Move `globalThis.AI_SDK_LOG_WARNINGS` to SDK initialization
4. Resolve the `shutdown()` vs `stop()` overlap

> [!NOTE]
> The `export namespace Server` pattern is a stylistic choice. While modern TS tends to prefer module-level exports, namespaces work fine for grouping related functionality and are used consistently throughout this codebase, so this is not a concern worth addressing.
