import fs from "node:fs/promises"
import path from "node:path"
import { Log } from "@liteai/util/log"
import { Config } from "@/config/config"
import { Global } from "@/global"
import { Instance } from "@/project/instance"

const logger = Log.create({ service: "agent:memory" })

export namespace AgentMemory {
  // log is currently unused, but can be added back if needed

  export async function isAutoMemoryEnabled(): Promise<boolean> {
    // 1. Env var overriding auto memory
    if (process.env.LITEAI_DISABLE_AUTO_MEMORY && process.env.LITEAI_DISABLE_AUTO_MEMORY !== "false") {
      return false
    }

    // 2. Headless mode checks (heuristic for CI or non-interactive environments)
    if (process.env.CI === "true" || !!process.env.SSH_CLIENT || !process.stdout.isTTY) {
      return false
    }

    // 3. Project settings fallback
    const cfg = await Config.get()
    if (cfg.experimental?.agent_memory !== undefined) {
      return cfg.experimental.agent_memory
    }

    // 4. Default enabled
    return true
  }

  export function getAgentMemoryDir(agentType: string, scope: "user" | "project" | "local"): string {
    const safeType = agentType.replace(/[^a-zA-Z0-9_-]/g, "_")
    switch (scope) {
      case "user":
        return path.join(Global.Path.home, ".liteai", "memory", safeType)
      case "project":
        return path.join(Instance.directory, ".liteai", "memory", safeType)
      case "local":
        return path.join(Instance.worktree ?? Instance.directory, ".liteai", "memory", safeType)
    }
  }

  export async function ensureMemoryDirExists(dir: string): Promise<void> {
    try {
      await fs.mkdir(dir, { recursive: true })
    } catch (err: unknown) {
      // Best-effort: the Write tool does its own mkdir as a safety net.
      // Log the failure so it's visible in --debug output and UAT telemetry.
      const code = err instanceof Error && "code" in err ? (err as NodeJS.ErrnoException).code : undefined
      logger.warn("ensureMemoryDirExists failed", { dir, code: code ?? String(err) })
    }
  }

  export function isAgentMemoryPath(filepath: string, memoryDir: string): boolean {
    const resolvedPath = path.resolve(filepath)
    const resolvedDir = path.resolve(memoryDir)
    return resolvedPath.startsWith(resolvedDir + path.sep) || resolvedPath === resolvedDir
  }

  export async function loadAgentMemoryPrompt(agentType: string, scope: "user" | "project" | "local"): Promise<string> {
    const memDir = getAgentMemoryDir(agentType, scope)
    const memFile = path.join(memDir, "MEMORY.md")

    let content = ""
    try {
      content = await fs.readFile(memFile, "utf-8")
    } catch (err: unknown) {
      const code = err instanceof Error && "code" in err ? (err as NodeJS.ErrnoException).code : undefined
      if (code !== "ENOENT") {
        // Non-ENOENT = real problem. Log for observability but don't crash agent spawn.
        logger.warn("loadAgentMemoryPrompt read failed", { memFile, code: code ?? String(err) })
      }
      // ENOENT is expected — memory file doesn't exist yet. Agent proceeds without memory.
    }

    return `Agent memory is scoped to ${scope} at ${memDir}.
You can use Read/Write/Edit memory tools to persist context across sessions.
Current memory:
${content ? `<memory>\n${content}\n</memory>` : "<memory>\n(Empty)\n</memory>"}`
  }

  export async function checkAgentMemorySnapshot(agentType: string): Promise<boolean> {
    if (process.env.AGENT_MEMORY_SNAPSHOT !== "true") return false

    const projectDir = getAgentMemoryDir(agentType, "project")
    const localDir = getAgentMemoryDir(agentType, "local")
    if (projectDir === localDir) return false

    try {
      const projectStat = await fs.stat(path.join(projectDir, "MEMORY.md"))
      const localStat = await fs.stat(path.join(localDir, "MEMORY.md")).catch(() => null)

      if (!localStat) return true // Project has memory, local doesn't
      return projectStat.mtimeMs > localStat.mtimeMs // Project is newer
    } catch {
      return false // Project memory doesn't exist
    }
  }

  export async function copyProjectSnapshotToLocal(agentType: string): Promise<void> {
    const projectDir = getAgentMemoryDir(agentType, "project")
    const localDir = getAgentMemoryDir(agentType, "local")
    if (projectDir === localDir) return

    try {
      await fs.mkdir(localDir, { recursive: true })
      await fs.copyFile(path.join(projectDir, "MEMORY.md"), path.join(localDir, "MEMORY.md"))
    } catch (err: unknown) {
      // Snapshot copy is best-effort — log for observability, don't crash agent spawn.
      logger.warn("copyProjectSnapshotToLocal failed", {
        agentType,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
}
