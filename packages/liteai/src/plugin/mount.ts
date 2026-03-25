/**
 * Plugin mounting.
 *
 * Wires loaded plugin components into the existing config / skill / agent /
 * hook / MCP systems. All components are merged with their namespace prefix.
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
  mcp: Record<string, Config.Mcp>
  commands: Record<string, Config.Command>
  agents: Record<string, Config.Agent>
  hooks: Record<string, unknown>
  skills: Array<{
    name: string
    description: string
    location: string
    content: string
    [key: string]: unknown
  }>
  env: Record<string, string>
}

function empty(): Mounted {
  return { mcp: {}, commands: {}, agents: {}, hooks: {}, skills: [], env: {} }
}

export function one(plugin: Loaded): Mounted {
  const result = empty()

  log.info("mounting plugin", { name: plugin.name, root: plugin.root })

  const env = vars(plugin.root, plugin.name)
  Object.assign(result.env, env)

  fs.mkdir(env.LITEAI_PLUGIN_DATA, { recursive: true }).catch(() => {})

  for (const [name, cmd] of Object.entries(plugin.commands)) result.commands[name] = cmd
  for (const [name, agent] of Object.entries(plugin.agents)) result.agents[name] = agent
  for (const skill of plugin.skills) result.skills.push(skill)

  if (plugin.hooks) {
    result.hooks = mergeDeep(result.hooks as Record<string, unknown>, plugin.hooks as Record<string, unknown>)
  }

  if (plugin.mcp) {
    for (const [name, mcp] of Object.entries(plugin.mcp)) result.mcp[name] = mcp
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

export function all(plugins: Loaded[]): Mounted {
  const result = empty()

  for (const plugin of plugins) {
    const mounted = one(plugin)
    Object.assign(result.mcp, mounted.mcp)
    Object.assign(result.commands, mounted.commands)
    Object.assign(result.agents, mounted.agents)
    result.skills.push(...mounted.skills)
    result.hooks = mergeDeep(result.hooks as Record<string, unknown>, mounted.hooks as Record<string, unknown>)
    Object.assign(result.env, mounted.env)
  }

  return result
}

/**
 * Apply mounted plugin components to a config.
 * All components are merged on top of the existing config.
 */
export function apply(config: Config.Info, mounted: Mounted): Config.Info {
  const result = { ...config }

  if (Object.keys(mounted.commands).length) {
    result.command = mergeDeep(result.command ?? {}, mounted.commands)
  }

  if (Object.keys(mounted.agents).length) {
    result.agent = mergeDeep(result.agent ?? {}, mounted.agents)
  }

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

  if (Object.keys(mounted.mcp).length) {
    result.mcp = { ...mounted.mcp, ...result.mcp }
  }

  for (const [key, val] of Object.entries(mounted.env)) {
    process.env[key] = val
  }

  return result
}
