import path from "node:path"
import type { Agent } from "@/agent/agent"
import { Bundled } from "@/bundled"
import { PermissionNext } from "@/permission/next"
import type { Provider } from "@/provider/provider"
import { Shell } from "@/shell/shell"
import { Skill } from "@/skill"

import { Instance } from "../../project/instance"

export namespace SystemPrompt {
  export async function instructions() {
    return (await Bundled.systemPrompt("codex_header")).trim()
  }

  export async function provider(model: Provider.Model) {
    if (model.api.id.includes("gpt-5")) return [await Bundled.systemPrompt("codex_header")]
    if (model.api.id.includes("gpt-") || model.api.id.includes("o1") || model.api.id.includes("o3"))
      return [await Bundled.systemPrompt("beast")]
    if (model.providerID === "google-code-assist") return [await Bundled.systemPrompt("google-code-assist")]
    if (model.api.id.includes("gemini-")) return [await Bundled.systemPrompt("gemini")]
    if (model.api.id.includes("claude")) return [await Bundled.systemPrompt("anthropic")]
    if (model.api.id.toLowerCase().includes("trinity")) return [await Bundled.systemPrompt("trinity")]
    return [await Bundled.systemPrompt("default")]
  }

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

    return [
      "Skills provide specialized instructions and workflows for specific tasks.",
      "Use the skill tool to load a skill when a task matches its description.",
      // the agents seem to ingest the information about skills a bit better if we present a more verbose
      // version of them here and a less verbose version in tool description, rather than vice versa.
      Skill.fmt(list, { verbose: true }),
    ].join("\n")
  }
}
