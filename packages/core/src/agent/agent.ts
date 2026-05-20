import path from "node:path"
import { NamedError } from "@liteai/util/error"
import { Log } from "@liteai/util/log"
import { generateObject, type ModelMessage } from "ai"
import matter from "gray-matter"
import { mergeDeep, pipe, sortBy, values } from "remeda"
import z from "zod"
import { Bundled } from "@/bundled"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { PermissionNext } from "@/permission/next"
import * as Platform from "@/platform"
import { Plugin } from "@/plugin"
import { Config } from "../config/config"
import { Agent as AgentSchema } from "../config/schema"
import { Instance } from "../project/instance"
import { Provider } from "../provider/provider"
import { ModelID, ProviderID } from "../provider/schema"
import { Skill } from "../skill"
import { Truncate } from "../tool/truncation"
import { AgentLoader } from "./loader"

const agentLog = Log.create({ service: "agent" })

/** Remap legacy "build" agent key to "liteai". Logs a warning on migration. */
function migrateLegacyAgentKey(key: string): string {
  if (key === "build") {
    agentLog.warn("migrating legacy agent config key 'build' → 'liteai'", { name: key })
    return "liteai"
  }
  return key
}

/**
 * Parse a bundled agent .md file (raw string with YAML frontmatter) into a
 * Config.Agent object. Uses gray-matter — the same mechanism as user-defined
 * agent .md files — so the schema, merge path, and override behaviour are identical.
 */
function parseBuiltinAgent(raw: string): Config.Agent {
  const { data, content } = matter(raw)
  const config = { ...data, prompt: content.trim() || undefined }
  return AgentSchema.parse(config)
}

const BUILTIN_AGENT_NAMES = ["plan", "liteai", "general", "explore", "compaction", "title", "summary"] as const

/** Load all built-in agents from the unified bundled directory. */
async function loadBuiltinAgents(): Promise<Record<string, Config.Agent>> {
  const agents: Record<string, Config.Agent> = {}
  for (const name of BUILTIN_AGENT_NAMES) {
    const raw = await Bundled.agent(name)
    agents[name] = parseBuiltinAgent(raw)
  }
  return agents
}

export namespace Agent {
  const log = Log.create({ service: "agent" })
  export const Info = z
    .object({
      name: z.string(),
      description: z.string().optional(),
      mode: z.enum(["subagent", "primary", "all"]),
      native: z.boolean().optional(),
      hidden: z.boolean().optional(),
      enabled: z.boolean().optional(),
      topP: z.number().optional(),
      temperature: z.number().optional(),
      color: z.string().optional(),
      permission: PermissionNext.Ruleset,
      model: z
        .object({
          modelID: ModelID.zod,
          providerID: ProviderID.zod,
        })
        .optional(),
      variant: z.string().optional(),
      prompt: z.string().optional(),
      toolChoice: z.enum(["auto", "required", "none"]).optional(),
      options: z.record(z.string(), z.any()),
      steps: z.number().int().positive().optional(),

      tools: z.union([z.string(), z.array(z.string()), z.record(z.string(), z.boolean())]).optional(),
      disallowedTools: z.union([z.string(), z.array(z.string())]).optional(),
      permissionMode: z.enum(["default", "acceptEdits", "dontAsk", "bypassPermissions", "plan", "bubble"]).optional(),
      skills: z.array(z.string()).optional(),
      /**
       * List of MCP servers to use.
       * Can include global server names (strings) or inline configs of the shape:
       * `{ "<serverName>": McpConfig }`
       */
      mcpServers: z.array(z.union([z.string(), z.record(z.string(), z.any())])).optional(),
      effort: z.enum(["low", "medium", "high", "max"]).optional(),
      memory: z.enum(["user", "project", "local"]).optional(),
      background: z.boolean().optional(),
      isolation: z.enum(["worktree", "remote"]).optional(),
      hooks: z.record(z.string(), z.any()).optional(),
      thinking: z.boolean().optional(),
      thinkingBudget: z.number().int().positive().optional(),
      timeout: z.number().int().positive().optional(),
      criticalSystemReminder: z.string().optional(),
      requiredMcpServers: z.array(z.string()).optional(),
      omitLiteaiMd: z.boolean().optional(),
      initialPrompt: z.string().optional(),
      containerImage: z.string().optional(),
    })
    .meta({
      ref: "Agent",
    })
  export type Info = z.infer<typeof Info>

