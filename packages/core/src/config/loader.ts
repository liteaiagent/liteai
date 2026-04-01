import { existsSync } from "node:fs"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { NamedError } from "@liteai/util/error"
import {
  applyEdits,
  type ParseError as JsoncParseError,
  modify,
  parse as parseJsonc,
  printParseErrorCode,
} from "jsonc-parser"
import { mergeDeep, unique } from "remeda"
import type z from "zod"
import { Account } from "@/account"
import { Brand } from "@/brand"

import { Bus } from "@/bus"
import { GlobalBus } from "@/bus/global"
import { Filesystem } from "@/util/filesystem"

import { Auth } from "../auth"
import { Env } from "../env"
import { Flag } from "../flag/flag"
import { Global } from "../global"
import { Instance } from "../project/instance"
import { Event } from "../server/event"
import { Glob } from "../util/glob"
import { lazy } from "../util/lazy"
import { Log } from "../util/log"
import { ConfigMarkdown } from "./markdown"
import { load as loadMcpJson, loadFile as loadMcpJsonFile } from "./mcp-json"
import { ConfigPaths } from "./paths"
import { Agent, Command, defaultConfig, Info, schema } from "./schema"

const log = Log.create({ service: "config" })

// Managed settings directory for enterprise deployments (highest priority, admin-controlled)
// These settings override all user and project settings
function systemManagedConfigDir(): string {
  switch (process.platform) {
    case "darwin":
      return `/Library/Application Support/${Brand.managed}`
    case "win32":
      return path.join(process.env.ProgramData || "C:\\ProgramData", Brand.managed)
    default:
      return `/etc/${Brand.managed}`
  }
}

export function managedConfigDir() {
  return process.env.LITEAI_TEST_MANAGED_CONFIG_DIR || systemManagedConfigDir()
}

const managedDir = managedConfigDir()

// Custom merge function that concatenates array fields instead of replacing them
function mergeConfigConcatArrays(target: Info, source: Info): Info {
  const merged = mergeDeep(target, source)

  if (target.instructions && source.instructions) {
    merged.instructions = Array.from(new Set([...target.instructions, ...source.instructions]))
  }
  return merged
}

// All recognized config file basenames, ordered by priority (later wins).
const CONFIG_FILES = [`${Brand.config}.json`]

export type PluginSkill = {
  name: string
  description: string
  location: string
  content: string
  [key: string]: unknown
}

