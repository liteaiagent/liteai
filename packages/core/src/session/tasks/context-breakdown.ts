import z from "zod"
import { fn } from "@/util/fn"
import { Agent } from "../../agent/agent"
import { Provider } from "../../provider/provider"
import { Session } from ".."
import { InstructionPrompt } from "../engine/instruction"
import { SystemPrompt } from "../engine/system"
import type { Message } from "../message"
import { SessionID } from "../schema"

export namespace ContextBreakdown {
  export const Category = z.object({
    label: z.string(),
    tokens: z.number(),
    percent: z.number(),
  })
  export type Category = z.infer<typeof Category>

  export const Info = z
    .object({
      totalTokens: z.number(),
      contextLimit: z.number(),
      utilization: z.number(),
      categories: Category.array(),
      modelID: z.string(),
      providerID: z.string(),
    })
    .meta({ ref: "ContextBreakdown" })
  export type Info = z.infer<typeof Info>

  // Rough token estimation: ~4 chars per token (GPT/Claude average)
  const CHARS_PER_TOKEN = 4

  function estimateTokens(text: string): number {
    return Math.ceil(text.length / CHARS_PER_TOKEN)
  }

  export const get = fn(z.object({ sessionID: SessionID.zod }), async (input): Promise<Info> => {
    // Existence guard: throws NotFoundError if session doesn't exist, before running expensive queries below.
    await Session.get(input.sessionID)
    const msgs = await Session.messages({ sessionID: input.sessionID })

    // Find the last user message to get model info
    const lastUser = msgs.findLast((m) => m.info.role === "user")?.info as Message.User | undefined
    if (!lastUser) {
      return emptyBreakdown()
    }

    const model = await Provider.getModel(lastUser.model.providerID, lastUser.model.modelID).catch(() => null)
    if (!model) return emptyBreakdown()

    const contextLimit = model.limit?.context ?? 200_000
    const categories: Category[] = []

    // 1. System Prompt — resolve actual system prompt sections
    const agent = await Agent.get(lastUser.agent)
    const { parts: systemParts } = await SystemPrompt.resolveSystemPromptSections(model, agent)
    const systemTokens = systemParts.reduce((sum, p) => sum + estimateTokens(p), 0)
    categories.push({ label: "System Prompt", tokens: systemTokens, percent: 0 })

    // 2. Instructions (AGENTS.md etc.)
    const instructions = await InstructionPrompt.system()
    const instructionTokens = instructions.reduce((sum, p) => sum + estimateTokens(p), 0)
    categories.push({ label: "Instructions", tokens: instructionTokens, percent: 0 })

    // 3. Conversation — sum actual token usage from messages
    let conversationInput = 0
    let conversationOutput = 0
    let cacheRead = 0
    let cacheWrite = 0
    for (const msg of msgs) {
      if (msg.info.role === "assistant") {
        const a = msg.info as Message.Assistant
        conversationInput += a.tokens.input
        conversationOutput += a.tokens.output
        cacheRead += a.tokens.cache.read
        cacheWrite += a.tokens.cache.write
      }
    }
    categories.push({ label: "Conversation", tokens: conversationInput + conversationOutput, percent: 0 })

    // 4. Cache
    const cacheTokens = cacheRead + cacheWrite
    if (cacheTokens > 0) {
      categories.push({ label: "Cache", tokens: cacheTokens, percent: 0 })
    }

    // 5. Tools — estimate from tool count (MCP tools + built-in tools)
    // Tool definitions are roughly ~200 tokens each for JSON schema definitions
    const { MCP } = await import("../../mcp")
    const mcpTools = await MCP.tools()
    const toolCount = Object.keys(mcpTools).length + 15 // ~15 built-in tools
    const toolTokens = toolCount * 200
    categories.push({ label: `Tools (${toolCount})`, tokens: toolTokens, percent: 0 })

    // Compute totals and percentages
    const totalTokens = categories.reduce((sum, c) => sum + c.tokens, 0)
    for (const cat of categories) {
      cat.percent = totalTokens > 0 ? Math.round((cat.tokens / totalTokens) * 1000) / 10 : 0
    }

    // Sort descending by tokens
    categories.sort((a, b) => b.tokens - a.tokens)

    return {
      totalTokens,
      contextLimit,
      utilization: totalTokens / contextLimit,
      categories,
      modelID: model.id,
      providerID: model.providerID,
    }
  })

  function emptyBreakdown(): Info {
    return {
      totalTokens: 0,
      contextLimit: 0,
      utilization: 0,
      categories: [],
      modelID: "unknown",
      providerID: "unknown",
    }
  }
}
