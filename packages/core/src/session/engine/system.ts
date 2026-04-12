import path from "node:path"
import type { Agent } from "@/agent/agent"
import { Bundled } from "@/bundled"
import { PermissionNext } from "@/permission/next"
import type { Provider } from "@/provider/provider"
import { Shell } from "@/shell/shell"
import { Skill } from "@/skill"

import { Flag } from "../../flag/flag"
import { Instance } from "../../project/instance"

export namespace SystemPrompt {
  export async function environment(model: Provider.Model) {
    const project = Instance.project
    const shell = Shell.acceptable()
    const shellName = (
      process.platform === "win32" ? path.win32.basename(shell, ".exe") : path.basename(shell)
    ).toLowerCase()
    return [
      [
        `You are powered by the model named ${model.api.id}. The exact model ID is ${model.providerID}/${model.api.id}`,
        `Here is some useful information about the environment you are running in:`,
        `<env>`,
        `  Working directory: ${Instance.directory}`,
        `  Workspace root folder: ${Instance.worktree}`,
        `  Is directory a git repo: ${project.vcs === "git" ? "yes" : "no"}`,
        `  Platform: ${process.platform}`,
        `  Shell: ${shellName}`,
        `  Today's date: ${new Date().toDateString()}`,
        `</env>`,
        `<directories>`,
        `  `,
        `</directories>`,
      ].join("\n"),
    ]
  }

  export async function skills(agent: Agent.Info) {
    if (PermissionNext.disabled(["skill"], agent.permission).has("skill")) return

    const list = await Skill.available(agent, "model")

    const lines = [
      "Skills provide specialized instructions and workflows for specific tasks.",
      "Use the skill tool to load a skill when a task matches its description.",
    ]

    if (Flag.LITEAI_INJECT_SKILLS_IN_SYSTEM_PROMPT) {
      lines.push(
        // the agents seem to ingest the information about skills a bit better if we present a more verbose
        // version of them here and a less verbose version in tool description, rather than vice versa.
        Skill.fmt(list, { verbose: true }),
      )
    }

    return lines.join("\n")
  }

  // _isLoaded is tracking if the loading happened. It isn't explicitly checked anywhere else but serves as internal state.
  let _isLoaded = false
  let loadPromise: Promise<void> | null = null
  let clearHookAdded = false

  export async function loadSystemMd() {
    const { SectionRegistry } = await import("./section-registry")
    if (!clearHookAdded) {
      SectionRegistry.onClear(() => {
        _isLoaded = false
      })
      clearHookAdded = true
    }
    if (SectionRegistry.all().length > 0) return
    if (loadPromise) return await loadPromise
    loadPromise = (async () => {
      try {
        const rawContent = await Bundled.systemMd()
        const { SectionParser } = await import("./section-parser")

        const sections = SectionParser.parse(rawContent)

        for (const section of sections) {
          if (section.scope === "static") {
            SectionRegistry.register(section, async () => section.content)
          } else {
            if (section.name === "environment") {
              SectionRegistry.DANGEROUS_uncachedSystemPromptSection(
                section,
                async (ctx?: unknown) => {
                  if (!ctx || typeof ctx !== "object" || !("api" in ctx)) {
                    throw new Error("SystemPrompt.environment requires a valid Provider.Model context")
                  }
                  return (await SystemPrompt.environment(ctx as Provider.Model)).join("\n")
                },
                "Environment info contains model ID, working directory, and date — all volatile per session/turn",
              )
            } else {
              SectionRegistry.DANGEROUS_uncachedSystemPromptSection(
                section,
                async () => section.content,
                "parsed from system.md",
              )
            }
          }
        }
        _isLoaded = true
      } catch (error) {
        const { SystemPromptLoadError } = await import("./section-registry")
        if (error instanceof Error) {
          throw new SystemPromptLoadError({ message: `Failed to load system prompt: ${error.message}` })
        }
        throw new SystemPromptLoadError({ message: "Failed to load system prompt" })
      } finally {
        loadPromise = null
      }
    })()
    return await loadPromise
  }

  export async function resolveSystemPromptSections(model: Provider.Model, agent?: Agent.Info) {
    await loadSystemMd()
    const { SectionRegistry, resolveProviderTag } = await import("./section-registry")
    const tag = resolveProviderTag(model)

    const parts: string[] = []
    let staticBoundary = 0

    const entries = SectionRegistry.all()

    for (const entry of entries) {
      const { section } = entry
      if (section.providers === "all" || section.providers.has(tag)) {
        const content = await SectionRegistry.resolve(section.name, model)
        parts.push(content)
        if (section.scope === "static") {
          staticBoundary = parts.length
        }
      }
    }

    if (agent?.prompt) {
      parts.push(agent.prompt)
    }

    return { parts, boundary: staticBoundary }
  }

  export function DANGEROUS_resetLoaded() {
    _isLoaded = false
  }
}
