import { Database as BunDatabase } from "bun:sqlite"
import { drizzle, type SQLiteBunDatabase } from "drizzle-orm/bun-sqlite"
import { migrate } from "drizzle-orm/bun-sqlite/migrator"
import type { EmptyRelations } from "drizzle-orm/relations"
import type { SQLiteTransaction } from "drizzle-orm/sqlite-core"

export * from "drizzle-orm"

import { existsSync, readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { NamedError } from "@liteai/util/error"
import z from "zod"
import { iife } from "@/util/iife"
import { Flag } from "../flag/flag"
import { Global } from "../global"
import { Installation } from "../installation"
import { Context } from "../util/context"
import { lazy } from "../util/lazy"
import { Log } from "../util/log"
import type * as schema from "./schema"

declare const LITEAI_MIGRATIONS: { sql: string; timestamp: number; name: string }[] | undefined

export const NotFoundError = NamedError.create(
  "NotFoundError",
  z.object({
    message: z.string(),
  }),
)

const log = Log.create({ service: "db" })

export namespace Database {
  export const Path = iife(() => {
    if (Flag.LITEAI_DB_MEMORY) return ":memory:"
    const channel = Installation.CHANNEL
    if (["latest", "beta"].includes(channel) || Flag.LITEAI_DISABLE_CHANNEL_DB)
      return path.join(Global.Path.data, "liteai.db")
    const safe = channel.replace(/[^a-zA-Z0-9._-]/g, "-")
    return path.join(Global.Path.data, `liteai-${safe}.db`)
  })

  type Schema = typeof schema
  export type Transaction = SQLiteTransaction<"sync", void, Schema>

  type Client = SQLiteBunDatabase

  type Journal = { sql: string; timestamp: number; name: string }[]

  const state = {
    sqlite: undefined as BunDatabase | undefined,
  }

  function time(tag: string) {
    const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(tag)
    if (!match) return 0
    return Date.UTC(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4]),
      Number(match[5]),
      Number(match[6]),
    )
  }

  function migrations(dir: string): Journal {
    const dirs = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)

    const sql = dirs.flatMap((name) => {
      const file = path.join(dir, name, "migration.sql")
      if (!existsSync(file)) return []
      return {
        sql: readFileSync(file, "utf-8"),
        timestamp: time(name),
        name,
      }
    })

    return sql.sort((a, b) => a.timestamp - b.timestamp)
  }

  export const Client = lazy(() => {
    log.info("opening database", { path: Path })

    const sqlite = new BunDatabase(Path, { create: true })
    state.sqlite = sqlite

    sqlite.run("PRAGMA foreign_keys = ON")
    sqlite.run("PRAGMA cache_size = -64000")
    if (Path !== ":memory:") {
      sqlite.run("PRAGMA journal_mode = WAL")
      sqlite.run("PRAGMA synchronous = NORMAL")
      sqlite.run("PRAGMA busy_timeout = 5000")
      sqlite.run("PRAGMA wal_checkpoint(PASSIVE)")
    }

    const db = drizzle({ client: sqlite })

    // Apply schema migrations
    const entries =
      typeof LITEAI_MIGRATIONS !== "undefined"
        ? LITEAI_MIGRATIONS
        : migrations(path.join(import.meta.dirname, "../../migration"))
    if (entries.length > 0) {
      log.info("applying migrations", {
        count: entries.length,
        mode: typeof LITEAI_MIGRATIONS !== "undefined" ? "bundled" : "dev",
      })
      if (Flag.LITEAI_SKIP_MIGRATIONS) {
        for (const item of entries) {
          item.sql = "select 1;"
        }
      }
      migrate(db, entries)
    }

    return db
  })

  export function close() {
    const sqlite = state.sqlite
    if (!sqlite) return
    sqlite.close()
    state.sqlite = undefined
    Client.reset()
  }

  export type TxOrDb = SQLiteTransaction<"sync", void, Record<string, never>, EmptyRelations> | Client

  const ctx = Context.create<{
    tx: TxOrDb
    effects: (() => void)[]
  }>("database")

  export function use<T>(callback: (trx: TxOrDb) => T): T {
    try {
      return callback(ctx.use().tx)
    } catch (err) {
      if (err instanceof Context.NotFound) {
        const effects: (() => void)[] = []
        const result = ctx.provide({ effects, tx: Client() }, () => callback(Client()))
        for (const effect of effects) effect()
        return result
      }
      throw err
    }
  }

  export function effect(fn: () => void) {
    try {
      ctx.use().effects.push(fn)
    } catch {
      fn()
    }
  }

  export function transaction<T>(callback: (tx: TxOrDb) => T): T {
    try {
      return callback(ctx.use().tx)
    } catch (err) {
      if (err instanceof Context.NotFound) {
        const effects: (() => void)[] = []
        const result = (Client().transaction as <R>(cb: (tx: TxOrDb) => R) => R)((tx) => {
          return ctx.provide({ tx, effects }, () => callback(tx))
        })
        for (const effect of effects) effect()
        return result
      }
      throw err
    }
  }
}
