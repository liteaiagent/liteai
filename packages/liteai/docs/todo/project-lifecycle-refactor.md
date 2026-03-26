# Project Lifecycle Refactor — Implementation Plan

> **Goal:** Eliminate localStorage as the project list source of truth. Make the DB the single authority for project lifecycle. Separate "exists in DB" from "is open in UI" using `time_archived`.

## Background

The system was designed for CLI where "project" is implicit (CWD). The web was patched on with a localStorage-backed project list synchronized via an `createEffect` loop to the DB. This dual-state causes ghost projects, cross-browser desync, and stale data bugs.

**After this refactor:**
- `time_archived IS NULL` → project is "active" (visible in web sidebar)
- `time_archived IS NOT NULL` → project is "closed" (hidden from sidebar)
- localStorage stores only ephemeral UI preferences (ordering, panel sizes)
- CLI `fromDirectory()` clears `time_archived` so projects re-activate on use

---

## Phase 1 — Backend: `fromDirectory()` clears `time_archived`

### File: `packages/liteai/src/project/project.ts`

**Line ~274-284** — Add `time_archived: null` to the `updateSet` in `fromDirectory()`:

```ts
// BEFORE
const updateSet = {
  worktree: result.worktree,
  vcs: result.vcs ?? null,
  name: result.name,
  icon_url: result.icon?.url,
  icon_color: result.icon?.color,
  time_updated: result.time.updated,
  time_initialized: result.time.initialized,
  sandboxes: result.sandboxes,
  commands: result.commands,
}

// AFTER
const updateSet = {
  worktree: result.worktree,
  vcs: result.vcs ?? null,
  name: result.name,
  icon_url: result.icon?.url,
  icon_color: result.icon?.color,
  time_updated: result.time.updated,
  time_initialized: result.time.initialized,
  time_archived: null,              // ← Active use always unarchives
  sandboxes: result.sandboxes,
  commands: result.commands,
}
```

**Why:** When someone accesses a project (CLI or web API), it should be considered "active." If a user archived a project in the web, then ran `liteai` in that directory from the CLI, the project should reappear in the web — because the user explicitly chose to work on it.

Also clear the `time.archived` on the returned `result` object (line ~249-257):

```ts
const result: Info = {
  ...existing,
  worktree: data.worktree,
  vcs: data.vcs as Info["vcs"],
  time: {
    ...existing.time,
    updated: Date.now(),
    archived: undefined,            // ← Clear archived on access
  },
}
```

**Tests:** Verify that a project with `time_archived` set gets it cleared when `fromDirectory()` is called again.

---

## Phase 2 — Backend: Add `DELETE /project/:projectID` endpoint

### File: `packages/liteai/src/project/project.ts`

Add a `remove()` function:

```ts
export const remove = fn(
  z.object({ projectID: ProjectID.zod }),
  async (input) => {
    log.info("remove", { id: input.projectID })
    Database.use(db =>
      db.delete(ProjectTable)
        .where(eq(ProjectTable.id, input.projectID))
        .run()
    )
    GlobalBus.emit("event", {
      payload: {
        type: "project.removed",
        properties: { id: input.projectID },
      },
    })
  },
)
```

### File: `packages/liteai/src/server/routes/project.ts`

Add the DELETE route after the unarchive route (~line 164):

```ts
.delete(
  "/:projectID",
  describeRoute({
    summary: "Delete project",
    description: "Permanently delete a project and all associated data.",
    operationId: "project.remove",
    responses: {
      200: { description: "Project deleted", content: { "application/json": { schema: resolver(z.boolean()) } } },
      ...errors(404),
    },
  }),
  validator("param", z.object({ projectID: ProjectID.zod })),
  async (c) => {
    await Project.remove({ projectID: c.req.valid("param").projectID })
    return c.json(true)
  },
)
```

### File: `packages/liteai/src/bus/bus-event.ts`

Register the new `project.removed` event type so SSE clients receive it.

### File: SDK regeneration

Run `./packages/liteai/script/build.ts` to regenerate the SDK with `project.remove()`.

