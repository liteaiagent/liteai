# Database Design

This document describes the SQLite database schema, query patterns, data lifecycle, and tracing/debugging capabilities.

> **Related:**
> - [project.md](./project.md) — project identity, discovery, Instance context
> - [session.md](./session.md) — session lifecycle, message structure, prompt loop
> - [snapshot-and-diff.md](./snapshot-and-diff.md) — shadow git, change tracking, revert

---

## Overview

LiteAI uses a **single global SQLite database** for all projects, managed by **Drizzle ORM**. The database file lives at `<data_dir>/liteai.db` (or `liteai-<safe_name>.db` for named instances).

```
<data_dir> = XDG_DATA_HOME/liteai
           = ~/.local/share/liteai     (Linux/macOS)
           = %LOCALAPPDATA%/liteai     (Windows)
```

**Schema source files:** `src/**/*.sql.ts`
**Migrations:** generated via `bun run db generate --name <slug>`, output to `migration/<timestamp>_<slug>/`.

---

## Entity Relationship

```
Project  1───∞  Session  1───∞  Message  1───∞  Part
   │                │
   │                ├── ∞ Todo     (checklist items)
   │                └── optional workspace_id
   │
   └──── Permission  (project-level ruleset, 1:1)
```

---

## Tables

### `project`

Defined in: `src/project/project.sql.ts`

| Column | Type | Notes |
|---|---|---|
| `id` | `text PK` | Root commit SHA, `"dir_<hash>"` (directory-based), or `"global"` |
| `worktree` | `text` | Absolute path to the git worktree root (or directory itself) |
| `vcs` | `text` | `"git"` or `null` |
| `name` | `text` | User-assigned display name |
| `icon_url` | `text` | Data URI or URL |
| `icon_color` | `text` | Badge color |
| `time_created` | `integer` | Epoch ms |
| `time_updated` | `integer` | Epoch ms |
| `time_initialized` | `integer` | Epoch ms; set after AGENTS.md bootstrap |
| `sandboxes` | `json text` | `string[]` — active worktree directories |
| `commands` | `json text` | Configured scripts |

**Indexes:** none (primary key only).

#### Project ID Resolution

The `Project.fromDirectory(directory)` function determines the project ID:

| Scenario | Project ID | Worktree |
|---|---|---|
| Git repo with commits | Root commit SHA (cached in `.git/liteai`) | Git worktree root |
| Git repo, no commits | `"dir_<sha1(directory)>"` | Directory path |
| Git repo, no git binary | `"dir_<sha1(directory)>"` | Directory path |
| No `.git` found | `"dir_<sha1(directory)>"` | Directory path |
| True last-resort fallback | `"global"` | `"/"` |

The `directoryId()` helper generates deterministic IDs:
```typescript
function directoryId(dir: string) {
  const hash = new Bun.CryptoHasher("sha1").update(dir).digest("hex").slice(0, 16)
  return ProjectID.make("dir_" + hash)
}
```

#### Session Migration

On every `fromDirectory()` call, two migrations run:

1. **`global` → real ID**: sessions with `project_id = "global"` matching the directory are re-homed.
2. **`directoryId` → git SHA**: when a first commit is made, sessions move from the directory-based ID to the git-based one.

---

### `session`

Defined in: `src/session/session.sql.ts`

| Column | Type | Notes |
|---|---|---|
| `id` | `text PK` | Descending ULID (newest sorts first lexically) |
| `project_id` | `text FK → project` | Cascade delete |
| `workspace_id` | `text` | Optional workspace scope |
| `parent_id` | `text` | For forked sessions |
| `slug` | `text NOT NULL` | Human-friendly slug (e.g. `"sunny-wolf"`) |
| `directory` | `text NOT NULL` | Absolute path the session was started from |
| `title` | `text NOT NULL` | Auto-generated or user-set |
| `version` | `text NOT NULL` | LiteAI version at creation time |
| `share_url` | `text` | Public share URL |
| `summary_additions` | `integer` | Total lines added |
| `summary_deletions` | `integer` | Total lines deleted |
| `summary_files` | `integer` | Files changed count |
| `summary_diffs` | `json text` | `FileDiff[]` |
| `revert` | `json text` | Undo state: `{ messageID, partID?, snapshot?, diff? }` |
| `permission` | `json text` | Session-level permission overrides |
| `time_created` | `integer` | Epoch ms |
| `time_updated` | `integer` | Epoch ms |
| `time_compacting` | `integer` | Set while compaction is in progress |
| `time_archived` | `integer` | Set when archived |

