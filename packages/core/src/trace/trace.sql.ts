import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import type { MessageID, SessionID } from "../session/schema"
import { MessageTable, SessionTable } from "../session/session.sql"
import { Timestamps } from "../storage/schema.sql"
import type { TraceID } from "./schema"

export const TraceTable = sqliteTable(
  "trace",
  {
    id: text().$type<TraceID>().primaryKey(),
    session_id: text()
      .$type<SessionID>()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    message_id: text()
      .$type<MessageID>()
      .notNull()
      .references(() => MessageTable.id, { onDelete: "cascade" }),
    parent_id: text().$type<TraceID>(),
    step: integer().notNull(),
    agent: text().notNull(),
    model_id: text().notNull(),
    provider_id: text().notNull(),
    params: text({ mode: "json" }).$type<{ temperature?: number; maxTokens?: number; topP?: number }>(),
    system_hash: text(),
    tools_hash: text(),
    results_hash: text(),
    context_ids: text({ mode: "json" }).notNull().$type<string[]>(),
    hooks_json: text({ mode: "json" }).$type<
      { event: string; type: string; config?: Record<string, unknown>; context?: string }[]
    >(),
    time_start: integer().notNull(),
    time_end: integer(),
    error: text(),
    ...Timestamps,
  },
  (table) => [index("trace_session_idx").on(table.session_id), index("trace_message_idx").on(table.message_id)],
)
