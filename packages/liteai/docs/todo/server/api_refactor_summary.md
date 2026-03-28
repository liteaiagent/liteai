# API Path Refactor — Summary of Changes

## ✅ Completed (Server-Side)

### Phase 1+3: Route Restructuring
- **Global routes** moved from `/global/*` → root `/` 
- **Project-scoped routes** now mounted under `/project/:projectID/*`
- New `projectContextMiddleware` resolves `:projectID` → project → boots Instance

### Phase 4: Legacy Removal
- Removed old directory-based middleware (`directoryMiddleware`)
- Removed `x-liteai-directory` header-based instance resolution for project-scoped routes

### Phase 5: OperationID Updates
- Global routes: removed `global.` prefix (e.g., `global.health` → `health`)
- Project-scoped routes: added `project.` prefix (e.g., `session.list` → `project.session.list`)

### Files Modified

| File | Change |
|------|--------|
| [server.ts](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/liteai/src/server/server.ts) | Full restructure — 3-tier routing |
| [middleware.ts](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/liteai/src/server/middleware.ts) | Added `projectContextMiddleware()` |
| [global.ts](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/liteai/src/server/routes/global.ts) | Removed `global.` from operationIds |
| [instance.ts](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/liteai/src/server/routes/instance.ts) | Added `project.` to operationIds |
| [config.ts](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/liteai/src/server/routes/config.ts) | Added `project.` to operationIds |
| [session.ts](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/liteai/src/server/routes/session.ts) | Added `project.` to operationIds |
| [trace.ts](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/liteai/src/server/routes/trace.ts) | Added `project.` to operationIds |
| [mcp.ts](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/liteai/src/server/routes/mcp.ts) | Added `project.` to operationIds |
| [file.ts](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/liteai/src/server/routes/file.ts) | Added `project.` to operationIds |
| [pty.ts](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/liteai/src/server/routes/pty.ts) | Added `project.` to operationIds |
| [plugin.ts](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/liteai/src/server/routes/plugin.ts) | Added `project.` to operationIds |
| [permission.ts](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/liteai/src/server/routes/permission.ts) | Added `project.` to operationIds |
| [question.ts](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/liteai/src/server/routes/question.ts) | Added `project.` to operationIds |
| [tui.ts](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/liteai/src/server/routes/tui.ts) | Added `project.` to operationIds |
| [experimental.ts](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/liteai/src/server/routes/experimental.ts) | Added `project.` to operationIds |
| [workspace.ts](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/liteai/src/server/routes/workspace.ts) | Added `project.` to operationIds |

### SDK Regenerated
- `packages/liteai-sdk/js` — full rebuild from new OpenAPI spec
- All generated files in `src/gen/` updated automatically

---

## 🔲 Remaining (Phase 2: Client Migration)

### New SDK API Shape

**Global routes** (no `projectID` needed):
```ts
client.health()              // was: client.global.health()
client.dispose()             // was: client.global.dispose()
client.browse()              // was: client.global.browse()
client.path()                // was: client.global.path()
client.config.get()          // was: client.global.config.get()
client.config.update(...)    // was: client.global.config.update(...)
client.event.subscribe()     // was: client.global.event()
client.log()                 // was: client.global.log()
client.log.write(...)        // was: client.global.log.write(...)
```

**Project-scoped routes** (now require `projectID`):
```ts
// Before: client.session.list({ directory: "..." })
// After:  client.session.list({ projectID: "abc123", ... })

client.session.list({ projectID })
client.session.create({ projectID, ... })
client.mcp.status({ projectID })
client.config.get({ projectID })     // Note: project config, not global config
client.vcs({ projectID })            // was: client.vcs.get()
client.instance.info({ projectID })  // was: client.instance.info()
client.agent.list({ projectID })     // was: client.app.agents()
client.skill.list({ projectID })     // was: client.app.skills()
```

### Files Needing Updates

#### `packages/liteai-app/`
| File | What changed |
|------|-------------|
| `src/context/global-sdk.tsx` | `eventSdk.global.event()` → `eventSdk.event.subscribe()` |
| `src/context/global-sync.tsx` | `globalSDK.client.global.config.update()` → `globalSDK.client.config.update()` |
| `src/context/global-sync/bootstrap.ts` | `globalSDK.global.health()` → `globalSDK.health()`, etc. |
| `src/pages/log.tsx` | `sdk.client.global.log()` → `sdk.client.log()` |
| `src/components/dialog-select-directory.tsx` | `sdk.client.global.browse()` → `sdk.client.browse()` |
| `src/components/settings-providers.tsx` | `globalSDK.client.global.dispose()` → `globalSDK.client.dispose()` |
| `src/components/dialog-connect-provider.tsx` | `globalSDK.client.global.dispose()` → `globalSDK.client.dispose()` |
| All files calling project-scoped methods | Must now pass `projectID` parameter |

#### `packages/liteai/src/` (TUI sync)
| File | What changed |
|------|-------------|
| `src/cli/cmd/tui/context/sync.tsx` | All SDK calls need `projectID` |

#### `packages/liteai-sdk/js/src/client.ts`
- The `createLiteaiClient` factory still sends `x-liteai-directory` header — this is now unnecessary for project-scoped routes since `projectID` is in the URL
- The `directory` config option should be deprecated