  export interface BaseAgentDefinition extends Info {
    source: "builtIn" | "custom" | "plugin"
  }

  export interface BuiltInAgentDefinition extends BaseAgentDefinition {
    source: "builtIn"
    native: true
    getSystemPrompt?: () => Promise<string>
  }

  export interface CustomAgentDefinition extends BaseAgentDefinition {
    source: "custom"
    native: false
    filePath?: string
  }

  export interface PluginAgentDefinition extends BaseAgentDefinition {
    source: "plugin"
    native: false
    pluginId?: string
  }

  /**
   * Represents the comprehensive configuration for an agent.
   * Note: If providing inline `mcpServers`, each inline specification MUST be an object
   * with exactly one key mapping the server's name to its configuration:
   * e.g., `{ "<serverName>": McpConfig }`
   */
  export type AgentDefinition = BuiltInAgentDefinition | CustomAgentDefinition | PluginAgentDefinition

  export function isBuiltInAgent(agent: AgentDefinition): agent is BuiltInAgentDefinition {
    return agent.source === "builtIn"
  }

  export function isCustomAgent(agent: AgentDefinition): agent is CustomAgentDefinition {
    return agent.source === "custom"
  }

  export function isPluginAgent(agent: AgentDefinition): agent is PluginAgentDefinition {
    return agent.source === "plugin"
  }

  export interface RunAgentResult {
    agentId: string
    status: "completed" | "failed" | "killed"
    result: string
    usage: {
      totalTokens: number
      toolCalls: number
      duration: number
      worktreeInfo?: unknown
    }
    partialResult?: string
    error?: Error
  }

