import fs from "node:fs/promises"
import path from "node:path"
import { tool as createTool } from "ai"
import z from "zod"
import { Config } from "@/config/config"
import { Global } from "@/global"
import { Instance } from "@/project/instance"

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
    await fs.mkdir(dir, { recursive: true }).catch(() => {})
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
    } catch {
      // Doesn't exist yet
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
    } catch {
      // Ignore copy errors
    }
  }
}

export namespace AgentMemory {
  export function injectAgentMemoryTools(
    toolPool: Record<string, unknown>,
    agentType: string,
    scope: "user" | "project" | "local",
  ): void {
    const memDir = getAgentMemoryDir(agentType, scope)

    toolPool.readMemory = createTool({
      description: `Read agent memory file. Only reads from ${memDir}`,
      parameters: z.object({ file: z.string().describe("Filename inside memory dir (e.g. MEMORY.md)") }),
      execute: async ({ file }: { file: string }) => {
        const target = path.join(memDir, file)
        if (!isAgentMemoryPath(target, memDir)) return "Access denied outside memory directory."
        try {
          return await fs.readFile(target, "utf-8")
        } catch {
          return "Memory file does not exist."
        }
      },
      // biome-ignore lint/suspicious/noExplicitAny: SDK inference fails for execute params
    } as any)

    toolPool.writeMemory = createTool({
      description: `Write entirely new content to an agent memory file in ${memDir}`,
      parameters: z.object({
        file: z.string().describe("Filename inside memory dir"),
        content: z.string().describe("Full content to write"),
      }),
      execute: async ({ file, content }: { file: string; content: string }) => {
        const target = path.join(memDir, file)
        if (!isAgentMemoryPath(target, memDir)) return "Access denied outside memory directory."
        await ensureMemoryDirExists(memDir)
        await fs.writeFile(target, content, "utf-8")
        return "Memory written successfully."
      },
      // biome-ignore lint/suspicious/noExplicitAny: SDK inference fails for execute params
    } as any)

    toolPool.editMemory = createTool({
      description: `Edit existing agent memory file in ${memDir}. Use this to selectively replace portions of the file without overwriting everything.`,
      parameters: z.object({
        file: z.string().describe("Filename inside memory dir"),
        oldContent: z.string().describe("Exact string to replace"),
        newContent: z.string().describe("Replacement string"),
      }),
      execute: async ({ file, oldContent, newContent }: { file: string; oldContent: string; newContent: string }) => {
        const target = path.join(memDir, file)
        if (!isAgentMemoryPath(target, memDir)) return "Access denied outside memory directory."
        try {
          const current = await fs.readFile(target, "utf-8")
          if (!current.includes(oldContent)) {
            return "Edit failed: oldContent not found in file."
          }
          const updated = current.replaceAll(oldContent, newContent)
          await fs.writeFile(target, updated, "utf-8")
          return "Memory edited successfully."
        } catch {
          return "Memory file does not exist. Use writeMemory first."
        }
      },
      // biome-ignore lint/suspicious/noExplicitAny: SDK inference fails for execute params
    } as any)
  }
}