---

## Phase 3 — Frontend: Derive project list from DB

### File: `packages/liteai-app/src/context/layout.tsx`

This is the core change. Currently `layout.projects` delegates to `server.projects` (localStorage). Change it to derive directly from `globalSync.data.project`.

#### 3a. Remove the sync loop (lines ~554-578)

Delete the entire `createEffect` that syncs DB → localStorage:

```ts
// DELETE THIS ENTIRE BLOCK
createEffect(() => {
  if (!ready()) return
  const db = globalSync.data.project
  const keys = new Set(db.filter((p) => p.worktree && !p.time?.archived).map((p) => workspaceKey(p.worktree)))
  const local = server.projects.list()
  // ...
  batch(() => {
    for (const p of db) { ... server.projects.open(p.worktree) }
    for (const p of local) { ... server.projects.close(p.worktree) }
  })
})
```

#### 3b. Change `enriched` and `list` to read from DB

Replace lines ~487-496:

```ts
// BEFORE
const enriched = createMemo(() => server.projects.list().map(enrich))

// AFTER
const enriched = createMemo(() => {
  const active = globalSync.data.project
    .filter(p => p.worktree && !p.time?.archived)
  // Preserve the "expanded" UI state from localStorage (kept as UI pref)
  return active.map(p => {
    const stored = uiPrefs().find(x => workspaceKey(x.worktree) === workspaceKey(p.worktree))
    return enrich({
      worktree: p.worktree,
      expanded: stored?.expanded ?? true,
    })
  })
})
```

#### 3c. Update `projects.open()` and `projects.close()`

```ts
projects: {
  list,
  open(directory: string) {
    const root = rootFor(directory)
    // Check if already active
    const existing = globalSync.data.project.find(
      p => workspaceKey(p.worktree) === workspaceKey(root)
    )
    if (existing && !existing.time?.archived) return
    // If archived, unarchive via API
    if (existing?.id && existing.id !== "global") {
      void globalSDK.client.project.unarchive({ projectID: existing.id })
    }
    // If not in DB at all, the next API call with this directory
    // will trigger fromDirectory() which creates the row
    globalSync.project.loadSessions(root)
  },
  close(directory: string) {
    const project = globalSync.data.project.find(
      p => workspaceKey(p.worktree) === workspaceKey(directory)
    )
    if (!project?.id || project.id === "global") return
    void globalSDK.client.project.archive({ projectID: project.id })
    // Optimistic update
    globalSync.set("project", ((draft: Project[]) => {
      const match = draft.find(p => workspaceKey(p.worktree) === workspaceKey(directory))
      if (match) {
        if (!match.time) match.time = {} as typeof match.time
        match.time.archived = Date.now()
      }
    }) as never)
  },
  // expand/collapse/move → keep delegating to a localStorage-based UI pref store
  expand(directory: string) { ... },
  collapse(directory: string) { ... },
  move(directory: string, toIndex: number) { ... },
},
```

#### 3d. Update the `enrich()` function

The current `enrich()` takes `{ worktree, expanded }` from `server.projects.list()`. It needs to accept the project from DB data instead. The `expanded` field should come from a separate localStorage store for UI preferences.

#### 3e. Change `onMount` session loading (lines ~580-586)

```ts
// BEFORE
onMount(() => {
  Promise.all(
    server.projects.list().map((project) => {
      return globalSync.project.loadSessions(project.worktree)
    }),
  )
})

// AFTER
onMount(() => {
  const active = globalSync.data.project.filter(p => p.worktree && !p.time?.archived)
  Promise.all(active.map(p => globalSync.project.loadSessions(p.worktree)))
})
```

#### 3f. Sandbox-to-root resolution (lines ~466-485)

The `createEffect` that resolves sandbox directories to their root projects currently reads from `server.projects.list()`. Change to read from the new derived `enriched` list instead. The `server.projects.open/close/expand` calls within this effect should be replaced with the new DB-backed equivalents.

---

## Phase 4 — Frontend: Remove `projects` from `server.tsx`

