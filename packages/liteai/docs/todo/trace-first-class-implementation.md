# Trace as First-Class Step Context — Implementation Plan

> **Status**: Planned
> **Depends on**: Nothing — self-contained refactor
> **Risk**: Medium — touches DB schema, core loop, and trace API but frontend impact is minimal

---

## Goal

Make `Trace` the authoritative, always-on record of what the LLM saw and did at each step. Eliminate code duplication, clean the data model, and lay the foundation for step-back/replay.

## Motivation

The current trace system works but has structural issues that make it fragile to maintain:

1. **Two inline trace-write blocks** in `loop.ts` (main: L481-518, subtask: L748-770) that can drift
2. **Backwards-walk resolution** for system/tools (null-if-unchanged pattern)
3. **`messages_json` blob** duplicating the entire message array per trace row
4. **Dead `experimental.trace` flag** — never checked, traces always written
5. **Disconnected step counters** — loop's `step` vs `Trace.next()`

---

## Phase 1: New `trace_content` Table

**Risk**: Low — additive change, nothing breaks
**Files**: `src/trace/trace-content.sql.ts` (new), `src/storage/schema.ts`

### 1.1 Create Drizzle schema

Create `src/trace/trace-content.sql.ts`:

```typescript
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"

export const TraceContentTable = sqliteTable("trace_content", {
  hash: text().primaryKey(),           // SHA-256 hex
  type: text().notNull(),              // 'system' | 'tools'
  content: text().notNull(),           // actual content
  time_created: integer().notNull().$default(() => Date.now()),
})
```

### 1.2 Export from storage schema

In `src/storage/schema.ts`, add:
```typescript
export { TraceContentTable } from "../trace/trace-content.sql"
```

### 1.3 Verify migration

Run the app to confirm Drizzle auto-creates the table. Verify with:
```sql
SELECT name FROM sqlite_master WHERE type='table' AND name='trace_content';
```

### 1.4 Add internal helpers to `trace.ts`

Add private functions (not exported from namespace yet):

```typescript
import { createHash } from "node:crypto"

function contentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex")
}

function upsertContent(hash: string, type: "system" | "tools", content: string) {
  Database.use((db) =>
    db.insert(TraceContentTable)
      .values({ hash, type, content })
      .onConflictDoNothing()
      .run()
  )
}

function getContent(hash: string): string | null {
  const row = Database.use((db) =>
    db.select({ content: TraceContentTable.content })
      .from(TraceContentTable)
      .where(eq(TraceContentTable.hash, hash))
      .get()
  )
  return row?.content ?? null
}
```

---

## Phase 2: `Trace.record()` — Unified Write API

**Risk**: Medium — new function, but doesn't replace anything yet
**Files**: `src/trace/trace.ts`

### 2.1 Define `RecordInput` interface

```typescript
export interface RecordInput {
  sessionID:  SessionID
  messageID:  MessageID
  parentID?:  TraceID
  agent:      string
  model:      { id: string; providerID: string }
  params?:    { temperature?: number; maxTokens?: number; topP?: number } | null
  system?:    string          // full resolved system prompt (omit for subtasks)
  tools?:     { name: string; description?: string; parameters?: unknown }[]
  contextIDs: string[]
  hooks?:     z.infer<typeof HookInvocation>[] | null
  timeStart:  number
  timeEnd:    number
  error?:     string | null
}
```

### 2.2 Implement `Trace.record()`

```typescript
export function record(input: RecordInput): { id: TraceID; step: number } {
  const step = next(input.sessionID)
  const id = TraceID.ascending()

  let systemHash: string | null = null
  if (input.system) {
    systemHash = contentHash(input.system)
    upsertContent(systemHash, "system", input.system)
  }

  let toolsHash: string | null = null
  if (input.tools && input.tools.length > 0) {
    const json = JSON.stringify(input.tools)
    toolsHash = contentHash(json)
    upsertContent(toolsHash, "tools", json)
  }

  log.info("record", { step, session: input.sessionID })
  Database.use((db) =>
    db.insert(TraceTable).values({
      id,
      session_id:  input.sessionID,
      message_id:  input.messageID,
      parent_id:   input.parentID ?? null,
      step,
      agent:       input.agent,
      model_id:    input.model.id,
      provider_id: input.model.providerID,
      params:      input.params ?? null,
      system:      input.system ?? null,        // keep writing inline during transition
      system_hash: systemHash,
      tools:       input.tools ?? null,          // keep writing inline during transition
      tools_hash:  toolsHash,
      context_ids: input.contextIDs,
      hooks_json:  input.hooks?.length ? input.hooks : null,
      time_start:  input.timeStart,
      time_end:    input.timeEnd,
      error:       input.error ?? null,
    }).run()
  )

  return { id, step }
}
```

