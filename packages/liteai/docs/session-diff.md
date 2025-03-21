# Session Diff Storage

Session diffs record what files changed during a session. The diff data is stored on the filesystem (not in SQLite) because `FileDiff[]` payloads can be large. This system powers the review panel in the UI.

> **Related:**
> - [snapshot-and-diff.md](./snapshot-and-diff.md) — how snapshots and diffs are computed
> - [session.md](./session.md) — session lifecycle and message parts
> - [database.md](./database.md) — schema for summary columns in the session table

---

## Storage Layer

**Source:** `src/storage/storage.ts`

The `Storage` namespace is a filesystem-based key-value store rooted at `~/.local/share/liteai/storage/`. Keys are path arrays that map to JSON files:

```typescript
// Write
Storage.write(["session_diff", sessionID], diffs)
// → ~/.local/share/liteai/storage/session_diff/<sessionID>.json

// Read
Storage.read<FileDiff[]>(["session_diff", sessionID])
```

### API

| Method | Description |
|---|---|
| `Storage.write(key, content)` | Write JSON to `<dir>/<key>.json` |
| `Storage.read<T>(key)` | Read and parse JSON from key path |
| `Storage.update<T>(key, fn)` | Read, mutate in place, write back |
| `Storage.remove(key)` | Delete the file |
| `Storage.list(prefix)` | Glob all keys under a prefix |

All operations use file-level read/write locks via `Lock`.

### Directory Structure

```
storage/
├── migration              ← integer tracking applied migrations
└── session_diff/
    ├── <sessionID>.json   ← FileDiff[] for that session
    └── ...
```

---

## How Diffs Are Computed

**Source:** `src/session/summary.ts` — `SessionSummary.summarize()`

After an assistant message completes:

1. Message parts are scanned for `step-start` and `step-finish` parts.
2. The **earliest** `step-start` snapshot and **latest** `step-finish` snapshot are identified.
3. `Snapshot.diffFull(from, to)` computes per-file diffs using three git commands:
   - `git diff --name-status` — file status (added/deleted/modified)
   - `git diff --numstat` — line-level add/delete counts
   - `git show <hash>:<file>` — full file contents at each snapshot
4. The resulting `FileDiff[]` is written via `Storage.write(["session_diff", sessionID], diffs)`.
5. Summary counts are stored in the session table columns.
6. A `session.diff` event is emitted on the bus.

### FileDiff Type

```typescript
type FileDiff = {
  file: string                              // relative path
  before: string                            // content at start snapshot
  after: string                             // content at end snapshot
  additions: number                         // lines added
  deletions: number                         // lines deleted
  status: "added" | "deleted" | "modified"  // change type
}
```

---

## Database Summary Columns

The session table stores aggregate counts (not the full diffs):

| Column | Type | Description |
|---|---|---|
| `summary_additions` | `integer` | Total lines added across all files |
| `summary_deletions` | `integer` | Total lines deleted across all files |
| `summary_files` | `integer` | Number of files changed |
| `summary_diffs` | `text (JSON)` | Per-message diff metadata |

---

## HTTP API

### `GET /session/:sessionID/diff`

**Source:** `src/server/routes/session.ts`

Returns the stored `FileDiff[]` for a session.

| Param | Type | Description |
|---|---|---|
| `messageID` | `string?` | If provided, returns per-message diffs instead of session-level |

**Response:** `FileDiff[]`

The handler calls `SessionSummary.diff()` which reads from `Storage.read(["session_diff", sessionID])`. Per-message diffs are stored on the user message's `data.summary.diffs` field.
