# Tracing System Design

This document describes the design for LLM call tracing in LiteAI — capturing the data needed to debug and understand what happens during each step of a conversation.

> **Related:**
> - [database.md](./database.md) — existing schema reference
> - [session.md](./session.md) — session lifecycle and prompt loop
> - [project.md](./project.md) — project and Instance context

---

## Motivation

The existing database stores enough data for **conversation replay** — messages, tool calls with full I/O, token counts, and costs. However, it does not capture what was sent **to** the LLM provider, making it hard to debug issues like:

- Why did the model ignore an instruction? → Can't see the system prompt it received.
- Why did the model hallucinate a tool? → Can't see which tool schemas were available.
- Why was the context window so large? → Can't see which messages were included.
- What sampling parameters were used? → Temperature, maxTokens not stored.

### What's missing (the gap)

| Data | Currently stored? | Needed for debugging? |
|---|---|---|
| System prompt text | ❌ Only a hash | ✅ Critical |
| Tool schemas | ❌ Not stored | ✅ Important |
| Model parameters | ❌ Not stored | ✅ Useful |
| Message IDs in context | ❌ Not explicit | ✅ Useful |
| Raw request body | ❌ Not stored | ❌ Reconstructable |
| Raw response body | ❌ Not stored | ❌ Already in parts |
| Tool call I/O | ✅ Full data in parts | ❌ Already stored |
| Token counts | ✅ On assistant message | ❌ Already stored |
| Cost | ✅ On assistant message | ❌ Already stored |

> **Note:** HTTP metadata (status, request ID, rate-limit headers) is intentionally excluded. The AI SDK streaming abstraction doesn't expose HTTP response headers, and errors are already captured on the assistant message as typed error objects. The `step-start`/`step-finish` parts already provide timing data. HTTP metadata can be added in a future version if the provider SDK layer is extended to surface it.

### Key insight: don't duplicate, reference

The raw API request body is a combination of system prompt + messages + tool schemas. Since messages are already stored in the `message`/`part` tables, we only need to capture:
1. The system prompt text (not in the DB today)
2. The tool schemas (not in the DB today)
3. Which message IDs were in the context window (an ordered list)
4. Model parameters (small, unique per call)

The full request can be **reconstructed** by combining these with the existing message data.

---

## Design Principles

1. **Same database** — trace tables live in `liteai.db` alongside conversation tables. FK constraints with cascade delete ensure cleanup.
2. **Single table** — one `trace` table, no content-addressed caching. Simplicity over marginal storage savings.
3. **Smart storage, simple implementation** — system prompt and tool schemas are stored only when they change from the previous step (null-if-unchanged). ~90% dedup benefit with zero extra infrastructure. Hash columns store fast-compare digests alongside the content.
4. **Opt-in** — tracing adds serialization overhead. Controlled via config flag.
5. **Separate from conversation data** — traces are in their own table, not mixed into the `part` table. The conversation flow is unaffected.
6. **OTel-compatible concepts** — follows the trace → span model conceptually, enabling future export to OTel backends without using the OTel SDK.

---

## Conceptual Model

Following OTel terminology:

| OTel Concept | LiteAI Mapping |
|---|---|
| **Trace** | A prompt loop execution (one user message → N LLM calls) |
| **Span** | One LLM call (`trace` table row) |
| **Span Attributes** | Model, params, system prompt hash |
| **Resource** | Session + project context |

> **Sub-agent tracing (v2):** Sub-agent calls via the `task` tool create new sessions. Parent-child linking across sessions requires a `parent_session_id` column or metadata-based approach, deferred to a future version. The `parent_id` column is reserved for this purpose but will remain unused in v1.

```
User sends message
  │
  └── Trace (implicit — the prompt loop)
        │
        ├── Span: Step 1 (LLM call)
        │     ├── system prompt: "You are..."
        │     ├── tools: [bash, edit, read, ...]
        │     ├── context: [msg_001, msg_002, msg_003]
        │     ├── model: claude-sonnet / anthropic
        │     └── params: { temperature: 1 }
        │
        ├── Span: Step 2 (LLM call — after tool execution)
        │     ├── system prompt: NULL (same as step 1)
        │     ├── tools: NULL (same as step 1)
        │     └── context: [msg_001, msg_002, msg_003, msg_004, msg_005]
        │
        └── Span: Step 3 (system prompt changed)
              ├── system prompt: "You are a task agent..."
              ├── tools: [bash, read]
              └── ...
```

---

## Database Schema

### `trace` table

