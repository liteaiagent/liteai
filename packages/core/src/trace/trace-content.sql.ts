import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"

export const TraceContentTable = sqliteTable("trace_content", {
  hash: text().primaryKey(), // SHA-256 hex
  type: text().$type<"system" | "tools" | "results">().notNull(),
  content: text().notNull(),
  time_created: integer()
    .notNull()
    .$default(() => Date.now()),
})
