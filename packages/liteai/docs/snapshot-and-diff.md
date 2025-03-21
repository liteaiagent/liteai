# Snapshot & Diff System

The snapshot system tracks file changes during sessions using a **shadow git repository** — a separate `.git` database that is completely independent of the user's project git. This enables change tracking, per-message diffs, and session revert without polluting the project's git history.

> **Related:**
> - [project.md](./project.md) — project identity and Instance context
> - [session.md](./session.md) — session lifecycle and message parts (step-start, step-finish)
> - [database.md](./database.md) — schema for snapshot-related parts and session summary columns

---

## Shadow Git Repository

Each project gets a dedicated git database stored at `<data_dir>/snapshot/<project_id>`. The key technique is using `--git-dir` and `--work-tree` flags to decouple git's storage from the tracked folder:

```
git --git-dir=<snapshot_dir> --work-tree=<project_worktree> <command>
```

This means:
- The project folder has **no extra `.git`** directory
- The project's own git repo is unaffected
- Snapshots don't appear in the project's history

### Initialization

On first use, `Snapshot.track()` creates the shadow repo:

```typescript
await Process.run(["git", "init"], {
  env: {
    GIT_DIR: git,              // e.g., ~/.local/share/liteai/snapshot/<project_id>
    GIT_WORK_TREE: Instance.worktree,  // the actual project folder
  },
})
```

Additional config is set to avoid cross-platform issues:
- `core.autocrlf=false` — no line-ending conversion on Windows
- `core.longpaths=true` — support long file paths
- `core.symlinks=true` — preserve symlinks
- `core.fsmonitor=false` — disable filesystem monitor

### Exclude Files

The snapshot system syncs the project's own `.git/info/exclude` into the shadow repo so the same files are ignored in both places. See `syncExclude()` in `src/snapshot/index.ts`.

---

## Snapshot Lifecycle

### Taking a Snapshot

`Snapshot.track()` captures the current state of all files:

```typescript
async function track() {
  const git = gitdir()
  await add(git)    // git add .
  const hash = await Process.text(
    ["git", ...args(git, ["write-tree"])],
    { cwd: Instance.directory }
  ).then((x) => x.text)
  return hash.trim()  // tree hash = snapshot ID
}
```

`write-tree` is used instead of `commit` because it's lighter — no commit message, author info, or parent chain needed. The returned tree hash uniquely identifies the file state.

### When Snapshots Are Taken

Snapshots are taken in `processor.ts` during message processing:

1. **Before the LLM acts** — a `step-start` part is created with `snapshot = await Snapshot.track()`.
2. **After each tool-call round** — a `step-finish` part is created with another snapshot.

These hashes are stored as message parts (`StepStartPart`, `StepFinishPart`) in the session database.

```
User sends message
  → step-start { snapshot: "abc123" }  (filesystem before)
  → LLM runs tools, edits files
  → step-finish { snapshot: "def456" }  (filesystem after)
```

---

## Computing Diffs

### `Snapshot.patch(hash)` — Changed File Names

Returns a list of file paths that changed since a given snapshot:

```bash
git diff --name-only <hash> -- .
```

### `Snapshot.diff(hash)` — Unified Diff Text

Returns raw unified diff output:

```bash
git diff --no-ext-diff <hash> -- .
```

### `Snapshot.diffFull(from, to)` — Structured File Diffs

Returns full per-file diff information by combining three git commands:

1. **`git diff --name-status --no-renames <from> <to>`** — determines each file's status:
   - `A` → `"added"`
   - `D` → `"deleted"`
   - `M` → `"modified"`

2. **`git diff --numstat <from> <to>`** — line-level addition/deletion counts per file.

3. **`git show <hash>:<file>`** — retrieves the full content of each file at both snapshots.

The result is an array of `Snapshot.FileDiff`:

```typescript
type FileDiff = {
  file: string                              // relative path
  before: string                            // content at "from" snapshot
  after: string                             // content at "to" snapshot
  additions: number                         // lines added
  deletions: number                         // lines deleted
  status: "added" | "deleted" | "modified"  // change type
}
```

---

## Session Summary

After an assistant message completes, `SessionSummary.summarize()` runs:

1. Scans message parts to find the **earliest** `step-start` snapshot and the **latest** `step-finish` snapshot.
2. Calls `Snapshot.diffFull(from, to)` to compute the full diff.
3. Stores the `FileDiff[]` via `Storage.write(["session_diff", sessionID], diffs)`.
4. Updates the session's summary metadata (total additions, deletions, file count) in the database.
5. Publishes a `session.diff` event on the bus.

Per-message diffs are also computed and stored on the `UserMessage.summary.diffs` field so each prompt's changes can be viewed independently.

### Storage locations

| Data | Location |
|---|---|
| Session-level `FileDiff[]` | `<data_dir>/storage/session_diff/<session_id>` (filesystem) |
| Summary counts | `session` table columns: `summary_additions`, `summary_deletions`, `summary_files` |
| Summary diffs | `session.summary_diffs` column (JSON) |
| Per-message diffs | User message `data.summary.diffs` (JSON in `message` table) |

---

## HTTP API

### `GET /session/:sessionID/diff`

Returns the stored `FileDiff[]` for a session. Accepts an optional `messageID` query param to get per-message diffs.

**Source:** `server/routes/session.ts`
**Handler:** Calls `SessionSummary.diff()` which reads from `Storage`.
**Response:** `Snapshot.FileDiff[]`

---

## Revert & Restore

### `Snapshot.restore(hash)`

Restores the entire working tree to a snapshot state:

```bash
git read-tree <hash>          # reset index to snapshot
git checkout-index -a -f      # write files from index to disk
```

### `Snapshot.revert(patches)`

Reverts specific files changed by the session. For each file in the patch:
- If the file existed in the snapshot: `git checkout <hash> -- <file>`
- If the file didn't exist: `fs.unlink(file)` (deletes it)

This enables per-session undo — the user can revert all changes made during a conversation.

---

## Snapshot Cleanup

Old snapshot data is pruned hourly via `Snapshot.cleanup()`:

```bash
git gc --prune=7.days
```

This runs in a scheduled task registered via `Scheduler.register()` with a 1-hour interval.
