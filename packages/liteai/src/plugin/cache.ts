/**
 * Plugin cache management.
 *
 * Installed plugins are cached at `~/.liteai/plugins/cache/<marketplace>/<plugin>/<version>/`.
 * Plugin data is stored at `~/.liteai/plugins/data/<normalized-id>/` and survives updates.
 *
 * This module provides functions to manage the cache directory: checking what
 * is cached, resolving paths, and cleaning up stale versions.
 */

import fs from "node:fs/promises"
import path from "node:path"
import { Global } from "@/global"
import { Filesystem } from "@/util/filesystem"
import { Log } from "@/util/log"

const log = Log.create({ service: "plugin:cache" })

/** Root directory for all plugin caches. */
export function root() {
  return path.join(Global.Path.config, "plugins", "cache")
}

/** Root directory for all plugin persistent data. */
export function dataRoot() {
  return path.join(Global.Path.config, "plugins", "data")
}

/** Resolve the cache directory for a specific plugin. */
export function dir(marketplace: string, name: string, version = "latest") {
  return path.join(root(), marketplace, name, version)
}

/** Normalize a plugin id for use as a directory name. */
export function normalize(id: string) {
  return id.replace(/[^a-zA-Z0-9_-]/g, "_")
}

/** Resolve the persistent data directory for a plugin. */
export function data(id: string) {
  return path.join(dataRoot(), normalize(id))
}

/** Check if a plugin version is cached. */
export async function exists(marketplace: string, name: string, version = "latest") {
  return Filesystem.isDir(dir(marketplace, name, version))
}

/** List cached versions for a plugin. */
export async function versions(marketplace: string, name: string): Promise<string[]> {
  const base = path.join(root(), marketplace, name)
  if (!(await Filesystem.isDir(base))) return []
  const entries = await fs.readdir(base, { withFileTypes: true }).catch(() => [])
  return entries.filter((e) => e.isDirectory()).map((e) => e.name)
}

/** List all cached plugins across all marketplaces. */
export async function all(): Promise<{ marketplace: string; name: string; versions: string[] }[]> {
  const base = root()
  if (!(await Filesystem.isDir(base))) return []

  const result: { marketplace: string; name: string; versions: string[] }[] = []
  const markets = await fs.readdir(base, { withFileTypes: true }).catch(() => [])

  for (const market of markets) {
    if (!market.isDirectory()) continue
    const plugins = await fs.readdir(path.join(base, market.name), { withFileTypes: true }).catch(() => [])
    for (const plugin of plugins) {
      if (!plugin.isDirectory()) continue
      const vers = await versions(market.name, plugin.name)
      result.push({ marketplace: market.name, name: plugin.name, versions: vers })
    }
  }

  return result
}

/**
 * Remove a specific cached version of a plugin.
 * If no version specified, removes all versions.
 */
export async function remove(marketplace: string, name: string, version?: string) {
  const target = version ? dir(marketplace, name, version) : path.join(root(), marketplace, name)
  await fs.rm(target, { recursive: true, force: true }).catch(() => {})
  log.info("removed cached plugin", { marketplace, name, version })

  // Clean up empty parent directories
  const parent = path.dirname(target)
  const remaining = await fs.readdir(parent).catch(() => [])
  if (remaining.length === 0) {
    await fs.rm(parent, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * Remove the persistent data directory for a plugin.
 * This is permanent and should only be done on explicit uninstall without --keep-data.
 */
export async function removeData(id: string) {
  const target = data(id)
  await fs.rm(target, { recursive: true, force: true }).catch(() => {})
  log.info("removed plugin data", { id, path: target })
}

/**
 * Ensure the persistent data directory exists for a plugin.
 */
export async function ensureData(id: string) {
  await fs.mkdir(data(id), { recursive: true })
}

/**
 * Get the total disk usage of the cache directory in bytes.
 */
export async function size(): Promise<number> {
  const base = root()
  if (!(await Filesystem.isDir(base))) return 0
  return walk(base)
}

async function walk(dir: string): Promise<number> {
  let total = 0
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      total += await walk(full)
    } else {
      const stat = Filesystem.stat(full)
      if (stat) total += typeof stat.size === "bigint" ? Number(stat.size) : stat.size
    }
  }
  return total
}
