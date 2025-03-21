# Project & Instance

This document describes how LiteAI discovers, identifies, and manages **projects** — the top-level organizational unit that scopes sessions, snapshots, and configuration.

> **Related:**
> - [database.md](./database.md) — full schema reference for the `project` table and all other tables
> - [session.md](./session.md) — session lifecycle and filtering
> - [snapshot-and-diff.md](./snapshot-and-diff.md) — shadow git and change tracking

---

## Data Model

```
Project  1───∞  Session  1───∞  Message  1───∞  Part
   │                │
   │                ├── ∞ Todo
   │                └── optional workspace_id
   │
   ├──── Permission  (project-level ruleset, 1:1)
   └──── ∞ Workspace  (experimental)
```

A **Project** represents a git repository or a standalone directory. It is the root entity that all sessions belong to.

---

## Project Identity — `ProjectID`

`ProjectID` is a branded string. The ID is determined by `Project.fromDirectory()` based on the directory's git state:

| Scenario | Project ID | Worktree | VCS |
|---|---|---|---|
| Git repo with commits | Root commit SHA (from `git rev-list --max-parents=0 HEAD`) | Git worktree root | `"git"` |
| Git repo, empty (no commits) | `"dir_<sha1(directory)>"` | Directory path | fake |
| Git repo, no git binary | `"dir_<sha1(directory)>"` | Directory path | fake |
| Git repo, `git-common-dir` fails | `"dir_<sha1(directory)>"` | Directory path | fake |
| No `.git` found | `"dir_<sha1(directory)>"` | Directory path | fake |

### Directory-based IDs

When a git-based ID cannot be determined, a deterministic ID is generated from the directory path:

```typescript
function directoryId(dir: string) {
  const hash = new Bun.CryptoHasher("sha1").update(dir).digest("hex").slice(0, 16)
  return ProjectID.make("dir_" + hash)
}
```

This ensures that:
- Every directory gets its own unique project — no two non-git directories share a project ID.
- The same directory always produces the same ID (deterministic).
- Sessions are correctly scoped when switching between projects in the UI.

### Git-based IDs

For git repositories with commits:

1. The root commit hash is computed via `git rev-list --max-parents=0 HEAD` (sorted, first element).
2. Every clone of the same repo gets the **same** project ID.
3. Git worktrees share a single project ID (resolved via `git rev-parse --git-common-dir`).
4. The computed ID is cached in `.git/liteai` for instant subsequent lookups.

### The Global Fallback

`ProjectID.global` (`"global"`) exists as a last-resort sentinel but is essentially unused in practice. All code paths that previously fell back to `"global"` now use `directoryId()` instead.

---

## Project Discovery — `Project.fromDirectory()`

**Source:** `src/project/project.ts`

Given a working directory, the discovery algorithm:

```
fromDirectory(directory)
  │
  ├── Walk up filesystem looking for .git
  │     │
  │     ├── .git found
  │     │     ├── Try to read cached ID from .git/liteai
  │     │     ├── Check for git binary → if missing, return directoryId(sandbox)
  │     │     ├── Resolve git-common-dir → if fails, return directoryId(sandbox)
  │     │     ├── Try to read cached ID from worktree/.git/liteai (for worktrees)
  │     │     ├── Compute ID from root commits → if fails, return directoryId(sandbox)
  │     │     ├── Cache computed ID in .git/liteai
  │     │     ├── Resolve --show-toplevel → set as sandbox
  │     │     └── Return { id: rootCommitSHA, worktree, sandbox, vcs: "git" }
  │     │
  │     └── .git not found
  │           └── Return { id: directoryId(directory), worktree: directory, sandbox: directory }
  │
  ├── Upsert project row in database
  │
  ├── Migrate sessions from "global" → real project ID (if applicable)
  ├── Migrate sessions from directoryId → git SHA (when first commit is made)
  │
  └── Emit project.updated event
```

### Session Migration

Two automatic migrations run on every `fromDirectory()` call:

1. **`global` → real ID**: Sessions created before per-directory IDs existed (with `project_id = "global"`) are re-homed when the directory matches:
   ```sql
   UPDATE session SET project_id = :newId
   WHERE project_id = 'global' AND directory = :worktree
   ```

