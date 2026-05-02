import { mkdir, rm } from "node:fs/promises"
import path from "node:path"
import { Fs as Filesystem } from "@liteai/util/fs"
import matter from "gray-matter"
import z from "zod"
import { Brand } from "../brand"
import { Instance } from "../project/instance"
import { Agent } from "./agent"

export namespace AgentWriter {
  export const CreateSchema = z.object({
    name: z.string().regex(/^[a-z0-9_-]+$/, "Agent name must be lowercase alphanumeric with hyphens/underscores"),
    description: z.string(),
    prompt: z.string(),
    model: z.string().optional(),
    tools: z.union([z.string(), z.array(z.string()), z.record(z.string(), z.boolean())]).optional(),
    permissionMode: z.enum(["default", "acceptEdits", "dontAsk", "bypassPermissions", "plan", "bubble"]).optional(),
    temperature: z.number().optional(),
    mode: z.enum(["subagent", "primary", "all"]).optional(),
  })
  export type CreateInput = z.infer<typeof CreateSchema>

  export const UpdateSchema = CreateSchema.partial().omit({ name: true })
  export type UpdateInput = z.infer<typeof UpdateSchema>

  function agentDir(): string {
    return path.join(Instance.directory, Brand.dir, "agents")
  }

  function agentPath(name: string): string {
    return path.join(agentDir(), `${name}.md`)
  }

  export async function create(input: CreateInput): Promise<Agent.Info> {
    const existing = await Agent.get(input.name).catch(() => null)
    if (existing) throw new Error(`Agent '${input.name}' already exists`)

    const { prompt, name, ...frontmatter } = input
    const content = matter.stringify(prompt ?? "", frontmatter)

    await mkdir(agentDir(), { recursive: true })
    await Filesystem.write(agentPath(name), content)

    // Reload agents
    await Agent.reload()
    const agent = await Agent.get(name)
    if (!agent) throw new Error("Failed to create agent")
    return agent
  }

  export async function update(name: string, input: UpdateInput): Promise<Agent.Info> {
    const filePath = agentPath(name)
    const exists = await Filesystem.exists(filePath)
    if (!exists) throw new Error(`Agent file not found: ${name}`)

    const raw = await Filesystem.readText(filePath)
    const { data, content } = matter(raw)

    const merged = { ...data, ...input }
    const newPrompt = input.prompt ?? content
    const { prompt: _prompt, ...frontmatter } = merged
    const newContent = matter.stringify(newPrompt, frontmatter)

    await Filesystem.write(filePath, newContent)
    await Agent.reload()

    const agent = await Agent.get(name)
    if (!agent) throw new Error("Failed to update agent")
    return agent
  }

  export async function remove(name: string): Promise<void> {
    const agent = await Agent.get(name)
    if (!agent) throw new Error(`Agent not found: ${name}`)
    if (agent.native) throw new Error("Cannot delete built-in agent")

    const filePath = agentPath(name)
    await rm(filePath, { force: true })
    await Agent.reload()
  }
}