**Indexes:**
- `session_project_idx` on `project_id`
- `session_workspace_idx` on `workspace_id`
- `session_parent_idx` on `parent_id`

---

### `message`

Defined in: `src/session/session.sql.ts`

| Column | Type | Notes |
|---|---|---|
| `id` | `text PK` | Ascending ULID |
| `session_id` | `text FK → session` | Cascade delete |
| `time_created` | `integer` | Epoch ms |
| `time_updated` | `integer` | Epoch ms |
| `data` | `json text NOT NULL` | `InfoData` — the full message object (minus `id` and `sessionID`) |

**Index:** `message_session_time_created_id_idx` on `(session_id, time_created, id)`.

#### `data` column — User message (`role: "user"`)

| Field | Type | Description |
|---|---|---|
| `role` | `"user"` | Message role |
| `time.created` | `number` | Epoch ms |
| `agent` | `string` | Which agent was invoked (e.g. `"code"`, `"plan"`) |
| `model.providerID` | `string` | Provider used (e.g. `"anthropic"`) |
| `model.modelID` | `string` | Model used (e.g. `"claude-sonnet-4-20250514"`) |
| `system` | `string?` | **System prompt identifier/hash** — not the actual prompt text |
| `tools` | `Record<string, boolean>?` | Map of enabled/disabled tools |
| `format` | `OutputFormat?` | Requested output format (text or json_schema) |
| `variant` | `string?` | Model variant |
| `summary` | `{ title?, body?, diffs }?` | Summary metadata |

#### `data` column — Assistant message (`role: "assistant"`)

| Field | Type | Description |
|---|---|---|
| `role` | `"assistant"` | Message role |
| `parentID` | `MessageID` | Links to the triggering user message |
| `modelID` | `string` | Which model responded |
| `providerID` | `string` | Which provider |
| `agent` | `string` | Which agent processed it |
| `path.cwd` | `string` | Working directory at response time |
| `path.root` | `string` | Worktree root at response time |
| `cost` | `number` | Dollar cost of this response |
| `tokens.input` | `number` | Input token count |
| `tokens.output` | `number` | Output token count |
| `tokens.reasoning` | `number` | Reasoning/thinking token count |
| `tokens.cache.read` | `number` | Cache read tokens |
| `tokens.cache.write` | `number` | Cache write tokens |
| `error` | `object?` | Error details (auth, API, abort, overflow, etc.) |
| `finish` | `string?` | Finish reason: `"stop"`, `"tool-calls"`, `"length"`, etc. |
| `structured` | `any?` | Structured output result |
| `time.created` | `number` | Epoch ms |
| `time.completed` | `number?` | Epoch ms |

---

### `part`

Defined in: `src/session/session.sql.ts`

| Column | Type | Notes |
|---|---|---|
| `id` | `text PK` | Ascending ULID |
| `message_id` | `text FK → message` | Cascade delete |
| `session_id` | `text NOT NULL` | Denormalized for queries |
| `time_created` | `integer` | Epoch ms |
| `time_updated` | `integer` | Epoch ms |
| `data` | `json text NOT NULL` | `PartData` — the part object (minus `id`, `sessionID`, `messageID`) |

**Indexes:**
- `part_message_id_id_idx` on `(message_id, id)`
- `part_session_idx` on `session_id`

#### Part types (stored in `data` column)

