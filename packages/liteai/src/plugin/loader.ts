/**
 * Plugin loader.
 *
 * Purely convention-based — no manifest required.
 * Plugin name is derived from the directory basename.
 * Components are discovered from fixed conventional folders:
 *   commands/*.md, agents/*.md, skills/**\/SKILL.md, hooks/hooks.json, .mcp.json
 */

import path from "node:path"
import z from "zod"
import { Config } from "@/config/config"
import { ConfigMarkdown } from "@/config/markdown"
import type { Schema as HookSchema } from "@/hook/hook"
import { Skill } from "@/skill"
import { Filesystem } from "@/util/filesystem"
import { Glob } from "@/util/glob"
import { Log } from "@/util/log"
import { expandDeep } from "./env"

const log = Log.create({ service: "plugin:loader" })

/** The result of loading a plugin directory. */
export const Loaded = z.object({
  name: z.string(),
  root: z.string(),
  commands: z.record(z.string(), z.custom<Config.Command>()),
  agents: z.record(z.string(), z.custom<Config.Agent>()),
  skills: z.array(z.custom<Skill.Info>()),
  hooks: z.custom<HookSchema>().optional(),
  mcp: z.record(z.string(), z.custom<Config.Mcp>()).optional(),
})
export type Loaded = z.infer<typeof Loaded>

/** Returns true if a directory basename looks like a version tag (e.g. "latest", "1.2.3"). */
function isVersion(s: string) {
  return s === "latest" || /^\d+\.\d+/.test(s)
}

/**
 * Load a plugin from a directory.
 * Returns `undefined` if the directory does not exist.
 * Plugin name = directory basename, unless the basename is a version tag, in
 * which case the parent directory name is used (registry cache layout:
 * …/cache/<marketplace>/<name>/<version>/).
 */
export async function load(root: string): Promise<Loaded | undefined> {
  const resolved = path.resolve(root)

  if (!(await Filesystem.isDir(resolved))) {
    log.warn("plugin directory not found", { root: resolved })
    return undefined
  }

  const base = path.basename(resolved)
  const name = isVersion(base) ? path.basename(path.dirname(resolved)) : base
  log.info("loading plugin", { name, root: resolved })

  const [commands, agents, skills, hooks, mcp] = await Promise.all([
    loadCommands(resolved, name),
    loadAgents(resolved, name),
    loadSkills(resolved, name),
    loadHooks(resolved, name),
    loadMcp(resolved, name),
  ])

  log.info("loaded plugin components", {
    name,
    commands: Object.keys(commands).length,
    agents: Object.keys(agents).length,
    skills: skills.length,
    hooks: hooks ? Object.keys(hooks).length : 0,
    mcp: mcp ? Object.keys(mcp).length : 0,
  })

  return { name, root: resolved, commands, agents, skills, hooks, mcp }
}

/** Prefix a component name with the plugin namespace. */
function ns(plugin: string, name: string) {
  return `${plugin}:${name}`
}

/** Strip extension from a filename. */
function trim(file: string) {
  const ext = path.extname(file)
  return ext.length ? file.slice(0, -ext.length) : file
}

// -------------------------------------------------------------------
// Commands
// -------------------------------------------------------------------

async function loadCommands(root: string, plugin: string) {
  const result: Record<string, Config.Command> = {}

  const matches = await Glob.scan("commands/*.md", { cwd: root, absolute: true, dot: true, symlink: true })
  for (const match of matches) {
    const md = await ConfigMarkdown.parse(match).catch((err) => {
      log.error("failed to parse plugin command", { plugin, path: match, err })
      return undefined
    })
    if (!md) continue

    const base = trim(path.basename(match))
    const name = ns(plugin, base)
    const config = { name, ...md.data, template: md.content.trim() }
    const parsed = Config.Command.safeParse(config)
    if (parsed.success) {
      log.info("loaded plugin command", { plugin, name, path: match })
      result[name] = parsed.data
    } else log.warn("invalid plugin command", { plugin, path: match, issues: parsed.error.issues })
  }

  return result
}

// -------------------------------------------------------------------
// Agents
// -------------------------------------------------------------------

async function loadAgents(root: string, plugin: string) {
  const result: Record<string, Config.Agent> = {}

  const matches = await Glob.scan("agents/*.md", { cwd: root, absolute: true, dot: true, symlink: true })
  for (const match of matches) {
    const md = await ConfigMarkdown.parse(match).catch((err) => {
      log.error("failed to parse plugin agent", { plugin, path: match, err })
      return undefined
    })
    if (!md) continue

    const base = trim(path.basename(match))
    const name = ns(plugin, base)
    const config = { name, ...md.data, prompt: md.content.trim() }
    const parsed = Config.Agent.safeParse(config)
    if (parsed.success) {
      log.info("loaded plugin agent", { plugin, name, path: match })
      result[name] = parsed.data
    } else log.warn("invalid plugin agent", { plugin, path: match, issues: parsed.error.issues })
  }

  return result
}

