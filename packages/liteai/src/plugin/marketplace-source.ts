/**
 * Marketplace source resolution.
 *
 * Fetches and clones marketplace catalogs from various sources:
 *
 * | Source Type | Input                              | Resolution                           |
 * |-------------|------------------------------------|--------------------------------------|
 * | GitHub      | `owner/repo`                       | Git clone, read marketplace manifest |
 * | Git URL     | `https://gitlab.com/foo/bar.git`   | Git clone, read manifest             |
 * | Local path  | `./my-marketplace`                 | Read manifest directly               |
 * | Remote URL  | `https://example.com/market.json`  | HTTP fetch the JSON                  |
 *
 * Cloned marketplaces are cached at `~/.liteai/plugins/marketplaces/<name>/`.
 */

import fs from "node:fs/promises"
import path from "node:path"
import { $ } from "bun"
import { Filesystem } from "@/util/filesystem"
import { Log } from "@/util/log"
import type { Manifest, MarketplaceRef, PluginSource } from "./marketplace"
import { add as addKnown, dir as marketDir, parse } from "./marketplace"

const log = Log.create({ service: "plugin:marketplace-source" })

/** Detect source type from a raw string input. */
export function detect(input: string): MarketplaceRef["source"] {
  // GitHub shorthand: owner/repo (no protocol, no dots before slash)
  if (/^[a-zA-Z0-9_-]+\/[a-zA-Z0-9._-]+$/.test(input)) {
    return { source: "github", repo: input }
  }
  // Git URL (.git suffix or known hosts)
  if (input.endsWith(".git") || /^(git@|ssh:\/\/)/.test(input)) {
    return { source: "url", url: input }
  }
  // Remote JSON URL
  if (/^https?:\/\//.test(input) && !input.endsWith(".git")) {
    return { source: "url", url: input }
  }
  // Local path
  return input
}

