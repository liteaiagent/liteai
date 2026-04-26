import { Log } from "@liteai/util/log"
import { Config } from "@/config/config"
import { type Handler, Schema } from "./hook"

const log = Log.create({ service: "hook:loader" })

export namespace HookLoader {
  /** Load hooks from merged config + registry-installed plugins. */
  export async function load(): Promise<Schema> {
    const cfg = await Config.get()
    if (cfg.disableAllHooks) return {}
    const merged: Schema = { ...((cfg.hooks as Schema) ?? {}) }
    const events = Object.keys(merged)
    if (events.length) {
      log.info("loaded hooks from config", { events, groups: events.map((e) => merged[e].length) })
    }

    return merged
  }

  /** Load hooks for a specific agent (from agent frontmatter). */
  export async function agentHooks(agent: string): Promise<Schema> {
    const cfg = await Config.get()
    const entry = cfg.agent?.[agent]
    if (!entry?.hooks) return {}
    // Agent hooks field is z.record(z.string(), z.any()) — parse it as our Schema
    const parsed = Schema.safeParse(entry.hooks)
    if (!parsed.success) return {}
    const events = Object.keys(parsed.data)
    if (events.length) {
      log.info("loaded hooks from agent", { agent, events })
    }
    return parsed.data
  }

  /**
   * Get all configured hooks grouped by event and source for the /hooks command.
   */
  export async function list(): Promise<
    {
      event: string
      source: string
      matcher?: string
      handlers: Handler[]
    }[]
  > {
    const result: { event: string; source: string; matcher?: string; handlers: Handler[] }[] = []
    const cfg = await Config.get()

    // Config hooks
    const hooks = (cfg.hooks as Schema) ?? {}
    for (const [event, groups] of Object.entries(hooks)) {
      for (const group of groups) {
        result.push({
          event,
          source: "config",
          matcher: group.matcher,
          handlers: group.hooks,
        })
      }
    }

    // Agent hooks
    for (const [name, agent] of Object.entries(cfg.agent ?? {})) {
      if (!agent.hooks) continue
      const parsed = Schema.safeParse(agent.hooks)
      if (!parsed.success) continue
      for (const [event, groups] of Object.entries(parsed.data)) {
        for (const group of groups) {
          result.push({
            event,
            source: `agent:${name}`,
            matcher: group.matcher,
            handlers: group.hooks,
          })
        }
      }
    }

    return result
  }
}