// -------------------------------------------------------------------
// Skills
// -------------------------------------------------------------------

async function loadSkills(root: string, plugin: string) {
  const result: Skill.Info[] = []

  const matches = await Glob.scan("skills/**/SKILL.md", {
    cwd: root,
    absolute: true,
    include: "file",
    dot: true,
    symlink: true,
  })
  for (const match of matches) {
    const md = await ConfigMarkdown.parse(match).catch((err) => {
      log.error("failed to parse plugin skill", { plugin, path: match, err })
      return undefined
    })
    if (!md) continue

    const parsed = Skill.Info.pick({
      name: true,
      description: true,
      argument_hint: true,
      disable_model_invocation: true,
      user_invocable: true,
      allowed_tools: true,
      model: true,
      context: true,
      agent: true,
      hooks: true,
    }).safeParse({
      ...md.data,
      argument_hint: md.data["argument-hint"] ?? md.data.argument_hint,
      disable_model_invocation: md.data["disable-model-invocation"] ?? md.data.disable_model_invocation,
      user_invocable: md.data["user-invocable"] ?? md.data.user_invocable,
      allowed_tools: md.data["allowed-tools"] ?? md.data.allowed_tools,
    })
    if (!parsed.success) {
      log.warn("invalid plugin skill", { plugin, path: match, issues: parsed.error.issues })
      continue
    }

    result.push({
      ...parsed.data,
      name: ns(plugin, parsed.data.name),
      location: match,
      content: md.content,
    })
  }

  return result
}

// -------------------------------------------------------------------
// Hooks
// -------------------------------------------------------------------

async function loadHooks(root: string, plugin: string): Promise<HookSchema | undefined> {
  const matches = await Glob.scan("hooks/hooks.json", { cwd: root, absolute: true, dot: true, symlink: true })
  for (const match of matches) {
    try {
      const raw = await Filesystem.readJson(match)
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue
      const obj = raw as Record<string, unknown>
      // Claude Code plugins wrap hooks: { description?, hooks: { EventName: [...] } }
      // Fall back to treating the whole object as the schema.
      const schema =
        obj.hooks && typeof obj.hooks === "object" && !Array.isArray(obj.hooks)
          ? obj.hooks
          : obj
      
      const expanded = expandDeep(schema, root, plugin)
      return expanded as HookSchema
    } catch (err) {
      log.warn("failed to read plugin hooks", { path: match, err })
    }
  }
  return undefined
}

// -------------------------------------------------------------------
// MCP servers
// -------------------------------------------------------------------

async function loadMcp(root: string, plugin: string): Promise<Record<string, Config.Mcp> | undefined> {
  const file = path.join(root, ".mcp.json")
  if (!(await Filesystem.exists(file))) return undefined

  try {
    const raw = await Filesystem.readJson<Record<string, unknown>>(file)
    const servers = (raw as { mcpServers?: Record<string, unknown> }).mcpServers ?? raw
    if (typeof servers !== "object" || Array.isArray(servers)) return undefined

    const result: Record<string, Config.Mcp> = {}
    for (const [key, entry] of Object.entries(servers as Record<string, unknown>)) {
      if (key === "mcpServers") continue
      const expanded = expandDeep(entry, root, plugin)
      const adapted = adaptMcp(key, expanded as Record<string, unknown>)
      if (adapted) result[ns(plugin, key)] = adapted
    }
    return Object.keys(result).length ? result : undefined
  } catch (err) {
    log.warn("failed to read plugin .mcp.json", { path: file, err })
    return undefined
  }
}

function adaptMcp(name: string, entry: Record<string, unknown>): Config.Mcp | undefined {
  if (entry.type === "http" || entry.type === "sse" || entry.url) {
    if (!entry.url || typeof entry.url !== "string") return undefined
    const result: Record<string, unknown> = { type: "remote", url: entry.url }
    if (entry.headers) result.headers = entry.headers
    if (entry.enabled !== undefined) result.enabled = entry.enabled
    if (entry.timeout !== undefined) result.timeout = entry.timeout
    return result as Config.Mcp
  }

  if (entry.command && typeof entry.command === "string") {
    const result: Record<string, unknown> = {
      type: "local",
      command: [entry.command, ...((entry.args as string[]) ?? [])],
    }
    if (entry.env) result.environment = entry.env
    if (entry.enabled !== undefined) result.enabled = entry.enabled
    if (entry.timeout !== undefined) result.timeout = entry.timeout
    return result as Config.Mcp
  }

  if (entry.type === "local" && Array.isArray(entry.command)) {
    const parsed = Config.McpLocal.safeParse(entry)
    if (parsed.success) return parsed.data
  }

  if (entry.type === "remote" && entry.url) {
    const parsed = Config.McpRemote.safeParse(entry)
    if (parsed.success) return parsed.data
  }

  log.warn("plugin mcp entry missing command or url", { name })
  return undefined
}
