import path from "node:path"
import { generateObject, type ModelMessage, streamObject } from "ai"
import matter from "gray-matter"
import { mergeDeep, pipe, sortBy, values } from "remeda"
import z from "zod"
import { PermissionNext } from "@/permission/next"
import { Plugin } from "@/plugin"
import { Log } from "@/util/log"
import { Auth } from "../auth"
import { Config } from "../config/config"
import { Agent as AgentSchema } from "../config/schema"
import { Instance } from "../project/instance"
import { Provider } from "../provider/provider"
import { ModelID, ProviderID } from "../provider/schema"
import { ProviderTransform } from "../provider/transform"
import { SystemPrompt } from "../session/engine/system"
import { Skill } from "../skill"
import { Truncate } from "../tool/truncation"
import AGENT_BUILD from "./agents/build.md?raw"
import AGENT_COMPACTION from "./agents/compaction.md?raw"
import AGENT_EXPLORE from "./agents/explore.md?raw"
import AGENT_GENERAL from "./agents/general.md?raw"
import AGENT_PLAN from "./agents/plan.md?raw"
import AGENT_SUMMARY from "./agents/summary.md?raw"
import AGENT_TITLE from "./agents/title.md?raw"
import PROMPT_GENERATE from "./prompt/generate.md?raw"

/**
 * Built-in declarative agents defined as .md files with YAML frontmatter.
 * Parsed once at module load using gray-matter — the same mechanism as user-defined
 * agent .md files — so the schema, merge path, and override behaviour are identical.
 */
function parseBuiltinAgent(raw: string): Config.Agent {
  const { data, content } = matter(raw)
  const config = { ...data, prompt: content.trim() || undefined }
  return AgentSchema.parse(config)
}

