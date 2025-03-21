/**
 * Plugin loader.
 *
 * Given a plugin root directory, resolves the manifest and scans for all
 * components (commands, agents, skills, hooks, MCP servers, LSP servers,
 * and settings).
 *
 * Each component type has a default path that can be overridden in the
 * plugin manifest.
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
import { type Manifest, parse } from "./manifest"

const log = Log.create({ service: "plugin:loader" })

/** The result of loading a plugin directory. */
export const Loaded = z.object({
  name: z.string(),
  root: z.string(),
  manifest: z.custom<Manifest>(),
  commands: z.record(z.string(), z.custom<Config.Command>()),
  agents: z.record(z.string(), z.custom<Config.Agent>()),
  skills: z.array(z.custom<Skill.Info>()),
  hooks: z.custom<HookSchema>().optional(),
  mcp: z.record(z.string(), z.custom<Config.Mcp>()).optional(),
  settings: z.custom<Config.Info>().optional(),
})
export type Loaded = z.infer<typeof Loaded>

/**
 * Load a plugin from a directory.
 * Returns `undefined` if the directory doesn't contain a valid plugin manifest.
 */
export async function load(root: string): Promise<Loaded | undefined> {
  const resolved = path.resolve(root)

  const result = await parse(resolved)
  if (!result) {
    log.warn("no valid plugin manifest found", { root: resolved })
    return undefined
  }

  const { manifest } = result
  const name = manifest.name

  log.info("loading plugin", { name, root: resolved })

  const [commands, agents, skills, hooks, mcp, settings] = await Promise.all([
    loadCommands(resolved, name, manifest),
    loadAgents(resolved, name, manifest),
    loadSkills(resolved, name, manifest),
    loadHooks(resolved, manifest),
    loadMcp(resolved, name, manifest),
    loadSettings(resolved, manifest),
  ])

  log.info("loaded plugin components", {
    name,
    commands: Object.keys(commands).length,
    agents: Object.keys(agents).length,
    skills: skills.length,
    hooks: hooks ? Object.keys(hooks).length : 0,
    mcp: mcp ? Object.keys(mcp).length : 0,
    settings: !!settings,
  })

  return {
    name,
    root: resolved,
    manifest,
    commands,
    agents,
    skills,
    hooks,
    mcp,
    settings,
  }
}