  const state = Instance.state(async () => {
    log.info("loading agents")
    const cfg = await Config.get()

    const skillDirs = await Skill.dirs()
    const whitelistedDirs = [Truncate.GLOB, ...skillDirs.map((dir) => path.join(dir, "*"))]
    const defaults = PermissionNext.fromConfig({
      "*": "allow",
      edit: "ask",
      doom_loop: "ask",
      external_directory: {
        "*": "ask",
        ...Object.fromEntries(whitelistedDirs.map((dir) => [dir, "allow"])),
      },
      // mirrors github.com/github/gitignore Node.gitignore pattern for .env files
      read: {
        "*": "allow",
        "*.env": "ask",
        "*.env.*": "ask",
        "*.env.example": "allow",
      },
    })
    const user = PermissionNext.fromConfig(cfg.permission ?? {})

    const result: Record<string, AgentDefinition> = {}

    // Populate built-in declarative agents via the same merge path as user config.
    // This allows user config to override or disable any built-in agent.
    const builtinAgents = await loadBuiltinAgents()
    for (const [key, value] of Object.entries(builtinAgents)) {
      result[key] = {
        name: key,
        mode: value.mode ?? "all",
        permission: PermissionNext.merge(defaults, user),
        options: {},
        prompt: value.prompt,
        description: value.description,
        toolChoice: value.toolChoice,
        temperature: value.temperature,
        topP: value.top_p,
        hidden: value.hidden,
        tools: value.tools,
        disallowedTools: value.disallowedTools,
        permissionMode: value.permissionMode,
        skills: value.skills,
        mcpServers: value.mcpServers,
        effort: value.effort,
        memory: value.memory,
        background: value.background,
        isolation: value.isolation,
        hooks: value.hooks,
        thinking: value.thinking,
        thinkingBudget: value.thinkingBudget,
        timeout: value.timeout,
        criticalSystemReminder: value.criticalSystemReminder,
        requiredMcpServers: value.requiredMcpServers,
        omitLiteaiMd: value.omitLiteaiMd,
        initialPrompt: value.initialPrompt,
        containerImage: value.containerImage,
        native: true,
        source: "builtIn",
        getSystemPrompt: async () => value.prompt ?? "",
      } as BuiltInAgentDefinition
    }

    const { ForkAgentConfig } = await import("./fork")
    result[ForkAgentConfig.agentType] = {
      name: ForkAgentConfig.agentType,
      mode: "subagent",
      permission: PermissionNext.merge(defaults, user),
      options: {},
      tools: ForkAgentConfig.tools,
      permissionMode: ForkAgentConfig.permissionMode,
      background: ForkAgentConfig.background,
      timeout: ForkAgentConfig.wallClockTimeout,
      steps: ForkAgentConfig.maxTurns,
      native: true,
      source: ForkAgentConfig.source,
      getSystemPrompt: async () => "",
    } as BuiltInAgentDefinition

    const dirs = await Config.directories()
    const platformAgents = await AgentLoader.loadPlatformAgents()
    let projectAgents: Record<string, z.infer<typeof AgentSchema>> = {}
    for (const dir of dirs) {
      projectAgents = mergeDeep(projectAgents, await AgentLoader.loadAgent(dir))
    }

    // Merge order: platform -> settings -> project directory agents
    const cfgAgent = mergeDeep(mergeDeep(platformAgents, cfg.agent ?? {}), projectAgents)

    for (const [key, value] of Object.entries(cfgAgent)) {
      // Migration: remap legacy "build" config key to "liteai"
      const resolvedKey = migrateLegacyAgentKey(key)

      log.info("processing agent config", { name: resolvedKey })
      // Hidden built-in agents (compaction, title, summary) are protected system agents.
      // Skip user config entries for them to prevent accidental breakage.
      if (result[resolvedKey]?.hidden) {
        log.warn("ignoring user config for protected hidden agent", { name: resolvedKey })
        continue
      }
      let isDisabled = !!value.disable
      if (resolvedKey === "liteai" && isDisabled) {
        log.warn("ignoring disable config for foundational agent", { name: resolvedKey })
        isDisabled = false
      }

      let item = result[resolvedKey]
      if (!item) {
        const valRecord = value as Record<string, unknown>
        const rawSource = valRecord.source
        const source = rawSource === "plugin" ? "plugin" : "custom"

        const base: Record<string, unknown> = {
          name: resolvedKey,
          mode: "all",
          permission: PermissionNext.merge(defaults, user),
          options: {},
          native: false,
          source,
        }

        if (source === "custom" && typeof valRecord.filePath === "string") {
          base.filePath = valRecord.filePath
        } else if (source === "plugin" && typeof valRecord.pluginId === "string") {
          base.pluginId = valRecord.pluginId
        }

        item = result[resolvedKey] = base as unknown as AgentDefinition
      }
      if (value.model) item.model = Provider.parseModel(value.model)
      item.variant = value.variant ?? item.variant
      item.prompt = value.prompt ?? item.prompt
      item.description = value.description ?? item.description
      item.toolChoice = value.toolChoice ?? item.toolChoice
      item.temperature = value.temperature ?? item.temperature
      item.topP = value.top_p ?? item.topP
      item.mode = value.mode ?? item.mode
      item.color = value.color ?? item.color
      item.hidden = value.hidden ?? item.hidden
      item.enabled = !isDisabled
      item.name = value.name ?? item.name
      item.steps = value.maxTurns ?? value.steps ?? item.steps

      const profile = Platform.active()
      item.tools = value.tools ? Platform.normalizeToolNames(value.tools, profile?.toolNameMap) : item.tools
      item.disallowedTools = value.disallowedTools
        ? Platform.normalizeToolNames(value.disallowedTools, profile?.toolNameMap)
        : item.disallowedTools
      item.permissionMode = value.permissionMode ?? item.permissionMode
      item.skills = value.skills ?? item.skills
      item.mcpServers = value.mcpServers ?? item.mcpServers
      item.effort = value.effort ?? item.effort
      item.memory = value.memory ?? item.memory
      item.background = value.background ?? item.background
      item.isolation = value.isolation ?? item.isolation
      item.hooks = value.hooks ?? item.hooks
      item.thinking = value.thinking ?? item.thinking
      item.thinkingBudget = value.thinkingBudget ?? item.thinkingBudget
      item.timeout = value.timeout ?? item.timeout
      item.criticalSystemReminder = value.criticalSystemReminder ?? item.criticalSystemReminder
      item.requiredMcpServers = value.requiredMcpServers ?? item.requiredMcpServers
      item.omitLiteaiMd = value.omitLiteaiMd ?? item.omitLiteaiMd
      item.initialPrompt = value.initialPrompt ?? item.initialPrompt
      item.containerImage = value.containerImage ?? item.containerImage

      item.options = mergeDeep(item.options, value.options ?? {})

      // Platform compatibility: map provider-specific fields (e.g., Claude Code's
      // tools/disallowedTools/permissionMode) to LiteAI permission rules.
      // Agent-level `permission` in YAML is deprecated — tool visibility is now
      // handled by tools/disallowedTools. Only platform compat transforms survive.
      const compat = profile?.permissionTransform?.(value)
      if (compat) item.permission = PermissionNext.merge(item.permission, compat)
    }

    // Ensure Truncate.GLOB is allowed unless explicitly configured
    for (const name in result) {
      const agent = result[name]
      const explicit = agent.permission.some((r) => {
        if (r.permission !== "external_directory") return false
        if (r.action !== "deny") return false
        return r.pattern === Truncate.GLOB
      })
      if (explicit) continue

      result[name].permission = PermissionNext.merge(
        result[name].permission,
        PermissionNext.fromConfig({ external_directory: { [Truncate.GLOB]: "allow" } }),
      )
    }

    log.info("agents loaded", { count: Object.keys(result).length, names: Object.keys(result).join(", ") })
    return result
  })

