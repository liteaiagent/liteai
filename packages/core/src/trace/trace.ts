import { createHash } from "node:crypto"
import z from "zod"
import type { MessageID, SessionID } from "../session/schema"
import { SessionTable } from "../session/session.sql"
import { and, Database, eq, inArray, max, or, sql } from "../storage/db"
import { Log } from "../util/log"
import type { TraceID } from "./schema"
import { TraceID as TraceIDSchema } from "./schema"
import { TraceTable } from "./trace.sql"
import { TraceContentTable } from "./trace-content.sql"

const log = Log.create({ service: "trace" })

// ── Content-addressable helpers ──────────────────────────────────────────────

function contentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex")
}

function upsertContent(hash: string, type: "system" | "tools", content: string) {
  Database.use((db) => db.insert(TraceContentTable).values({ hash, type, content }).onConflictDoNothing().run())
}

function getContent(hash: string): string | null {
  const row = Database.use((db) =>
    db
      .select({ content: TraceContentTable.content })
      .from(TraceContentTable)
      .where(eq(TraceContentTable.hash, hash))
      .get(),
  )
  return row?.content ?? null
}

// ── Trace namespace ──────────────────────────────────────────────────────────

export namespace Trace {
  export const Info = z
    .object({
      id: z.string(),
      sessionID: z.string(),
      messageID: z.string(),
      step: z.number(),
      agent: z.string(),
      modelID: z.string(),
      providerID: z.string(),
      params: z.record(z.string(), z.unknown()).nullable(),
      hasSystem: z.boolean(),
      hasTools: z.boolean(),
      contextSize: z.number(),
      timeStart: z.number(),
      timeEnd: z.number().nullable(),
      timeCreated: z.number(),
      error: z.string().nullable(),
    })
    .meta({ ref: "Trace" })

  export type Info = z.output<typeof Info>

  export const HookInvocation = z.object({
    event: z.string(),
    type: z.string(),
    config: z.record(z.string(), z.unknown()).optional(),
    context: z.string().optional(),
  })

  export const Detail = Info.extend({
    system: z.string().nullable(),
    tools: z.array(z.record(z.string(), z.unknown())).nullable(),
    hooks: z.array(HookInvocation).nullable(),
    contextIDs: z.array(z.string()),
  }).meta({ ref: "TraceDetail" })

  export type Detail = z.output<typeof Detail>

  // ── Pending hooks accumulator ────────────────────────────────────────────

  const _pendingHooks = new Map<SessionID, z.infer<typeof HookInvocation>[]>()

  export function addHooks(sessionID: SessionID, hooks: z.infer<typeof HookInvocation>[]) {
    if (!hooks || hooks.length === 0) return
    const current = _pendingHooks.get(sessionID) ?? []
    current.push(...hooks)
    _pendingHooks.set(sessionID, current)
  }

  export function flushHooks(sessionID: SessionID): z.infer<typeof HookInvocation>[] | null {
    const current = _pendingHooks.get(sessionID)
    _pendingHooks.delete(sessionID)
    return current?.length ? current : null
  }

  // ── Step counter ─────────────────────────────────────────────────────────

  export function next(sessionID: SessionID) {
    const row = Database.use((db) =>
      db
        .select({ val: max(TraceTable.step) })
        .from(TraceTable)
        .where(eq(TraceTable.session_id, sessionID))
        .get(),
    )
    return (row?.val ?? 0) + 1
  }

  // ── RecordInput ──────────────────────────────────────────────────────────

  export interface RecordInput {
    sessionID: SessionID
    messageID: MessageID
    parentID?: TraceID
    agent: string
    model: { id: string; providerID: string }
    params?: { temperature?: number; maxTokens?: number; topP?: number } | null
    system?: string // full resolved system prompt (omit for subtasks)
    tools?: { name: string; description?: string; parameters?: unknown }[]
    contextIDs: string[]
    hooks?: z.infer<typeof HookInvocation>[] | null
    timeStart: number
    timeEnd: number
    error?: string | null
  }

  // ── Unified write API ────────────────────────────────────────────────────

  export function record(input: RecordInput): { id: TraceID; step: number } {
    const step = next(input.sessionID)
    const id = TraceIDSchema.ascending()

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
      db
        .insert(TraceTable)
        .values({
          id,
          session_id: input.sessionID,
          message_id: input.messageID,
          parent_id: input.parentID ?? null,
          step,
          agent: input.agent,
          model_id: input.model.id,
          provider_id: input.model.providerID,
          params: input.params ?? null,
          system_hash: systemHash,
          tools_hash: toolsHash,
          hooks_json: input.hooks?.length ? input.hooks : null,
          context_ids: input.contextIDs,
          time_start: input.timeStart,
          time_end: input.timeEnd,
          error: input.error ?? null,
        })
        .run(),
    )

