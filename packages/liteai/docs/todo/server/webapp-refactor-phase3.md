# Web App Refactor — Phase 3: Core State Layer

## Goal

Update the core state management (`bootstrap`, `global-sync`, `sync`) to pass `projectID` to all project-scoped SDK calls.

---

## 3.1 Update `bootstrapGlobal` (no changes needed)

**File**: `src/context/global-sync/bootstrap.ts` (lines 33-112)

All calls here are already global routes:
- `input.globalSDK.health()` ✓ (after Phase 2 rename)
- `input.globalSDK.config.get()` ✓
- `input.globalSDK.project.list()` ✓ (project CRUD — no projectID)
- `input.globalSDK.provider.list()` ✓
- `input.globalSDK.provider.auth()` ✓
- `input.globalSDK.path()` ✓

**No project-scoped calls → no `projectID` changes needed.**

---

## 3.2 Update `bootstrapDirectory`

**File**: `src/context/global-sync/bootstrap.ts` (lines 124-246)

### Signature change

```diff
 export async function bootstrapDirectory(input: {
   directory: string
+  projectID: string
   sdk: LiteaiClient
   store: Store<State>
   setStore: SetStoreFunction<State>
   vcsCache: VcsCache
   loadSessions: (directory: string) => Promise<void> | void
   translate: (key: string, vars?: Record<string, string | number>) => string
 }) {
```

### SDK calls to update

All project-scoped calls need `{ projectID: input.projectID }` added:

| Line | Current | New |
|------|---------|-----|
| ~137 | `input.sdk.project.current()` | `input.sdk.project.current({ projectID: input.projectID })` |
| ~154 | `input.sdk.app.agents()` | `input.sdk.agent.list({ projectID: input.projectID })` |
| ~156 | `input.sdk.config.get()` | `input.sdk.config.get({ projectID: input.projectID })` ← project config |
| ~177 | `input.sdk.instance.info()` | `input.sdk.instance.info({ projectID: input.projectID })` |
| ~187 | `input.sdk.command.list()` | `input.sdk.command.list({ projectID: input.projectID })` |
| ~188 | `input.sdk.session.status()` | `input.sdk.session.status({ projectID: input.projectID })` |
| ~192 | `input.sdk.mcp.status()` | `input.sdk.mcp.status({ projectID: input.projectID })` |
| ~195 | `input.sdk.lsp.status()` | `input.sdk.lsp.status({ projectID: input.projectID })` |
| ~198 | `input.sdk.vcs.get()` | `input.sdk.vcs({ projectID: input.projectID })` |
| ~203 | `input.sdk.permission.list()` | `input.sdk.permission.list({ projectID: input.projectID })` |
| ~224 | `input.sdk.question.list()` | `input.sdk.question.list({ projectID: input.projectID })` |

> **Note**: `input.sdk.provider.list()` (line ~151) is a GLOBAL route — do NOT add projectID.

> **Warning**: Verify method renames against generated SDK in `sdk.gen.ts`:
> - `app.agents()` → likely `agent.list()`
> - `vcs.get()` → likely `vcs()`
> - Check each method exists with the expected signature

---

## 3.3 Update `global-sync.tsx` callers

**File**: `src/context/global-sync.tsx`

### Import

```diff
+import { toProjectID } from "@/utils/project-id"
```

### `bootstrapInstance(directory)` — pass projectID to bootstrap

```diff
 async function bootstrapInstance(directory: string) {
+  const projectID = toProjectID(directory)
   ...
   await bootstrapDirectory({
     directory,
+    projectID,
     sdk,
     store: child[0],
     setStore: child[1],
     vcsCache: cache,
     loadSessions,
     translate: language.t,
   })
 }
```

### `loadSessions` — session.list needs projectID

Line ~204: `globalSDK.client.session.list(query)` needs projectID.

The `loadRootSessionsWithFallback` function receives a `list` callback. Either:
- Add `projectID` to the query object passed to `list`
- Or update `session-load.ts` to accept and pass projectID

```diff
 const promise = loadRootSessionsWithFallback({
   directory,
   limit,
-  list: (query) => globalSDK.client.session.list(query),
+  list: (query) => globalSDK.client.session.list({ ...query, projectID: toProjectID(directory) }),
 })
```

### LSP reload in event handler

Line ~310: `sdkFor(directory).lsp.status()` needs projectID:

```diff
 loadLsp: () => {
-  sdkFor(directory).lsp.status()
+  sdkFor(directory).lsp.status({ projectID: toProjectID(directory) })
     .then((x) => setStore("lsp", x.data ?? []))
 },
```

---

## 3.4 Update `sync.tsx`

**File**: `src/context/sync.tsx` (616 lines)

### Add projectID derivation

```diff
+import { toProjectID } from "@/utils/project-id"

 init: () => {
   const globalSync = useGlobalSync()
   const sdk = useSDK()
+  const projectID = () => toProjectID(sdk.directory)
```

### SDK calls to update

| Line | Method | Change |
|------|--------|--------|
| ~297 | `client.session.messages({ sessionID, limit, before })` | Add `projectID: projectID()` |
| ~467 | `client.session.get({ sessionID })` | Add `projectID: projectID()` |
| ~507 | `client.session.diff({ sessionID })` | Add `projectID: projectID()` |
| ~533 | `client.session.todo({ sessionID })` | Add `projectID: projectID()` |
| ~587 | `client.session.list()` | Add `{ projectID: projectID() }` |
| ~600 | `client.session.update({ sessionID, time: ... })` | Add `projectID: projectID()` |

> **Note**: The `fetchMessages` inner function receives `client` as parameter. The `projectID` should be passed through or derived from directory in scope.

---

## Verification

After Phase 3, the core state layer should compile and work. Run:
1. `tsc --noEmit` in `liteai-app`
2. Manual test: open app, verify project bootstrap loads (sessions, config, MCP status, etc.)
