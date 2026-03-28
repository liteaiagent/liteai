/**
 * Marketplace manifest schema and known marketplaces management.
 *
 * A marketplace is a curated catalog of plugins distributed via a Git repo,
 * local directory, or remote URL. The catalog lives inside
 * `.liteai-plugin/marketplace.json` (or `.claude-plugin/marketplace.json`
 * for Claude Code compat).
 *
 * Known marketplaces are stored at `~/.liteai/plugins/known_marketplaces.json`.
 */

import fs from "node:fs/promises"
import path from "node:path"
import z from "zod"
import { Global } from "@/global"
import { Filesystem } from "@/util/filesystem"
import { Log } from "@/util/log"

const log = Log.create({ service: "plugin:marketplace" })

// ---------------------------------------------------------------------------
// Source schemas
// ---------------------------------------------------------------------------

export const GithubSource = z.object({
  source: z.literal("github"),
  repo: z.string(),
  ref: z.string().optional(),
  sha: z.string().optional(),
})
export type GithubSource = z.infer<typeof GithubSource>

export const UrlSource = z.object({
  source: z.literal("url"),
  url: z.string(),
  ref: z.string().optional(),
  sha: z.string().optional(),
})
export type UrlSource = z.infer<typeof UrlSource>

export const GitSubdirSource = z.object({
  source: z.literal("git-subdir"),
  url: z.string(),
  path: z.string(),
  ref: z.string().optional(),
  sha: z.string().optional(),
})
export type GitSubdirSource = z.infer<typeof GitSubdirSource>

export const NpmSource = z.object({
  source: z.literal("npm"),
  package: z.string(),
  version: z.string().optional(),
  registry: z.string().optional(),
})
export type NpmSource = z.infer<typeof NpmSource>

export const PluginSource = z.union([
  z.string(), // relative path ("./plugins/foo")
  GithubSource,
  UrlSource,
  GitSubdirSource,
  NpmSource,
])
export type PluginSource = z.infer<typeof PluginSource>

export const PluginEntry = z.object({
  name: z.string(),
  source: PluginSource,
  description: z.string().optional(),
  version: z.string().optional(),
  author: z
    .object({
      name: z.string(),
      email: z.string().optional(),
    })
    .optional(),
  category: z.string().optional(),
  tags: z.array(z.string()).optional(),
  strict: z.boolean().optional(),
  // Inline overrides (same as plugin.json fields)
  commands: z.any().optional(),
  agents: z.any().optional(),
  hooks: z.any().optional(),
  mcpServers: z.any().optional(),
  lspServers: z.any().optional(),
})
export type PluginEntry = z.infer<typeof PluginEntry>

export const Manifest = z.object({
  name: z.string(),
  owner: z.object({
    name: z.string(),
    email: z.string().optional(),
  }),
  metadata: z
    .object({
      description: z.string().optional(),
      version: z.string().optional(),
      pluginRoot: z.string().optional(),
    })
    .optional(),
  plugins: z.array(PluginEntry),
})
export type Manifest = z.infer<typeof Manifest>

// ---------------------------------------------------------------------------
// Known marketplaces storage
// ---------------------------------------------------------------------------

export const MarketplaceRef = z.object({
  source: z.union([GithubSource, UrlSource, z.string()]),
  added: z.string().optional(),
  displayName: z.string().optional(),
})
export type MarketplaceRef = z.infer<typeof MarketplaceRef>

const Known = z.record(z.string(), MarketplaceRef)
type Known = z.infer<typeof Known>

function file() {
  return path.join(Global.Path.config, "plugins", "known_marketplaces.json")
}

/** Root directory for cloned marketplace repos. */
export function root() {
  return path.join(Global.Path.config, "plugins", "marketplaces")
}

/** Directory for a specific marketplace clone. */
export function dir(name: string) {
  return path.join(root(), name)
}

/** Read known marketplaces from disk. */
export async function known(): Promise<Known> {
  const p = file()
  if (!(await Filesystem.exists(p))) return {}
  const raw = await Filesystem.readJson(p).catch(() => ({}))
  const parsed = Known.safeParse(raw)
  return parsed.success ? parsed.data : {}
}

/** Write known marketplaces to disk. */
async function save(data: Known) {
  await fs.mkdir(path.dirname(file()), { recursive: true })
  await Filesystem.writeJson(file(), data)
}

/** Add a marketplace to known_marketplaces.json. */
export async function add(name: string, ref: MarketplaceRef) {
  const all = await known()
  all[name] = ref
  await save(all)
  log.info("added marketplace", { name })
}

/** Remove a marketplace from known_marketplaces.json. */
export async function remove(name: string) {
  const all = await known()
  delete all[name]
  await save(all)

  // Remove cloned files
  const cloned = dir(name)
  await fs.rm(cloned, { recursive: true, force: true }).catch(() => {})
  log.info("removed marketplace", { name })
}

// ---------------------------------------------------------------------------
// Manifest parsing from a marketplace directory
// ---------------------------------------------------------------------------

const MARKER_DIRS = [".liteai-plugin", ".claude-plugin"]
const MANIFEST_FILE = "marketplace.json"

/**
 * Parse the marketplace manifest from a marketplace root directory.
 * Searches: `.liteai-plugin/marketplace.json`, `.claude-plugin/marketplace.json`,
 * then root `marketplace.json`.
 */
export async function parse(root: string): Promise<Manifest | undefined> {
  for (const marker of MARKER_DIRS) {
    const p = path.join(root, marker, MANIFEST_FILE)
    const result = await tryParse(p)
    if (result) return result
  }

  const p = path.join(root, MANIFEST_FILE)
  return tryParse(p)
}

async function tryParse(file: string): Promise<Manifest | undefined> {
  if (!(await Filesystem.exists(file))) return undefined
  const raw = await Filesystem.readJson(file).catch(() => undefined)
  if (!raw) return undefined
  const parsed = Manifest.safeParse(raw)
  if (!parsed.success) {
    log.warn("invalid marketplace manifest", { path: file, issues: parsed.error.issues })
    return undefined
  }
  return parsed.data
}

/**
 * Find a plugin entry by name inside a marketplace manifest.
 * Supports `name` or `name@marketplace`.
 */
export function find(manifest: Manifest, name: string): PluginEntry | undefined {
  return manifest.plugins.find((p) => p.name === name)
}

/**
 * List all plugins in a marketplace.
 */
export function plugins(manifest: Manifest): PluginEntry[] {
  return manifest.plugins
}

/**
 * Format a marketplace listing for display.
 */
export function format(manifest: Manifest): string {
  const lines = [`**${manifest.name}** (by ${manifest.owner.name})`]
  if (manifest.metadata?.description) lines.push(manifest.metadata.description)
  lines.push("")
  if (!manifest.plugins.length) {
    lines.push("_No plugins in this marketplace._")
    return lines.join("\n")
  }
  lines.push(`**Plugins (${manifest.plugins.length}):**\n`)
  for (const plugin of manifest.plugins) {
    const desc = plugin.description ? ` — ${plugin.description}` : ""
    const ver = plugin.version ? ` v${plugin.version}` : ""
    const tags = plugin.tags?.length ? ` [${plugin.tags.join(", ")}]` : ""
    lines.push(`- **${plugin.name}**${ver}${desc}${tags}`)
  }
  return lines.join("\n")
}
