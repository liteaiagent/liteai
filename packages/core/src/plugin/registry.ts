/**
 * Plugin registry.
 *
 * Manages the list of known/installed plugins and their state. Plugin state
 * (enabled/disabled) is persisted via the `enabledPlugins` field in
 * settings files. The registry reads from all scopes (user, project, local)
 * and provides functions to list, enable, disable, install, and uninstall
 * plugins.
 */

import path from "node:path"
import { Config } from "@/config/config"
import { Global } from "@/global"
import { Log } from "@/util/log"
import { type Loaded, load } from "./loader"
import { type Mounted, all as mountAll } from "./mount"

const log = Log.create({ service: "plugin:registry" })

export type Scope = "user" | "project"

export type Entry = {
  /** Plugin identifier, e.g. "plugin-name@marketplace-name" */
  id: string
  name: string
  /** Source marketplace, or "__local__" for --plugin-dir plugins */
  marketplace: string
  version?: string
  enabled: boolean
  scope: Scope
  /** Absolute path to the plugin directory (in cache or local) */
  root: string
}

/** Derive a plugin id from name and marketplace. */
export function id(name: string, marketplace: string) {
  if (marketplace === "__local__") return name
  return `${name}@${marketplace}`
}

/** Parse a plugin reference like "name@marketplace" into parts. */
export function parse(ref: string): { name: string; marketplace?: string } {
  const at = ref.lastIndexOf("@")
  if (at <= 0) return { name: ref }
  return { name: ref.slice(0, at), marketplace: ref.slice(at + 1) }
}

/** Cache root for installed plugins. */
export function cacheRoot() {
  return path.join(Global.Path.config, "plugins", "cache")
}

/** Resolve the cache directory for a specific plugin version. */
export function cachePath(marketplace: string, name: string, version?: string) {
  return path.join(cacheRoot(), marketplace, name, version ?? "latest")
}

/** Persistent data directory (survives updates). */
export function dataPath(normalized: string) {
  return path.join(Global.Path.config, "plugins", "data", normalized.replace(/[^a-zA-Z0-9_-]/g, "_"))
}

/**
 * Read `enabledPlugins` from a config object.
 * Returns a record of plugin-id → enabled boolean.
 */
export function enabled(config: Config.Info): Record<string, boolean> {
  // biome-ignore lint/suspicious/noExplicitAny: enabledPlugins is a new field
  return (config as any).enabledPlugins ?? {}
}

/**
 * Build the list of known plugin entries from the current config.
 * Only includes plugins that have a cached root or are from --plugin-dir.
 */
export async function list(): Promise<Entry[]> {
  const cfg = await Config.get()
  const plugins = enabled(cfg)
  const result: Entry[] = []

  for (const [key, on] of Object.entries(plugins)) {
    const parsed = parse(key)
    const marketplace = parsed.marketplace ?? "__local__"
    const root = cachePath(marketplace, parsed.name)

    result.push({
      id: key,
      name: parsed.name,
      marketplace,
      enabled: on,
      scope: "user",
      root,
    })
  }

  return result
}

/**
 * Load and mount all enabled plugins from the registry.
 * Returns the merged mount result to apply on top of config.
 */
export async function mount(): Promise<{ mounted: Mounted; plugins: Loaded[] } | undefined> {
  const entries = await list()
  const active = entries.filter((e) => e.enabled)
  if (!active.length) return undefined

  const loaded = (await Promise.all(active.map((e) => load(e.root)))).filter((p): p is NonNullable<typeof p> => !!p)
  if (!loaded.length) return undefined

  const mounted = mountAll(loaded)
  log.info("mounted registered plugins", { count: loaded.length, names: loaded.map((p) => p.name) })
  return { mounted, plugins: loaded }
}

/**
 * Enable a plugin by writing to the appropriate settings file.
 */
export async function enable(ref: string, scope: Scope = "user") {
  const parsed = parse(ref)
  const key = parsed.marketplace ? `${parsed.name}@${parsed.marketplace}` : parsed.name

  await write(scope, { [key]: true })
  log.info("enabled plugin", { id: key, scope })
}

/**
 * Disable a plugin without uninstalling it.
 */