    return { id, step }
  }

  // ── Row → Info mapper ────────────────────────────────────────────────────

  function rowToInfo(r: typeof TraceTable.$inferSelect): Info {
    return {
      id: r.id,
      sessionID: r.session_id,
      messageID: r.message_id,
      step: r.step,
      agent: r.agent,
      modelID: r.model_id,
      providerID: r.provider_id,
      params: r.params,
      hasSystem: r.system_hash !== null,
      hasTools: r.tools_hash !== null,
      contextSize: r.context_ids.length,
      timeStart: r.time_start,
      timeEnd: r.time_end ?? null,
      timeCreated: r.time_created,
      error: r.error,
    }
  }

  // ── List / ListDeep ──────────────────────────────────────────────────────

  export function list(sessionID: SessionID): Info[] {
    const rows = Database.use((db) =>
      db.select().from(TraceTable).where(eq(TraceTable.session_id, sessionID)).orderBy(TraceTable.step).all(),
    )
    return rows.map(rowToInfo)
  }

  export function listDeep(sessionID: SessionID): Info[] {
    const children = Database.use((db) =>
      db.select({ id: SessionTable.id }).from(SessionTable).where(eq(SessionTable.parent_id, sessionID)).all(),
    )
    const ids = [sessionID, ...children.map((c) => c.id)]
    const rows = Database.use((db) =>
      db
        .select()
        .from(TraceTable)
        .where(inArray(TraceTable.session_id, ids))
        .orderBy(TraceTable.time_start, TraceTable.step)
        .all(),
    )
    return rows.map(rowToInfo)
  }

  // ── Search ───────────────────────────────────────────────────────────────

  export function search(sessionID: SessionID, query: string): string[] {
    const pattern = `%${query}%`
    const rows = Database.use((db) =>
      db
        .select({ id: TraceTable.id })
        .from(TraceTable)
        .where(
          and(
            eq(TraceTable.session_id, sessionID),
            or(
              sql`EXISTS (
                SELECT 1 FROM trace_content tc
                WHERE tc.hash = ${TraceTable.system_hash}
                AND tc.content LIKE ${pattern}
              )`,
              sql`EXISTS (
                SELECT 1 FROM trace_content tc
                WHERE tc.hash = ${TraceTable.tools_hash}
                AND tc.content LIKE ${pattern}
              )`,
            ),
          ),
        )
        .all(),
    )
    return rows.map((r) => r.id)
  }

  // ── Get (single trace detail) ────────────────────────────────────────────

  export function get(sessionID: SessionID, traceID: TraceID): Detail | undefined {
    const row = Database.use((db) =>
      db
        .select()
        .from(TraceTable)
        .where(and(eq(TraceTable.session_id, sessionID), eq(TraceTable.id, traceID)))
        .get(),
    )
    if (!row) return undefined

    const system = row.system_hash ? getContent(row.system_hash) : null

    const tools = row.tools_hash
      ? (JSON.parse(getContent(row.tools_hash) ?? "null") as Record<string, unknown>[] | null)
      : null

    return {
      ...rowToInfo(row),
      system,
      tools,
      hooks: (row.hooks_json ?? null) as z.infer<typeof HookInvocation>[] | null,
      contextIDs: row.context_ids,
    }
  }

  // ── All (all details for a session) ──────────────────────────────────────

  export function all(sessionID: SessionID): Detail[] {
    const rows = Database.use((db) =>
      db.select().from(TraceTable).where(eq(TraceTable.session_id, sessionID)).orderBy(TraceTable.step).all(),
    )
    const result: Detail[] = []

    for (const row of rows) {
      const system = row.system_hash ? getContent(row.system_hash) : null

      const tools = row.tools_hash
        ? (JSON.parse(getContent(row.tools_hash) ?? "null") as Record<string, unknown>[] | null)
        : null

      result.push({
        ...rowToInfo(row),
        system,
        tools,
        hooks: (row.hooks_json ?? null) as z.infer<typeof HookInvocation>[] | null,
        contextIDs: row.context_ids,
      })
    }
    return result
  }

  // ── Export helpers ────────────────────────────────────────────────────────

  export function toJSON(sessionID: SessionID) {
    return all(sessionID)
  }

  export function toMarkdown(sessionID: SessionID) {
    const traces = all(sessionID)
    if (traces.length === 0) return "# Trace\n\nNo trace data.\n"

    const lines = ["# Trace\n"]
    for (const t of traces) {
      lines.push(`## Step ${t.step} — ${t.agent} (${t.providerID}/${t.modelID})`)
      lines.push("")
      lines.push(`- **Time**: ${new Date(t.timeStart).toISOString()}`)
      lines.push(`- **Context**: ${t.contextSize} messages`)
      if (t.params) lines.push(`- **Params**: ${JSON.stringify(t.params)}`)
      if (t.error) lines.push(`- **Error**: ${t.error}`)
      lines.push("")

      if (t.system) {
        lines.push("### System Prompt")
        lines.push("")
        lines.push("```")
        lines.push(t.system)
        lines.push("```")
        lines.push("")
      }

      if (t.tools && t.tools.length > 0) {
        lines.push(`### Tools (${t.tools.length})`)
        lines.push("")
        lines.push("```json")
        lines.push(JSON.stringify(t.tools, null, 2))
        lines.push("```")
        lines.push("")
      }

      if (t.hooks && t.hooks.length > 0) {
        lines.push(`### Hooks (${t.hooks.length})`)
        lines.push("")
        lines.push("```json")
        lines.push(JSON.stringify(t.hooks, null, 2))
        lines.push("```")
        lines.push("")
      }

      if (t.contextIDs.length > 0) {
        lines.push("### Context IDs")
        lines.push("")
        for (const id of t.contextIDs) {
          lines.push(`- \`${id}\``)
        }
        lines.push("")
      }

      lines.push("---")
      lines.push("")
    }
    return lines.join("\n")
  }
}