2. **`directoryId` → git SHA**: When a first commit is made in a repo, sessions move from the directory-based ID to the git-based one:
   ```sql
   UPDATE session SET project_id = :gitSha
   WHERE project_id = :dirId AND directory = :worktree
   ```

---

## Instance — Runtime Context

**Source:** `src/project/instance.ts`

`Instance` is the **runtime context** that ties a running server request to a specific directory. It is resolved per-request via the `x-liteai-directory` HTTP header or `directory` query parameter.

| Property | Description |
|---|---|
| `Instance.directory` | The directory from the request (the user's CWD) |
| `Instance.worktree` | The git worktree root (may differ from directory in worktree setups) |
| `Instance.project` | The resolved `Project.Info` for this directory |

### How it works

1. **SDK client** sets `x-liteai-directory` header on every request (set at client creation time).
2. **Server middleware** reads the header and calls `Instance.provide({ directory })`.
3. `Instance.provide` calls `Project.fromDirectory(directory)` to resolve the project.
4. The Instance context is available to all downstream handlers via async local storage.
5. Instances are **cached per directory** — subsequent requests for the same directory reuse the context.

### Instance reload

When a project's VCS state changes (e.g. `git init`), `Instance.reload()`:
1. Disposes all instance state (snapshot tracker, scheduler, etc.).
2. Emits `server.instance.disposed` on `GlobalBus`.
3. Boots a fresh instance context with the new project info.
4. Runs `InstanceBootstrap` (re-initializes snapshot tracking, VCS branch monitoring, etc.).

---

## Database Schema

See [database.md](./database.md) for the full `project` table schema.

### Filesystem

| Path | Purpose |
|---|---|
| `.git/liteai` | Cached `ProjectID` (one line of text) |
| `<data_dir>/snapshot/<project_id>/` | Shadow git database (see [snapshot-and-diff.md](./snapshot-and-diff.md)) |

---

## Git Init After Project Selection

When a user opens a non-git directory and later creates a git repository:

### Backend — `POST /project/git/init`

1. `Project.initGit()` runs `git init --quiet` in the project directory.
2. `Project.fromDirectory()` re-discovers the project, computing a new `ProjectID`.
3. If the project ID or VCS state changed, `Instance.reload()` is called.
4. The session migration automatically re-homes sessions from the old `directoryId` to the new git SHA.
5. Returns the new `Project.Info` with `vcs: "git"`.

### UI — `session.tsx`

1. The review panel checks `project.vcs` — when falsy, it shows a **"Create Git repository"** button.
2. `initGit()` calls `sdk.client.project.initGit()` and updates the project store.
3. The `server.instance.disposed` SSE event triggers a full state re-bootstrap.
4. The project now has `vcs: "git"`, so the review panel switches to the diff view.

> **Note**: The project ID changes from `"dir_<hash>"` to the root commit SHA. Since the migration runs server-side, existing sessions are seamlessly transferred.

---

## Workspace (Experimental)

Workspaces are an **experimental** feature gated behind `LITEAI_EXPERIMENTAL_WORKSPACES`. They represent isolated execution environments (remote sandboxes, worktrees, etc.).

### Database Schema — `workspace` table

| Column | Type | Notes |
|---|---|---|
| `id` | `text PK` | `WorkspaceID` |
| `type` | `text` | Adaptor type (e.g. `"worktree"`) |
| `branch` | `text` | Git branch for this workspace |
| `name` | `text` | Display name |
| `directory` | `text` | Local mount/directory |
| `extra` | `json text` | Adaptor-specific metadata |
| `project_id` | `text FK → project` | Cascade delete |

### Workspace Context

`WorkspaceContext` is an async local storage provider. When a request carries a workspace ID, the `WorkspaceRouterMiddleware` sets the context so that:

- `Session.list()` automatically filters by `workspace_id`.
- Mutations can be forwarded to a remote workspace via the adaptor's `fetch()` method.

### SSE Sync

For non-worktree workspaces, `Workspace.startSyncing()` opens an SSE connection to each workspace's `/event` endpoint and pipes events into `GlobalBus`.
