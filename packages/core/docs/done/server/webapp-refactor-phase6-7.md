# Web App Refactor — Phase 6-7: Settings, Dialogs + Cleanup

## Phase 6: Settings + Dialogs

### 6.1 `dialog-select-directory.tsx`

**File**: `src/components/dialog-select-directory.tsx`

| Line | Call | Change |
|------|------|--------|
| 161 | `sdk.client.file.list({ directory: key, path: "" })` | Add `projectID` |
| 197 | `sdk.client.find.files({ directory, query, type, limit })` | Add `projectID` |

> **⚠️ Open Question**: These calls browse arbitrary filesystem directories, not registered projects. The `file.list()` and `find.files()` endpoints are now under `/project/:projectID/file` — but the user may be browsing a directory that isn't a registered project yet.

>
> **Options**:
> 1. Use the global SDK client (no projectID) and keep the directory header for these specific calls
> 2. Auto-register the browsed directory as a project first
> 3. Add a global file browsing endpoint that doesn't require projectID
>
> Recommend option 1 as a short-term fix, then move to option 3.

** ANSWER **: User shall not browse a directory that isn't a registered project.

---

### 6.2 `settings-mcp.tsx`

**File**: `src/components/settings-mcp.tsx`

Check for `sdk.client.mcp.*` calls → add `projectID` if project-scoped.

---

### 6.3 `settings-plugins.tsx`

**File**: `src/components/settings-plugins.tsx`

Check for `sdk.client.plugin.*` calls → add `projectID` if project-scoped.

---

### 6.4 `settings-agents.tsx` + `settings-skills.tsx`

These likely use:
- `app.agents()` → now `agent.list({ projectID })`  
- `app.skills()` → now `skill.list({ projectID })`

---

### 6.5 `dialog-edit-project.tsx`

**File**: `src/components/dialog-edit-project.tsx`

Check for project update calls.

---

## Phase 7: Cleanup + Tests

### 7.1 Update test files

Files with SDK mocks that need updating:

| File | What to Update |
|------|----------------|
| `components/prompt-input/submit.test.ts` | Mock SDK shape — `createClient` opts |
| `context/global-sync.test.ts` | Mock `global.*` → flat calls |
| `context/sync-optimistic.test.ts` | Verify no SDK mocks |
| `context/command.test.ts` | Verify no SDK mocks |

---

### 7.2 Remove `x-liteai-directory` from SDK client factory

**File**: `packages/liteai-sdk/js/src/client.ts`

After all consumers are migrated:

```diff
-if (config?.directory) {
-  const isNonASCII = /[^\x00-\x7F]/.test(config.directory)
-  const encodedDirectory = isNonASCII ? encodeURIComponent(config.directory) : config.directory
-  config.headers = {
-    ...config.headers,
-    "x-liteai-directory": encodedDirectory,
-  }
-}
```

Also deprecate `directory` option in `createLiteaiClient` type signature.

---

### 7.3 Remove `directory` from `createSdkForServer` in app

**File**: `src/utils/server.ts`

Remove the `directory` option from internal calls. Since `projectID` is now a method-level parameter, client creation doesn't need directory context.

---

### 7.4 Clean up `sdk.tsx` context

Once all consumers use `sdk.projectID`, remove `directory` from the client creation config:

```diff
 const client = createMemo(() =>
   globalSDK.createClient({
-    directory: directory(),
     throwOnError: true,
   }),
 )
```

---

### 7.5 Final verification

1. `tsc --noEmit` — no type errors
2. `biome check` — no lint errors  
3. Manual test: full app flow (open project, sessions, traces, settings, MCP, terminals)
4. Verify no `x-liteai-directory` header in network requests for project-scoped routes
5. Verify `global.*` no longer appears in codebase: `grep -r "\.global\." src/`
