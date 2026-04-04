import z from "zod"
import { Bundled } from "@/bundled"
import { BusEvent } from "@/bus/bus-event"
import { MessageID, SessionID } from "@/session/schema"
import { Config } from "../config/config"
import { Hook } from "../hook"
import { MCP } from "../mcp"
import { Instance } from "../project/instance"
import { Skill } from "../skill"

// biome-ignore lint/suspicious/noTemplateCurlyInString: intentional literal used as .replace() target
const PATH_PLACEHOLDER = "${path}"

export namespace Command {
  export const Event = {
    Executed: BusEvent.define(
      "command.executed",
      z.object({
        name: z.string(),
        sessionID: SessionID.zod,
        arguments: z.string(),
        messageID: MessageID.zod,
      }),
    ),
  }

  export const Info = z
    .object({
      name: z.string(),
      description: z.string().optional(),
      agent: z.string().optional(),
      model: z.string().optional(),
      source: z.enum(["command", "mcp", "skill"]).optional(),
      // workaround for zod not supporting async functions natively so we use getters
      // https://zod.dev/v4/changelog?id=zfunction
      template: z.promise(z.string()).or(z.string()),
      subtask: z.boolean().optional(),
      hints: z.array(z.string()),
    })
    .meta({
      ref: "Command",
    })

  // for some reason zod is inferring `string` for z.promise(z.string()).or(z.string()) so we have to manually override it
  export type Info = Omit<z.infer<typeof Info>, "template"> & { template: Promise<string> | string }

  export function hints(template: string): string[] {
    const result: string[] = []
    const numbered = template.match(/\$\d+/g)
    if (numbered) {
      for (const match of [...new Set(numbered)].sort()) result.push(match)
    }
    if (template.includes("$ARGUMENTS")) result.push("$ARGUMENTS")
    return result
  }

  export const Default = {
    INIT: "init",
    REVIEW: "review",
    HOOKS: "hooks",
    PLUGIN: "plugin",
    /** @internal Mutable: set by command processing before /plugin template access. */
    _pluginArgs: undefined as string | undefined,
  }

  async function pluginCommand(args: string): Promise<string> {
    const { install, uninstall, enable, disable, summary, parse: parseRef } = await import("@/plugin/registry")
    const parts = args.trim().split(/\s+/)
    const sub = parts[0] ?? "list"
    const target = parts.slice(1).join(" ")

    switch (sub) {
      case "install": {
        if (!target) return "Usage: /plugin install <path-or-name[@marketplace]>"

        // Check if it's a marketplace reference (name@marketplace)
        const parsed = parseRef(target)
        if (parsed.marketplace) {
          return installFromMarketplace(parsed.name, parsed.marketplace)
        }

        // Try local path install — name comes from the directory basename
        const nodePath = await import("node:path")
        const { Filesystem } = await import("@/util/filesystem")
        const resolved = nodePath.resolve(target)
        if (await Filesystem.isDir(resolved)) {
          const name = nodePath.basename(resolved)
          await install({ name, root: resolved })
          await Instance.dispose()
          return `Installed and enabled plugin **${name}** from ${resolved}`
        }

        // Try to find in any known marketplace
        return installFromAnyMarketplace(parsed.name)
      }
      case "uninstall": {
        if (!target) return "Usage: /plugin uninstall <name[@marketplace]>"
        const keepData = parts.includes("--keep-data")
        const ref = parts[1]
        await uninstall(ref, { keepData })
        await Instance.dispose()
        return `Uninstalled plugin **${ref}**${keepData ? " (data preserved)" : ""}`
      }
      case "enable": {
        if (!target) return "Usage: /plugin enable <name[@marketplace]>"
        await enable(parts[1])
        await Instance.dispose()
        return `Enabled plugin **${parts[1]}**`
      }
      case "disable": {
        if (!target) return "Usage: /plugin disable <name[@marketplace]>"
        await disable(parts[1])
        await Instance.dispose()
        return `Disabled plugin **${parts[1]}**`
      }
      case "update": {
        if (!target) return updateAll()
        return updatePlugin(parts[1])
      }
      case "marketplace":
        return marketplaceCommand(parts.slice(1))
      default:
        return summary()
    }
  }

