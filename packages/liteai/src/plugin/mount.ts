/**
 * Plugin mounting.
 *
 * Wires loaded plugin components into the existing config / skill / agent /
 * hook / MCP systems. Plugin settings are merged as lowest-priority defaults,
 * and all other components are merged or registered with their namespace prefix.
 */

import fs from "node:fs/promises"
import { mergeDeep } from "remeda"
import type { Config } from "@/config/config"
import { Log } from "@/util/log"
import { vars } from "./env"
import type { Loaded } from "./loader"

const log = Log.create({ service: "plugin:mount" })

/** Result of mounting one or more plugins into a config. */
export type Mounted = {
  /** Extra MCP configs to add. */
  mcp: Record<string, Config.Mcp>
  /** Extra commands to add. */
  commands: Record<string, Config.Command>
  /** Extra agents to add. */
  agents: Record<string, Config.Agent>
  /** Extra hook groups to merge into dispatch. */
  hooks: Record<string, unknown>
  /** Plugin-sourced skills (registered separately via Skill). */
  skills: Array<{
    name: string
    description: string
    location: string
    content: string
    [key: string]: unknown
  }>
  /** Lowest-priority config defaults from plugin settings. */
  settings: Config.Info
  /** Env vars to set for each plugin. */
  env: Record<string, string>
}

function empty(): Mounted {
  return {
    mcp: {},
    commands: {},
    agents: {},
    hooks: {},
    skills: [],
    settings: {},
    env: {},
  }
}

/**
 * Mount a single loaded plugin, returning the components to merge.
 */
export function one(plugin: Loaded): Mounted {
  const result = empty()

  log.info("mounting plugin", { name: plugin.name, root: plugin.root })

  // Environment variables
  const env = vars(plugin.root, plugin.name)
  Object.assign(result.env, env)

  // Ensure persistent data directory exists
  fs.mkdir(env.LITEAI_PLUGIN_DATA, { recursive: true }).catch(() => {})

  // Commands
  for (const [name, cmd] of Object.entries(plugin.commands)) {
    result.commands[name] = cmd
  }

  // Agents
  for (const [name, agent] of Object.entries(plugin.agents)) {
    result.agents[name] = agent
  }

  // Skills
  for (const skill of plugin.skills) {
    result.skills.push(skill)
  }

  // Hooks
  if (plugin.hooks) {
    result.hooks = mergeDeep(result.hooks as Record<string, unknown>, plugin.hooks as Record<string, unknown>)
  }

  // MCP servers
  if (plugin.mcp) {
    for (const [name, mcp] of Object.entries(plugin.mcp)) {
      result.mcp[name] = mcp
    }
  }

  // Settings (lowest priority)
  if (plugin.settings) {
    result.settings = mergeDeep(result.settings, plugin.settings)
  }

  log.info("mounted plugin", {
    name: plugin.name,
    commands: Object.keys(result.commands).length,
    agents: Object.keys(result.agents).length,
    skills: result.skills.length,
    hooks: Object.keys(result.hooks).length,
    mcp: Object.keys(result.mcp).length,
  })

  return result
}

/**
 * Mount multiple loaded plugins, merging all their components.
 * Later plugins override earlier ones on collision.
 */
export function all(plugins: Loaded[]): Mounted {
  const result = empty()

  for (const plugin of plugins) {
    const mounted = one(plugin)
    Object.assign(result.mcp, mounted.mcp)
    Object.assign(result.commands, mounted.commands)
    Object.assign(result.agents, mounted.agents)
    result.skills.push(...mounted.skills)
    result.hooks = mergeDeep(result.hooks as Record<string, unknown>, mounted.hooks as Record<string, unknown>)
    result.settings = mergeDeep(result.settings, mounted.settings)
    Object.assign(result.env, mounted.env)
  }

  return result
}

/**
 * Apply mounted plugin components to a config.
 * Plugin settings are merged as lowest priority (underneath the existing config).
 * All other components are merged on top.
 */
export function apply(config: Config.Info, mounted: Mounted): Config.Info {
  // Start with plugin settings as base (lowest priority)
  const result = mergeDeep(mounted.settings, config)

  // Merge commands
  if (Object.keys(mounted.commands).length) {
    result.command = mergeDeep(result.command ?? {}, mounted.commands)
  }

  // Merge agents
  if (Object.keys(mounted.agents).length) {
    result.agent = mergeDeep(result.agent ?? {}, mounted.agents)
  }

  // Merge hooks
  if (Object.keys(mounted.hooks).length) {
    const existing = (result.hooks ?? {}) as Record<string, unknown[]>
    const incoming = mounted.hooks as Record<string, unknown[]>
    for (const [event, groups] of Object.entries(incoming)) {
      if (!existing[event]) existing[event] = []
      existing[event].push(...(Array.isArray(groups) ? groups : [groups]))
    }
    // biome-ignore lint/suspicious/noExplicitAny: hooks type is complex
    result.hooks = existing as any
  }

  // Merge MCP servers
  if (Object.keys(mounted.mcp).length) {
    result.mcp = { ...mounted.mcp, ...result.mcp }
  }

  // Set plugin env vars in process.env so env expansion picks them up
  for (const [key, val] of Object.entries(mounted.env)) {
    process.env[key] = val
  }

  return result
}
