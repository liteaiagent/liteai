import { existsSync } from "node:fs"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  applyEdits,
  type ParseError as JsoncParseError,
  modify,
  parse as parseJsonc,
  printParseErrorCode,
} from "jsonc-parser"
import { mergeDeep, unique } from "remeda"
import { Account } from "@/account"
import { Brand } from "@/brand"
import { GlobalBus } from "@/bus/global"
import { Filesystem } from "@/util/filesystem"
import { Auth } from "../auth"
import { Env } from "../env"
import { Flag } from "../flag/flag"
import { Global } from "../global"
import { Instance } from "../project/instance"
import { Event } from "../server/event"
import { lazy } from "../util/lazy"
import { Log } from "../util/log"
import { ConfigPaths } from "./paths"
import { defaultConfig, Info, schema } from "./schema"

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
  }

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
    message:
      `Invalid configuration at ${source}:\n` +
      parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n"),
  })
}

export const { JsonError, InvalidError } = ConfigPaths

export function redactSensitiveFields(config: Info): Info {
  if (!config) return config
  // Shallow clone top level
  const redacted = { ...config }

  // Deep clone and redact mcp secret keys
  if (redacted.mcpServers) {
    redacted.mcpServers = { ...redacted.mcpServers }
    for (const [key, value] of Object.entries(redacted.mcpServers)) {
      const mcpVal = value as { type?: string; oauth?: { clientSecret?: string } }
      if (mcpVal && mcpVal.type === "remote" && mcpVal.oauth && typeof mcpVal.oauth === "object") {
        const clonedOauth = { ...mcpVal.oauth }
        if (clonedOauth.clientSecret) {
          clonedOauth.clientSecret = "*****"
        }
        redacted.mcpServers[key] = { ...mcpVal, oauth: clonedOauth } as typeof value
      }
    }
  }

  // Deep clone and redact telemetry langfuse secret keys
  if (redacted.telemetry?.langfuse?.secretKey) {
    redacted.telemetry = {
      ...redacted.telemetry,
      langfuse: {
        ...redacted.telemetry.langfuse,
        secretKey: "*****",
      },
    }
  }

  return redacted
}

export async function get(options?: { unredacted?: boolean }) {
  const config = await state().then((x) => x.config)
  return options?.unredacted ? config : redactSensitiveFields(config)
}

export async function getGlobal(options?: { unredacted?: boolean }) {
  const config = await global()
  return options?.unredacted ? config : redactSensitiveFields(config)
}

export async function update(config: Info) {
  if (config.telemetry !== undefined || config.server !== undefined) {
    log.warn("ignoring global-only fields in project config update", {
      fields: ["telemetry", "server"].filter((f) => f in config),
    })
    delete config.telemetry
    delete config.server
  }

  const filepath = path.join(Instance.directory, Brand.dir, `${Brand.config}.json`)
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
    message:
      `Invalid configuration at ${filepath}:\n` +
      parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n"),
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

  const keys = Object.keys(config)
  const onlyTelemetry = keys.length > 0 && keys.every((k) => k === "telemetry")

  if (!onlyTelemetry) {
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
  }

  return next
}

export async function directories() {
  return state().then((x) => x.directories)
}

export async function pluginSkills() {
  return state().then((x) => x.pluginSkills)
}
