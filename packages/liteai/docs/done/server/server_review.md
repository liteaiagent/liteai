# Code Review: `server.ts`

**File:** [server.ts](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/liteai/src/server/server.ts)
**Lines:** 664 | **Size:** ~20 KB
**Middleware:** [middleware.ts](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/liteai/src/server/middleware.ts)

---

## Summary Verdict

The file has a **solid foundation** — good framework choice (Hono), proper use of Zod validation, OpenAPI documentation, and well-structured error handling. Middleware concerns (error handler, auth, logging, CORS) have been **extracted to `middleware.ts`**. The remaining issue is the **inline route handlers** — `createApp` still mixes route definitions with middleware setup, and the inconsistency between extracted and inline routes is the most impactful remaining issue.

---

## ✅ Completed

### ~~Extract Middleware~~ → Done

The following were extracted to [`middleware.ts`](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/liteai/src/server/middleware.ts):
- `errorHandler(log)` — structured error handler with status code mapping
- `authMiddleware()` — basic auth with OPTIONS bypass for CORS preflight
- `requestLogger(log)` — request logging with SSE-aware timer
- `corsMiddleware(opts)` — CORS origin policy (localhost, tauri, custom)
- `safeDecodeDirectory(raw, log)` — deduplicated URI-decoding helper (was duplicated as IIFE in two places)

`createApp()` now starts cleanly:
```typescript
.onError(errorHandler(log))
.use(authMiddleware())
.use(requestLogger(log))
.use(corsMiddleware(opts))
```

---

## 🔴 Critical Issues (Remaining)

### 1. `createApp` Still Has ~12 Inline Route Handlers

Middleware is now extracted, but the function still owns ~12 inline route handlers plus route mounting. It should be reduced to middleware setup + `.route()` calls only.

```
createApp() currently owns:
  ├── ✅ Middleware (extracted to middleware.ts)
  ├── Instance context middleware (inline)
  ├── OpenAPI doc route
  ├── ~12 inline route handlers (auth, project, path, vcs, command, log, agent, skill, lsp, formatter, event, instance)
  ├── ~12 extracted route modules (provider, session, trace, mcp, plugin, etc.)
  └── Static file / dev-proxy catch-all
```

> [!IMPORTANT]
> **Recommendation:** Extract the inline routes into dedicated route modules (e.g., `AuthRoutes`, `AgentRoutes`, `PathRoutes`, `ToolRoutes`) to match the pattern already established by `ProviderRoutes`, `SessionRoutes`, etc. See opencode's `instance.ts` for the reference pattern.

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
.route("/session", SessionRoutes())   // line 277
.route("/session", TraceRoutes())     // line 278  ← same prefix!
```

Mounting `TraceRoutes` under `/session` is non-obvious. If traces are a sub-resource of sessions, this should be a single `SessionRoutes` module. If they're separate concepts, they need separate prefixes.

---

## 🟡 Moderate Issues (Remaining)

### 4. OpenAPI Version Mismatch

```typescript
// In createApp (line 258)
info: { title: "liteai", version: "0.0.3" }

// In openapi() (line 587)
info: { title: "liteai", version: "1.0.0" }
```

Two different API version strings. Should be a single constant.

### 5. Magic Values Scattered Throughout

| Value | Location | Issue |
|---|---|---|
| `9000` | L627 | Hardcoded fallback port |
| `10_000` | L487 | Heartbeat interval |
| `"server.connected"` | L467 | Synthetic event type string |
| `"server.heartbeat"` | L484 | Synthetic event type string |
| `"http://localhost:3000"` | L505 | Dev server URL |

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

This is fragile. A wrapper class or a dedicated `shutdown()` orchestrator would be cleaner. Currently `stop()` and `shutdown()` both exist with overlapping responsibilities.

### 7. Module-Level Side Effect

```typescript
globalThis.AI_SDK_LOG_WARNINGS = false  // line 46
```

This mutates a global as a side effect of importing the module. This should be handled closer to the SDK initialization point, or guarded by a setup function.

---

## 🟢 What's Done Well

| Aspect | Notes |
|---|---|
| **Middleware extraction** | Error handling, auth, logging, CORS cleanly separated into `middleware.ts` |
| **`safeDecodeDirectory`** | Shared helper eliminates duplicated IIFE pattern |
| **Zod validation** | Consistent request validation with proper OpenAPI schema integration |
| **OpenAPI documentation** | Every inline route has `describeRoute` metadata — thorough |
| **Lazy initialization** | `lazy(() => createApp({}))` for the default app is a nice pattern |
| **SSE implementation** | Proper heartbeat, cleanup on abort, and unsubscribe handling |

---

## 🏗️ Refactoring Roadmap

### ~~Phase 0 — Extract Middleware~~ ✅ Done
- ~~Extract error handler, auth, logging, CORS into `middleware.ts`~~
- ~~Extract `safeDecodeDirectory` helper~~

### Phase 1 — Extract Inline Routes (High Impact, Low Risk)
1. Create `instance.ts` (following opencode pattern) to hold all instance-scoped routes
2. Move remaining inline handlers into route modules or `instance.ts`
3. Reduce `createApp` to middleware setup + `.route()` calls only

### Phase 2 — Constants & Config (Medium Impact, Zero Risk)
1. Extract magic values into named constants
2. Unify the OpenAPI version string

### Phase 3 — Clean Up Patterns (Lower Priority)
1. Replace the `server.stop` monkey-patch with a proper lifecycle wrapper
2. Move `globalThis.AI_SDK_LOG_WARNINGS` to SDK initialization
3. Resolve the `shutdown()` vs `stop()` overlap

> [!NOTE]
> The `export namespace Server` pattern is a stylistic choice. While modern TS tends to prefer module-level exports, namespaces work fine for grouping related functionality and are used consistently throughout this codebase, so this is not a concern worth addressing.