export const state = Instance.state(async () => {
  const auth = await Auth.all()

  // Config loading order (low -> high precedence): https://liteai.com/docs/config#precedence-order
  // 1) Remote .well-known/liteai (org defaults)
  // 2) Global config (~/.liteai/settings.json{,c})
  // 3) Custom config (LITEAI_CONFIG)
  // 4) Project config (settings.json{,c})
  // 5) .liteai directories (.liteai/agents/, .liteai/commands/, .liteai/settings.json{,c})
  // 6) Inline config (LITEAI_CONFIG_CONTENT)
  // Managed config directory is enterprise-only and always overrides everything above.
  let result: Info = {}
  for (const [key, value] of Object.entries(auth)) {
    if (value.type === "wellknown") {
      const url = key.replace(/\/+$/, "")
      process.env[value.key] = value.token
      log.debug("fetching remote config", { url: `${url}/.well-known/${Brand.wellknown}` })
      const response = await fetch(`${url}/.well-known/${Brand.wellknown}`)
      if (!response.ok) {
        throw new Error(`failed to fetch remote config from ${url}: ${response.status}`)
      }
      const wellknown = (await response.json()) as { config?: Record<string, unknown> }
      const remoteConfig = wellknown.config ?? {}
      // Add $schema to prevent load() from trying to write back to a non-existent file
      if (!remoteConfig.$schema) remoteConfig.$schema = "https://liteai.com/config.json"
      result = mergeConfigConcatArrays(
        result,
        await load(JSON.stringify(remoteConfig), {
          dir: path.dirname(`${url}/.well-known/${Brand.wellknown}`),
          source: `${url}/.well-known/${Brand.wellknown}`,
        }),
      )
      log.debug("loaded remote config from well-known", { url })
    }
  }

  // ~/.liteai/.mcp.json user-scope file (Claude Code compatible).
  // Loaded before global config so settings.json entries take precedence.
  // Cached at module level so multiple instances don't re-read the same file.
  const globalMcpJson = await globalMcpJsonCache()
  if (Object.keys(globalMcpJson).length > 0) {
    result.mcp = { ...globalMcpJson, ...result.mcp }
  }

  // Global user config overrides remote config.
  result = mergeConfigConcatArrays(result, await global())

  // Custom config path overrides global config.
  if (Flag.LITEAI_CONFIG) {
    result = mergeConfigConcatArrays(result, await loadFile(Flag.LITEAI_CONFIG))
    log.debug("loaded custom config", { path: Flag.LITEAI_CONFIG })
  }

  // Project config overrides global and remote config.
  if (!Flag.LITEAI_DISABLE_PROJECT_CONFIG) {
    for (const file of await ConfigPaths.projectFiles(Brand.config, Instance.directory, Instance.worktree)) {
      log.info("loading project config", { path: file })
      result = mergeConfigConcatArrays(result, await loadFile(file))
    }
  }

  // .mcp.json project-scope file (Claude Code compatible).
  // Loaded after project config so settings.json entries take precedence.
  if (!Flag.LITEAI_DISABLE_PROJECT_CONFIG) {
    log.info("scanning for .mcp.json", { start: Instance.directory, stop: Instance.worktree })
    const mcpJson = await loadMcpJson(Instance.directory, Instance.worktree)
    if (Object.keys(mcpJson).length > 0) {
      // Merge: .mcp.json first, then existing result.mcp overrides
      result.mcp = { ...mcpJson, ...result.mcp }
    }
  }

  result.agent = result.agent || {}

  const directories = await ConfigPaths.directories(Instance.directory, Instance.worktree)

  // .liteai directory config overrides (project and global) config sources.
  if (Flag.LITEAI_CONFIG_DIR) {
    log.debug("loading config from LITEAI_CONFIG_DIR", { path: Flag.LITEAI_CONFIG_DIR })
  }

  for (const dir of unique(directories)) {
    if (dir.endsWith(Brand.dir) || dir === Flag.LITEAI_CONFIG_DIR) {
      for (const file of CONFIG_FILES) {
        log.debug(`loading config from ${path.join(dir, file)}`)
        result = mergeConfigConcatArrays(result, await loadFile(path.join(dir, file)))
        result.agent ??= {}
      }
    }

    log.info("scanning for commands", { dir })
    result.command = mergeDeep(result.command ?? {}, await loadCommand(dir))
    log.info("scanning for agents", { dir })
    result.agent = mergeDeep(result.agent, await loadAgent(dir))
  }

  // External agent directories (.claude/agents/, .agents/agents/) — project wins over global
  // Global agents cached at module level; project-scoped agents still per-instance.
  log.info("scanning for external agents")
  result.agent = mergeDeep(await loadExternalAgents(), result.agent)

  // Load plugins from --plugin-dir (LITEAI_PLUGIN_DIR env var)
  const pluginSkills: PluginSkill[] = []
  const pluginDirs = Flag.LITEAI_PLUGIN_DIR
  if (pluginDirs?.length) {
    log.info("scanning for plugins from --plugin-dir", { dirs: pluginDirs })
    const { load: loadPlugin } = await import("@/plugin/loader")
    const { all: mountAll, apply: applyPlugins } = await import("@/plugin/mount")
    const plugins = (await Promise.all(pluginDirs.map(loadPlugin))).filter((p): p is NonNullable<typeof p> => !!p)
    if (plugins.length) {
      const mounted = mountAll(plugins)
      result = applyPlugins(result, mounted)
      pluginSkills.push(...mounted.skills)
      log.info("mounted plugins from --plugin-dir", { count: plugins.length, names: plugins.map((p) => p.name) })
    }
  }

  // Load enabled plugins from the registry (enabledPlugins in settings)
  if (result.enabledPlugins) {
    const { load: loadPlugin } = await import("@/plugin/loader")
    const { all: mountAll, apply: applyPlugins } = await import("@/plugin/mount")
    const enabled = Object.entries(result.enabledPlugins).filter(([, on]) => on)
    if (enabled.length) {
      log.info("scanning for registered plugins", { ids: enabled.map(([k]) => k) })
      const { cachePath, parse: parseRef } = await import("@/plugin/registry")
      const roots = enabled.map(([key]) => {
        const parsed = parseRef(key)
        return cachePath(parsed.marketplace ?? "__local__", parsed.name)
      })
      const plugins = (await Promise.all(roots.map(loadPlugin))).filter((p): p is NonNullable<typeof p> => !!p)
      if (plugins.length) {
        const mounted = mountAll(plugins)
        result = applyPlugins(result, mounted)
        pluginSkills.push(...mounted.skills)
        log.info("mounted registered plugins", { count: plugins.length, names: plugins.map((p) => p.name) })
      }
    }
  }

  // Register extra marketplaces from settings (team-shared via `.liteai/settings.json`)
  if (result.extraKnownMarketplaces) {
    const { add: addMarketplace } = await import("@/plugin/marketplace")
    for (const [name, entry] of Object.entries(result.extraKnownMarketplaces)) {
      await addMarketplace(name, { source: entry.source, added: new Date().toISOString() }).catch((err) => {
        log.warn("failed to register extra marketplace", { name, err })
      })
    }
  }

  // Inline config content overrides all non-managed config sources.
  if (process.env.LITEAI_CONFIG_CONTENT) {
    result = mergeConfigConcatArrays(
      result,
      await load(process.env.LITEAI_CONFIG_CONTENT, {
        dir: Instance.directory,
        source: "LITEAI_CONFIG_CONTENT",
      }),
    )
    log.debug("loaded custom config from LITEAI_CONFIG_CONTENT")
  }

  const active = Account.active()
  if (active?.active_org_id) {
    try {
      const [config, token] = await Promise.all([
        Account.config(active.id, active.active_org_id),
        Account.token(active.id),
      ])
      if (token) {
        process.env.LITEAI_CONSOLE_TOKEN = token
        Env.set("LITEAI_CONSOLE_TOKEN", token)
      }

      if (config) {
        result = mergeConfigConcatArrays(
          result,
          await load(JSON.stringify(config), {
            dir: path.dirname(`${active.url}/api/config`),
            source: `${active.url}/api/config`,
          }),
        )
      }
    } catch (err) {
      log.debug("failed to fetch remote account config", { error: err instanceof Error ? err.message : err })
    }
  }

  // Load managed config files last (highest priority) - enterprise admin-controlled
  // Kept separate from directories array to avoid write operations when installing plugins
  // which would fail on system directories requiring elevated permissions
  // This way it only loads config file and not skills/plugins/commands
  if (existsSync(managedDir)) {
    for (const file of CONFIG_FILES) {
      result = mergeConfigConcatArrays(result, await loadFile(path.join(managedDir, file)))
    }
  }

  if (Flag.LITEAI_PERMISSION) {
    result.permission = mergeDeep(result.permission ?? {}, JSON.parse(Flag.LITEAI_PERMISSION))
  }

  if (!result.username) result.username = os.userInfo().username

  // Apply flag overrides for compaction settings
  if (Flag.LITEAI_DISABLE_AUTOCOMPACT) {
    result.compaction = { ...result.compaction, auto: false }
  }
  if (Flag.LITEAI_DISABLE_PRUNE) {
    result.compaction = { ...result.compaction, prune: false }
  }

  return {
    config: result,
    directories,
    pluginSkills,
  }
})

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

