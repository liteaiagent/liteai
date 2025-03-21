import z from "zod"
import { Config } from "../config/config"
import type { SessionID } from "../session/schema"
import { SessionTable } from "../session/session.sql"
import { and, Database, desc, eq, inArray, isNotNull, like, lte, max, or, sql } from "../storage/db"
import { Log } from "../util/log"
import type { TraceID } from "./schema"
import { TraceTable } from "./trace.sql"

const log = Log.create({ service: "trace" })

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

  export const Detail = Info.extend({
    system: z.string().nullable(),
    tools: z.array(z.record(z.string(), z.unknown())).nullable(),
    contextIDs: z.array(z.string()),
  }).meta({ ref: "TraceDetail" })

  export type Detail = z.output<typeof Detail>

  export async function enabled() {
    const cfg = await Config.get()
    return cfg?.experimental?.trace === true
  }

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

  export function last(sessionID: SessionID) {
    return Database.use((db) =>
      db
        .select({
          system_hash: TraceTable.system_hash,
          tools_hash: TraceTable.tools_hash,
        })
        .from(TraceTable)
        .where(eq(TraceTable.session_id, sessionID))
        .orderBy(desc(TraceTable.step))
        .limit(1)
        .get(),
    )
  }

  export function write(row: typeof TraceTable.$inferInsert) {
    log.info("write", { step: row.step, session: row.session_id })
    Database.use((db) => db.insert(TraceTable).values(row).run())
  }

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
      hasSystem: r.system !== null,
      hasTools: r.tools !== null,
      contextSize: r.context_ids.length,
      timeStart: r.time_start,
      timeEnd: r.time_end ?? null,
      timeCreated: r.time_created,
      error: r.error,
    }
  }

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

  export function search(sessionID: SessionID, query: string): string[] {
    const pattern = `%${query}%`
    const rows = Database.use((db) =>
      db
        .select({ id: TraceTable.id })
        .from(TraceTable)
        .where(
          and(
            eq(TraceTable.session_id, sessionID),
            or(like(TraceTable.system, pattern), sql`${TraceTable.tools} LIKE ${pattern}`),
          ),
        )
        .all(),
    )
    return rows.map((r) => r.id)
  }

  function resolve(sessionID: SessionID, step: number, field: "system" | "tools") {
    const col = field === "system" ? TraceTable.system : TraceTable.tools
    const row = Database.use((db) =>
      db
        .select({ val: col })
        .from(TraceTable)
        .where(and(eq(TraceTable.session_id, sessionID), isNotNull(col), lte(TraceTable.step, step)))
        .orderBy(desc(TraceTable.step))
        .limit(1)
        .get(),
    )
    return row?.val ?? null
  }

  export function get(sessionID: SessionID, traceID: TraceID): Detail | undefined {
    const row = Database.use((db) =>
      db
        .select()
        .from(TraceTable)
        .where(and(eq(TraceTable.session_id, sessionID), eq(TraceTable.id, traceID)))
        .get(),
    )
    if (!row) return undefined

    const system = row.system ?? (resolve(sessionID, row.step, "system") as string | null)
    const tools = row.tools ?? (resolve(sessionID, row.step, "tools") as typeof row.tools)

    return {
      ...rowToInfo(row),
      system,
      tools: tools as Record<string, unknown>[] | null,
      contextIDs: row.context_ids,
    }
  }

  export function all(sessionID: SessionID): Detail[] {
    const rows = Database.use((db) =>
      db.select().from(TraceTable).where(eq(TraceTable.session_id, sessionID)).orderBy(TraceTable.step).all(),
    )
    const result: Detail[] = []
    let prevSystem: string | null = null
    let prevTools: Record<string, unknown>[] | null = null

    for (const row of rows) {
      const system = row.system ?? prevSystem
      const tools = (row.tools as Record<string, unknown>[] | null) ?? prevTools
      if (row.system) prevSystem = row.system
      if (row.tools) prevTools = row.tools as Record<string, unknown>[]

      result.push({
        ...rowToInfo(row),
        system,
        tools,
        contextIDs: row.context_ids,
      })
    }
    return result
  }

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
