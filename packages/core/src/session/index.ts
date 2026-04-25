import path from "node:path"
import type { LanguageModelV2Usage } from "@ai-sdk/provider"
import { Slug } from "@liteai/util/slug"
import type { ProviderMetadata } from "ai"
import { Decimal } from "decimal.js"
import z from "zod"
import { Brand } from "@/brand"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { PermissionNext } from "@/permission/next"
import type { Provider } from "@/provider/provider"
import { ModelID, ProviderID } from "@/provider/schema"
import { Snapshot } from "@/snapshot"
import { Storage } from "@/storage/storage"
import { fn } from "@/util/fn"
import { iife } from "@/util/iife"
import { Command } from "../command"
import { Config } from "../config/config"
import { WorkspaceID } from "../control-plane/schema"
import { WorkspaceContext } from "../control-plane/workspace-context"
import { Flag } from "../flag/flag"
import { Hook } from "../hook"
import { Installation } from "../installation"
import { Plugin } from "../plugin"
import { Instance } from "../project/instance"
import { ProjectID } from "../project/schema"
import { and, Database, desc, eq, gte, isNotNull, isNull, like, NotFoundError, sql } from "../storage/db"
import { Log } from "../util/log"
import { SessionPrompt } from "./engine"
import { Message } from "./message"
import { MessageID, PartID, SessionID } from "./schema"
import { MessageTable, PartTable, SessionTable } from "./session.sql"

export namespace Session {
  const log = Log.create({ service: "session" })

  const sessionAgentCounts = new Map<string, number>()

  export function incrementAgentCount(sessionID: string) {
    const current = sessionAgentCounts.get(sessionID) ?? 0
    sessionAgentCounts.set(sessionID, current + 1)
    return current + 1
  }

  export function decrementAgentCount(sessionID: string) {
    const current = sessionAgentCounts.get(sessionID) ?? 0
    if (current > 1) {
      sessionAgentCounts.set(sessionID, current - 1)
      return current - 1
    }
    sessionAgentCounts.delete(sessionID)
    return 0
  }

  export function getAgentCount(sessionID: string) {
    return sessionAgentCounts.get(sessionID) ?? 0
  }

  const parentTitlePrefix = "New session - "
  const childTitlePrefix = "Child session - "

  function createDefaultTitle(isChild = false) {
    return (isChild ? childTitlePrefix : parentTitlePrefix) + new Date().toISOString()
  }

  export function isDefaultTitle(title: string) {
    return new RegExp(
      `^(${parentTitlePrefix}|${childTitlePrefix})\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$`,
    ).test(title)
  }

  type SessionRow = typeof SessionTable.$inferSelect

  export function fromRow(row: SessionRow): Info {
    const summary =
      row.summary_additions !== null || row.summary_deletions !== null || row.summary_files !== null
        ? {
            additions: row.summary_additions ?? 0,
            deletions: row.summary_deletions ?? 0,
            files: row.summary_files ?? 0,
            diffs: row.summary_diffs ?? undefined,
          }
        : undefined
    const share = row.share_url ? { url: row.share_url } : undefined
    const revert = row.revert ?? undefined
    return {
      id: row.id,
      slug: row.slug,
      projectID: row.project_id,
      workspaceID: row.workspace_id ?? undefined,
      directory: row.directory,
      parentID: row.parent_id ?? undefined,
      title: row.title,
      version: row.version,
      summary,
      share,
      revert,
      permission: row.permission ?? undefined,
      time: {
        created: row.time_created,
        updated: row.time_updated,
        compacting: row.time_compacting ?? undefined,
        archived: row.time_archived ?? undefined,
      },
      sessionMode: (row.session_mode as "Normal" | "Coordinator" | "Swarm") ?? "Normal",
      toolProfile: (row.tool_profile as "Plan" | "Fast") ?? "Plan",
      forkEnabled: row.fork_enabled === 1,
    }
  }

  export function toRow(info: Info) {
    return {
      id: info.id,
      project_id: info.projectID,
      workspace_id: info.workspaceID,
      parent_id: info.parentID,
      slug: info.slug,
      directory: info.directory,
      title: info.title,
      version: info.version,
      share_url: info.share?.url,
      summary_additions: info.summary?.additions,
      summary_deletions: info.summary?.deletions,
      summary_files: info.summary?.files,
      summary_diffs: info.summary?.diffs,
      revert: info.revert ?? null,
      permission: info.permission,
      time_created: info.time.created,
      time_updated: info.time.updated,
      time_compacting: info.time.compacting,
      time_archived: info.time.archived,
      session_mode: info.sessionMode ?? "Normal",
      tool_profile: info.toolProfile ?? "Plan",
      fork_enabled: info.forkEnabled ? 1 : 0,
    }
  }