  async function marketplaceCommand(parts: string[]): Promise<string> {
    const sub = parts[0] ?? "list"
    const target = parts.slice(1).join(" ")

    switch (sub) {
      case "add": {
        if (!target) return "Usage: /plugin marketplace add <owner/repo | git-url | local-path | remote-url>"
        const { resolve } = await import("@/plugin/marketplace-source")
        const result = await resolve(target)
        if (!result) return `Failed to add marketplace from \`${target}\`. No valid marketplace manifest found.`
        return `Added marketplace **${result.name}** with ${result.manifest.plugins.length} plugin(s).\n\nUse \`/plugin install <plugin-name>@${result.name}\` to install plugins from it.`
      }
      case "remove": {
        if (!target) return "Usage: /plugin marketplace remove <name>"
        const { remove } = await import("@/plugin/marketplace")
        await remove(target)
        return `Removed marketplace **${target}**.`
      }
      case "update": {
        const { known } = await import("@/plugin/marketplace")
        const { update } = await import("@/plugin/marketplace-source")
        const all = await known()
        if (target) {
          const ref = all[target]
          if (!ref)
            return `Marketplace **${target}** not found. Use \`/plugin marketplace list\` to see known marketplaces.`
          const manifest = await update(target, ref)
          if (!manifest) return `Failed to update marketplace **${target}**.`
          return `Updated marketplace **${target}** — ${manifest.plugins.length} plugin(s) available.`
        }
        // Update all
        const results: string[] = []
        for (const [key, ref] of Object.entries(all)) {
          const manifest = await update(key, ref)
          results.push(
            manifest ? `✅ **${key}** — ${manifest.plugins.length} plugin(s)` : `❌ **${key}** — update failed`,
          )
        }
        if (!results.length) return "No marketplaces to update. Use `/plugin marketplace add` to add one."
        return `**Marketplace Update Results:**\n\n${results.join("\n")}`
      }
      case "list": {
        const { known } = await import("@/plugin/marketplace")
        const { load } = await import("@/plugin/marketplace-source")
        const { format } = await import("@/plugin/marketplace")
        const all = await known()
        if (!Object.keys(all).length)
          return "No marketplaces configured. Use `/plugin marketplace add <source>` to add one."
        const sections: string[] = ["**Known Marketplaces:**\n"]
        for (const [key, ref] of Object.entries(all)) {
          const manifest = await load(key, ref)
          if (manifest) {
            sections.push(format(manifest))
          } else {
            const src =
              typeof ref.source === "string"
                ? ref.source
                : ref.source.source === "github"
                  ? ref.source.repo
                  : ref.source.url
            sections.push(
              `**${key}** — _catalog not cached, run \`/plugin marketplace update ${key}\` to fetch_ (source: ${src})`,
            )
          }
          sections.push("")
        }
        return sections.join("\n")
      }
      default:
        return "Usage: /plugin marketplace <add|remove|update|list>"
    }
  }

  async function installFromMarketplace(name: string, marketplace: string): Promise<string> {
    const { known, find: findPlugin } = await import("@/plugin/marketplace")
    const { load } = await import("@/plugin/marketplace-source")
    const all = await known()
    const ref = all[marketplace]
    if (!ref) return `Marketplace **${marketplace}** not found. Use \`/plugin marketplace add\` first.`

    const manifest = await load(marketplace, ref)
    if (!manifest)
      return `Marketplace **${marketplace}** catalog not cached. Run \`/plugin marketplace update ${marketplace}\` first.`

    const entry = findPlugin(manifest, name)
    if (!entry)
      return `Plugin **${name}** not found in marketplace **${marketplace}**.\n\nAvailable: ${manifest.plugins.map((p) => p.name).join(", ")}`

    const { download } = await import("@/plugin/download")
    const dest = await download(marketplace, entry)
    if (!dest) return `Failed to download plugin **${name}** from **${marketplace}**.`

    const { install } = await import("@/plugin/registry")
    await install({ name: entry.name, root: dest, marketplace, version: entry.version })
    await Instance.dispose()
    return `Installed and enabled plugin **${name}** from marketplace **${marketplace}**${entry.version ? ` (v${entry.version})` : ""}.`
  }