```typescript
// src/trace/trace.sql.ts
export const TraceTable = sqliteTable(
  "trace",
  {
    id: text().primaryKey(),
    session_id: text()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    message_id: text()
      .notNull()
      .references(() => MessageTable.id, { onDelete: "cascade" }),
    parent_id: text(),                  // reserved for v2 sub-agent linking
    step: integer().notNull(),          // session-global step number (monotonically increasing)
    agent: text().notNull(),            // agent name
    model_id: text().notNull(),
    provider_id: text().notNull(),
    params: text({ mode: "json" }),     // { temperature?, maxTokens?, topP? }
    system: text(),                     // full system prompt text (NULL if unchanged from previous step)
    system_hash: text(),               // sha256 hash of system prompt (stored alongside for fast comparison)
    tools: text({ mode: "json" }),      // tool schemas array (NULL if unchanged from previous step)
    tools_hash: text(),                // sha256 hash of tool schemas JSON (stored alongside for fast comparison)
    context_ids: text({ mode: "json" }).notNull(), // ordered message IDs in context window
    time_start: integer().notNull(),   // epoch ms — when the LLM call began
    error: text(),                      // error message if the call failed
    ...Timestamps,
  },
  (table) => [
    index("trace_session_idx").on(table.session_id),
    index("trace_message_idx").on(table.message_id),
  ],
)
```

### Key design decisions

- **`step` is session-global**: derived from `MAX(step) + 1` on the trace table for the session. A session with 3 user messages, each triggering 2 LLM calls, has steps `[1, 2, 3, 4, 5, 6]` — not per-loop-invocation counters.
- **`message_id` FK with cascade**: when messages are deleted (e.g., during session cleanup), associated traces are automatically removed.
- **`time_start`**: explicit column for when the LLM call began. Combined with the `step-finish` part's timestamp, gives precise call duration. `Timestamps.time_created` may differ due to row insertion timing.
- **`system_hash` / `tools_hash`**: stored alongside the full text to avoid re-hashing potentially 50KB of content on every comparison. When `system` is NULL (unchanged), `system_hash` is also NULL.
- **`parent_id` reserved for v2**: sub-agent calls create separate sessions, making cross-session parent linking non-trivial. Deferred.

### Storage characteristics

Per-step row size (when system/tools are NULL — i.e., unchanged):
- ~200–500 bytes (IDs, params, context_ids)

Per-step row size (when system/tools are stored):
- System prompt: 10–50KB
- Tool schemas: 5–20KB
- Total: 15–70KB

Typical session (10 steps, system changes once):
- Step 1: 30KB (system + tools stored)
- Steps 2–9: 8 × 400 bytes = 3.2KB (null, only metadata)
- Step 10: 30KB (system changed, stored again)
- **Total per session: ~63KB**

Without the null-if-unchanged optimization:
- 10 × 30KB = 300KB per session
- **~80% savings from the simple null check**

### Migration

```sql
-- migration/<timestamp>_add_trace/migration.sql
CREATE TABLE IF NOT EXISTS trace (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL REFERENCES message(id) ON DELETE CASCADE,
  parent_id TEXT,
  step INTEGER NOT NULL,
  agent TEXT NOT NULL,
  model_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  params TEXT,             -- json
  system TEXT,             -- full text, NULL if unchanged
  system_hash TEXT,        -- sha256 hash for fast comparison
  tools TEXT,              -- json, NULL if unchanged
  tools_hash TEXT,         -- sha256 hash for fast comparison
  context_ids TEXT NOT NULL, -- json array of message IDs
  time_start INTEGER NOT NULL, -- epoch ms
  error TEXT,
  time_created INTEGER NOT NULL,
  time_updated INTEGER NOT NULL
);

CREATE INDEX trace_session_idx ON trace(session_id);
CREATE INDEX trace_message_idx ON trace(message_id);
```

---

## Implementation

### Where to instrument

The trace is captured in `SessionPrompt.loop()` in `src/session/prompt.ts`, around the `processor.process()` call:

```typescript
// Before LLM call
const system = [
  ...(await SystemPrompt.environment(model)),
  ...(skills ? [skills] : []),
  ...(await InstructionPrompt.system()),
]

const msgs = Message.toModelMessages(...)
const tools = await resolveTools(...)

// ─── Trace capture point ───
if (traceEnabled) {
  const text = system.join("\n---\n")
  const schemas = Object.entries(tools).map(([name, t]) => ({
    name,
    description: t.description,
    parameters: t.parameters,
  }))
  const ids = msgs.map(m => m.info.id)
  const hash = (s: string) => new Bun.CryptoHasher("sha256").update(s).digest("hex")

  // Find previous step's hashes for comparison
  const prev = lastTrace(sessionID)
  const sysHash = hash(text)
  const tlsHash = hash(JSON.stringify(schemas))
  const sysChanged = !prev || prev.system_hash !== sysHash
  const tlsChanged = !prev || prev.tools_hash !== tlsHash

  currentTrace = {
    id: TraceID.ascending(),
    session_id: sessionID,
    message_id: processor.message.id,
    step: nextStep(sessionID),  // MAX(step) + 1
    agent: agent.name,
    model_id: model.id,
    provider_id: model.providerID,
    params: { temperature: model.temperature, maxTokens: model.maxTokens },
    system: sysChanged ? text : null,
    system_hash: sysChanged ? sysHash : null,
    tools: tlsChanged ? schemas : null,
    tools_hash: tlsChanged ? tlsHash : null,
    context_ids: ids,
    time_start: Date.now(),
  }
}

// LLM call
const result = await processor.process({ ... })

// After LLM call
if (traceEnabled && currentTrace) {
  currentTrace.error = processor.message.error?.message
  Trace.write(currentTrace)
}
```

