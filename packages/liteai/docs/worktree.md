# Worktree (Sandbox)

The worktree system creates isolated git worktree checkouts so sessions can run in a separate branch without touching the user's main working directory. Each worktree is a full copy of the project on a dedicated `liteai/<name>` branch.

> **Related:**
> - [session.md](./session.md) — session lifecycle and the prompt loop
> - [project.md](./project.md) — project identity and Instance context
> - [snapshot-and-diff.md](./snapshot-and-diff.md) — change tracking (separate system, uses shadow git)

---

## Overview

```
~/.local/share/liteai/worktree/<project_id>/
  ├── clever-falcon/      ← git worktree on branch liteai/clever-falcon
  ├── sunny-wolf/         ← git worktree on branch liteai/sunny-wolf
  └── ...
```

Worktrees are real git worktrees created via `git worktree add`. They appear as separate directories that share the same `.git` object store as the main project. Each is registered as a "sandbox" in the project database.

---

## Lifecycle

### Creation

**Source:** `src/worktree/index.ts` — `Worktree.create()`

1. A random name is generated from adjective-noun pairs (e.g. `clever-falcon`). User can provide a custom name.
2. The directory is created at `<data_dir>/worktree/<project_id>/<name>`.
3. A new branch `liteai/<name>` is created from the current HEAD.
4. `git worktree add --no-checkout -b liteai/<name> <directory>` creates the worktree.
5. The directory is registered as a sandbox via `Project.addSandbox()`.
6. Asynchronously:
   - `git reset --hard` populates the checkout.
   - `InstanceBootstrap` initializes the project context.
   - `worktree.ready` event is emitted.
   - Project start commands run (if configured).

### Reset

**Source:** `Worktree.reset()`

Resets a worktree to the default branch (main/master or remote HEAD):

1. Fetches the latest from the remote default branch.
2. `git reset --hard <target>` to reset the worktree.
3. `git clean -ffdx` to remove untracked files.
4. Submodules are updated and cleaned.
5. Project start commands re-run.

### Removal

**Source:** `Worktree.remove()`

1. Stops the filesystem monitor if running.
2. `git worktree remove --force <path>` detaches the worktree.
3. `git branch -D liteai/<name>` deletes the branch.
4. The directory is cleaned up and the sandbox registration removed.

---

## API Routes

All worktree endpoints live under `/experimental/` in `src/server/routes/experimental.ts`.

| Method | Path | Op ID | Description |
|---|---|---|---|
| `POST` | `/experimental/worktree` | `worktree.create` | Create a new worktree + branch |
| `GET` | `/experimental/worktree` | `worktree.list` | List sandbox directories for the project |
| `DELETE` | `/experimental/worktree` | `worktree.remove` | Remove a worktree and delete its branch |
| `POST` | `/experimental/worktree/reset` | `worktree.reset` | Reset worktree to the default branch |

### Create Input

```typescript
{
  name?: string        // Optional custom name (slugified)
  startCommand?: string // Additional startup script
}
```

### Create Response

```typescript
{
  name: string      // e.g. "clever-falcon"
  branch: string    // e.g. "liteai/clever-falcon"
  directory: string // Full path to the worktree checkout
}
```

---

## UI Integration

**Source:** `src/components/prompt-input/submit.ts`

When creating a new session, the prompt input has a `newSessionWorktree` accessor that controls worktree selection:

| Value | Behavior |
|---|---|
| `"main"` (default) | Session runs in the main project directory |
| `"create"` | Creates a new worktree, waits for it to be ready (up to 5 min), then starts the session there |
| `<directory>` | Uses an existing worktree directory |

When `"create"` is selected:

1. `POST /experimental/worktree` is called.
2. The worktree is marked as "pending" in `WorktreeState`.
3. The prompt submission waits for the `worktree.ready` event.
4. A new SDK client is created targeting the worktree directory.
5. The session is created and the agent runs entirely in the worktree.

---

## Worktree vs Snapshot

| | Worktree | Snapshot |
|---|---|---|
| **Purpose** | Isolated workspace for the user to work in | Invisible change tracking for diffs/revert |
| **Git type** | Real `git worktree` with its own branch | Shadow git repo (separate `--git-dir`) |
| **User-visible** | Yes — a real directory the user can open | No — hidden in data dir |
| **Scope** | Per session (optional) | Per project (always active) |
| **Storage** | `<data_dir>/worktree/<project_id>/` | `<data_dir>/snapshot/<project_id>/` |