### File: `packages/liteai-app/src/context/server.tsx`

#### 4a. Remove `projects` store from persisted state

```ts
// BEFORE
const [store, setStore, _, ready] = persisted(
  Persist.global("server", ["server.v3"]),
  createStore({
    list: [] as StoredServer[],
    projects: {} as Record<string, StoredProject[]>,  // ← REMOVE
    lastProject: {} as Record<string, string>,         // ← REMOVE
  }),
)

// AFTER
const [store, setStore, _, ready] = persisted(
  Persist.global("server", ["server.v4"]),  // ← bump version
  createStore({
    list: [] as StoredServer[],
  }),
)
```

#### 4b. Remove the `projects` namespace from the return value

Delete lines ~239-297 entirely (the `projects: { list, open, close, expand, collapse, move, last, touch }` block).

#### 4c. Remove `projectsKey`, `StoredProject` type, `projectsList` memo

These are all only used by the removed `projects` namespace.

#### 4d. Add a minimal UI preferences store for project ordering

Since ordering/expanded state is a UI preference, keep a simple localStorage store:

```ts
// Can live in layout.tsx or a new file
const [projectPrefs, setProjectPrefs] = persisted(
  Persist.global("projectPrefs", []),
  createStore({
    order: {} as Record<string, string[]>,    // server → worktree[]
    expanded: {} as Record<string, boolean>,  // worktree → boolean
    last: {} as Record<string, string>,       // server → last active worktree
  }),
)
```

---

## Phase 5 — Frontend: Update all consumers

Every file that references `server.projects.*` or `layout.projects.*` needs updating. Here is the complete list:

### Files referencing `server.projects.*`

| File | Lines | What to change |
|------|-------|----------------|
| `context/layout.tsx` | 467, 475, 478, 482, 487, 558, 570, 575, 582, 604, 606, 609, 612, 615, 618 | Replace with DB-backed logic (Phase 3) |
| `pages/layout.tsx` | 388, 403 | `server.projects.last()` → read from `projectPrefs.last` |
| `pages/layout/navigation.ts` | 64, 106 | `server.projects.touch()` → write to `projectPrefs.last` |
| `pages/home.tsx` | 44 | `server.projects.touch()` → write to `projectPrefs.last` |

### Files referencing `layout.projects.*`

These should continue to work once `layout.projects` is rewired (Phase 3). Verify each still works:

| File | Usage | Notes |
|------|-------|-------|
| `pages/layout.tsx:210,215` | `.list().find()` — project lookup by worktree | No change needed |
| `pages/layout.tsx:283` | `.list()` — project list for sidebar | No change needed |
| `pages/layout.tsx:387,400` | `.list().length > 0` — ready check | No change needed |
| `pages/layout.tsx:620,623` | `.list()`, `.move()` — drag-and-drop | `.move()` → update `projectPrefs.order` |
| `pages/layout.tsx:747,754` | `.list()` — sidebar + overlay | No change needed |
| `pages/layout/navigation.ts:107` | `.list().find()` — lookup | No change needed |
| `pages/layout/navigation.ts:192` | `.open()` — on deep link | Now calls unarchive API |
| `pages/layout/navigation.ts:197` | `.list()` — close project | No change needed |
| `pages/layout/navigation.ts:229,237,243` | `.close()` — close project | Now calls archive API |
| `pages/layout/workspace-ops.ts:77,78` | `.close()`, `.open()` — delete workspace | Now calls archive/unarchive API |
| `pages/layout/workspace-ops.ts:84,91` | `.list().find()` — lookup | No change needed |
| `pages/home.tsx:43` | `.open()` — open from home page | Now calls unarchive API |
| `components/session/session-header.tsx:145` | `.list().find()` — lookup | No change needed |
| `components/dialog-select-file.tsx:283` | `.list().find()` — lookup | No change needed |
| `components/dialog-select-directory.tsx:284` | `.list()` — directory list | No change needed |

---

## Phase 6 — Frontend: Handle `project.removed` SSE event