  function getForkedTitle(title: string): string {
    const match = title.match(/^(.+) \(fork #(\d+)\)$/)
    if (match) {
      const base = match[1]
      const num = parseInt(match[2], 10)
      return `${base} (fork #${num + 1})`
    }
    return `${title} (fork #1)`
  }

  export const Info = z
    .object({
      id: SessionID.zod,
      slug: z.string(),
      projectID: ProjectID.zod,
      workspaceID: WorkspaceID.zod.optional(),
      directory: z.string(),
      parentID: SessionID.zod.optional(),
      summary: z
        .object({
          additions: z.number(),
          deletions: z.number(),
          files: z.number(),
          diffs: Snapshot.FileDiff.array().optional(),
        })
        .optional(),
      share: z
        .object({
          url: z.string(),
        })
        .optional(),
      title: z.string(),
      version: z.string(),
      time: z.object({
        created: z.number(),
        updated: z.number(),
        compacting: z.number().optional(),
        archived: z.number().optional(),
      }),
      permission: PermissionNext.Ruleset.optional(),
      revert: z
        .object({
          messageID: MessageID.zod,
          partID: PartID.zod.optional(),
          snapshot: z.string().optional(),
          diff: z.string().optional(),
        })
        .optional(),
      sessionMode: z.enum(["Normal", "Coordinator", "Swarm"]).default("Normal"),
      toolProfile: z.enum(["Plan", "Fast"]).default("Plan"),
      forkEnabled: z.boolean().default(false),
    })
    .meta({
      ref: "Session",
    })
  export type Info = z.output<typeof Info>

  export const Event = {
    Created: BusEvent.define(
      "session.created",
      z.object({
        info: Info,
      }),
    ),
    Updated: BusEvent.define(
      "session.updated",
      z.object({
        info: Info,
      }),
    ),
    Deleted: BusEvent.define(
      "session.deleted",
      z.object({
        info: Info,
      }),
    ),
    Diff: BusEvent.define(
      "session.diff",
      z.object({
        sessionID: SessionID.zod,
        diff: Snapshot.FileDiff.array(),
      }),
    ),
    Error: BusEvent.define(
      "session.error",
      z.object({
        sessionID: SessionID.zod.optional(),
        error: Message.Assistant.shape.error,
      }),
    ),
    PlanStateChanged: BusEvent.define(
      "plan.state_changed",
      z.object({
        sessionID: SessionID.zod,
        active: z.boolean(),
        planFilePath: z.string(),
        turnsSincePlanReminder: z.number(),
      }),
    ),
    PlanApprovalRequested: BusEvent.define(
      "plan.approval_requested",
      z.object({
        sessionID: SessionID.zod,
        planText: z.string(),
        planFilePath: z.string(),
      }),
    ),
  }

  export const create = fn(
    z
      .object({
        parentID: SessionID.zod.optional(),
        title: z.string().optional(),
        permission: Info.shape.permission,
        workspaceID: WorkspaceID.zod.optional(),
      })
      .optional(),
    async (input) => {
      return createNext({
        parentID: input?.parentID,
        directory: Instance.directory,
        title: input?.title,
        permission: input?.permission,
        workspaceID: input?.workspaceID,
      })
    },
  )

  export const fork = fn(
    z.object({
      sessionID: SessionID.zod,
      messageID: MessageID.zod.optional(),
    }),
    async (input) => {
      const original = await get(input.sessionID)
      if (!original) throw new Error("session not found")
      const title = getForkedTitle(original.title)
      const session = await createNext({
        directory: Instance.directory,
        workspaceID: original.workspaceID,
        title,
      })
      const msgs = await messages({ sessionID: input.sessionID })
      const idMap = new Map<string, MessageID>()

      for (const msg of msgs) {
        if (input.messageID && msg.info.id >= input.messageID) break
        const newID = MessageID.ascending()
        idMap.set(msg.info.id, newID)

        const parentID = msg.info.role === "assistant" && msg.info.parentID ? idMap.get(msg.info.parentID) : undefined
        const cloned = await updateMessage({
          ...msg.info,
          sessionID: session.id,
          id: newID,
          ...(parentID && { parentID }),
        })

        for (const part of msg.parts) {
          await updatePart({
            ...part,
            id: PartID.ascending(),
            messageID: cloned.id,
            sessionID: session.id,
          })
        }
      }
      return session
    },
  )

  export const touch = fn(SessionID.zod, async (sessionID) => {
    const now = Date.now()
    Database.use((db) => {
      const row = db
        .update(SessionTable)
        .set({ time_updated: now })
        .where(eq(SessionTable.id, sessionID))
        .returning()
        .get()
      if (!row) throw new NotFoundError({ message: `Session not found: ${sessionID}` })
      const info = fromRow(row)
      Database.effect(() => Bus.publish(Event.Updated, { info }))
    })
  })

  export async function createNext(input: {
    id?: SessionID
    title?: string
    parentID?: SessionID
    workspaceID?: WorkspaceID
    directory: string
    permission?: PermissionNext.Ruleset
  }) {
    const result: Info = {
      id: SessionID.descending(input.id),
      slug: Slug.create(),
      version: Installation.VERSION,
      projectID: Instance.project.id,
      directory: input.directory,
      workspaceID: input.workspaceID,
      parentID: input.parentID,
      title: input.title ?? createDefaultTitle(!!input.parentID),
      permission: input.permission,
      time: {
        created: Date.now(),
        updated: Date.now(),
      },
      sessionMode: "Normal" as const,
      toolProfile: "Plan" as const,
      forkEnabled: false,
    }
    log.info("created", result)
    Database.use((db) => {
      db.insert(SessionTable).values(toRow(result)).run()
      Database.effect(() =>
        Bus.publish(Event.Created, {
          info: result,
        }),
      )
    })
    const cfg = await Config.get()
    if (!result.parentID && (Flag.LITEAI_AUTO_SHARE || cfg.share === "auto"))
      share(result.id).catch((e) => {
        log.warn("auto-share failed on session creation", { sessionID: result.id, error: e })
      })
    Bus.publish(Event.Updated, {
      info: result,
    })
    const defAgentName = await import("../agent/agent").then((m) => m.Agent.defaultAgent())
    const defAgent = await import("../agent/agent").then((m) => m.Agent.get(defAgentName))

    // Resolve a model for the hook context message: prefer agent's explicit model, fall back to default
    const hookModel =
      defAgent.model ??
      (await import("../provider/provider").then((m) => m.Provider.defaultModel()).catch(() => undefined))

    const sessionHook = await Hook.dispatch("SessionStart", {
      session_id: result.id,
      cwd: result.directory,
      hook_event_name: "SessionStart",
      source: input.parentID ? "resume" : "startup",
      model: hookModel ? `${hookModel.providerID}/${hookModel.modelID}` : "unknown",
      agent_type: defAgentName,
    })

    if (sessionHook.context) {
      if (!hookModel) {
        log.warn("SessionStart hook returned context but no model is available — skipping synthetic message", {
          sessionID: result.id,
          agent: defAgentName,
        })
      } else {
        const messageID = MessageID.ascending()
        await updateMessage({
          id: messageID,
          sessionID: result.id,
          role: "user",
          time: { created: Date.now() },
          agent: defAgentName,
          model: hookModel,
        } as import("./message").Message.User)
        await updatePart({
          id: PartID.ascending(),
          sessionID: result.id,
          messageID,
          type: "text",
          text: sessionHook.context,
          synthetic: true,
        })
      }
    }

    await Plugin.trigger("session.start", { sessionID: result.id }, {})

    const { IsolationArtifactRegistry } = await import("@/isolation/registry")
    IsolationArtifactRegistry.cleanupStaleIsolationArtifacts().catch((e) => {
      log.warn("failed to clean up stale isolation artifacts", { error: e })
    })

    return result
  }

  export function plan(input: { slug: string; time: { created: number } }) {
    const rootDir = Instance.project.vcs ? Instance.worktree : Instance.directory
    const base = path.join(rootDir, Brand.dir, "plans")
    return path.join(base, `${[input.time.created, input.slug].join("-")}.md`)
  }

  export const get = fn(SessionID.zod, async (id) => {
    const row = Database.use((db) => db.select().from(SessionTable).where(eq(SessionTable.id, id)).get())
    if (!row) throw new NotFoundError({ message: `Session not found: ${id}` })
    return fromRow(row)
  })

  export const share = fn(SessionID.zod, async (id) => {
    const cfg = await Config.get()
    if (cfg.share === "disabled") {
      throw new Error("Sharing is disabled in configuration")
    }
    const { ShareNext } = await import("@/share/share-next")
    const share = await ShareNext.create(id)
    Database.use((db) => {
      const row = db.update(SessionTable).set({ share_url: share.url }).where(eq(SessionTable.id, id)).returning().get()
      if (!row) throw new NotFoundError({ message: `Session not found: ${id}` })
      const info = fromRow(row)
      Database.effect(() => Bus.publish(Event.Updated, { info }))
    })
    return share
  })

  export const unshare = fn(SessionID.zod, async (id) => {
    // Use ShareNext to remove the share (same as share function uses ShareNext to create)
    const { ShareNext } = await import("@/share/share-next")
    await ShareNext.remove(id)
    Database.use((db) => {
      const row = db.update(SessionTable).set({ share_url: null }).where(eq(SessionTable.id, id)).returning().get()
      if (!row) throw new NotFoundError({ message: `Session not found: ${id}` })
      const info = fromRow(row)
      Database.effect(() => Bus.publish(Event.Updated, { info }))
    })
  })

  export const setTitle = fn(
    z.object({
      sessionID: SessionID.zod,
      title: z.string(),
    }),
    async (input) => {
      return Database.use((db) => {
        const row = db
          .update(SessionTable)
          .set({ title: input.title })
          .where(eq(SessionTable.id, input.sessionID))
          .returning()
          .get()
        if (!row) throw new NotFoundError({ message: `Session not found: ${input.sessionID}` })
        const info = fromRow(row)
        Database.effect(() => Bus.publish(Event.Updated, { info }))
        return info
      })
    },
  )

  export const setArchived = fn(
    z.object({
      sessionID: SessionID.zod,
      time: z.number().optional(),
    }),
    async (input) => {
      return Database.use((db) => {
        const row = db
          .update(SessionTable)
          .set({ time_archived: input.time })
          .where(eq(SessionTable.id, input.sessionID))
          .returning()
          .get()
        if (!row) throw new NotFoundError({ message: `Session not found: ${input.sessionID}` })
        const info = fromRow(row)
        Database.effect(() => Bus.publish(Event.Updated, { info }))
        return info
      })
    },
  )

  export const setPermission = fn(
    z.object({
      sessionID: SessionID.zod,
      permission: PermissionNext.Ruleset,
    }),
    async (input) => {
      return Database.use((db) => {
        const row = db
          .update(SessionTable)
          .set({ permission: input.permission, time_updated: Date.now() })
          .where(eq(SessionTable.id, input.sessionID))
          .returning()
          .get()
        if (!row) throw new NotFoundError({ message: `Session not found: ${input.sessionID}` })
        const info = fromRow(row)
        Database.effect(() => Bus.publish(Event.Updated, { info }))
        return info
      })
    },
  )

  export const setConfig = fn(
    z.object({
      sessionID: SessionID.zod,
      sessionMode: Info.shape.sessionMode.optional(),
      toolProfile: Info.shape.toolProfile.optional(),
      forkEnabled: Info.shape.forkEnabled.optional(),
    }),
    async (input) => {
      return Database.use((db) => {
        const updates: Record<string, unknown> = { time_updated: Date.now() }
        if (input.sessionMode !== undefined) updates.session_mode = input.sessionMode
        if (input.toolProfile !== undefined) updates.tool_profile = input.toolProfile
        if (input.forkEnabled !== undefined) updates.fork_enabled = input.forkEnabled ? 1 : 0

        const row = db.update(SessionTable).set(updates).where(eq(SessionTable.id, input.sessionID)).returning().get()
        if (!row) throw new NotFoundError({ message: `Session not found: ${input.sessionID}` })
        const info = fromRow(row)
        Database.effect(() => Bus.publish(Event.Updated, { info }))
        return info
      })
    },
  )

  export const setRevert = fn(
    z.object({
      sessionID: SessionID.zod,
      revert: Info.shape.revert,
      summary: Info.shape.summary,
    }),
    async (input) => {
      return Database.use((db) => {
        const row = db
          .update(SessionTable)
          .set({
            revert: input.revert ?? null,
            summary_additions: input.summary?.additions,
            summary_deletions: input.summary?.deletions,
            summary_files: input.summary?.files,
            time_updated: Date.now(),
          })
          .where(eq(SessionTable.id, input.sessionID))
          .returning()
          .get()
        if (!row) throw new NotFoundError({ message: `Session not found: ${input.sessionID}` })
        const info = fromRow(row)
        Database.effect(() => Bus.publish(Event.Updated, { info }))
        return info
      })
    },
  )

  export const clearRevert = fn(SessionID.zod, async (sessionID) => {
    return Database.use((db) => {
      const row = db
        .update(SessionTable)
        .set({
          revert: null,
          time_updated: Date.now(),
        })
        .where(eq(SessionTable.id, sessionID))
        .returning()
        .get()
      if (!row) throw new NotFoundError({ message: `Session not found: ${sessionID}` })
      const info = fromRow(row)
      Database.effect(() => Bus.publish(Event.Updated, { info }))
      return info
    })
  })

  export const setSummary = fn(
    z.object({
      sessionID: SessionID.zod,
      summary: Info.shape.summary,
    }),
    async (input) => {
      return Database.use((db) => {
        const row = db
          .update(SessionTable)
          .set({
            summary_additions: input.summary?.additions,
            summary_deletions: input.summary?.deletions,
            summary_files: input.summary?.files,
            time_updated: Date.now(),
          })
          .where(eq(SessionTable.id, input.sessionID))
          .returning()
          .get()
        if (!row) throw new NotFoundError({ message: `Session not found: ${input.sessionID}` })
        const info = fromRow(row)
        Database.effect(() => Bus.publish(Event.Updated, { info }))
        return info
      })
    },
  )

  export const diff = fn(SessionID.zod, async (sessionID) => {
    try {
      return await Storage.read<Snapshot.FileDiff[]>(["session_diff", sessionID])
    } catch (e) {
      log.debug("session diff not found, returning empty", { sessionID, error: e })
      return []
    }
  })

  export const messages = fn(
    z.object({
      sessionID: SessionID.zod,
      limit: z.number().optional(),
    }),
    async (input) => {
      const result = [] as Message.WithParts[]
      for await (const msg of Message.stream(input.sessionID)) {
        if (input.limit && result.length >= input.limit) break
        result.push(msg)
      }
      result.reverse()
      return result
    },
  )

  export const history = fn(
    z.object({
      limit: z.number().optional().default(500),
    }),
    async (input) => {
      const projectID = Instance.project.id
      const rows = Database.use((db) =>
        db
          .select({
            sessionID: SessionTable.id,
            timeCreated: MessageTable.time_created,
            partData: PartTable.data,
          })
          .from(MessageTable)
          .innerJoin(SessionTable, eq(SessionTable.id, MessageTable.session_id))
          .innerJoin(PartTable, eq(PartTable.message_id, MessageTable.id))
          .where(
            and(
              eq(SessionTable.project_id, projectID),
              sql`json_extract(${MessageTable.data}, '$.role') = 'user'`,
              sql`json_extract(${PartTable.data}, '$.type') = 'text'`,
            ),
          )
          .orderBy(desc(MessageTable.time_created))
          .limit(input.limit)
          .all(),
      )

      const result: Array<{ display: string; sessionID: string; timestamp: number }> = []
      const seen = new Set<string>()

      for (const row of rows) {
        // PartData is a discriminated union — the SQL WHERE clause already
        // filters to type='text' parts, but TypeScript can't narrow from SQL.
        const partData = row.partData as { type: string; text?: string }
        const text = partData.text
        if (typeof text === "string" && text.trim().length > 0) {
          const display = text.trim()
          if (!seen.has(display)) {
            seen.add(display)
            result.push({
              display,
              sessionID: row.sessionID,
              timestamp: row.timeCreated,
            })
          }
        }
      }

      return result
    },
  )

  export function* list(input?: {
    directory?: string
    workspaceID?: WorkspaceID
    roots?: boolean
    start?: number
    search?: string
    limit?: number
    archived?: boolean
  }) {
    const project = Instance.project
    const conditions = [eq(SessionTable.project_id, project.id)]

    if (WorkspaceContext.workspaceID) {
      conditions.push(eq(SessionTable.workspace_id, WorkspaceContext.workspaceID))
    }
    if (input?.directory) {
      conditions.push(eq(SessionTable.directory, input.directory))
    }
    if (input?.roots) {
      conditions.push(isNull(SessionTable.parent_id))
    }
    if (input?.start) {
      conditions.push(gte(SessionTable.time_updated, input.start))
    }
    if (input?.search) {
      conditions.push(like(SessionTable.title, `%${input.search}%`))
    }
    if (!input?.archived) {
      conditions.push(isNull(SessionTable.time_archived))
    } else {
      conditions.push(isNotNull(SessionTable.time_archived))
    }

    const limit = input?.limit ?? 100

    const rows = Database.use((db) =>
      db
        .select()
        .from(SessionTable)
        .where(and(...conditions))
        .orderBy(desc(SessionTable.time_updated))
        .limit(limit)
        .all(),
    )
    for (const row of rows) {
      yield fromRow(row)
    }
  }

  export const children = fn(SessionID.zod, async (parentID) => {
    const project = Instance.project
    const rows = Database.use((db) =>
      db
        .select()
        .from(SessionTable)
        .where(and(eq(SessionTable.project_id, project.id), eq(SessionTable.parent_id, parentID)))
        .all(),
    )
    return rows.map(fromRow)
  })

  export const remove = fn(SessionID.zod, async (sessionID) => {
    const _project = Instance.project
    try {
      const session = await get(sessionID)
      for (const child of await children(sessionID)) {
        await remove(child.id)
      }
      await unshare(sessionID).catch((e) => log.debug("unshare failed during remove", { sessionID, error: e }))
      // CASCADE delete handles messages and parts automatically
      Database.use((db) => {
        db.delete(SessionTable).where(eq(SessionTable.id, sessionID)).run()
        Database.effect(() =>
          Bus.publish(Event.Deleted, {
            info: session,
          }),
        )
      })
      sessionAgentCounts.delete(sessionID)
    } catch (e) {
      log.error("remove", { error: e })
    }
  })

  export const updateMessage = fn(Message.Info, async (msg) => {
    const time_created = msg.time.created
    const { id, sessionID, ...data } = msg
    Database.use((db) => {
      db.insert(MessageTable)
        .values({
          id,
          session_id: sessionID,
          time_created,
          data,
        })
        .onConflictDoUpdate({ target: MessageTable.id, set: { data } })
        .run()
      Database.effect(() =>
        Bus.publish(Message.Event.Updated, {
          info: msg,
        }),
      )
    })
    return msg
  })

  export const removeMessage = fn(
    z.object({
      sessionID: SessionID.zod,
      messageID: MessageID.zod,
    }),
    async (input) => {
      // CASCADE delete handles parts automatically
      Database.use((db) => {
        db.delete(MessageTable)
          .where(and(eq(MessageTable.id, input.messageID), eq(MessageTable.session_id, input.sessionID)))
          .run()
        Database.effect(() =>
          Bus.publish(Message.Event.Removed, {
            sessionID: input.sessionID,
            messageID: input.messageID,
          }),
        )
      })
      return input.messageID
    },
  )

  export const removePart = fn(
    z.object({
      sessionID: SessionID.zod,
      messageID: MessageID.zod,
      partID: PartID.zod,
    }),
    async (input) => {
      Database.use((db) => {
        db.delete(PartTable)
          .where(and(eq(PartTable.id, input.partID), eq(PartTable.session_id, input.sessionID)))
          .run()
        Database.effect(() =>
          Bus.publish(Message.Event.PartRemoved, {
            sessionID: input.sessionID,
            messageID: input.messageID,
            partID: input.partID,
          }),
        )
      })
      return input.partID
    },
  )

  const UpdatePartInput = Message.Part

  export const updatePart = fn(UpdatePartInput, async (part) => {
    const { id, messageID, sessionID, ...data } = part
    const time = Date.now()
    Database.use((db) => {
      db.insert(PartTable)
        .values({
          id,
          message_id: messageID,
          session_id: sessionID,
          time_created: time,
          data,
        })
        .onConflictDoUpdate({ target: PartTable.id, set: { data } })
        .run()
      Database.effect(() =>
        Bus.publish(Message.Event.PartUpdated, {
          part: structuredClone(part),
        }),
      )
    })
    return part
  })

  export const updatePartDelta = fn(
    z.object({
      sessionID: SessionID.zod,
      messageID: MessageID.zod,
      partID: PartID.zod,
      field: z.string(),
      delta: z.string(),
    }),
    async (input) => {
      Bus.publish(Message.Event.PartDelta, input)
    },
  )

  export const getUsage = fn(
    z.object({
      model: z.custom<Provider.Model>(),
      usage: z.custom<LanguageModelV2Usage>(),
      metadata: z.custom<ProviderMetadata>().optional(),
    }),
    (input) => {
      const safe = (value: number) => {
        if (!Number.isFinite(value)) return 0
        return value
      }
      const inputTokens = safe(input.usage.inputTokens ?? 0)
      const outputTokens = safe(input.usage.outputTokens ?? 0)
      const reasoningTokens = safe(input.usage.reasoningTokens ?? 0)

      const cacheReadInputTokens = safe(input.usage.cachedInputTokens ?? 0)
      const cacheWriteInputTokens = safe(
        (input.metadata?.anthropic?.cacheCreationInputTokens ??
          // @ts-expect-error
          input.metadata?.bedrock?.usage?.cacheWriteInputTokens ??
          // @ts-expect-error
          input.metadata?.venice?.usage?.cacheCreationInputTokens ??
          0) as number,
      )

      // OpenRouter provides inputTokens as the total count of input tokens (including cached).
      // AFAIK other providers (OpenRouter/OpenAI/Gemini etc.) do it the same way e.g. vercel/ai#8794 (comment)
      // Anthropic does it differently though - inputTokens doesn't include cached tokens.
      // It looks like LiteAI's cost calculation assumes all providers return inputTokens the same way Anthropic does (I'm guessing getUsage logic was originally implemented with anthropic), so it's causing incorrect cost calculation for OpenRouter and others.
      const excludesCachedTokens = !!(input.metadata?.anthropic || input.metadata?.bedrock)
      const adjustedInputTokens = safe(
        excludesCachedTokens ? inputTokens : inputTokens - cacheReadInputTokens - cacheWriteInputTokens,
      )

      const total = iife(() => {
        // Anthropic doesn't provide total_tokens, also ai sdk will vastly undercount if we
        // don't compute from components
        if (
          input.model.api.npm === "@ai-sdk/anthropic" ||
          input.model.api.npm === "@ai-sdk/amazon-bedrock" ||
          input.model.api.npm === "@ai-sdk/google-vertex/anthropic"
        ) {
          return adjustedInputTokens + outputTokens + cacheReadInputTokens + cacheWriteInputTokens
        }
        return input.usage.totalTokens
      })

      const tokens = {
        total,
        input: adjustedInputTokens,
        output: outputTokens,
        reasoning: reasoningTokens,
        cache: {
          write: cacheWriteInputTokens,
          read: cacheReadInputTokens,
        },
      }

      const costInfo =
        input.model.cost?.experimentalOver200K && tokens.input + tokens.cache.read > 200_000
          ? input.model.cost.experimentalOver200K
          : input.model.cost
      return {
        cost: safe(
          new Decimal(0)
            .add(new Decimal(tokens.input).mul(costInfo?.input ?? 0).div(1_000_000))
            .add(new Decimal(tokens.output).mul(costInfo?.output ?? 0).div(1_000_000))
            .add(new Decimal(tokens.cache.read).mul(costInfo?.cache?.read ?? 0).div(1_000_000))
            .add(new Decimal(tokens.cache.write).mul(costInfo?.cache?.write ?? 0).div(1_000_000))
            // TODO: update models.dev to have better pricing model, for now:
            // charge reasoning tokens at the same rate as output tokens
            .add(new Decimal(tokens.reasoning).mul(costInfo?.output ?? 0).div(1_000_000))
            .toNumber(),
        ),
        tokens,
      }
    },
  )

  export class BusyError extends Error {
    constructor(public readonly sessionID: string) {
      super(`Session ${sessionID} is busy`)
    }
  }

  export const initialize = fn(
    z.object({
      sessionID: SessionID.zod,
      modelID: ModelID.zod,
      providerID: ProviderID.zod,
      messageID: MessageID.zod,
    }),
    async (input) => {
      await SessionPrompt.command({
        sessionID: input.sessionID,
        messageID: input.messageID,
        model: `${input.providerID}/${input.modelID}`,
        command: Command.Default.INIT,
        arguments: "",
      })
    },
  )
}
export * from "./engine/persister"
export * from "./events"
export * from "./retry"
export * from "./schema"
export * from "./status"
