import type { Agent } from "@/agent/agent"
import { PermissionNext } from "@/permission/next"
import { Instance } from "../project/instance"
import { SkillSchema } from "./schema"

export namespace Skill {
  export const Info = SkillSchema.Info
  export type Info = SkillSchema.Info
  export const InvalidError = SkillSchema.InvalidError
  export const NameMismatchError = SkillSchema.NameMismatchError

  export const state = Instance.state(async () => {
    return (await import("./loader")).SkillLoader.load()
  })

  export async function get(name: string) {
    return state().then((x) => x.skills[name])
  }

  export async function all() {
    return state().then((x) => Object.values(x.skills))
  }

  export async function dirs() {
    return state().then((x) => x.dirs)
  }

  export async function available(agent?: Agent.Info, invoker?: "user" | "model") {
    const list = await all()
    return list.filter((skill) => {
      if (skill.enabled === false) return false
      if (agent && PermissionNext.evaluate("skill", skill.name, agent.permission).action === "deny") return false
      if (invoker === "model" && skill.disable_model_invocation) return false
      if (invoker === "user" && skill.user_invocable === false) return false
      return true
    })
  }

  export function fmt(list: Info[], opts: { verbose: boolean }) {
    if (list.length === 0) {
      return "No skills are currently available."
    }
    if (opts.verbose) {
      return [
        "<available_skills>",
        ...list.flatMap((skill) => [
          `  <skill>`,
          `    <name>${skill.name}</name>`,
          `    <description>${skill.description}</description>`,
          ...(skill.argument_hint ? [`    <argument_hint>${skill.argument_hint}</argument_hint>`] : []),
          `  </skill>`,
        ]),
        "</available_skills>",
      ].join("\n")
    }
    return [
      "## Available Skills",
      ...list.flatMap((skill) => {
        const hint = skill.argument_hint ? ` ${skill.argument_hint}` : ""
        return `- **${skill.name}**${hint}: ${skill.description}`
      }),
    ].join("\n")
  }
}