> [!IMPORTANT]
> During the transition (Phase 2), we **still write** `system` and `tools` inline alongside the hashes. This means existing `Trace.get()` / `Trace.all()` continue working without changes. We'll stop writing inline in Phase 4 after the read path is updated.

### 2.3 Tests

Write tests for `Trace.record()`:
- Records a trace with system + tools → verify `trace_content` has entries
- Records a subtask trace (no system/tools) → verify nulls
- Records two traces with same system → verify `trace_content` has ONE row (dedup)
- Step counter increments correctly
- Hash is deterministic (same content → same hash)

---

## Phase 3: Switch Loop to `Trace.record()`

**Risk**: Medium — replacing inline code in the hot path
**Files**: `src/session/prompt/loop.ts`

### 3.1 Replace main loop trace block (L481-518)

**Before** (~40 lines):
```typescript
// Trace capture (after LLM call) — always record traces
{
  const { createHash } = await import("node:crypto")
  const text = (processor.resolvedSystem ?? system).join("\n\n")
  const hash = createHash("sha256").update(text).digest("hex")
  // ... hash tools, compare prev, write ...
  Trace.write({ ... 17 fields ... })
}
```

**After** (~12 lines):
```typescript
Trace.record({
  sessionID,
  messageID:  processor.message.id,
  agent:      agent.name,
  model:      { id: model.id, providerID: model.providerID },
  params:     agent.temperature !== undefined ? { temperature: agent.temperature } : undefined,
  system:     (processor.resolvedSystem ?? system).join("\n\n"),
  tools:      Object.entries(tools)
                .filter(([name]) => name !== "invalid")
                .map(([name, t]) => ({
                  name,
                  description: (t as { description?: string }).description,
                  parameters: (t as { parameters?: unknown }).parameters,
                })),
  contextIDs: msgs.map((m) => m.info.id),
  hooks:      Trace.flushHooks(sessionID) ?? undefined,
  timeStart:  traceStart,
  timeEnd:    traceEnd,
  error:      processor.message.error ? JSON.stringify(processor.message.error) : undefined,
})
```

### 3.2 Replace subtask trace block (L748-770)

**Before** (~20 lines):
```typescript
const traceEnd = Date.now()
const traceStep = Trace.next(sessionID)
const ids = msgs.map((m) => m.info.id)
Trace.write({ ... 17 fields, mostly null ... })
```

**After** (~8 lines):
```typescript
Trace.record({
  sessionID,
  messageID: assistantMessage.id,
  agent:     task.agent,
  model:     { id: taskModel.id, providerID: taskModel.providerID },
  contextIDs: msgs.map((m) => m.info.id),
  hooks:     Trace.flushHooks(sessionID) ?? undefined,
  timeStart: traceStart,
  timeEnd:   Date.now(),
  error:     executionError?.message,
})
```

### 3.3 Remove `messages_json` from write

In Phase 2's `Trace.record()`, we intentionally omit `messages_json`. The old `Trace.write()` was passing `msgs` as `messages_json`. The new `record()` doesn't. This stops the blob duplication immediately.

### 3.4 Remove the `const { createHash } = await import("node:crypto")` 

This dynamic import was only needed for the inline hash computation. `Trace.record()` handles it internally with a static import.

### 3.5 Verify

- Run all existing trace tests
- Run a session end-to-end, verify traces appear in the trace panel
- Verify `trace_content` table is populated
- Verify `messages_json` is no longer being written (should be null on new rows)

---

## Phase 4: Update Read Path to Use `trace_content`

**Risk**: Medium — changes query behavior
**Files**: `src/trace/trace.ts`

### 4.1 Rewrite `Trace.get()` to use JOIN

