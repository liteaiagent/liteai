# Implicit Project Creation & Auto-Redirect Workflow

This document explains the step-by-step execution trace of what happens when a user opens `http://localhost:3000/` in the LiteAI application, particularly when starting with a seemingly "empty" database. 

It details why users are automatically redirected to the backend's Current Working Directory (CWD) instead of displaying an empty project screen.

## Execution Trace

### 1. Frontend Initialization and `bootstrapGlobal`
When the UI loads `/`, the frontend mounts `<GlobalSyncProvider>` (`packages/web/src/context/global-sync.tsx`). As soon as it detects a successful server connection, it triggers the `bootstrapGlobal()` sequence.

`bootstrapGlobal()` (located in `packages/web/src/context/global-sync/bootstrap.ts`) fires off a batch of required API calls to fetch global state, including:
```typescript
// Requests the list of available projects
input.globalSDK.project.list()
```

### 2. Backend Middleware CWD Fallback
The `GET /project/` request reaches the backend. Because the user is on the `/` route with no previously selected project, the request lacks the `x-liteai-directory` header and the `directory` query parameter.

The request passes through the **Workspace Instance Middleware** (`packages/core/src/server/server.ts`), which is bound to almost all API routes:
```typescript
const raw = c.req.query("directory") || c.req.header("x-liteai-directory") || process.cwd()

return WorkspaceContext.provide({
  workspaceID: rawWorkspaceID ? WorkspaceID.make(rawWorkspaceID) : undefined,
  async fn() {
    return Instance.provide({ // <--- Bound to process.cwd()
      directory: raw,
      // ...
    })
  }
})
```
Since the request lacks directory context, `raw` falls back to `process.cwd()`.

### 3. Implicit Database Insertion
Inside `Instance.provide` (`packages/core/src/project/instance.ts`), the backend resolves the directory and invokes `Project.fromDirectory(process.cwd())`.

`Project.fromDirectory` (`packages/core/src/project/project.ts`) calculates the project properties (e.g., discovering git configurations) and immediately **upserts the CWD into the SQLite `ProjectTable`**:
```typescript
Database.use((db) =>
  db.insert(ProjectTable)
    .values(insert)
    .onConflictDoUpdate({ target: ProjectTable.id, set: updateSet })
    .run(),
)
```
At this exact moment, the CWD is persistently inserted as a valid LiteAI project into the SQLite database.

### 4. Returning the Newly Minted Project
After the middleware finishes initializing the instance (and implicitly creating the project), the actual `GET /project/` route handler resolves:
```typescript
async (c) => {
  const projects = await Project.list() 
  // This list now contains the newly created CWD project
  return c.json(projects)
}
```

### 5. Frontend Auto-Selection and Redirect
Back on the frontend, `bootstrapGlobal` receives the response containing the new CWD project and updates the global store (`globalStore.project`). A sync effect pushes this project into `server.projects` (localStorage).

Finally, the `autoselecting` memo and effect in `packages/web/src/pages/layout.tsx` spring into action:
```typescript
const next = (lastKey ? value.list.find((p) => workspaceKey(p.worktree) === lastKey) : undefined) ?? value.list[0]

if (!next) return // It would have stopped here if the DB was truly empty!

setState("autoselect", false)
openProject(navDeps, next.worktree, false)
navigateToProject(navDeps, next.worktree) // REDIRECT
```
Because `value.list` is no longer empty (`value.list[0]` is the newly inserted CWD project), the frontend abandons the empty homepage and automatically navigates the user to the `/:dir` layout of the backend's CWD.

## Summary
The redirect happens because **virtually every API route on the backend routes through the Instance Middleware**, which forcibly inserts the CWD into the SQLite database if no filesystem context is provided. The frontend then correctly assumes there *is* a project in the database, grabs it, and auto-navigates.