### File: `packages/liteai-app/src/context/global-sync/event-reducer.ts`

Add handling for the new `project.removed` event in `applyGlobalEvent`:

```ts
if (event.type === "project.removed") {
  const id = event.properties.id
  setGlobalProject((draft) => {
    const index = draft.findIndex(p => p.id === id)
    if (index !== -1) draft.splice(index, 1)
  })
  return
}
```

---

## Phase 7 — Frontend: Update `closeProject()` in navigation.ts

### File: `packages/liteai-app/src/pages/layout/navigation.ts`

Simplify `closeProject()` (lines ~196-247). Remove all `layout.projects.close()` calls since archiving in DB is now the sole mechanism:

```ts
export function closeProject(deps, directory) {
  const list = deps.layout.projects.list()
  const key = workspaceKey(directory)
  const index = list.findIndex(x => workspaceKey(x.worktree) === key)
  const active = workspaceKey(deps.currentProject()?.worktree ?? "") === key
  const project = list[index]

  if (index === -1) return

  // Archive in DB (single source of truth)
  if (project?.id && project.id !== "global") {
    void deps.globalSDK.client.project.archive({ projectID: project.id })
  }

  // Optimistic update — set time.archived so the reactive list updates immediately
  deps.globalSync.set("project", ((draft: Project[]) => {
    const match = draft.find(p => workspaceKey(p.worktree) === key)
    if (match) {
      if (!match.time) match.time = {} as typeof match.time
      match.time.archived = Date.now()
    }
  }) as never)

  // Navigate away if closing the active project
  if (!active) return

  const target = list[index + 1] ?? list[index - 1]
  if (!target) {
    deps.navigate("/")
    return
  }
  deps.navigateWithSidebarReset(`/${base64Encode(target.worktree)}/session`)
  queueMicrotask(() => void navigateToProject(deps, target.worktree))
}
```

Similarly simplify `archiveProject()` and `restoreProject()` — they become thin wrappers around the archive/unarchive API calls with optimistic updates.

---

## Phase 8 — Frontend: Update home page

### File: `packages/liteai-app/src/pages/home.tsx`

The home page already reads from `sync.data.project` for recent projects (line 28-33). Update the `openProject` function:

```ts
// BEFORE
function openProject(directory: string) {
  layout.projects.open(directory)
  server.projects.touch(directory)     // ← remove
  navigate(`/${base64Encode(directory)}`)
}

// AFTER
function openProject(directory: string) {
  layout.projects.open(directory)
  navigate(`/${base64Encode(directory)}`)
}
```

The `server.projects.touch()` tracked "last active project" in localStorage. Replace with the new `projectPrefs.last` if needed, or just use URL-based routing as the source for "current project."

---

## Phase 9 — Backend: Auto-archive stale projects

### File: `packages/liteai/src/project/project.ts`

Add a function to archive projects untouched for 30 days:

```ts
export function archiveStale(days = 30) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
  const count = Database.use(db =>
    db.update(ProjectTable)
      .set({ time_archived: Date.now() })
      .where(and(
        isNull(ProjectTable.time_archived),
        lt(ProjectTable.time_updated, cutoff),
      ))
      .returning()
      .all()
      .length
  )
  if (count > 0) log.info("archiveStale", { archived: count, days })
  return count
}
```

### File: `packages/liteai/src/cli/cmd/serve.ts` or server startup

Call `Project.archiveStale()` once on server startup.

---

## Phase 10 — CLI: Add project management commands

### File: `packages/liteai/src/cli/cmd/project.ts` (new)

Add CLI commands for project management:

```ts
export const ProjectCommand = cmd({
  command: "project",
  describe: "manage projects",
  builder: (yargs) =>
    yargs
      .command("list", "list all projects", {}, async () => {
        const projects = Project.list()
        for (const p of projects) {
          const status = p.time.archived ? "(archived)" : ""
          console.log(`${p.id}  ${p.worktree}  ${status}`)
        }
      })
      .command("archive <id>", "archive a project", {
        id: { type: "string", demandOption: true },
      }, async (args) => {
        await Project.setArchived({ projectID: args.id, time: Date.now() })
        console.log("archived")
      })
      .command("delete <id>", "permanently delete a project", {
        id: { type: "string", demandOption: true },
      }, async (args) => {
        await Project.remove({ projectID: args.id })
        console.log("deleted")
      }),
})
```