| Type | Key fields | Description |
|---|---|---|
| `text` | `text`, `time.start/end`, `metadata`, `synthetic`, `ignored` | Text content from user or assistant |
| `reasoning` | `text`, `time.start/end`, `metadata` | LLM thinking/reasoning text |
| **`tool`** | `callID`, `tool`, `state` | **Full tool call** — see below |
| `file` | `mime`, `filename`, `url`, `source` | Attached files (images, code, directories) |
| `step-start` | `snapshot` | Step boundary marker — snapshot hash before LLM acts |
| `step-finish` | `reason`, `snapshot`, `cost`, `tokens` | Step boundary — snapshot after, with cost/token breakdown |
| `snapshot` | `snapshot` | Git snapshot reference |
| `patch` | `hash`, `files` | Git patch reference |
| `subtask` | `prompt`, `description`, `agent`, `model`, `command` | Sub-agent invocation |
| `compaction` | `auto`, `overflow` | Context compaction marker |
| `retry` | `attempt`, `error`, `time.created` | Retry attempt with error details |
| `agent` | `name`, `source` | Agent invocation marker (from `@agent` syntax) |

#### Tool call states (in `ToolPart.state`)

Tool calls are stored with **full input and output**:

| Status | Fields |
|---|---|
| `pending` | `input`, `raw` (raw args string) |
| `running` | `input`, `title?`, `metadata?`, `time.start` |
| `completed` | `input`, `output`, `title`, `metadata`, `time.start/end/compacted?`, `attachments?` |
| `error` | `input`, `error` (string), `metadata?`, `time.start/end` |

---

### `todo`

Defined in: `src/session/session.sql.ts`

| Column | Type | Notes |
|---|---|---|
| `session_id` | `text FK → session` | Cascade delete (part of composite PK) |
| `position` | `integer` | Order within session (part of composite PK) |
| `content` | `text NOT NULL` | Todo text |
| `status` | `text NOT NULL` | e.g. `"pending"`, `"done"` |
| `priority` | `text NOT NULL` | Priority level |
| `time_created` | `integer` | Epoch ms |
| `time_updated` | `integer` | Epoch ms |

**Index:** `todo_session_idx` on `session_id`.

---

### `permission`

Defined in: `src/session/session.sql.ts`

| Column | Type | Notes |
|---|---|---|
| `project_id` | `text PK FK → project` | Cascade delete |
| `time_created` | `integer` | Epoch ms |
| `time_updated` | `integer` | Epoch ms |
| `data` | `json text NOT NULL` | `PermissionNext.Ruleset` |

---

## Query Patterns

### List sessions in a project

```typescript
// Session.list() — src/session/index.ts
const conditions = [eq(SessionTable.project_id, project.id)]

if (input?.directory)   conditions.push(eq(SessionTable.directory, input.directory))
if (input?.roots)       conditions.push(isNull(SessionTable.parent_id))
if (input?.start)       conditions.push(gte(SessionTable.time_updated, input.start))
if (input?.search)      conditions.push(like(SessionTable.title, `%${input.search}%`))

db.select().from(SessionTable)
  .where(and(...conditions))
  .orderBy(desc(SessionTable.time_updated))
  .limit(limit)
```

SQL equivalent:
```sql
SELECT * FROM session
WHERE project_id = ?
  AND directory = ?           -- optional
  AND parent_id IS NULL       -- if roots=true
  AND time_updated >= ?       -- if start provided
  AND title LIKE '%...%'      -- if search provided
ORDER BY time_updated DESC
LIMIT ?
```

### Get messages in a session

```typescript
// Message.stream() — reads messages oldest-first
db.select().from(MessageTable)
  .where(eq(MessageTable.session_id, sessionID))
  .orderBy(MessageTable.time_created, MessageTable.id)
```

### Get messages with parts (hydration)

```typescript
// Message.hydrate() — batch-loads parts for a set of messages
const rows = db.select().from(MessageTable).where(...).all()
const ids = rows.map(r => r.id)
const parts = db.select().from(PartTable)
  .where(inArray(PartTable.message_id, ids))
  .orderBy(PartTable.message_id, PartTable.id)
  .all()
// Groups parts by message_id, returns { info, parts }[]
```

### Paginated message listing