  async function installFromAnyMarketplace(name: string): Promise<string> {
    const { known } = await import("@/plugin/marketplace")
    const { load } = await import("@/plugin/marketplace-source")
    const all = await known()

    for (const [key, ref] of Object.entries(all)) {
      const manifest = await load(key, ref)
      if (!manifest) continue
      const entry = manifest.plugins.find((p) => p.name === name)
      if (!entry) continue
      return installFromMarketplace(name, key)
    }

    return `No valid plugin found at \`${name}\`. Not found in any known marketplace either.\n\nUse \`/plugin install <path>\` for local installs, or \`/plugin install <name>@<marketplace>\` for marketplace installs.`
  }

  async function updatePlugin(ref: string): Promise<string> {
    const { parse: parseRef, install } = await import("@/plugin/registry")
    const parsed = parseRef(ref)
    const marketplace = parsed.marketplace
    if (!marketplace || marketplace === "__local__") {
      return `Plugin **${ref}** is a local plugin — reinstall with \`/plugin install <path>\` to update.`
    }

    const { known } = await import("@/plugin/marketplace")
    const { load } = await import("@/plugin/marketplace-source")
    const all = await known()
    const mref = all[marketplace]
    if (!mref) return `Marketplace **${marketplace}** not found.`

    const manifest = await load(marketplace, mref)
    if (!manifest)
      return `Marketplace **${marketplace}** catalog not cached. Run \`/plugin marketplace update ${marketplace}\` first.`

    const entry = manifest.plugins.find((p) => p.name === parsed.name)
    if (!entry) return `Plugin **${parsed.name}** no longer exists in marketplace **${marketplace}**.`

    const { download } = await import("@/plugin/download")
    const dest = await download(marketplace, entry)
    if (!dest) return `Failed to download updated plugin **${parsed.name}** from **${marketplace}**.`

    await install({ name: entry.name, root: dest, marketplace, version: entry.version })
    await Instance.dispose()
    return `Updated plugin **${parsed.name}** from marketplace **${marketplace}**${entry.version ? ` to v${entry.version}` : ""}.`
  }

  async function updateAll(): Promise<string> {
    const { list: listPlugins } = await import("@/plugin/registry")
    const entries = await listPlugins()
    const marketplace = entries.filter((e) => e.marketplace !== "__local__")
    if (!marketplace.length)
      return "No marketplace-installed plugins to update.\n\nUse `/plugin update <name@marketplace>` to update a specific plugin."
    const results: string[] = []
    for (const entry of marketplace) {
      const result = await updatePlugin(entry.id)
      results.push(result)
    }
    return results.join("\n\n")
  }