### Null-if-unchanged logic

The dedup logic uses hash columns for fast comparison:

```typescript
function lastTrace(sessionID: SessionID) {
  return Database.use(db =>
    db.select({
      system_hash: TraceTable.system_hash,
      tools_hash: TraceTable.tools_hash,
    })
      .from(TraceTable)
      .where(eq(TraceTable.session_id, sessionID))
      .orderBy(desc(TraceTable.step))
      .limit(1)
      .get()
  )
}
```

For reading, the resolver walks backwards:

```typescript
function resolve(trace: Trace.Row): string {
  if (trace.system) return trace.system

  // Find the most recent non-null system prompt before this step
  const prev = Database.use(db =>
    db.select({ system: TraceTable.system })
      .from(TraceTable)
      .where(and(
        eq(TraceTable.session_id, trace.session_id),
        isNotNull(TraceTable.system),
        lte(TraceTable.step, trace.step),
      ))
      .orderBy(desc(TraceTable.step))
      .limit(1)
      .get()
  )

  return prev?.system ?? "(system prompt not captured)"
}
```

### Context IDs caveat

The `context_ids` list stores IDs from the `msgs` array before `Message.toModelMessages()` transforms them. The actual model input may differ slightly (filtered messages, injected synthetic content like `<system-reminder>` wrappers). The IDs still point to the right source messages and are sufficient for debugging context window composition.

---

## API

### List traces for a session

```
GET /session/:sessionID/trace
```

Returns all trace spans for a session, ordered by step:

```json
{
  "data": [
    {
      "id": "trc_001",
      "step": 1,
      "agent": "code",
      "modelID": "claude-sonnet-4-20250514",
      "providerID": "anthropic",
      "params": { "temperature": 1 },
      "hasSystem": true,
      "hasTools": true,
      "contextSize": 3,
      "timeStart": 1710000000000,
      "timeCreated": 1710000004200
    },
    {
      "id": "trc_002",
      "step": 2,
      "agent": "code",
      "modelID": "claude-sonnet-4-20250514",
      "providerID": "anthropic",
      "params": { "temperature": 1 },
      "hasSystem": false,
      "hasTools": false,
      "contextSize": 5,
      "timeStart": 1710000004300,
      "timeCreated": 1710000010400
    }
  ]
}
```

The list returns lightweight metadata. `hasSystem`/`hasTools` indicate whether this step has its own stored value or inherits from a previous step.

### Get trace detail

```
GET /session/:sessionID/trace/:traceID
```

Returns the full trace with resolved system prompt and tool schemas:

```json
{
  "data": {
    "id": "trc_002",
    "step": 2,
    "agent": "code",
    "modelID": "claude-sonnet-4-20250514",
    "providerID": "anthropic",
    "params": { "temperature": 1 },
    "system": "You are powered by the model named claude-sonnet...\n---\nSkills provide...\n---\nInstructions from: ...",
    "tools": [
      { "name": "bash", "description": "Run a shell command", "parameters": { ... } },
      { "name": "edit", "description": "Edit a file", "parameters": { ... } }
    ],
    "contextIDs": ["msg_001", "msg_002", "msg_003", "msg_004", "msg_005"],
    "error": null,
    "timeStart": 1710000004300,
    "timeCreated": 1710000010400
  }
}
```

The detail endpoint **resolves** null system/tools by walking backwards to the most recent non-null step.

---

## Trace Export (CLI)

For LLM-based analysis of trace data, a CLI export command dumps resolved trace data in machine-readable formats:

```bash
# Export as JSON (for LLM analysis)
liteai trace export --session <id> --format json > trace.json

# Export as Markdown (human-readable report)
liteai trace export --session <id> --format md > trace.md
```

The export logic:
1. Queries the `trace` table for the session
2. Resolves null-if-unchanged fields (walks backwards to find the last non-null system/tools)
3. Optionally hydrates context IDs with message content (via `--hydrate` flag)
4. Outputs as JSON or Markdown

This is also exposed as an API endpoint (`GET /session/:sessionID/trace/export?format=json`) for programmatic access, and can be used as a built-in tool for self-introspection by agents.