Register in `packages/liteai/src/cli/cli.ts`.

---

## Phase 11 — SDK regeneration

After adding the `DELETE /project/:projectID` route (Phase 2), regenerate the SDK:

```bash
cd packages/liteai
bun run ./script/build.ts
```

This generates the client method `project.remove()` that the frontend can use.

---

## Verification Checklist

After all phases are complete, verify:

- [ ] Fresh web app open (no localStorage) → shows all non-archived DB projects
- [ ] Closing a project → archives in DB → disappears from sidebar
- [ ] Opening a project (home page or deep link) → appears in sidebar
- [ ] Switching browsers → same project list (from DB)
- [ ] Clearing localStorage → project list intact (from DB), only lose UI prefs
- [ ] CLI `liteai` in a directory → project created/unarchived in DB → visible in web
- [ ] CLI `liteai` in an archived project's directory → project unarchived → visible in web
- [ ] `liteai project list` → shows all projects with archive status
- [ ] `liteai project archive <id>` → archives, disappears from web sidebar
- [ ] `liteai project delete <id>` → permanently removed, sessions cascade deleted
- [ ] Server restart → stale projects (30+ days) auto-archived
- [ ] Drag-and-drop project ordering still works (from localStorage UI prefs)
- [ ] No `server.projects` references remain in codebase

---

## Files Changed Summary

### Backend (`packages/liteai`)

| File | Change |
|------|--------|
| `src/project/project.ts` | `fromDirectory()` clears `time_archived`; add `remove()`, `archiveStale()` |
| `src/server/routes/project.ts` | Add `DELETE /:projectID` route |
| `src/bus/bus-event.ts` | Register `project.removed` event |
| `src/cli/cmd/project.ts` | **New file** — `list`, `archive`, `delete` commands |
| `src/cli/cli.ts` | Register `ProjectCommand` |
| `src/cli/cmd/serve.ts` | Call `archiveStale()` on startup |

### Frontend (`packages/liteai-app`)

| File | Change |
|------|--------|
| `src/context/server.tsx` | Remove `projects` store; bump persist version |
| `src/context/layout.tsx` | Derive project list from `globalSync.data.project`; remove sync loop; update `projects.open/close` to use API |
| `src/context/global-sync/event-reducer.ts` | Handle `project.removed` SSE event |
| `src/pages/layout/navigation.ts` | Simplify `closeProject()`; remove `layout.projects.close()` calls |
| `src/pages/layout/workspace-ops.ts` | Update `deleteWorkspace()` — remove `layout.projects.close/open` |
| `src/pages/layout.tsx` | Update `server.projects.last()` refs → `projectPrefs.last` |
| `src/pages/home.tsx` | Remove `server.projects.touch()` |

### SDK

| File | Change |
|------|--------|
| `packages/liteai/script/build.ts` | Run to regenerate SDK with `project.remove()` |

---

## Execution Order

```
Phase 1  → Backend: fromDirectory() clears time_archived
Phase 2  → Backend: DELETE endpoint + project.removed event
Phase 11 → SDK regeneration (depends on Phase 2)
Phase 3  → Frontend: Derive project list from DB (core change)
Phase 4  → Frontend: Remove projects from server.tsx
Phase 5  → Frontend: Update all consumers
Phase 6  → Frontend: Handle project.removed SSE
Phase 7  → Frontend: Simplify closeProject()
Phase 8  → Frontend: Update home page
Phase 9  → Backend: Auto-archive stale projects
Phase 10 → CLI: Project management commands
```

Phases 1-2 and 11 can be done first (backend-only, no breaking changes).
Phases 3-8 form the core frontend migration (do together).
Phases 9-10 are independent enhancements.
