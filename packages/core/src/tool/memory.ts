import fs from "node:fs/promises"
import path from "node:path"
import z from "zod"
import { AgentMemory } from "../agent/memory"
import { Instance } from "../project/instance"
import { Tool } from "./tool"

function getMemDir(ctx: Tool.Context) {
  const scope = Instance.worktree ? "local" : "project"
  return AgentMemory.getAgentMemoryDir(ctx.agent, scope)
}

export const ReadMemoryTool = Tool.define("readMemory", {
  description: "Read agent memory file. Only reads from the agent's isolated memory directory.",
  parameters: z.object({ file: z.string().describe("Filename inside memory dir (e.g. MEMORY.md)") }),
  async execute({ file }, ctx) {
    const memDir = getMemDir(ctx)
    const target = path.join(memDir, file)
    if (!AgentMemory.isAgentMemoryPath(target, memDir)) return { title: "Error", output: "Access denied outside memory directory.", metadata: {} }
    try {
      const content = await fs.readFile(target, "utf-8")
      return { title: "Read Memory", output: content, metadata: {} }
    } catch {
      return { title: "Error", output: "Memory file does not exist.", metadata: {} }
    }
  },
})

export const WriteMemoryTool = Tool.define("writeMemory", {
  description: "Write entirely new content to an agent memory file in the agent's memory directory.",
  parameters: z.object({
    file: z.string().describe("Filename inside memory dir"),
    content: z.string().describe("Full content to write"),
  }),
  async execute({ file, content }, ctx) {
    const memDir = getMemDir(ctx)
    const target = path.join(memDir, file)
    if (!AgentMemory.isAgentMemoryPath(target, memDir)) return { title: "Error", output: "Access denied outside memory directory.", metadata: {} }
    await AgentMemory.ensureMemoryDirExists(memDir)
    await fs.writeFile(target, content, "utf-8")
    return { title: "Write Memory", output: "Memory written successfully.", metadata: {} }
  },
})

export const EditMemoryTool = Tool.define("editMemory", {
  description: "Edit existing agent memory file in the agent's memory directory. Use this to selectively replace portions of the file without overwriting everything.",
  parameters: z.object({
    file: z.string().describe("Filename inside memory dir"),
    oldContent: z.string().describe("Exact string to replace"),
    newContent: z.string().describe("Replacement string"),
  }),
  async execute({ file, oldContent, newContent }, ctx) {
    const memDir = getMemDir(ctx)
    const target = path.join(memDir, file)
    if (!AgentMemory.isAgentMemoryPath(target, memDir)) return { title: "Error", output: "Access denied outside memory directory.", metadata: {} }
    try {
      const current = await fs.readFile(target, "utf-8")
      if (!current.includes(oldContent)) {
        return { title: "Error", output: "Edit failed: oldContent not found in file.", metadata: {} }
      }
      const updated = current.replaceAll(oldContent, newContent)
      await fs.writeFile(target, updated, "utf-8")
      return { title: "Edit Memory", output: "Memory edited successfully.", metadata: {} }
    } catch {
      return { title: "Error", output: "Memory file does not exist. Use writeMemory first.", metadata: {} }
    }
  },
})
