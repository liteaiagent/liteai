import os from "node:os"
import path from "node:path"
import { Flag } from "@/flag/flag"
import { Config } from "../../config/config"
import { Global } from "../../global"
import { Instance } from "../../project/instance"
import { Filesystem } from "../../util/filesystem"
import { Glob } from "../../util/glob"
import { Log } from "../../util/log"
import type { Message } from "../message"

const log = Log.create({ service: "session.instruction" })

const FILES = ["AGENTS.md", "CLAUDE.md"]

function globalFiles() {
  const files = []
  if (Flag.LITEAI_CONFIG_DIR) {
    files.push(path.join(Flag.LITEAI_CONFIG_DIR, "AGENTS.md"))
  }
  files.push(path.join(Global.Path.config, "AGENTS.md"))
  if (!Flag.LITEAI_DISABLE_CLAUDE_CODE_PROMPT) {
    files.push(path.join(os.homedir(), ".claude", "CLAUDE.md"))
  }
  return files
}

async function resolveRelative(instruction: string): Promise<string[]> {
  if (!Flag.LITEAI_DISABLE_PROJECT_CONFIG) {
    return Filesystem.globUp(instruction, Instance.directory, Instance.worktree).catch((e: unknown) => {
      log.debug("globUp failed for instruction", { instruction, error: e })
      return []
    })
  }
  if (!Flag.LITEAI_CONFIG_DIR) {
    log.warn(
      `Skipping relative instruction "${instruction}" - no LITEAI_CONFIG_DIR set while project config is disabled`,
    )
    return []
  }
  return Filesystem.globUp(instruction, Flag.LITEAI_CONFIG_DIR, Flag.LITEAI_CONFIG_DIR).catch((e: unknown) => {
    log.debug("globUp failed for config instruction", { instruction, error: e })
    return []
  })
}

export namespace InstructionPrompt {
  const state = Instance.state(() => {
    return {
      claims: new Map<string, Set<string>>(),
    }
  })

  function isClaimed(messageID: string, filepath: string) {
    const claimed = state().claims.get(messageID)
    if (!claimed) return false
    return claimed.has(filepath)
  }

  function claim(messageID: string, filepath: string) {
    const current = state()
    let claimed = current.claims.get(messageID)
    if (!claimed) {
      claimed = new Set()
      current.claims.set(messageID, claimed)
    }
    claimed.add(filepath)
  }

  export function clear(messageID: string) {
    state().claims.delete(messageID)
  }

  export async function systemPaths() {
    const config = await Config.get()
    const paths = new Set<string>()

    if (!Flag.LITEAI_DISABLE_PROJECT_CONFIG) {
      for (const file of FILES) {
        const matches = await Filesystem.findUp(file, Instance.directory, Instance.worktree)
        if (matches.length > 0) {
          matches.forEach((p: string) => {
            paths.add(path.resolve(p))
          })
          break
        }
      }
    }

    for (const file of globalFiles()) {
      if (await Filesystem.exists(file)) {
        paths.add(path.resolve(file))
        break
      }
    }

    if (config.instructions) {
      for (let instruction of config.instructions) {
        if (instruction.startsWith("https://") || instruction.startsWith("http://")) continue
        if (instruction.startsWith("~/")) {
          instruction = path.join(os.homedir(), instruction.slice(2))
        }
        const matches = path.isAbsolute(instruction)
          ? await Glob.scan(path.basename(instruction), {
              cwd: path.dirname(instruction),
              absolute: true,
              include: "file",
            }).catch((e: unknown) => {
              log.debug("glob scan failed for instruction", { instruction, error: e })
              return []
            })
          : await resolveRelative(instruction)
        matches.forEach((p: string) => {
          paths.add(path.resolve(p))
        })
      }
    }

    return paths
  }

  export async function system() {
    const config = await Config.get()
    const paths = await systemPaths()

    const files = Array.from(paths).map(async (p) => {
      const content = await Filesystem.readText(p).catch((e: unknown) => {
        log.warn("failed to read instruction file", { path: p, error: e })
        return ""
      })
      return content ? `Instructions from: ${p}\n${content}` : ""
    })

    const urls: string[] = []
    if (config.instructions) {
      for (const instruction of config.instructions) {
        if (instruction.startsWith("https://") || instruction.startsWith("http://")) {
          urls.push(instruction)
        }
      }
    }
    const fetches = urls.map((url) =>
      fetch(url, { signal: AbortSignal.timeout(5000) })
        .then((res) => (res.ok ? res.text() : ""))
        .catch((e) => {
          log.warn("failed to fetch remote instruction", { url, error: e })
          return ""
        })
        .then((x) => (x ? `Instructions from: ${url}\n${x}` : "")),
    )

    return Promise.all([...files, ...fetches]).then((result) => result.filter(Boolean))
  }

  export function loaded(messages: Message.WithParts[]) {
    const paths = new Set<string>()
    for (const msg of messages) {
      for (const part of msg.parts) {
        if (part.type === "tool" && part.tool === "read" && part.state.status === "completed") {
          if (part.state.time.compacted) continue
          const loaded = part.state.metadata?.loaded
          if (!loaded || !Array.isArray(loaded)) continue
          for (const p of loaded) {
            if (typeof p === "string") paths.add(p)
          }
        }
      }
    }
    return paths
  }

  export async function find(dir: string) {
    for (const file of FILES) {
      const filepath = path.resolve(path.join(dir, file))
      if (await Filesystem.exists(filepath)) return filepath
    }
  }

  export async function resolve(messages: Message.WithParts[], filepath: string, messageID: string) {
    const system = await systemPaths()
    const already = loaded(messages)
    const results: { filepath: string; content: string }[] = []

    const target = path.resolve(filepath)
    let current = path.dirname(target)
    const root = path.resolve(Instance.directory)

    while (current.startsWith(root) && current !== root) {
      const found = await find(current)

      if (found && found !== target && !system.has(found) && !already.has(found) && !isClaimed(messageID, found)) {
        claim(messageID, found)
        const content = await Filesystem.readText(found).catch(() => undefined)
        if (content) {
          results.push({ filepath: found, content: `Instructions from: ${found}\n${content}` })
        }
      }
      current = path.dirname(current)
    }

    return results
  }
}