async function loadCommand(dir: string) {
  const result: Record<string, z.infer<typeof Command>> = {}
  for (const item of await Glob.scan("{command,commands}/**/*.md", {
    cwd: dir,
    absolute: true,
    dot: true,
    symlink: true,
  })) {
    const md = await ConfigMarkdown.parse(item).catch(async (err) => {
      const message = ConfigMarkdown.FrontmatterError.isInstance(err)
        ? err.data.message
        : `Failed to parse command ${item}`
      const { Session } = await import("@/session")
      Bus.publish(Session.Event.Error, { error: new NamedError.Unknown({ message }).toObject() })
      log.error("failed to load command", { command: item, err })
      return undefined
    })
    if (!md) continue

    const patterns = [`/${Brand.dir}/command/`, `/${Brand.dir}/commands/`, "/command/", "/commands/"]
    const file = rel(item, patterns) ?? path.basename(item)
    const name = trim(file)

    const config = {
      name,
      ...md.data,
      template: md.content.trim(),
    }
    const parsed = Command.safeParse(config)
    if (parsed.success) {
      log.info("loaded command", { name: config.name, path: item })
      result[config.name] = parsed.data
      continue
    }
    throw new ConfigPaths.InvalidError({ path: item, issues: parsed.error.issues }, { cause: parsed.error })
  }
  return result
}