  const state = Instance.state(async () => {
    const cfg = await Config.get()

    // Eagerly read command templates once during state initialization.
    // This avoids sync/async issues with the hints() function.
    const [templateInit, templateReview] = await Promise.all([
      Bundled.command("initialize"),
      Bundled.command("review"),
    ])

    const result: Record<string, Info> = {
      [Default.INIT]: {
        name: Default.INIT,
        description: "create/update AGENTS.md",
        source: "command",
        get template() {
          return templateInit.replace(PATH_PLACEHOLDER, Instance.worktree)
        },
        hints: hints(templateInit),
      },
      [Default.REVIEW]: {
        name: Default.REVIEW,
        description: "review changes [commit|branch|pr], defaults to uncommitted",
        source: "command",
        get template() {
          return templateReview.replace(PATH_PLACEHOLDER, Instance.worktree)
        },
        subtask: true,
        hints: hints(templateReview),
      },
      [Default.HOOKS]: {
        name: Default.HOOKS,
        description: "list configured hooks",
        source: "command",
        get template() {
          return Hook.list().then((items) => {
            if (items.length === 0)
              return "No hooks configured.\n\nTo add hooks, set the `hooks` key in your settings.json file. See https://liteai.com/docs/hooks for details."
            const lines = ["**Configured Hooks:**\n"]
            const grouped = new Map<string, typeof items>()
            for (const item of items) {
              const list = grouped.get(item.event) ?? []
              list.push(item)
              grouped.set(item.event, list)
            }
            for (const [event, list] of grouped) {
              lines.push(`### ${event}`)
              for (const item of list) {
                const matcher = item.matcher ? ` (matcher: \`${item.matcher}\`)` : ""
                lines.push(`- **${item.source}**${matcher}`)
                for (const h of item.handlers) {
                  const detail = h.command ?? h.url ?? h.prompt?.slice(0, 60) ?? ""
                  lines.push(`  - \`${h.type}\`: ${detail}`)
                }
              }
              lines.push("")
            }
            return lines.join("\n")
          })
        },
        hints: [],
      },
      [Default.PLUGIN]: {
        name: Default.PLUGIN,
        description:
          "manage plugins — use: list, install <path-or-name[@marketplace]>, uninstall, enable, disable, update, marketplace <add|remove|update|list>",
        source: "skill" as const,
        hints: ["$ARGUMENTS"],
        get template() {
          return pluginCommand(Default._pluginArgs ?? "list")
        },
      } as Info,
    }

    const dirs = await Config.directories()
    const { CommandLoader } = await import("./loader")
    const { mergeDeep } = await import("remeda")
    let projectCommands: Record<string, Config.Command> = {}
    for (const dir of dirs) {
      projectCommands = mergeDeep(projectCommands, await CommandLoader.loadCommand(dir))
    }

    const baseCommands = mergeDeep(cfg.command ?? {}, projectCommands)

    for (const [name, command] of Object.entries(baseCommands)) {
      result[name] = {
        name,
        agent: command.agent,
        model: command.model,
        description: command.description,
        source: "command",
        get template() {
          return command.template
        },
        subtask: command.subtask,
        hints: hints(command.template),
      }
    }
    for (const [name, prompt] of Object.entries(await MCP.prompts())) {
      result[name] = {
        name,
        source: "mcp",
        description: prompt.description,
        get template() {
          // since a getter can't be async we need to manually return a promise here
          return MCP.getPrompt(
            prompt.client,
            prompt.name,
            prompt.arguments
              ? // substitute each argument with $1, $2, etc.
                Object.fromEntries(prompt.arguments?.map((argument, i) => [argument.name, `$${i + 1}`]))
              : {},
          ).then(
            (template) =>
              template?.messages
                .map((message) => (message.content.type === "text" ? message.content.text : ""))
                .join("\n") || "",
          )
        },
        hints: prompt.arguments?.map((_, i) => `$${i + 1}`) ?? [],
      }
    }

    // Add skills as invokable commands
    for (const skill of await Skill.all()) {
      // Skip if a command with this name already exists
      if (result[skill.name]) continue
      // Skills with user_invocable: false are background knowledge — not slash commands
      if (skill.user_invocable === false) continue
      result[skill.name] = {
        name: skill.name,
        description: skill.description,
        source: "skill",
        get template() {
          return skill.content
        },
        hints: skill.argument_hint ? [skill.argument_hint] : [],
      }
    }

    return result
  })

  export async function get(name: string) {
    return state().then((x) => x[name])
  }

  export async function list() {
    return state().then((x) => Object.values(x))
  }
}
