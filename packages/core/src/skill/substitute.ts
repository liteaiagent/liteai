import { $ } from "bun"
import { ConfigMarkdown } from "../config/markdown"
import * as Platform from "../platform"

const VARS_REGEX = /\$\{([A-Z0-9_]+)_(SESSION_ID|SKILL_DIR)\}/g
const ARGS_REGEX = /\$ARGUMENTS/g
const POSITIONAL_REGEX = /\$(\d+)/g

export namespace Substitute {
  export interface Context {
    sessionID?: string
    dir?: string
    arguments?: string
  }

  export function apply(content: string, ctx: Context) {
    const prefixes = Platform.envPrefixes()
    let result = content.replace(VARS_REGEX, (match, prefix, suffix) => {
      if (!prefixes.includes(prefix)) return match
      if (suffix === "SESSION_ID") return ctx.sessionID ?? ""
      if (suffix === "SKILL_DIR") return ctx.dir ?? ""
      return match
    })
    if (ctx.arguments !== undefined) {
      const raw = ctx.arguments.match(/(?:"[^"]*"|'[^']*'|[^\s"']+)/gi) ?? []
      const args = raw.map((arg) => arg.replace(/^["']|["']$/g, ""))
      result = result.replace(ARGS_REGEX, ctx.arguments)
      result = result.replace(POSITIONAL_REGEX, (_, index) => {
        const i = Number(index) - 1
        return i < args.length ? args[i] : ""
      })
    }
    return result
  }

  export async function shell(content: string) {
    const cmds = ConfigMarkdown.shell(content)
    if (cmds.length === 0) return content
    const outputs = await Promise.all(
      cmds.map(async ([, cmd]) => {
        try {
          return await $`${{ raw: cmd }}`.quiet().nothrow().text()
        } catch (err) {
          return `Error: ${err instanceof Error ? err.message : String(err)}`
        }
      }),
    )
    let i = 0
    return content.replace(ConfigMarkdown.SHELL_REGEX, () => outputs[i++])
  }
}