const builtinAgents: Record<string, Config.Agent> = {
  plan: parseBuiltinAgent(AGENT_PLAN),
  build: parseBuiltinAgent(AGENT_BUILD),
  general: parseBuiltinAgent(AGENT_GENERAL),
  explore: parseBuiltinAgent(AGENT_EXPLORE),
  compaction: parseBuiltinAgent(AGENT_COMPACTION),
  title: parseBuiltinAgent(AGENT_TITLE),
  summary: parseBuiltinAgent(AGENT_SUMMARY),
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
      options: z.record(z.string(), z.any()),
      steps: z.number().int().positive().optional(),
    })
    .meta({
      ref: "Agent",
    })
  export type Info = z.infer<typeof Info>

  /** Map Claude Code agent frontmatter (tools / disallowedTools / permissionMode) to permission rules. */
  function ccPermission(value: Config.Agent): PermissionNext.Ruleset | undefined {
    const rules: Config.Permission = {}
    let any = false

    // permissionMode presets
    if (value.permissionMode === "dontAsk" || value.permissionMode === "bypassPermissions") {
      rules["*"] = "allow"
      any = true
    } else if (value.permissionMode === "plan") {
      Object.assign(rules, { "*": "deny", read: "allow", grep: "allow", glob: "allow", list: "allow" })
      any = true
    } else if (value.permissionMode === "acceptEdits") {
      Object.assign(rules, { edit: "allow", write: "allow" })
      any = true
    }

    // tools: allowed tool list (implies *:deny base)
    if (value.tools) {
      const list =
        typeof value.tools === "string"
          ? value.tools.split(",").map((t) => t.trim().toLowerCase())
          : Array.isArray(value.tools)
            ? value.tools.map((t) => t.toLowerCase())
            : Object.entries(value.tools)
                .filter(([, v]) => v)
                .map(([k]) => k.toLowerCase())
      if (list.length) {
        rules["*"] = "deny"
        for (const t of list) rules[t] = "allow"
        any = true
      }
    }

    // disallowedTools: denied tool list
    if (value.disallowedTools) {
      const list =
        typeof value.disallowedTools === "string"
          ? value.disallowedTools.split(",").map((t) => t.trim().toLowerCase())
          : value.disallowedTools.map((t) => t.toLowerCase())
      for (const t of list) rules[t] = "deny"
      if (list.length) any = true
    }

    if (!any) return undefined
    return PermissionNext.fromConfig(rules)
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
      question: "deny",
      plan_enter: "deny",
      plan_exit: "deny",
      // mirrors github.com/github/gitignore Node.gitignore pattern for .env files
      read: {
        "*": "allow",
        "*.env": "ask",
        "*.env.*": "ask",
        "*.env.example": "allow",
      },
    })
    const user = PermissionNext.fromConfig(cfg.permission ?? {})

    const result: Record<string, Info> = {}

    // Populate built-in declarative agents via the same merge path as user config.
    // This allows user config to override or disable any built-in agent.
    const builtinEntries = Object.entries(builtinAgents)
    for (const [key, value] of builtinEntries) {
      result[key] = {
        name: key,
        mode: value.mode ?? "all",
        permission: PermissionNext.merge(defaults, PermissionNext.fromConfig(value.permission ?? {}), user),
        options: {},
        prompt: value.prompt,
        description: value.description,
        temperature: value.temperature,
        topP: value.top_p,
        hidden: value.hidden,
        native: true,
      }
    }

    for (const [key, value] of Object.entries(cfg.agent ?? {})) {
      log.info("processing agent config", { name: key })
      // Hidden built-in agents (compaction, title, summary) are protected system agents.
      // Skip user config entries for them to prevent accidental breakage.
      if (result[key]?.hidden) {
        log.warn("ignoring user config for protected hidden agent", { name: key })
        continue
      }
      if (value.disable) {
        delete result[key]
        continue
      }
      let item = result[key]
      if (!item)
        item = result[key] = {
          name: key,
          mode: "all",
          permission: PermissionNext.merge(defaults, user),
          options: {},
          native: false,
        }
      if (value.model) item.model = Provider.parseModel(value.model)
      item.variant = value.variant ?? item.variant
      item.prompt = value.prompt ?? item.prompt
      item.description = value.description ?? item.description
      item.temperature = value.temperature ?? item.temperature
      item.topP = value.top_p ?? item.topP
      item.mode = value.mode ?? item.mode
      item.color = value.color ?? item.color
      item.hidden = value.hidden ?? item.hidden
      item.name = value.name ?? item.name
      item.steps = value.maxTurns ?? value.steps ?? item.steps
      item.options = mergeDeep(item.options, value.options ?? {})

      // Claude Code compatibility: map tools/disallowedTools/permissionMode → permission rules.
      // These are applied before LiteAI's `permission` field so explicit `permission` always wins.
      const cc = ccPermission(value)
      if (cc) item.permission = PermissionNext.merge(item.permission, cc)

      item.permission = PermissionNext.merge(item.permission, PermissionNext.fromConfig(value.permission ?? {}))
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

  export async function get(agent: string) {
    return state().then((x) => x[agent])
  }

  export async function list() {
    const cfg = await Config.get()
    return pipe(
      await state(),
      values(),
      sortBy([(x) => (cfg.default_agent ? x.name === cfg.default_agent : x.name === "plan"), "desc"]),
    )
  }

  export async function defaultAgent() {
    const cfg = await Config.get()
    const agents = await state()

    if (cfg.default_agent) {
      const agent = agents[cfg.default_agent]
      if (!agent) throw new Error(`default agent "${cfg.default_agent}" not found`)
      if (agent.mode === "subagent") throw new Error(`default agent "${cfg.default_agent}" is a subagent`)
      if (agent.hidden === true) throw new Error(`default agent "${cfg.default_agent}" is hidden`)
      return agent.name
    }

    const primaryVisible = Object.values(agents).find((a) => a.mode !== "subagent" && a.hidden !== true)
    if (!primaryVisible) throw new Error("no primary visible agent found")
    return primaryVisible.name
  }

  export async function generate(input: { description: string; model?: { providerID: ProviderID; modelID: ModelID } }) {
    const cfg = await Config.get()
    const defaultModel = input.model ?? (await Provider.defaultModel())
    if (!defaultModel) throw new Error("no model available: connect a provider first")
    const model = await Provider.getModel(defaultModel.providerID, defaultModel.modelID)
    const language = await Provider.getLanguage(model)

    const system = [PROMPT_GENERATE]
    await Plugin.trigger("experimental.chat.system.transform", { model }, { system })
    const existing = await list()

    const params = {
      experimental_telemetry: {
        isEnabled: cfg.experimental?.openTelemetry,
        metadata: {
          userId: cfg.username ?? "unknown",
        },
      },
      temperature: 0.3,
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

    if (defaultModel.providerID === "openai" && (await Auth.get(defaultModel.providerID))?.type === "oauth") {
      const result = streamObject({
        ...params,
        providerOptions: ProviderTransform.providerOptions(model, {
          instructions: SystemPrompt.instructions(),
          store: false,
        }),
        onError: () => {},
      })
      for await (const part of result.fullStream) {
        if (part.type === "error") throw part.error
      }
      return result.object
    }

    const result = await generateObject(params)
    return result.object
  }
}
