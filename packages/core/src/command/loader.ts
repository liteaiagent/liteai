import path from "node:path"
import { NamedError } from "@liteai/util/error"
import type z from "zod"
import { Brand } from "@/brand"
import { Bus } from "@/bus"
import { ConfigMarkdown } from "@/config/markdown"
import { ConfigPaths } from "@/config/paths"
import { Command } from "@/config/schema"
import { Glob } from "@/util/glob"
import { Log } from "@/util/log"

export namespace CommandLoader {
  const log = Log.create({ service: "command:loader" })

  function rel(item: string, patterns: string[]) {
    const normalizedItem = item.replaceAll("\\", "/")
    for (const pattern of patterns) {
      const index = normalizedItem.indexOf(pattern)
      if (index === -1) continue
      return normalizedItem.slice(index + pattern.length)
    }
  }

  function trim(file: string) {
    const ext = path.extname(file)
    return ext.length ? file.slice(0, -ext.length) : file
  }

  export async function loadCommand(dir: string): Promise<Record<string, z.infer<typeof Command>>> {
    const result: Record<string, z.infer<typeof Command>> = {}
    for (const item of await Glob.scan("{command,commands}/**/*.md", {
      cwd: dir,
      absolute: true,
      dot: true,
      symlink: true,
    })) {
      const md = await ConfigMarkdown.parse(item).catch(async (err) => {
        const message = ConfigMarkdown.FrontmatterError.isInstance(err)
          ? err.data.message
          : `Failed to parse command ${item}`
        const { Session } = await import("@/session")
        Bus.publish(Session.Event.Error, { error: new NamedError.Unknown({ message }).toObject() })
        log.error("failed to load command", { command: item, err })
        return undefined
      })
      if (!md) continue

      const patterns = [`/${Brand.dir}/command/`, `/${Brand.dir}/commands/`, "/command/", "/commands/"]
      const file = rel(item, patterns) ?? path.basename(item)
      const name = trim(file)

      const config = {
        name,
        ...md.data,
        template: md.content.trim(),
      }
      const parsed = Command.safeParse(config)
      if (parsed.success) {
        log.info("loaded command", { name: config.name, path: item })
        result[config.name] = parsed.data
        continue
      }
      throw new ConfigPaths.InvalidError({ path: item, issues: parsed.error.issues }, { cause: parsed.error })
    }
    return result
  }
}