/** Derive a marketplace name from its source. */
export function name(source: MarketplaceRef["source"]): string {
  if (typeof source === "string") return path.basename(path.resolve(source))
  if (source.source === "github") return source.repo.replace("/", "-")
  if (source.source === "url") {
    const url = new URL(source.url)
    return url.pathname
      .replace(/^\//, "")
      .replace(/\.git$/, "")
      .replace(/\//g, "-")
  }
  return "unknown"
}

/**
 * Resolve a marketplace source: clone/fetch it and return the parsed manifest.
 * The marketplace is saved to known_marketplaces.json and cached on disk.
 */
export async function resolve(input: string): Promise<{ name: string; manifest: Manifest } | undefined> {
  const source = detect(input)
  const key = name(source)
  const dest = marketDir(key)

  log.info("resolving marketplace", { input, name: key })

  if (typeof source === "string") {
    // Local path — read directly
    const resolved = path.resolve(source)
    const manifest = await parse(resolved)
    if (!manifest) {
      log.warn("no marketplace manifest found at local path", { path: resolved })
      return undefined
    }
    await addKnown(manifest.name, { source, added: new Date().toISOString() })
    return { name: manifest.name, manifest }
  }

  if (source.source === "github") {
    const url = `https://github.com/${source.repo}.git`
    const ok = await clone(url, dest, source.ref)
    if (!ok) return undefined
    const manifest = await parse(dest)
    if (!manifest) {
      log.warn("cloned repo has no marketplace manifest", { repo: source.repo })
      return undefined
    }
    await addKnown(manifest.name, { source, added: new Date().toISOString() })
    return { name: manifest.name, manifest }
  }

  if (source.source === "url") {
    // If it looks like a JSON URL, fetch it directly
    if (source.url.endsWith(".json")) {
      return fetchRemote(key, source)
    }
    // Otherwise treat as git URL
    const ok = await clone(source.url, dest, source.ref)
    if (!ok) return undefined
    const manifest = await parse(dest)
    if (!manifest) {
      log.warn("cloned repo has no marketplace manifest", { url: source.url })
      return undefined
    }
    await addKnown(manifest.name, { source, added: new Date().toISOString() })
    return { name: manifest.name, manifest }
  }

  return undefined
}

/**
 * Update a marketplace by re-cloning or re-fetching.
 * Returns the refreshed manifest.
 */
export async function update(key: string, ref: MarketplaceRef): Promise<Manifest | undefined> {
  const dest = marketDir(key)
  const source = ref.source

  log.info("updating marketplace", { name: key })

  if (typeof source === "string") {
    return parse(path.resolve(source))
  }

  if (source.source === "github") {
    const url = `https://github.com/${source.repo}.git`
    // Pull if already cloned, otherwise clone
    if (await Filesystem.isDir(path.join(dest, ".git"))) {
      await pull(dest)
    } else {
      await clone(url, dest, source.ref)
    }
    return parse(dest)
  }

  if (source.source === "url") {
    if (source.url.endsWith(".json")) {
      const result = await fetchRemote(key, source)
      return result?.manifest
    }
    if (await Filesystem.isDir(path.join(dest, ".git"))) {
      await pull(dest)
    } else {
      await clone(source.url, dest, source.ref)
    }
    return parse(dest)
  }

  return undefined
}

/**
 * Load a marketplace manifest from already-cached files.
 * Does not clone or fetch — expects files to already be on disk.
 */
export async function load(key: string, ref: MarketplaceRef): Promise<Manifest | undefined> {
  const source = ref.source
  if (typeof source === "string") return parse(path.resolve(source))
  const dest = marketDir(key)
  if (!(await Filesystem.isDir(dest))) return undefined
  return parse(dest)
}

/**
 * Resolve the root directory of a plugin source relative to a marketplace.
 */
export function pluginRoot(marketplace: string, source: PluginSource): string | undefined {
  if (typeof source === "string") {
    // Relative path inside marketplace
    return path.resolve(marketDir(marketplace), source)
  }
  // Non-local sources need download (handled by download.ts)
  return undefined
}

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

async function clone(url: string, dest: string, ref?: string): Promise<boolean> {
  await fs.mkdir(path.dirname(dest), { recursive: true })
  // Remove stale clone
  await fs.rm(dest, { recursive: true, force: true }).catch(() => {})
  const args = ["git", "clone", "--depth", "1"]
  if (ref) args.push("--branch", ref)
  args.push(url, dest)

  log.info("cloning marketplace", { url, dest })
  const result = await $`${args}`.quiet().nothrow()
  if (result.exitCode !== 0) {
    log.error("git clone failed", { url, stderr: result.stderr.toString() })
    return false
  }
  return true
}

async function pull(dest: string): Promise<boolean> {
  log.info("pulling marketplace updates", { dest })
  const result = await $`git -C ${dest} pull --ff-only`.quiet().nothrow()
  if (result.exitCode !== 0) {
    log.warn("git pull failed, will re-clone", { dest, stderr: result.stderr.toString() })
    return false
  }
  return true
}

async function fetchRemote(
  key: string,
  source: { source: "url"; url: string },
): Promise<{ name: string; manifest: Manifest } | undefined> {
  log.info("fetching remote marketplace manifest", { url: source.url })
  const response = await fetch(source.url).catch((err) => {
    log.error("failed to fetch marketplace manifest", { url: source.url, err })
    return undefined
  })
  if (!response?.ok) {
    log.error("marketplace fetch failed", { url: source.url, status: response?.status })
    return undefined
  }

  const raw = await response.json().catch(() => undefined)
  if (!raw) return undefined

  const { Manifest: Schema } = await import("./marketplace")
  const parsed = Schema.safeParse(raw)
  if (!parsed.success) {
    log.warn("invalid remote marketplace manifest", { url: source.url, issues: parsed.error.issues })
    return undefined
  }

  // Cache the manifest locally
  const dest = marketDir(key)
  await fs.mkdir(dest, { recursive: true })
  await Filesystem.writeJson(path.join(dest, "marketplace.json"), raw)

  await addKnown(parsed.data.name, { source, added: new Date().toISOString() })
  return { name: parsed.data.name, manifest: parsed.data }
}
