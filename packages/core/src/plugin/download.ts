/**
 * Plugin download from marketplace sources.
 *
 * Given a plugin entry from a marketplace catalog, resolves the source and
 * downloads/copies the plugin files into the cache at
 * `~/.liteai/plugins/cache/<marketplace>/<plugin>/<version>/`.
 *
 * Supports:
 * - Relative path (inside marketplace repo)
 * - GitHub `owner/repo`
 * - Git URL
 * - Git subdirectory (sparse checkout)
 * - npm package (via `npm pack` + extract)
 */

import fs from "node:fs/promises"
import path from "node:path"
import { Log } from "@liteai/util/log"
import { $ } from "bun"
import { dir as cacheDir } from "./cache"
import type { PluginEntry, PluginSource } from "./marketplace"
import { dir as marketDir } from "./marketplace"

const log = Log.create({ service: "plugin:download" })

/**
 * Download a plugin from its marketplace source into the cache.
 * Returns the cache directory on success, undefined on failure.
 */
export async function download(marketplace: string, entry: PluginEntry): Promise<string | undefined> {
  const version = entry.version ?? "latest"
  const dest = cacheDir(marketplace, entry.name, version)
  const source = entry.source

  log.info("downloading plugin", { marketplace, name: entry.name, version })

  // Remove stale cache
  await fs.rm(dest, { recursive: true, force: true }).catch(() => {})
  await fs.mkdir(dest, { recursive: true })

  const ok = await resolve(source, marketplace, dest)
  if (!ok) {
    log.error("failed to download plugin", { marketplace, name: entry.name })
    await fs.rm(dest, { recursive: true, force: true }).catch(() => {})
    return undefined
  }

  log.info("downloaded plugin", { marketplace, name: entry.name, dest })
  return dest
}

async function resolve(source: PluginSource, marketplace: string, dest: string): Promise<boolean> {
  if (typeof source === "string") return copyLocal(source, marketplace, dest)
  switch (source.source) {
    case "github":
      return cloneGithub(source.repo, dest, source.ref)
    case "url":
      return cloneUrl(source.url, dest, source.ref)
    case "git-subdir":
      return cloneSubdir(source.url, source.path, dest, source.ref)
    case "npm":
      return installNpm(source.package, dest, source.version, source.registry)
  }
}

// ---------------------------------------------------------------------------
// Source handlers
// ---------------------------------------------------------------------------

/** Copy a relative path from inside the marketplace clone. */
async function copyLocal(rel: string, marketplace: string, dest: string): Promise<boolean> {
  const src = path.resolve(marketDir(marketplace), rel)

  log.info("copying local plugin", { src, dest })
  const ok = await copyDir(src, dest)
  return ok
}

/** Clone a GitHub repo as a plugin. */
async function cloneGithub(repo: string, dest: string, ref?: string): Promise<boolean> {
  const url = `https://github.com/${repo}.git`
  return cloneUrl(url, dest, ref)
}

/** Clone a git URL as a plugin. */
async function cloneUrl(url: string, dest: string, ref?: string): Promise<boolean> {
  const args = ["git", "clone", "--depth", "1"]
  if (ref) args.push("--branch", ref)
  args.push(url, dest)

  log.info("cloning plugin", { url, dest })
  const result = await $`${args}`.quiet().nothrow()
  if (result.exitCode !== 0) {
    log.error("git clone failed", { url, stderr: result.stderr.toString() })
    return false
  }

  // Remove .git to save space — we only need the files
  await fs.rm(path.join(dest, ".git"), { recursive: true, force: true }).catch(() => {})
  return true
}

/** Clone a git repo and extract a subdirectory. */
async function cloneSubdir(url: string, subpath: string, dest: string, ref?: string): Promise<boolean> {
  const tmp = `${dest}.__tmp__`
  await fs.rm(tmp, { recursive: true, force: true }).catch(() => {})

  // Sparse checkout of the subdirectory
  const args = ["git", "clone", "--depth", "1", "--filter=blob:none", "--sparse"]
  if (ref) args.push("--branch", ref)
  args.push(url, tmp)

  log.info("sparse cloning plugin subdir", { url, subpath, dest })
  let result = await $`${args}`.quiet().nothrow()
  if (result.exitCode !== 0) {
    log.error("sparse clone failed", { url, stderr: result.stderr.toString() })
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {})
    return false
  }

  result = await $`git -C ${tmp} sparse-checkout set ${subpath}`.quiet().nothrow()
  if (result.exitCode !== 0) {
    log.error("sparse-checkout set failed", { subpath, stderr: result.stderr.toString() })
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {})
    return false
  }

  // Move the subdirectory to dest
  const src = path.join(tmp, subpath)
  await fs.rm(dest, { recursive: true, force: true }).catch(() => {})
  await fs.rename(src, dest).catch(async () => {
    // rename fails across devices — fallback to copy
    await copyDir(src, dest)
  })

  await fs.rm(tmp, { recursive: true, force: true }).catch(() => {})
  return true
}

/** Install an npm package as a plugin using `npm pack` + extract. */
async function installNpm(pkg: string, dest: string, version?: string, registry?: string): Promise<boolean> {
  const spec = version ? `${pkg}@${version}` : pkg
  const args = ["npm", "pack", spec, "--pack-destination", dest]
  if (registry) args.push("--registry", registry)

  log.info("npm packing plugin", { spec, dest })
  const result = await $`${args}`.quiet().nothrow()
  if (result.exitCode !== 0) {
    log.error("npm pack failed", { spec, stderr: result.stderr.toString() })
    return false
  }

  // npm pack creates a tarball — extract it
  const tarballs = await fs.readdir(dest).then((entries) => entries.filter((e) => e.endsWith(".tgz")))
  if (!tarballs.length) {
    log.error("no tarball created by npm pack", { spec })
    return false
  }

  const tarball = path.join(dest, tarballs[0])
  const extract = await $`tar -xzf ${tarball} -C ${dest} --strip-components=1`.quiet().nothrow()
  if (extract.exitCode !== 0) {
    log.error("tar extract failed", { tarball, stderr: extract.stderr.toString() })
    return false
  }

  // Cleanup tarball
  await fs.rm(tarball, { force: true }).catch(() => {})
  return true
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function copyDir(src: string, dest: string): Promise<boolean> {
  const { readdir, copyFile, mkdir } = fs
  try {
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
    return true
  } catch (err) {
    log.error("copy failed", { src, dest, err })
    return false
  }
}