function resolvePaths(manifest: Manifest, key: keyof Manifest, defaults: string[]): string[] {
  const val = manifest[key]
  if (!val) return defaults
  if (typeof val === "string") return [val]
  if (Array.isArray(val)) return val as string[]
  return defaults
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

async function loadCommands(root: string, plugin: string, manifest: Manifest) {
  const patterns = resolvePaths(manifest, "commands", ["commands/*.md"])
  const result: Record<string, Config.Command> = {}

  for (const pattern of patterns) {
    const matches = await Glob.scan(pattern, { cwd: root, absolute: true, dot: true, symlink: true })
    for (const match of matches) {
      const md = await ConfigMarkdown.parse(match).catch((err) => {
        log.error("failed to parse plugin command", { plugin, path: match, err })
        return undefined
      })
      if (!md) continue

      const file = path.relative(root, match)
      const base = trim(path.basename(file))
      const name = ns(plugin, base)
      const config = { name, ...md.data, template: md.content.trim() }
      const parsed = Config.Command.safeParse(config)
      if (parsed.success) {
        log.info("loaded plugin command", { plugin, name, path: match })
        result[name] = parsed.data
      } else log.warn("invalid plugin command", { plugin, path: match, issues: parsed.error.issues })
    }
  }

  return result
}

// -------------------------------------------------------------------
// Agents
// -------------------------------------------------------------------

async function loadAgents(root: string, plugin: string, manifest: Manifest) {
  const patterns = resolvePaths(manifest, "agents", ["agents/*.md"])
  const result: Record<string, Config.Agent> = {}

  for (const pattern of patterns) {
    const matches = await Glob.scan(pattern, { cwd: root, absolute: true, dot: true, symlink: true })
    for (const match of matches) {
      const md = await ConfigMarkdown.parse(match).catch((err) => {
        log.error("failed to parse plugin agent", { plugin, path: match, err })
        return undefined
      })
      if (!md) continue

      const file = path.relative(root, match)
      const base = trim(path.basename(file))
      const name = ns(plugin, base)
      const config = { name, ...md.data, prompt: md.content.trim() }
      const parsed = Config.Agent.safeParse(config)
      if (parsed.success) {
        log.info("loaded plugin agent", { plugin, name, path: match })
        result[name] = parsed.data
      } else log.warn("invalid plugin agent", { plugin, path: match, issues: parsed.error.issues })
    }
  }

  return result
}

// -------------------------------------------------------------------
// Skills
// -------------------------------------------------------------------

async function loadSkills(root: string, plugin: string, manifest: Manifest) {
  const patterns = resolvePaths(manifest, "skills", ["skills/**/SKILL.md"])
  const result: Skill.Info[] = []

  for (const pattern of patterns) {
    const matches = await Glob.scan(pattern, { cwd: root, absolute: true, include: "file", dot: true, symlink: true })
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
  }

  return result
}

// -------------------------------------------------------------------
// Hooks
// -------------------------------------------------------------------

async function loadHooks(root: string, manifest: Manifest): Promise<HookSchema | undefined> {
  const patterns = resolvePaths(manifest, "hooks", ["hooks/hooks.json"])

  for (const pattern of patterns) {
    const matches = await Glob.scan(pattern, { cwd: root, absolute: true, dot: true, symlink: true })
    for (const match of matches) {
      try {
        const raw = await Filesystem.readJson(match)
        // hooks.json should be a record of event name → array of groups
        if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as HookSchema
      } catch (err) {
        log.warn("failed to read plugin hooks", { path: match, err })
      }
    }
  }

  return undefined
}

// -------------------------------------------------------------------
// MCP servers
// -------------------------------------------------------------------

async function loadMcp(
  root: string,
  plugin: string,
  manifest: Manifest,
): Promise<Record<string, Config.Mcp> | undefined> {
  const val = manifest.mcpServers

  // If mcpServers is a record of server configs, use directly
  if (val && typeof val === "object" && !Array.isArray(val) && typeof val !== "string") {
    const result: Record<string, Config.Mcp> = {}
    for (const [key, raw] of Object.entries(val as Record<string, unknown>)) {
      const expanded = expandDeep(raw, root, plugin)
      const parsed = Config.Mcp.safeParse(expanded)
      if (parsed.success) result[ns(plugin, key)] = parsed.data
      else log.warn("invalid plugin mcp entry", { plugin, key, issues: parsed.error.issues })
    }
    return Object.keys(result).length ? result : undefined
  }

  // If mcpServers is a string (path to .mcp.json), load it
  const file = typeof val === "string" ? path.resolve(root, val) : path.join(root, ".mcp.json")
  if (!(await Filesystem.exists(file))) return undefined

  try {
    const raw = await Filesystem.readJson<Record<string, unknown>>(file)
    const servers = (raw as { mcpServers?: Record<string, unknown> }).mcpServers ?? raw
    if (typeof servers !== "object" || Array.isArray(servers)) return undefined

    const result: Record<string, Config.Mcp> = {}
    for (const [key, entry] of Object.entries(servers as Record<string, unknown>)) {
      if (key === "mcpServers") continue
      const expanded = expandDeep(entry, root, plugin)
      // Adapt Claude Code .mcp.json format to LiteAI
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

  // If it already has `type: "local"` with a command array
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

// -------------------------------------------------------------------
// Settings
// -------------------------------------------------------------------

async function loadSettings(root: string, manifest: Manifest): Promise<Config.Info | undefined> {
  const file = manifest.settings ? path.resolve(root, manifest.settings) : path.join(root, "settings.json")

  if (!(await Filesystem.exists(file))) return undefined

  try {
    const raw = await Filesystem.readJson(file)
    const parsed = Config.Info.safeParse(raw)
    if (parsed.success) return parsed.data
    log.warn("invalid plugin settings", { path: file, issues: parsed.error.issues })
  } catch (err) {
    log.warn("failed to read plugin settings", { path: file, err })
  }
  return undefined
}