**Before**: Calls `resolve()` which walks backwards:
```typescript
const system = row.system ?? (resolve(sessionID, row.step, "system") as string | null)
const tools = row.tools ?? (resolve(sessionID, row.step, "tools") as typeof row.tools)
```

**After**: Direct content lookup:
```typescript
const system = row.system_hash ? getContent(row.system_hash) : null
const tools = row.tools_hash ? JSON.parse(getContent(row.tools_hash) ?? "null") : null
```

Or as a proper JOIN query replacing the entire `get()` implementation.

### 4.2 Rewrite `Trace.all()` to use JOIN

**Before**: Maintains `prevSystem` / `prevTools` state across iteration:
```typescript
let prevSystem: string | null = null
let prevTools: Record<string, unknown>[] | null = null
for (const row of rows) {
  const system = row.system ?? prevSystem
  // ...
}
```

**After**: Each row is self-contained via hash lookup:
```typescript
for (const row of rows) {
  const system = row.system_hash ? getContent(row.system_hash) : null
  const tools = row.tools_hash
    ? JSON.parse(getContent(row.tools_hash) ?? "null")
    : null
  // ...
}
```

### 4.3 Update `rowToInfo()` for `hasSystem` / `hasTools`

**Before**: `hasSystem: r.system !== null`
**After**: `hasSystem: r.system_hash !== null`

Similarly: `hasTools: r.tools_hash !== null`

### 4.4 Remove dead code

| Function | Why |
|---|---|
| `resolve()` (private) | Backwards-walk no longer needed |
| `Trace.last()` | Only used for hash dedup in old inline block |

### 4.5 Stop writing inline `system` / `tools`

Now that the read path uses `trace_content`, update `Trace.record()` to stop writing `system` and `tools` inline on the `trace` table. Set them to `null` always.

### 4.6 Update Zod schemas

In `Trace.Detail`:
- Remove `messages_json` field (or make truly optional with deprecation)

In `Trace.Info`:
- No shape changes needed (hasSystem/hasTools remain booleans)

### 4.7 Verify

- `Trace.get()` returns correct system/tools for each step
- `Trace.all()` returns correct system/tools for each step
- Compare view in trace panel still shows prompt diffs correctly
- Export (JSON + MD) still works
- CLI `trace` command still works

---

## Phase 5: Cleanup & Frontend

**Risk**: Low — deleting dead code
**Files**: Backend + Frontend

### 5.1 Backend cleanup

