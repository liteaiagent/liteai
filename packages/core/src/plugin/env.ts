/**
 * Plugin environment variable expansion.
 *
 * Sets and expands plugin-specific env vars in MCP configs, hook commands,
 * and skill shell substitutions:
 *
 * | Variable                   | Description                                    |
 * |----------------------------|------------------------------------------------|
 * | `LITEAI_PLUGIN_ROOT`       | Absolute path to the plugin directory           |
 * | `LITEAI_PLUGIN_DATA`       | Persistent data dir for this plugin             |
 * | `CLAUDE_PLUGIN_ROOT`       | Alias for `LITEAI_PLUGIN_ROOT` (compat)         |
 * | `CLAUDE_PLUGIN_DATA`       | Alias for `LITEAI_PLUGIN_DATA` (compat)         |
 */

import path from "node:path"
import { Global } from "@/global"

/** Compute the persistent data directory for a plugin. */
export function data(id: string) {
  const normalized = id.replace(/[^a-zA-Z0-9_-]/g, "_")
  return path.join(Global.Path.config, "plugins", "data", normalized)
}

/**
 * Return a record of plugin env vars for a given plugin root and id.
 * These can be merged into `process.env` or used for env expansion.
 */
export function vars(root: string, id: string): Record<string, string> {
  const dir = data(id)
  return {
    LITEAI_PLUGIN_ROOT: root,
    LITEAI_PLUGIN_DATA: dir,
    CLAUDE_PLUGIN_ROOT: root,
    CLAUDE_PLUGIN_DATA: dir,
  }
}

/**
 * Expand `${LITEAI_PLUGIN_ROOT}`, `${LITEAI_PLUGIN_DATA}`,
 * `${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}` in a string.
 */
export function expand(input: string, root: string, id: string): string {
  const env = vars(root, id)
  return input.replace(/\$\{([^}]+)\}/g, (match, name) => {
    if (name in env) return env[name]
    return match
  })
}

/** Recursively expand plugin env vars in all string values of an object. */
export function expandDeep<T>(value: T, root: string, id: string): T {
  if (typeof value === "string") return expand(value, root, id) as T
  if (Array.isArray(value)) return value.map((v) => expandDeep(v, root, id)) as T
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      out[k] = expandDeep(v, root, id)
    }
    return out as T
  }
  return value
}