export async function disable(ref: string, scope: Scope = "user") {
  const parsed = parse(ref)
  const key = parsed.marketplace ? `${parsed.name}@${parsed.marketplace}` : parsed.name

  await write(scope, { [key]: false })
  log.info("disabled plugin", { id: key, scope })
}

/**
 * Install a plugin: copy/clone it into the cache and enable it.
 * For now, supports local paths. Marketplace sources are handled in 5C.
 */
export async function install(opts: {
  name: string
  root: string
  marketplace?: string
  version?: string
  scope?: Scope
}) {
  const marketplace = opts.marketplace ?? "__local__"
  const dest = cachePath(marketplace, opts.name, opts.version)

  // Copy plugin files to cache (skip if installing from the cache location itself)
  const src = path.resolve(opts.root)
  if (src !== path.resolve(dest)) {
    await copyDir(src, dest)
  }

  const key = marketplace === "__local__" ? opts.name : `${opts.name}@${marketplace}`
  await write(opts.scope ?? "user", { [key]: true })
  log.info("installed plugin", { id: key, root: dest })
}

/**
 * Uninstall a plugin: remove from settings and optionally delete cached files.
 */
export async function uninstall(ref: string, opts?: { keepData?: boolean; scope?: Scope }) {
  const parsed = parse(ref)
  const marketplace = parsed.marketplace ?? "__local__"
  const key = parsed.marketplace ? `${parsed.name}@${parsed.marketplace}` : parsed.name

  // Remove from settings by setting to undefined (which gets stripped on write)
  await remove(opts?.scope ?? "user", key)

  // Remove cached files
  const cached = cachePath(marketplace, parsed.name)
  const { rm } = await import("node:fs/promises")
  await rm(cached, { recursive: true, force: true }).catch(() => {})

  // Remove data directory unless --keep-data
  if (!opts?.keepData) {
    const dir = dataPath(key)
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }

  log.info("uninstalled plugin", { id: key })
}

/**
 * List installed plugins with brief info for display.
 */
export async function summary(): Promise<string> {
  const entries = await list()
  if (!entries.length) return "No plugins installed."

  const lines = ["**Installed Plugins:**\n"]
  for (const entry of entries) {
    const status = entry.enabled ? "✅ enabled" : "⏸ disabled"
    const source = entry.marketplace === "__local__" ? "local" : entry.marketplace
    lines.push(`- **${entry.name}** (${source}) — ${status}`)
  }
  return lines.join("\n")
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Write enabledPlugins to the appropriate settings file. */
async function write(scope: Scope, plugins: Record<string, boolean>) {
  // biome-ignore lint/suspicious/noExplicitAny: enabledPlugins is a new field
  const patch: any = { enabledPlugins: plugins }

  if (scope === "user") {
    await Config.updateGlobal(patch)
    return
  }

  // For project/local scope, handled via Config.update
  await Config.update(patch)
}

/** Remove an enabledPlugins key from settings. */
async function remove(scope: Scope, key: string) {
  // Read current settings, remove the key, write back
  if (scope === "user") {
    const cfg = await Config.getGlobal()
    // biome-ignore lint/suspicious/noExplicitAny: enabledPlugins is a new field
    const plugins = { ...(cfg as any).enabledPlugins }
    delete plugins[key]
    // biome-ignore lint/suspicious/noExplicitAny: enabledPlugins is a new field
    await Config.updateGlobal({ enabledPlugins: plugins } as any)
    return
  }

  const cfg = await Config.get()
  // biome-ignore lint/suspicious/noExplicitAny: enabledPlugins is a new field
  const plugins = { ...(cfg as any).enabledPlugins }
  delete plugins[key]
  // biome-ignore lint/suspicious/noExplicitAny: enabledPlugins is a new field
  await Config.update({ enabledPlugins: plugins } as any)
}

/** Recursively copy a directory. */
async function copyDir(src: string, dest: string) {
  const { mkdir, readdir, copyFile } = await import("node:fs/promises")
  await mkdir(dest, { recursive: true })

  const entries = await readdir(src, { withFileTypes: true })
  for (const entry of entries) {
    const from = path.join(src, entry.name)
    const to = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      await copyDir(from, to)
    } else {
      await copyFile(from, to)
    }
  }
}
