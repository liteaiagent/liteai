import path from "node:path"
import { NamedError } from "@liteai/util/error"
import type z from "zod"
import { Brand } from "@/brand"
import { Bus } from "@/bus"
import { ConfigMarkdown } from "@/config/markdown"
import { Agent } from "@/config/schema"
import { Flag } from "@/flag/flag"
import { Global } from "@/global"
import * as Platform from "@/platform"
import { Instance } from "@/project/instance"
import { Filesystem } from "@/util/filesystem"
import { Glob } from "@/util/glob"
import { lazy } from "@/util/lazy"
import { Log } from "@/util/log"

export namespace AgentLoader {
  const log = Log.create({ service: "agent:loader" })

  const EXTERNAL_AGENT_PATTERN = "agents/*.md"

  function rel(item: string, patterns: string[]) {
    const normalizedItem = item.replaceAll("\\", "/")
    for (const pattern of patterns) {
      const index = normalizedItem.indexOf(pattern)
      if (index === -1) continue
      return normalizedItem.slice(index + pattern.length)
    }
  }

  function trim(file: string) {
    const ext = path.extname(file)
    return ext.length ? file.slice(0, -ext.length) : file
  }

  export async function parseAgent(item: string): Promise<[string, z.infer<typeof Agent>] | undefined> {
    log.info("parsing agent", { path: item })
    const md = await ConfigMarkdown.parse(item).catch(async (err) => {
      const message = ConfigMarkdown.FrontmatterError.isInstance(err)
        ? err.data.message
        : `Failed to parse agent ${item}`
      const { Session } = await import("@/session")
      Bus.publish(Session.Event.Error, { error: new NamedError.Unknown({ message }).toObject() })
      log.error("failed to load agent", { agent: item, err })
      return undefined
    })
    if (!md) return undefined

    const patterns = [`/${Brand.dir}/agents/`, "/agents/"]
    const name = trim(rel(item, patterns) ?? path.basename(item))

    const config = {
      name,
      ...md.data,
      prompt: md.content.trim(),
    }
    const parsed = Agent.safeParse(config)
    if (parsed.success) return [config.name, parsed.data]
    log.error("invalid agent config, skipping", { path: item, issues: parsed.error.issues })
    const { Session } = await import("@/session")
    Bus.publish(Session.Event.Error, {
      error: new NamedError.Unknown({
        message: `Invalid agent config ${item}: ${parsed.error.issues.map((i) => i.message).join(", ")}`,
      }).toObject(),
    })
    return undefined
  }

  export async function loadAgent(dir: string): Promise<Record<string, z.infer<typeof Agent>>> {
    const result: Record<string, z.infer<typeof Agent>> = {}
    for (const item of await Glob.scan("agents/**/*.md", {
      cwd: dir,
      absolute: true,
      dot: true,
      symlink: true,
    })) {
      const entry = await parseAgent(item)
      if (entry) {
        log.info("loaded agent", { name: entry[0], path: item })
        result[entry[0]] = entry[1]
      }
    }
    return result
  }

  export async function scanAgents(
    root: string,
    scope: "global" | "project",
  ): Promise<Record<string, z.infer<typeof Agent>>> {
    log.info("scanning for external agents", { scope, dir: root })
    const result: Record<string, z.infer<typeof Agent>> = {}
    const items = await Glob.scan(EXTERNAL_AGENT_PATTERN, {
      cwd: root,
      absolute: true,
      include: "file",
      dot: true,
      symlink: true,
    }).catch((error) => {
      log.error(`failed to scan ${scope} agents`, { dir: root, error })
      return [] as string[]
    })
    for (const item of items) {
      const entry = await parseAgent(item)
      if (entry) {
        log.info("loaded external agent", { scope, name: entry[0], path: item })
        result[entry[0]] = entry[1]
      }
    }
    return result
  }

  // Module-level cache: global external agents don't change per instance
  const globalExternalAgentsCache = lazy(async () => {
    if (Flag.LITEAI_DISABLE_AGENTS) return {}
    const result: Record<string, z.infer<typeof Agent>> = {}
    for (const dir of Platform.externalDirs()) {
      const root = path.join(Global.Path.home, dir)
      if (!(await Filesystem.isDir(root))) continue
      Object.assign(result, await scanAgents(root, "global"))
    }
    return result
  })

  export async function loadExternalAgents(): Promise<Record<string, z.infer<typeof Agent>>> {
    if (Flag.LITEAI_DISABLE_AGENTS) return {}
    const result: Record<string, z.infer<typeof Agent>> = { ...(await globalExternalAgentsCache()) }

    for await (const root of Filesystem.up({
      targets: Platform.externalDirs(),
      start: Instance.directory,
      stop: Instance.worktree,
    })) {
      Object.assign(result, await scanAgents(root, "project"))
    }

    return result
  }

  export function resetCache() {
    globalExternalAgentsCache.reset()
  }
}
