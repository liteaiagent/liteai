# Workspace, Project & Session — Navigation

> This document was split into focused docs for better organization. See the individual docs below.

---

## Docs

| Document | Scope |
|---|---|
| [project.md](./project.md) | Project identity, discovery (`fromDirectory`), ID resolution, Instance context, workspace |
| [session.md](./session.md) | Session lifecycle, listing/filtering, message structure, prompt loop, operations |
| [database.md](./database.md) | Full SQLite schema reference, query patterns, what's stored vs. not stored |
| [snapshot-and-diff.md](./snapshot-and-diff.md) | Shadow git, snapshot lifecycle, diffs, revert/restore, cleanup |
| [sse.md](./sse.md) | SSE event catalog and real-time update patterns |

---

## Quick Reference

### Data Model

```
Project  1───∞  Session  1───∞  Message  1───∞  Part
   │                │
   │                ├── ∞ Todo
   │                └── optional workspace_id
   │
   ├──── Permission  (project-level, 1:1)
   └──── ∞ Workspace  (experimental)
```

### Project ID Resolution

| Scenario | Project ID |
|---|---|
| Git repo with commits | Root commit SHA |
| Git repo, no commits / no binary | `"dir_<sha1(directory)>"` |
| No `.git` | `"dir_<sha1(directory)>"` |

### Session Listing Flow

```
UI selects directory
  → SDK sets x-liteai-directory header
  → Server middleware resolves Instance (project_id)
  → Session.list() filters by project_id + optional directory
  → Returns sessions ordered by time_updated DESC
```

### Snapshot Flow

```
User sends message
  → step-start { snapshot: "abc123" }   (before)
  → LLM runs tools
  → step-finish { snapshot: "def456" }  (after)
  → SessionSummary computes FileDiff[] from abc123..def456
```