  export const AgentDisabledError = NamedError.create(
    "AgentDisabledError",
    z.object({
      agent: z.string(),
      message: z.string().optional(),
    }),
  )

  export async function get(agent: string) {
    const item = await state().then((x) => x[agent])
    if (item && item.enabled === false) {
      throw new AgentDisabledError({ message: `Agent '${agent}' is disabled.`, agent })
    }
    return item
  }

  export async function list() {
    const cfg = await Config.get()
    return pipe(
      await state(),
      values(),
      sortBy([(x) => (cfg.default_agent ? x.name === cfg.default_agent : x.name === "plan"), "desc"]),
    )
  }

  export const Event = {
    Updated: BusEvent.define("agent.updated", z.object({ agents: Agent.Info.array() })),
  }

  export async function reload() {
    state.invalidate()
    const agents = await list()
    Bus.publish(Agent.Event.Updated, { agents })
  }

  export async function defaultAgent() {
    const cfg = await Config.get()
    const agents = await state()

    if (cfg.default_agent) {
      // Migration: remap legacy "build" default_agent to "liteai"
      const resolvedDefault = migrateLegacyAgentKey(cfg.default_agent)

      const agent = agents[resolvedDefault]
      if (agent && agent.mode !== "subagent" && agent.hidden !== true && agent.enabled !== false) {
        return agent.name
      }
    }

    const primaryVisible = Object.values(agents).find(
      (a) => a.mode !== "subagent" && a.hidden !== true && a.enabled !== false,
    )
    if (!primaryVisible) {
      log.warn("no primary visible agent found, falling back to foundational 'liteai' agent")
      return "liteai"
    }
    return primaryVisible.name
  }

  export async function generate(input: { description: string; model?: { providerID: ProviderID; modelID: ModelID } }) {
    const defaultModel = input.model ?? (await Provider.defaultModel())
    if (!defaultModel) throw new Error("no model available: connect a provider first")
    const model = await Provider.getModel(defaultModel.providerID, defaultModel.modelID)
    const language = await Provider.getLanguage(model)

    const system = [await Bundled.agentPrompt("generate")]
    await Plugin.trigger("experimental.chat.system.transform", { model }, { system })
    const existing = await list()

    const params = {
      temperature: 0.3,
      experimental_telemetry: { isEnabled: true, functionId: "agent.generate-config" },
      messages: [
        ...system.map(
          (item): ModelMessage => ({
            role: "system",
            content: item,
          }),
        ),
        {
          role: "user",
          content: `Create an agent configuration based on this request: "${input.description}".\n\nIMPORTANT: The following identifiers already exist and must NOT be used: ${existing.map((i) => i.name).join(", ")}\n  Return ONLY the JSON object, no other text, do not wrap in backticks`,
        },
      ],
      model: language,
      schema: z.object({
        identifier: z.string(),
        whenToUse: z.string(),
        systemPrompt: z.string(),
      }),
    } satisfies Parameters<typeof generateObject>[0]

    const result = await generateObject(params)
    return result.object
  }
}