---

## UI Integration

### Trace viewer panel

The trace viewer is a **separate panel** in the UI (not mixed into the conversation view). It shows a timeline of LLM calls for the current session:

```
┌─────────────────────────────────────────────────────────┐
│ Trace: "Create budget ledger web app"                   │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ ● Step 1   claude-sonnet · 15K in · 2K out             │
│   ├ System prompt (42KB)                    [expand ▸]  │
│   ├ Tools: bash, edit, read, write, +8      [expand ▸]  │
│   └ Context: 3 messages                     [expand ▸]  │
│                                                         │
│ ● Step 2   claude-sonnet · 19K in · 1K out             │
│   ├ System prompt (same as step 1)                      │
│   ├ Tools (same as step 1)                              │
│   └ Context: 5 messages (+2)                [expand ▸]  │
│                                                         │
│ ● Step 3   claude-sonnet · 22K in · 800 out            │
│   ├ System prompt (changed!)                [expand ▸]  │
│   ├ Tools (same as step 1)                              │
│   └ Context: 7 messages (+2)                [expand ▸]  │
│                                                         │
│ Total: 3 steps · $0.089                                 │
└─────────────────────────────────────────────────────────┘
```

### How the UI knows when to refresh

The UI doesn't need a dedicated SSE event for traces. The existing conversation SSE already provides the signals:

| SSE Event | UI Action |
|---|---|
| `message.part.updated` (step-finish) | A step completed → fetch updated trace list |
| `session.status` (idle) | Session finished → final trace list is ready |

Flow:
1. User is in a session, conversation is streaming.
2. UI receives `step-finish` part via SSE → knows a step completed.
3. UI calls `GET /session/:id/trace` to get the latest trace list.
4. Trace panel updates in near-real-time (one fetch per step, not per token).

This avoids new SSE events and keeps the trace system fully decoupled from the conversation streaming.

### Expanding details

When the user clicks "expand" on system prompt or tools:
1. UI calls `GET /session/:id/trace/:traceID` for the full detail.
2. The backend resolves null-if-unchanged fields and returns the complete data.
3. UI renders the full system prompt in a scrollable, syntax-highlighted view.

For the context messages, the UI already has the message data from the conversation view — it just highlights which messages were included in the context window using the `contextIDs` list.

---

## Configuration

```json
// liteai.json
{
  "experimental": {
    "trace": true
  }
}
```

Or via environment variable:

```bash
LITEAI_EXPERIMENTAL_TRACE=true
```

When disabled (default), no trace data is captured and no overhead is added to the prompt loop.

---

## Cleanup & Lifecycle

- **Cascade delete**: When a session is deleted, all its trace rows are automatically deleted via FK constraint. When a message is deleted, its associated trace row is also deleted.
- **No orphan problem**: Since everything is in one table with FKs, there's no orphaned data.
- **Storage growth**: ~60KB per session (typical). 1000 sessions ≈ 60MB. Negligible for a local tool.
- **Optional purge**: A future `/trace/purge` endpoint could delete traces older than N days while keeping conversation data intact.

---

## Future: OTel Export

The trace data follows OTel concepts (trace → spans → attributes). A future exporter could:

1. Read from the `trace` table.
2. Map each row to an OTel span:
   - `trace_id` = session_id
   - `span_id` = trace.id
   - `parent_span_id` = trace.parent_id
   - Attributes: model, params, tokens
   - Events: system prompt, tool schemas
3. Export via OTLP to Jaeger, Grafana Tempo, Honeycomb, etc.

This is a clean add-on that doesn't change the core tracing infrastructure.

---

## Summary

| Decision | Choice | Rationale |
|---|---|---|
| Storage | Same DB, new `trace` table | FK constraints, cascade delete, single schema |
| Deduplication | Null-if-unchanged + hash columns | 80-90% savings, fast comparison, zero extra infrastructure |
| System prompt | Full text, stored on change | Critical for debugging, too large for every step |
| Tool schemas | Full JSON, stored on change | Important for debugging, same dedup benefit |
| Message context | Ordered ID list only | Messages already stored in main tables |
| Raw request body | Not stored | Reconstructable from system + messages + tools |
| Raw response body | Not stored | Already captured in parts (text, tool, reasoning) |
| HTTP metadata | Not stored (v1) | AI SDK doesn't expose; errors already captured |
| Real-time viewing | Fetch on step-finish SSE | No new SSE events needed |
| OTel compatibility | Conceptual model, no SDK | Lightweight; exportable later |
| Activation | Opt-in via config | Avoids overhead when not needed |
| Sub-agent linking | Deferred to v2 | Cross-session FK complexity |
| Data analysis | CLI export + API endpoint | DB benefits + LLM-friendly output on demand |