| Item | File | Action |
|---|---|---|
| `Trace.enabled()` | `src/trace/trace.ts:67-70` | Delete function |
| `experimental.trace` config | `src/config/schema.ts:669` | Delete line |
| `Trace.write()` | `src/trace/trace.ts:98-101` | Make private or remove (only `record()` should be used) |
| `messages_json` column | `src/trace/trace.sql.ts:29` | Can leave in schema (SQLite can't drop columns easily) but stop reading/writing |
| `system` column | `src/trace/trace.sql.ts:25` | Same — leave in schema, stop reading/writing |
| `tools` column | `src/trace/trace.sql.ts:27` | Same |

> [!NOTE]
> SQLite doesn't support `ALTER TABLE DROP COLUMN` for all cases. The safest approach is to leave the columns in the schema but stop reading/writing them. New rows will have `NULL` for these columns. Old rows retain their data harmlessly.

### 5.2 Frontend cleanup (3 files)

#### `packages/liteai-app/src/pages/session/trace-types.ts`

```diff
 export type TraceDetail = TraceInfo & {
   system: string | null
   tools: Record<string, unknown>[] | null
   hooks: Record<string, unknown>[] | null
-  messages_json?: Record<string, unknown>[] | null
   contextIDs: string[]
 }
```

#### `packages/liteai-app/src/pages/session/trace-parts.tsx`

In `ContextMessages` component, delete the `messages_json` prop and the Path 1 fallback (lines ~236-248):

```diff
 export function ContextMessages(props: {
   ids: string[]
   messages: TraceMessageData[]
-  messages_json?: Record<string, unknown>[] | null
 }) {
   const sync = useSync()
   const resolved = createMemo(() => {
-    if (props.messages_json && props.messages_json.length > 0) {
-      return props.messages_json.map((m: Record<string, unknown>) => ({
-        msg: {
-          id: ((m.info as Record<string, unknown>)?.id as string) || "",
-          role: ((m.info as Record<string, unknown>)?.role as string) ?? "unknown",
-        },
-        parts: ((m.parts as unknown[]) ?? []) as TracePartData[],
-      }))
-    }
-
     const map = new Map(props.messages.map((m) => [m.id, m]))
```

#### `packages/liteai-app/src/pages/session/trace-detail.tsx`

Remove the `messages_json` prop from the `ContextMessages` usage (line ~294):

```diff
             <ContextMessages
               ids={props.detail.contextIDs}
               messages={props.messages}
-              messages_json={props.detail.messages_json}
             />
```

Also remove `messages_json` from the `exportJSON` function if it references it.

### 5.3 Verify end-to-end

- [ ] Trace panel opens and shows spans
- [ ] Selecting a span shows system prompt, tools, hooks
- [ ] Context messages render correctly (using sync store path)
- [ ] Compare view shows prompt diffs
- [ ] Export JSON works
- [ ] Export Markdown works
- [ ] CLI `liteai trace` command works
- [ ] Search traces works
- [ ] Deep traces (with sub-agents) work
- [ ] Polling during active session works

---

## Phase 6: (Optional) Drop Legacy Columns via Table Rebuild

**Risk**: Medium-High — destructive migration
**When**: After confidence that Phase 1-5 are stable

SQLite doesn't support `DROP COLUMN` for columns with complex constraints. To actually remove the columns:

1. Create new `trace_v2` table without `system`, `tools`, `messages_json`
2. `INSERT INTO trace_v2 SELECT ... FROM trace` (exclude dropped columns)
3. `DROP TABLE trace`
4. `ALTER TABLE trace_v2 RENAME TO trace`
5. Recreate indexes

This saves disk space on existing databases but isn't required for correctness.

---

## File Impact Summary

### Backend (`packages/liteai`)

| File | Phase | Change |
|---|---|---|
| `src/trace/trace-content.sql.ts` | 1 | **NEW** — TraceContentTable schema |
| `src/storage/schema.ts` | 1 | Add TraceContentTable export |
| `src/trace/trace.ts` | 2,4,5 | Add `record()`, rewrite `get()`/`all()`, remove dead code |
| `src/session/prompt/loop.ts` | 3 | Replace 2 inline blocks (~60 lines) with 2 `Trace.record()` calls (~20 lines) |
| `src/config/schema.ts` | 5 | Remove `experimental.trace` option |
| `src/trace/trace.sql.ts` | 5 | Mark columns as legacy (no schema change needed) |
| `src/server/routes/trace.ts` | 4 | Minor — update if `Detail` Zod shape changes |
| `src/cli/cmd/trace.ts` | 5 | Minor — verify export still works |

### Frontend (`packages/liteai-app`)

| File | Phase | Change |
|---|---|---|
| `src/pages/session/trace-types.ts` | 5 | Remove `messages_json` from type |
| `src/pages/session/trace-parts.tsx` | 5 | Remove `messages_json` prop + fallback path |
| `src/pages/session/trace-detail.tsx` | 5 | Remove `messages_json` prop pass-through |
| `src/pages/session/trace-panel.tsx` | — | No changes |
| `src/pages/session/trace-compare.tsx` | — | No changes |
| `src/pages/session/trace-helpers.ts` | — | No changes |
| `src/pages/session/trace-section.tsx` | — | No changes |
| `src/pages/session/trace-panel.css` | — | No changes |

### Net Code Change

- **Lines removed**: ~80 (inline trace blocks + dead code + messages_json fallback)
- **Lines added**: ~60 (`Trace.record()` + `trace-content.sql.ts` + helpers)
- **Net**: ~20 fewer lines with cleaner architecture

---

## Testing Plan

There are currently **zero trace tests** in the codebase (`test/` has no `trace/` directory). This is the biggest gap. We need both unit tests for the new `Trace.record()` API and integration tests for the API routes + frontend contract.

### Test Infrastructure

Tests follow the existing project patterns:
- **Framework**: `bun:test` (`describe`, `test`, `expect`)
- **DB context**: `Instance.provide({ directory, fn })` wraps tests needing a database
- **Temp dirs**: `tmpdir({ git: true, config: {...} })` from `test/fixture/fixture.ts`
- **Logging**: `Log.init({ print: false })` silences output

### New File: `test/trace/trace.test.ts` — Unit Tests

```typescript
import { describe, expect, test } from "bun:test"
import path from "node:path"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Trace } from "../../src/trace/trace"
import { Database } from "../../src/storage/db"
import { TraceContentTable } from "../../src/trace/trace-content.sql"
import { MessageID } from "../../src/session/schema"
import { Log } from "../../src/util/log"
import { eq } from "drizzle-orm"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })
```

#### T1: `Trace.record()` writes trace + content

```typescript
test("record writes trace and content-addressable system/tools", async () => {
  await Instance.provide({
    directory: projectRoot,
    fn: async () => {
      const session = await Session.create({})
      const mid = MessageID.ascending()
      // create a minimal message for the FK
      await Session.updateMessage({ id: mid, sessionID: session.id, role: "assistant", ... })

      const { id, step } = Trace.record({
        sessionID: session.id,
        messageID: mid,
        agent: "build",
        model: { id: "gpt-5", providerID: "openai" },
        system: "You are a helpful assistant.",
        tools: [{ name: "read_file", description: "Reads a file" }],
        contextIDs: [mid],
        timeStart: Date.now() - 1000,
        timeEnd: Date.now(),
      })

      expect(id).toBeDefined()
      expect(step).toBe(0)

      // Verify trace_content has entries
      const content = Database.use((db) =>
        db.select().from(TraceContentTable).all()
      )
      expect(content.length).toBe(2) // system + tools
      expect(content.find(c => c.type === "system")?.content).toBe("You are a helpful assistant.")
      expect(content.find(c => c.type === "tools")).toBeDefined()

      await Session.remove(session.id)
    },
  })
})
```

#### T2: Subtask trace — no system/tools

```typescript
test("record subtask trace with null system and tools", async () => {
  await Instance.provide({
    directory: projectRoot,
    fn: async () => {
      const session = await Session.create({})
      const mid = MessageID.ascending()
      await Session.updateMessage({ id: mid, sessionID: session.id, role: "assistant", ... })

      const { step } = Trace.record({
        sessionID: session.id,
        messageID: mid,
        agent: "task-agent",
        model: { id: "gpt-5", providerID: "openai" },
        contextIDs: [mid],
        timeStart: Date.now() - 500,
        timeEnd: Date.now(),
      })

      expect(step).toBe(0)

      // No content should have been written
      const content = Database.use((db) =>
        db.select().from(TraceContentTable).all()
      )
      expect(content.length).toBe(0)

      await Session.remove(session.id)
    },
  })
})
```

#### T3: Content deduplication

```typescript
test("same system prompt across steps stored once in trace_content", async () => {
  await Instance.provide({
    directory: projectRoot,
    fn: async () => {
      const session = await Session.create({})
      const prompt = "You are a coding assistant."

      for (let i = 0; i < 3; i++) {
        const mid = MessageID.ascending()
        await Session.updateMessage({ id: mid, sessionID: session.id, role: "assistant", ... })
        Trace.record({
          sessionID: session.id,
          messageID: mid,
          agent: "build",
          model: { id: "gpt-5", providerID: "openai" },
          system: prompt,
          contextIDs: [mid],
          timeStart: Date.now() - 100,
          timeEnd: Date.now(),
        })
      }

      const content = Database.use((db) =>
        db.select().from(TraceContentTable).where(eq(TraceContentTable.type, "system")).all()
      )
      expect(content.length).toBe(1) // Only ONE row despite 3 traces

      await Session.remove(session.id)
    },
  })
})
```

#### T4: Step counter increments

```typescript
test("step counter increments per trace in same session", async () => {
  await Instance.provide({
    directory: projectRoot,
    fn: async () => {
      const session = await Session.create({})
      const steps: number[] = []

      for (let i = 0; i < 4; i++) {
        const mid = MessageID.ascending()
        await Session.updateMessage({ id: mid, sessionID: session.id, ... })
        const { step } = Trace.record({
          sessionID: session.id, messageID: mid, agent: "build",
          model: { id: "gpt-5", providerID: "openai" },
          contextIDs: [mid], timeStart: Date.now(), timeEnd: Date.now(),
        })
        steps.push(step)
      }

      expect(steps).toEqual([0, 1, 2, 3])
      await Session.remove(session.id)
    },
  })
})
```

#### T5: Hash determinism

```typescript
test("hash is deterministic for identical content", () => {
  // contentHash is a private function, test indirectly via record
  // Two identical system prompts must produce the same hash → same row
  // Already covered by T3, but we can also test:
  const { createHash } = require("node:crypto")
  const a = createHash("sha256").update("hello").digest("hex")
  const b = createHash("sha256").update("hello").digest("hex")
  expect(a).toBe(b)
})
```

#### T6: `Trace.get()` resolves from content-addressable store

```typescript
test("get() returns full system/tools via hash lookup", async () => {
  await Instance.provide({
    directory: projectRoot,
    fn: async () => {
      const session = await Session.create({})
      const mid = MessageID.ascending()
      await Session.updateMessage({ id: mid, sessionID: session.id, ... })

      const system = "You are an AI coding assistant."
      const tools = [{ name: "bash", description: "Run a shell command" }]

      const { id } = Trace.record({
        sessionID: session.id, messageID: mid, agent: "build",
        model: { id: "gpt-5", providerID: "openai" },
        system, tools, contextIDs: [mid],
        timeStart: Date.now(), timeEnd: Date.now(),
      })

      const detail = Trace.get(session.id, id)
      expect(detail).toBeDefined()
      expect(detail!.system).toBe(system)
      expect(detail!.tools).toEqual(tools)

      await Session.remove(session.id)
    },
  })
})
```

#### T7: `Trace.list()` returns correct info flags

```typescript
test("list() returns hasSystem/hasTools based on hash presence", async () => {
  await Instance.provide({
    directory: projectRoot,
    fn: async () => {
      const session = await Session.create({})

      // Trace with system + tools
      const mid1 = MessageID.ascending()
      await Session.updateMessage({ id: mid1, sessionID: session.id, ... })
      Trace.record({
        sessionID: session.id, messageID: mid1, agent: "build",
        model: { id: "gpt-5", providerID: "openai" },
        system: "prompt", tools: [{ name: "bash" }],
        contextIDs: [mid1], timeStart: Date.now(), timeEnd: Date.now(),
      })

      // Trace without (subtask)
      const mid2 = MessageID.ascending()
      await Session.updateMessage({ id: mid2, sessionID: session.id, ... })
      Trace.record({
        sessionID: session.id, messageID: mid2, agent: "task-agent",
        model: { id: "gpt-5", providerID: "openai" },
        contextIDs: [mid2], timeStart: Date.now(), timeEnd: Date.now(),
      })

      const list = Trace.list(session.id)
      expect(list.length).toBe(2)
      expect(list[0].hasSystem).toBe(true)
      expect(list[0].hasTools).toBe(true)
      expect(list[1].hasSystem).toBe(false)
      expect(list[1].hasTools).toBe(false)

      await Session.remove(session.id)
    },
  })
})
```

#### T8: `Trace.search()` searches content-addressable store

```typescript
test("search() finds traces by system prompt content", async () => {
  await Instance.provide({
    directory: projectRoot,
    fn: async () => {
      const session = await Session.create({})
      const mid = MessageID.ascending()
      await Session.updateMessage({ id: mid, sessionID: session.id, ... })

      const { id } = Trace.record({
        sessionID: session.id, messageID: mid, agent: "build",
        model: { id: "gpt-5", providerID: "openai" },
        system: "You are a coding assistant that writes TypeScript.",
        contextIDs: [mid], timeStart: Date.now(), timeEnd: Date.now(),
      })

      const results = Trace.search(session.id, "TypeScript")
      expect(results).toContain(id)

      await Session.remove(session.id)
    },
  })
})
```

#### T9: Error traces

```typescript
test("record includes error field", async () => {
  await Instance.provide({
    directory: projectRoot,
    fn: async () => {
      const session = await Session.create({})
      const mid = MessageID.ascending()
      await Session.updateMessage({ id: mid, sessionID: session.id, ... })

      const { id } = Trace.record({
        sessionID: session.id, messageID: mid, agent: "build",
        model: { id: "gpt-5", providerID: "openai" },
        system: "prompt", contextIDs: [mid],
        timeStart: Date.now(), timeEnd: Date.now(),
        error: "context_length_exceeded",
      })

      const detail = Trace.get(session.id, id)
      expect(detail?.error).toBe("context_length_exceeded")

      await Session.remove(session.id)
    },
  })
})
```

#### T10: Hooks preservation

```typescript
test("record stores hooks_json correctly", async () => {
  await Instance.provide({
    directory: projectRoot,
    fn: async () => {
      const session = await Session.create({})
      const mid = MessageID.ascending()
      await Session.updateMessage({ id: mid, sessionID: session.id, ... })

      const hooks = [{ event: "before-prompt", type: "url", config: { url: "https://example.com" } }]
      const { id } = Trace.record({
        sessionID: session.id, messageID: mid, agent: "build",
        model: { id: "gpt-5", providerID: "openai" },
        contextIDs: [mid], hooks: hooks as any,
        timeStart: Date.now(), timeEnd: Date.now(),
      })

      const detail = Trace.get(session.id, id)
      expect(detail?.hooks?.length).toBe(1)
      expect((detail?.hooks?.[0] as any)?.event).toBe("before-prompt")

      await Session.remove(session.id)
    },
  })
})
```

#### T11: `messages_json` no longer returned

```typescript
test("Trace.Detail does not include messages_json", async () => {
  await Instance.provide({
    directory: projectRoot,
    fn: async () => {
      const session = await Session.create({})
      const mid = MessageID.ascending()
      await Session.updateMessage({ id: mid, sessionID: session.id, ... })

      const { id } = Trace.record({
        sessionID: session.id, messageID: mid, agent: "build",
        model: { id: "gpt-5", providerID: "openai" },
        system: "prompt", contextIDs: [mid],
        timeStart: Date.now(), timeEnd: Date.now(),
      })

      const detail = Trace.get(session.id, id)
      expect(detail).toBeDefined()
      expect("messages_json" in (detail as any)).toBe(false)

      await Session.remove(session.id)
    },
  })
})
```

### New File: `test/trace/trace-content.test.ts` — Content Store Unit Tests

```typescript
import { describe, expect, test } from "bun:test"
```

#### T12: Upsert idempotency

```typescript
test("upsertContent is idempotent — same hash does not error", async () => {
  // Insert same content twice, verify no error and still 1 row
})
```

#### T13: Different content produces different hashes

```typescript
test("different content produces different hashes", async () => {
  // Record two traces with different system prompts
  // Verify trace_content has 2 rows with different hashes
})
```

### New File: `test/trace/trace-api.test.ts` — Integration Tests (API Routes)

These test the full HTTP contract that the frontend trace panel relies on.

```typescript
import { describe, expect, test } from "bun:test"
import { Hono } from "hono"
import { TraceRoutes } from "../../src/server/routes/trace"
```

#### T14: `GET /session/:id/trace` — list traces

```typescript
test("GET /session/:id/trace returns TraceInfo[]", async () => {
  // Setup: create session, record 3 traces
  // Call: GET /session/:id/trace
  // Assert: response is array of 3 TraceInfo objects
  // Assert: each has { hasSystem, hasTools, contextSize, step, agent, ... }
  // Assert: does NOT contain system, tools, hooks (detail fields)
})
```

#### T15: `GET /session/:id/trace?deep=true` — deep list with sub-agent traces

```typescript
test("GET /session/:id/trace?deep=true includes child session traces", async () => {
  // Setup: create parent session, fork child session, record traces in both
  // Call: GET /session/:id/trace?deep=true
  // Assert: response includes traces from both parent and child sessions
})
```

#### T16: `GET /session/:id/trace/:tid` — trace detail

```typescript
test("GET /session/:id/trace/:tid returns TraceDetail with resolved system/tools", async () => {
  // Setup: create session, record trace with system + tools
  // Call: GET /session/:id/trace/:tid
  // Assert: response.system is the full system prompt string
  // Assert: response.tools is the full tools array
  // Assert: response does NOT have messages_json
  // Assert: response.contextIDs is an array of message IDs
})
```

#### T17: `GET /session/:id/trace/:tid` — 404 for missing trace

```typescript
test("GET /session/:id/trace/:tid returns 404 for unknown trace", async () => {
  // Call with nonexistent trace ID
  // Assert: 404 status
})
```

#### T18: `GET /session/:id/trace/search?q=` — search

```typescript
test("GET /session/:id/trace/search?q=TypeScript finds matching traces", async () => {
  // Setup: create session, record trace with system mentioning "TypeScript"
  // Call: GET /session/:id/trace/search?q=TypeScript
  // Assert: response.ids contains the trace ID
})
```

#### T19: `GET /session/:id/trace/export` — export JSON

```typescript
test("GET /session/:id/trace/export?format=json returns full trace data", async () => {
  // Setup: create session, record traces
  // Call: GET /session/:id/trace/export?format=json
  // Assert: valid JSON with trace data
})
```

### Test Summary Table

| ID | File | Type | What it verifies |
|---|---|---|---|
| T1 | `trace.test.ts` | Unit | `record()` writes trace + stores content by hash |
| T2 | `trace.test.ts` | Unit | Subtask trace (no system/tools) writes null hashes |
| T3 | `trace.test.ts` | Unit | Content deduplication — 3 identical prompts = 1 row |
| T4 | `trace.test.ts` | Unit | Step counter increments [0, 1, 2, 3] |
| T5 | `trace.test.ts` | Unit | SHA-256 hash determinism |
| T6 | `trace.test.ts` | Unit | `get()` resolves system/tools from content store |
| T7 | `trace.test.ts` | Unit | `list()` computes `hasSystem` / `hasTools` from hash |
| T8 | `trace.test.ts` | Unit | `search()` searches content-addressable content |
| T9 | `trace.test.ts` | Unit | Error field persisted and retrieved |
| T10 | `trace.test.ts` | Unit | Hooks JSON persisted and retrieved |
| T11 | `trace.test.ts` | Unit | `messages_json` no longer present in Detail |
| T12 | `trace-content.test.ts` | Unit | Upsert idempotency |
| T13 | `trace-content.test.ts` | Unit | Different content → different hashes |
| T14 | `trace-api.test.ts` | Integration | `GET /trace` → `TraceInfo[]` shape |
| T15 | `trace-api.test.ts` | Integration | `GET /trace?deep=true` includes child sessions |
| T16 | `trace-api.test.ts` | Integration | `GET /trace/:tid` → `TraceDetail` with resolved content |
| T17 | `trace-api.test.ts` | Integration | `GET /trace/:tid` → 404 for missing |
| T18 | `trace-api.test.ts` | Integration | `GET /trace/search?q=` returns matching IDs |
| T19 | `trace-api.test.ts` | Integration | `GET /trace/export` returns valid data |

### Test Coverage Targets

| Component | Current Coverage | Target |
|---|---|---|
| `Trace.record()` | **0%** (doesn't exist yet) | 100% |
| `Trace.get()` / `Trace.all()` | **0%** | 100% |
| `Trace.list()` / `Trace.listDeep()` | **0%** | 80% |
| `Trace.search()` | **0%** | 80% |
| `trace_content` helpers | **0%** | 100% |
| API routes (`/trace/*`) | **0%** | 80% |

---

## What This Enables (Future Work)

Once trace is first-class, these features become straightforward:

### Step-Back
```
Trace.record() returns { step }.
→ Query trace at step N for context_ids (message boundary)
→ Query trace at step N for message_id (truncation point)  
→ Restore snapshot from step-start part
→ Delete messages after boundary
→ Re-enter loop
```

### Step-Pause
```
After Trace.record() returns, check session pause flag.
→ SessionStatus.set(sessionID, { type: "paused", step })
→ Break the loop
→ Resume API continues from paused step
```

### Replay with Different Params
```
Fork session to step N's message boundary (Session.fork).
→ Trace.record() with different model/agent creates new step N
→ Loop continues from there
```

### Per-Step Debugging
```
Trace.get(sessionID, traceID) gives exact:
  - System prompt (via trace_content JOIN)
  - Tool schemas (via trace_content JOIN)  
  - Message IDs in context window
  - Agent, model, params, timing
All resolved without backwards walks.
```