```typescript
// Message.page() — cursor-based pagination
db.select().from(MessageTable)
  .where(and(
    eq(MessageTable.session_id, sessionID),
    older(cursor)   // time_created < cursor OR (same time AND id < cursor)
  ))
  .orderBy(desc(MessageTable.time_created), desc(MessageTable.id))
  .limit(limit)
```

---

## What's Stored vs. What's Not

### ✅ Stored — sufficient for conversation replay

| Data | Location | Detail level |
|---|---|---|
| Full message history | `message.data` | User and assistant messages with all metadata |
| Tool call inputs | `part.data` (`type: "tool"`) | Full JSON input args |
| Tool call outputs | `part.data` (`type: "tool"`) | Full string output (may be compacted) |
| Tool call errors | `part.data` (`type: "tool"`) | Error message |
| Tool call timing | `part.data` (`type: "tool"`) | `time.start` and `time.end` |
| Reasoning/thinking | `part.data` (`type: "reasoning"`) | Full text |
| Token usage | `message.data` (assistant) | Per-message: input, output, reasoning, cache |
| Cost | `message.data` (assistant) | Dollar cost per response |
| Model used | `message.data` | `providerID` + `modelID` per message |
| Agent used | `message.data` | Agent name per message |
| Working directory | `message.data` (assistant) | `path.cwd` and `path.root` |
| Errors | `message.data` (assistant) | Typed error objects (auth, API, abort, overflow) |
| File attachments | `part.data` (`type: "file"`) | MIME, URL, source context |
| Snapshots/patches | `part.data` (`type: "snapshot"/"patch"`) | Git hashes referencing shadow repo |
| Step boundaries | `part.data` (`type: "step-start"/"step-finish"`) | Snapshot hashes, cost, tokens per step |
| Session diffs | `session` row + filesystem | `summary_*` columns and `<data_dir>/storage/session_diff/` |

### ❌ Not stored — gaps for tracing/debugging

| Data | Why it's missing | Impact |
|---|---|---|
| **System prompt text** | Generated dynamically from `.txt` templates, env, AGENTS.md, config, skills. Only a hash/identifier is stored on `User.system`. | Cannot reconstruct what instructions the model received for a given turn |
| **Raw HTTP request/response** | Ephemeral — processed in the AI SDK streaming pipeline | Cannot inspect exact API payloads for debugging provider issues |
| **Tool definitions/schemas** | Resolved dynamically from `ToolRegistry`, MCP servers, and agent config | Cannot see which tools were available for a given turn |
| **Instruction file contents** | Read from disk at runtime (AGENTS.md, CLAUDE.md, etc.) | Historical instructions not preserved if files change |
| **Model parameters** | Temperature, top_p, etc. are resolved from config/agent at runtime | Cannot verify what sampling parameters were used |
| **Token-level data** | No logprobs or per-token metadata | Cannot analyze model confidence or token distribution |
| **SSE stream packets** | Ephemeral real-time delivery | Cannot replay the streaming experience |

### Compaction effects

When context compaction runs, older tool outputs are replaced with `"[Old tool result content cleared]"` and `time.compacted` is set. This **permanently removes** the original tool output from the database. The compacted data is irrecoverable.

---

## Database Location

```typescript
// src/storage/db.ts
function location() {
  if (Flag.LITEAI_DB)           return Flag.LITEAI_DB        // explicit override
  if (Flag.LITEAI_DB_NAME)      return path.join(Global.Path.data, `liteai-${safe}.db`)
  return path.join(Global.Path.data, "liteai.db")            // default
}
```

The database is opened with WAL mode and uses `better-sqlite3` under the hood (via Drizzle).

---

## Migration System

- Schema files: `src/**/*.sql.ts`
- Migration config: `drizzle.config.ts`
- Generate: `bun run db generate --name <slug>`
- Output: `migration/<timestamp>_<slug>/migration.sql` + `snapshot.json`
- Migrations are applied automatically on startup via Drizzle's migration runner
- Each migration folder is self-contained (no `_journal.json` dependency)
