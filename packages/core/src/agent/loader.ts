import path from "node:path"
import { NamedError } from "@liteai/util/error"
import { Glob } from "@liteai/util/glob"
import { Log } from "@liteai/util/log"
import type z from "zod"
import { Brand } from "@/brand"
import { Bus } from "@/bus"
import { ConfigMarkdown } from "@/config/markdown"
import { Agent } from "@/config/schema"
import { Flag } from "@/flag/flag"
import { Global } from "@/global"
import { MCP } from "@/mcp"
import * as Platform from "@/platform"
import { Instance } from "@/project/instance"
import { Session } from "@/session"
import { Filesystem } from "@/util/filesystem"
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

  export async function parseAgentFromMarkdown(
    item: string,
    source: "custom" | "plugin",
  ): Promise<
    [string, z.infer<typeof Agent> & { source: "custom" | "plugin"; filePath?: string; pluginId?: string }] | undefined
  > {
    log.info("parsing agent", { path: item })
    const md = await ConfigMarkdown.parse(item).catch((err) => {
      const message = ConfigMarkdown.FrontmatterError.isInstance(err)
        ? err.data.message
        : `Failed to parse agent ${item}`
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
    if (parsed.success) {
      if (parsed.data.requiredMcpServers && parsed.data.requiredMcpServers.length > 0) {
        const mcpData = await (async () => {
          try {
            const status = await MCP.status()
            const tools = await MCP.tools()
            return { status, tools }
          } catch (err) {
            log.error("failed to query MCP status/tools in parseAgentFromMarkdown, skipping agent", {
              agent: config.name,
              err,
            })
            return null
          }
        })()

        if (!mcpData) return undefined
        const { status: mcpStatus, tools: mcpTools } = mcpData

        for (const reqServer of parsed.data.requiredMcpServers) {
          const status = mcpStatus[reqServer]
          if (status?.status !== "connected") {
            log.info("excluding agent due to disconnected required MCP server", {
              agent: config.name,
              server: reqServer,
            })
            return undefined
          }

          const sanitizedReqServer = reqServer.replace(/[^a-zA-Z0-9_-]/g, "_")
          const hasTools = Object.keys(mcpTools).some((k) => k.startsWith(`${sanitizedReqServer}_`))
          if (!hasTools) {
            log.info("excluding agent due to required MCP server having no tools", {
              agent: config.name,
              server: reqServer,
            })
            return undefined
          }
        }
      }
      return [
        config.name,
        { ...parsed.data, source, filePath: item, pluginId: source === "plugin" ? item : undefined },
      ] as [string, z.infer<typeof Agent> & { source: "custom" | "plugin"; filePath?: string; pluginId?: string }]
    }
    log.error("invalid agent config, skipping", { path: item, issues: parsed.error.issues })
    Bus.publish(Session.Event.Error, {
      error: new NamedError.Unknown({
        message: `Invalid agent config ${item}: ${parsed.error.issues.map((i) => i.message).join(", ")}`,
      }).toObject(),
    })
    return undefined
  }

  export async function loadAgent(
    dir: string,
  ): Promise<
    Record<string, z.infer<typeof Agent> & { source: "custom" | "plugin"; filePath?: string; pluginId?: string }>
  > {
    const result: Record<
      string,
      z.infer<typeof Agent> & { source: "custom" | "plugin"; filePath?: string; pluginId?: string }
    > = {}
    for (const item of await Glob.scan("agents/**/*.md", {
      cwd: dir,
      absolute: true,
      dot: true,
      symlink: true,
    })) {
      const entry = await parseAgentFromMarkdown(item, "custom")
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
  ): Promise<
    Record<string, z.infer<typeof Agent> & { source: "custom" | "plugin"; filePath?: string; pluginId?: string }>
  > {
    log.info("scanning for platform agents", { scope, dir: root })
    const result: Record<
      string,
      z.infer<typeof Agent> & { source: "custom" | "plugin"; filePath?: string; pluginId?: string }
    > = {}
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
      const entry = await parseAgentFromMarkdown(item, "plugin")
      if (entry) {
        log.info("loaded platform agent", { scope, name: entry[0], path: item })
        result[entry[0]] = entry[1]
      }
    }
    return result
  }

  type AgentRecord = Record<
    string,
    z.infer<typeof Agent> & { source: "custom" | "plugin"; filePath?: string; pluginId?: string }
  >

  /**
   * Per-platform-id cache for global platform agents.
   * Keyed by the active platform ID (or `"__none__"` when no platform is active)
   * so that parallel async contexts using different platform overrides each get
   * their own cached result without cross-contamination.
   */
  const globalPlatformAgentsByPlatform = new Map<string, Promise<AgentRecord>>()

  function globalPlatformAgents(): Promise<AgentRecord> {
    if (Flag.LITEAI_DISABLE_AGENTS) return Promise.resolve({})
    const platformId = Platform.active()?.id ?? "__none__"
    const existing = globalPlatformAgentsByPlatform.get(platformId)
    if (existing) return existing

    const promise = (async (): Promise<AgentRecord> => {
      const result: AgentRecord = {}
      for (const dir of Platform.dirs()) {
        const root = path.join(Global.Path.home, dir)
        if (!(await Filesystem.isDir(root))) continue
        Object.assign(result, await scanAgents(root, "global"))
      }
      return result
    })()

    globalPlatformAgentsByPlatform.set(platformId, promise)
    return promise
  }

  export async function loadPlatformAgents(): Promise<AgentRecord> {
    if (Flag.LITEAI_DISABLE_AGENTS) return {}
    const result: AgentRecord = {
      ...(await globalPlatformAgents()),
    }

    for await (const root of Filesystem.up({
      targets: Platform.dirs(),
      start: Instance.directory,
      stop: Instance.worktree,
    })) {
      Object.assign(result, await scanAgents(root, "project"))
    }

    return result
  }

  export function resetCache() {
    globalPlatformAgentsByPlatform.clear()
  }
}
