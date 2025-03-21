/**
 * Plugin manifest schema and parsing.
 *
 * A plugin manifest lives inside `.liteai-plugin/plugin.json` (or `.claude-plugin/plugin.json`
 * for Claude Code compat). It describes the plugin name, version, and optional overrides
 * for component paths.
 *
 * Discovery order inside a plugin root:
 * 1. `.liteai-plugin/plugin.json`
 * 2. `.claude-plugin/plugin.json`
 * 3. Root `plugin.json` (if it contains a `name` field)
 */

import path from "node:path"
import z from "zod"
import { Filesystem } from "@/util/filesystem"
import { Log } from "@/util/log"

const log = Log.create({ service: "plugin:manifest" })

export const Manifest = z.object({
  name: z.string(),
  version: z.string().optional(),
  description: z.string().optional(),
  author: z
    .object({
      name: z.string(),
      email: z.string().optional(),
      url: z.string().optional(),
    })
    .optional(),
  homepage: z.string().optional(),
  repository: z.string().optional(),
  license: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  // Component path overrides (default to conventional locations)
  commands: z.union([z.string(), z.array(z.string())]).optional(),
  agents: z.union([z.string(), z.array(z.string())]).optional(),
  skills: z.union([z.string(), z.array(z.string())]).optional(),
  hooks: z.union([z.string(), z.array(z.string())]).optional(),
  mcpServers: z.union([z.string(), z.record(z.string(), z.any())]).optional(),
  lspServers: z.string().optional(),
  outputStyles: z.string().optional(),
  settings: z.string().optional(),
})
export type Manifest = z.infer<typeof Manifest>

const MARKER_DIRS = [".liteai-plugin", ".claude-plugin"]
const MANIFEST_FILE = "plugin.json"

/**
 * Parse the plugin manifest from a plugin root directory.
 * Returns `undefined` if no valid manifest is found.
 */
export async function parse(root: string): Promise<{ manifest: Manifest; dir: string } | undefined> {
  // 1. Check marker directories
  for (const marker of MARKER_DIRS) {
    const file = path.join(root, marker, MANIFEST_FILE)
    const result = await tryParse(file)
    if (result) return { manifest: result, dir: path.join(root, marker) }
  }

  // 2. Root plugin.json (must have a `name` field)
  const file = path.join(root, MANIFEST_FILE)
  const result = await tryParse(file)
  if (result) return { manifest: result, dir: root }

  return undefined
}

async function tryParse(file: string): Promise<Manifest | undefined> {
  if (!(await Filesystem.exists(file))) return undefined
  try {
    const raw = await Filesystem.readJson(file)
    const parsed = Manifest.safeParse(raw)
    if (!parsed.success) {
      log.warn("invalid plugin manifest", { path: file, issues: parsed.error.issues })
      return undefined
    }
    return parsed.data
  } catch (err) {
    log.warn("failed to read plugin manifest", { path: file, err })
    return undefined
  }
}
