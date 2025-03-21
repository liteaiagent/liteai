# Session Lifecycle

This document describes how sessions are created, listed, forked, archived, and deleted. A session is a single conversation within a project.

> **Related:**
> - [database.md](./database.md) — full schema reference for the `session`, `message`, `part`, and `todo` tables
> - [project.md](./project.md) — project identity and Instance context
> - [snapshot-and-diff.md](./snapshot-and-diff.md) — change tracking and revert

---

## Overview

Sessions are scoped to a project via `project_id` and optionally to a workspace via `workspace_id`. Each session holds an ordered sequence of messages, where each message has an ordered sequence of parts.

```
Session
  ├── Messages (ordered by time_created)
  │     ├── User message   { agent, model, system, tools }
  │     │     └── Parts: text, file, agent, subtask, compaction
  │     └── Assistant message  { model, cost, tokens, error, finish }
  │           └── Parts: text, reasoning, tool, step-start, step-finish, snapshot, patch, retry
  ├── Todos (ordered by position)
  └── Permission ruleset (session-level overrides)
```

---

## Session Creation

**Endpoint:** `POST /session`
**Source:** `src/session/index.ts` — `Session.createNext()`

When a new session is created:

1. A descending ULID is generated as the session ID (newest sorts first lexically).
2. A random slug is assigned (e.g. `"sunny-wolf"`, `"cosmic-harbor"`).
3. `project_id` is set from `Instance.project.id` (resolved from the request's directory context).
4. `directory` is set from `Instance.directory`.
5. The row is inserted into the `session` table.
6. Events `session.created` and `session.updated` are emitted.
7. If auto-share is enabled, the session is shared in the background.

---

## Session Listing & Filtering

### Instance-scoped — `GET /session`

**Source:** `Session.list()` in `src/session/index.ts`

This is the primary listing endpoint. It always filters by the current project:

```sql
SELECT * FROM session
WHERE project_id = :currentProjectId      -- always applied
  AND workspace_id = :workspaceId          -- if workspace context is set
  AND directory = :directory               -- if directory param is provided
  AND parent_id IS NULL                    -- if roots=true (exclude forks)
  AND time_updated >= :start               -- if start param provided
  AND title LIKE '%:search%'               -- if search param provided
ORDER BY time_updated DESC
LIMIT :limit                               -- default 100
```

**Query parameters:**

| Param | Type | Description |
|---|---|---|
| `directory` | `string?` | Filter by the directory the session was started from |
| `roots` | `boolean?` | Exclude forked sessions (only show top-level) |
| `start` | `number?` | Only sessions updated since this epoch ms |
| `search` | `string?` | Title substring match |
| `limit` | `number?` | Max results (default 100) |

### How the UI calls this

The UI creates a per-directory SDK client that sets `x-liteai-directory` as an HTTP header. When listing sessions:

1. The SDK sends `GET /session?directory=<dir>&roots=true&limit=<n>`.
2. The server middleware reads `x-liteai-directory` to resolve the Instance context (project_id).
3. `Session.list()` filters by `project_id` (from Instance) AND optionally by `directory` (from query).

### Global listing — `GET /experimental/session`

**Source:** `Session.listGlobal()` in `src/session/index.ts`

Cross-project listing that does **not** filter by project:

| Param | Type | Description |
|---|---|---|
| `cursor` | `string?` | Pagination token (base64 of `{id, time}`) |
| `roots` | `boolean?` | Exclude forked sessions |
| `search` | `string?` | Title substring match |
| `limit` | `number?` | Max results (default 50) |
| `archived` | `boolean?` | Include archived sessions (default false) |

Each result includes `project: { id, name, worktree }` for grouping. Pagination uses the `x-next-cursor` response header.

---

## Message Structure

Messages are stored in the `message` table with a JSON `data` column. See [database.md](./database.md) for the full schema.

### User Message

Created when the user sends a prompt. Key fields in `data`:

- `agent` — which agent was invoked (e.g. `"code"`, `"plan"`)
- `model` — `{ providerID, modelID }` for the selected model
- `system` — system prompt identifier (hash, not the actual text)
- `tools` — map of enabled/disabled tools
- `format` — output format (text or json_schema)

### Assistant Message

Created for each LLM response. Key fields in `data`:

- `parentID` — links to the triggering user message
- `modelID` / `providerID` — which model responded
- `cost` — dollar cost
- `tokens` — full breakdown: input, output, reasoning, cache read/write
- `error` — typed error (auth, API, abort, context overflow, etc.)
- `finish` — finish reason (`"stop"`, `"tool-calls"`, `"length"`)
- `path` — `{ cwd, root }` at response time

### Parts

Parts are stored in the `part` table, each belonging to a message. Types:

| Part | Role | Description |
|---|---|---|
| `text` | Both | Text content |
| `reasoning` | Assistant | LLM thinking/reasoning text |
| `tool` | Assistant | Full tool call with input, output, timing |
| `file` | User | Attached files (images, code, directories) |
| `step-start` | Assistant | Snapshot before LLM acts |
| `step-finish` | Assistant | Snapshot after, with per-step cost/tokens |
| `subtask` | User | Sub-agent invocation |
| `compaction` | User | Context compaction marker |
| `agent` | User | Agent invocation marker (from `@agent` syntax) |
| `snapshot` | Assistant | Git snapshot reference |
| `patch` | Assistant | Git patch reference |
| `retry` | Assistant | Retry attempt with error details |

---

## Message Hydration

Messages and parts are stored in separate tables. To reconstruct a conversation, parts are "hydrated" onto messages:

```typescript
// Message.hydrate() — batch loads parts for a set of messages
const rows = db.select().from(MessageTable).where(...).all()
const ids = rows.map(r => r.id)
const parts = db.select().from(PartTable)
  .where(inArray(PartTable.message_id, ids))
  .orderBy(PartTable.message_id, PartTable.id)
  .all()
// Returns { info: Message, parts: Part[] }[]
```

This is used for:
- Building model context (converting to `ModelMessage[]` for the AI SDK)
- Rendering the conversation in the UI
- Computing diffs from snapshot parts

---

## Prompt Loop

**Source:** `src/session/prompt.ts` — `SessionPrompt.loop()`

The prompt loop is the core message processing cycle:

```
User sends message
  │
  ├── Create user message + parts
  ├── Touch session (update time_updated)
  │
  └── Enter loop:
        ├── Load all messages in session
        ├── Find last user message + last assistant message
        ├── Check if last assistant finished (non-tool-calls finish reason)
        │     └── If yes → exit loop
        │
        ├── Handle pending subtask (sub-agent) → process and continue
        ├── Handle pending compaction → compact and continue
        ├── Check context overflow → auto-compact if needed
        │
        ├── Normal processing:
        │     ├── Create assistant message
        │     ├── Resolve tools (from registry + MCP + agent config)
        │     ├── Build system prompt (environment + skills + instructions)
        │     ├── Convert messages to model format
        │     ├── Call LLM via SessionProcessor
        │     └── Handle finish:
        │           ├── "stop" → exit loop
        │           ├── "tool-calls" → continue (tools will be processed)
        │           └── context overflow → auto-compact and continue
        │
        └── Loop again (max steps per agent config)
```

---

## Session Operations

### Fork — `POST /session/:id/fork`

Deep-copies messages and parts up to a given `messageID`, creating a new session with `parent_id` set to the original.

### Archive — `PATCH /session/:id`

Sets `time_archived` to the current timestamp. Archived sessions are excluded from the default listing but can be included via the `archived` param on the global listing endpoint.

### Delete — `DELETE /session/:id`

Cascade-deletes all related messages, parts, and todos. Emits `session.deleted`.

### Share — `POST /session/:id/share`

Uploads the session to a share endpoint and stores the returned URL in `share_url`.

### Compact — triggered automatically or via `/compact`

Context compaction reduces the message history when token limits are approached. Old tool outputs are replaced with `"[Old tool result content cleared]"` and `time.compacted` is set on the tool part. **Compacted data is permanently removed.**

---

## Session Title Generation

Titles are auto-generated after the first assistant response using a summarization prompt. The LLM is asked to generate a short title from the conversation. Titles can also be set manually via `PATCH /session/:id`.

---

## Todos

Each session can have a checklist of todo items, stored in the `todo` table with `(session_id, position)` as the composite primary key.

| Field | Description |
|---|---|
| `content` | Todo text |
| `status` | e.g. `"pending"`, `"done"` |
| `priority` | Priority level |
| `position` | Order within the session |
