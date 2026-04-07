/**
 * `.mcp.json` project-scope file support.
 *
 * Claude Code uses a `.mcp.json` file at the project root for version-controlled
 * MCP server configs. This module discovers, parses, and adapts that format into
 * LiteAI's `Config.Mcp` entries.
 *
 * Claude Code format:
 *   { "mcpServers": { "<name>": { command, args, env } | { type: "http", url, headers } } }
 *
 * LiteAI format:
 *   { "<name>": { type: "local", command: string, args: string[], env: Record<string, string> } | { type: "remote", url, headers } }
 */

import { Filesystem } from "@/util/filesystem"
import { Log } from "@/util/log"

const log = Log.create({ service: "config.mcp-json" })

type McpJsonEntry = {
  command?: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  type?: string
  url?: string
  headers?: Record<string, string>
  oauth?: Record<string, unknown> | false
  disabled?: boolean
  timeout?: number
}

type McpJsonFile = {
  mcpServers?: Record<string, McpJsonEntry>
}

type Adapted =
  | {
      type: "local"
      command: string
      args?: string[]
      env?: Record<string, string>
      cwd?: string
      disabled?: boolean
      timeout?: number
    }
  | {
      type: "remote"
      url: string
      headers?: Record<string, string>
      oauth?: Record<string, unknown> | false
      disabled?: boolean
      timeout?: number
    }

/** Adapt a single Claude Code `.mcp.json` entry to LiteAI `Config.Mcp`. */
function adapt(name: string, entry: McpJsonEntry): Adapted | undefined {
  if (entry.type === "http" || entry.type === "sse" || entry.url) {
    if (!entry.url) {
      log.warn("mcp.json entry has remote type but no url", { name })
      return undefined
    }
    return {
      type: "remote",
      url: entry.url,
      ...(entry.headers && { headers: entry.headers }),
      ...(entry.oauth !== undefined && { oauth: entry.oauth }),
      ...(entry.disabled !== undefined && { disabled: entry.disabled }),
      ...(entry.timeout !== undefined && { timeout: entry.timeout }),
    }
  }

  if (entry.command) {
    return {
      type: "local",
      command: entry.command,
      ...(entry.args && { args: entry.args }),
      ...(entry.env && { env: entry.env }),
      ...(entry.cwd && { cwd: entry.cwd }),
      ...(entry.disabled !== undefined && { disabled: entry.disabled }),
      ...(entry.timeout !== undefined && { timeout: entry.timeout }),
    }
  }

  log.warn("mcp.json entry missing command or url", { name })
  return undefined
}

/** Parse a single `.mcp.json` file and return adapted MCP config entries. */
async function parse(file: string): Promise<Record<string, Adapted>> {
  const result: Record<string, Adapted> = {}
  let raw: McpJsonFile
  try {
    raw = await Filesystem.readJson<McpJsonFile>(file)
  } catch (err) {
    log.warn("failed to parse .mcp.json", { path: file, err })
    return result
  }

  const servers = raw.mcpServers ?? raw
  if (typeof servers !== "object" || Array.isArray(servers)) {
    log.warn(".mcp.json has unexpected shape", { path: file })
    return result
  }

  for (const [name, entry] of Object.entries(servers as Record<string, McpJsonEntry>)) {
    if (name === "mcpServers") continue
    const adapted = adapt(name, entry)
    if (adapted) {
      log.info("loaded mcp server from .mcp.json", { name, path: file })
      result[name] = adapted
    }
  }

  return result
}

/**
 * Scan for `.mcp.json` files from `start` up to `stop` and return adapted
 * MCP config entries. Files closer to `start` take precedence.
 */
export async function load(start: string, stop: string): Promise<Record<string, Adapted>> {
  const result: Record<string, Adapted> = {}
  const files = await Filesystem.findUp(".mcp.json", start, stop)

  // Process in reverse (root → project) so project-level wins
  for (const file of files.toReversed()) {
    Object.assign(result, await parse(file))
  }

  return result
}

/** Load a single `.mcp.json` from a specific path. Returns empty if missing. */
export async function loadFile(filepath: string): Promise<Record<string, Adapted>> {
  if (!(await Filesystem.exists(filepath))) return {}
  return parse(filepath)
}