// External agent directories to search for (project-level and global).
// These follow the directory layout used by Claude Code and other agents.
const EXTERNAL_AGENT_DIRS = [".claude", ".agents"]
const EXTERNAL_AGENT_PATTERN = "agents/*.md"

async function parseAgent(item: string): Promise<[string, z.infer<typeof Agent>] | undefined> {
  log.info("parsing agent", { path: item })
  const md = await ConfigMarkdown.parse(item).catch(async (err) => {
    const message = ConfigMarkdown.FrontmatterError.isInstance(err) ? err.data.message : `Failed to parse agent ${item}`
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

async function loadAgent(dir: string) {
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

async function scanAgents(root: string, scope: "global" | "project") {
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

// Module-level cache: global external agents (~/.claude, ~/.agents) don't change per instance
const globalExternalAgentsCache = lazy(async () => {
  if (Flag.LITEAI_DISABLE_EXTERNAL_AGENTS) return {}
  const result: Record<string, z.infer<typeof Agent>> = {}
  for (const dir of EXTERNAL_AGENT_DIRS) {
    const root = path.join(Global.Path.home, dir)
    if (!(await Filesystem.isDir(root))) continue
    Object.assign(result, await scanAgents(root, "global"))
  }
  return result
})

async function loadExternalAgents() {
  if (Flag.LITEAI_DISABLE_EXTERNAL_AGENTS) return {}
  // Start with cached global agents, then overlay project-scoped agents
  const result: Record<string, z.infer<typeof Agent>> = { ...(await globalExternalAgentsCache()) }

  for await (const root of Filesystem.up({
    targets: EXTERNAL_AGENT_DIRS,
    start: Instance.directory,
    stop: Instance.worktree,
  })) {
    Object.assign(result, await scanAgents(root, "project"))
  }

  return result
}

// Module-level cache: global .mcp.json doesn't change per instance
const globalMcpJsonCache = lazy(async () => {
  const p = path.join(Global.Path.config, ".mcp.json")
  log.info("scanning for mcp servers", { path: p })
  return loadMcpJsonFile(p)
})

export const global = lazy(async () => {
  const candidates = CONFIG_FILES.map((f) => path.join(Global.Path.config, f))
  const exists = candidates.some((f) => existsSync(f))
  if (!exists) {
    await fs.mkdir(Global.Path.config, { recursive: true })
    const target = path.join(Global.Path.config, "settings.json")
    await Filesystem.writeJson(target, defaultConfig)
    log.info("created default config", { path: target })
  }
  await schema().catch((e) => {
    log.warn("schema generation failed", { error: e })
  })

  let result: Info = {}
  for (const file of candidates) {
    result = mergeDeep(result, await loadFile(file))
  }
  return result
})

export const { readFile } = ConfigPaths

async function loadFile(filepath: string): Promise<Info> {
  log.info("loading", { path: filepath })
  const text = await readFile(filepath)
  if (!text) return {}
  return load(text, { path: filepath })
}

async function load(text: string, options: { path: string } | { dir: string; source: string }) {
  const original = text
  const source = "path" in options ? options.path : options.source
  const isFile = "path" in options
  const data = await ConfigPaths.parseText(
    text,
    "path" in options ? options.path : { source: options.source, dir: options.dir },
  )

  const normalized = (() => {
    if (!data || typeof data !== "object" || Array.isArray(data)) return data
    const copy = { ...(data as Record<string, unknown>) }
    const hadLegacy = "theme" in copy || "keybinds" in copy || "tui" in copy
    if (!hadLegacy) return copy
    delete copy.theme
    delete copy.keybinds
    delete copy.tui
    log.warn("tui keys in liteai config are deprecated; move them to tui.json", { path: source })
    return copy
  })()

  const parsed = Info.safeParse(normalized)
  if (parsed.success) {
    if (!parsed.data.$schema && isFile) {
      parsed.data.$schema = "./config.schema.json"
      const updated = original.replace(/^\s*\{/, '{\n  "$schema": "./config.schema.json",')
      await Filesystem.write(options.path, updated).catch((e) => {
        log.debug("failed to write $schema update", { path: options.path, error: e })
      })
    }
    const data = parsed.data

    return data
  }

  throw new ConfigPaths.InvalidError({
    path: source,
    issues: parsed.error.issues,
  })
}

export const { JsonError, InvalidError } = ConfigPaths

export async function get() {
  return state().then((x) => x.config)
}

export async function getGlobal() {
  return global()
}

export async function update(config: Info) {
  const filepath = path.join(Instance.directory, `${Brand.config}.json`)
  const existing = await loadFile(filepath)
  await Filesystem.writeJson(filepath, mergeDeep(existing, config))
  await Instance.dispose()
}

function globalConfigFile() {
  // Check in reverse priority order so highest-priority existing file wins
  const candidates = CONFIG_FILES.toReversed().map((file) => path.join(Global.Path.config, file))
  for (const file of candidates) {
    if (existsSync(file)) return file
  }
  // Default to settings.json for new files
  return path.join(Global.Path.config, "settings.json")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function patchJson(input: string, patch: unknown, path: string[] = []): string {
  if (!isRecord(patch)) {
    const edits = modify(input, path, patch, {
      formattingOptions: {
        insertSpaces: true,
        tabSize: 2,
      },
    })
    return applyEdits(input, edits)
  }

  return Object.entries(patch).reduce((result, [key, value]) => {
    if (value === undefined) return result
    return patchJson(result, value, [...path, key])
  }, input)
}

function parseConfig(text: string, filepath: string): Info {
  const errors: JsoncParseError[] = []
  const data = parseJsonc(text, errors, { allowTrailingComma: true })
  if (errors.length) {
    const lines = text.split("\n")
    const errorDetails = errors
      .map((e) => {
        const beforeOffset = text.substring(0, e.offset).split("\n")
        const line = beforeOffset.length
        const column = beforeOffset[beforeOffset.length - 1].length + 1
        const problemLine = lines[line - 1]

        const error = `${printParseErrorCode(e.error)} at line ${line}, column ${column}`
        if (!problemLine) return error

        return `${error}\n   Line ${line}: ${problemLine}\n${"".padStart(column + 9)}^`
      })
      .join("\n")

    throw new ConfigPaths.JsonError({
      path: filepath,
      message: `\n--- JSONC Input ---\n${text}\n--- Errors ---\n${errorDetails}\n--- End ---`,
    })
  }

  const parsed = Info.safeParse(data)
  if (parsed.success) return parsed.data

  throw new ConfigPaths.InvalidError({
    path: filepath,
    issues: parsed.error.issues,
  })
}

export async function updateGlobal(config: Info) {
  const filepath = globalConfigFile()
  const before = await Filesystem.readText(filepath).catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") return "{}"
    throw new ConfigPaths.JsonError({ path: filepath }, { cause: err })
  })

  const next = await (async () => {
    const updated = patchJson(before, config)
    const merged = parseConfig(updated, filepath)
    await Filesystem.write(filepath, updated)
    return merged
  })()

  global.reset()
  globalMcpJsonCache.reset()
  globalExternalAgentsCache.reset()

  void Instance.disposeAll()
    .catch((e) => {
      log.debug("disposeAll failed after global config update", { error: e })
      return undefined
    })
    .finally(() => {
      GlobalBus.emit("event", {
        directory: "global",
        payload: {
          type: Event.Disposed.type,
          properties: {},
        },
      })
    })

  return next
}

export async function directories() {
  return state().then((x) => x.directories)
}

export async function pluginSkills() {
  return state().then((x) => x.pluginSkills)
}
