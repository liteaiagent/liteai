import type { TranscriptMessage } from "../session/transcript"
import type { Agent } from "./agent"

const ALL_AGENT_DISALLOWED_TOOLS = ["plan_exit", "plan_enter", "ask_user"]

export const ASYNC_AGENT_ALLOWED_TOOLS = [
  "read",
  "websearch",
  "todowrite",
  "grep",
  "webfetch",
  "glob",
  "run_command",
  "send_command_input",
  "command_status",
  "edit",
  "write",
  "multiedit",
  "skill",
  "tool_search",
  "enter_worktree",
  "exit_worktree",
  "agent_get",
  "agent_list",
]

// Deduplication via Set is intentional and overlaps between ALL_AGENT_DISALLOWED_TOOLS
// and the explicit literals are expected.
const ALL_LITEAI_TOOLS = new Set([
  ...ALL_AGENT_DISALLOWED_TOOLS,
  ...ASYNC_AGENT_ALLOWED_TOOLS,
  "invalid",
  "list",
  "lsp",
  "agent",
  "todoread",
  "apply_patch", // If it exists
  "batch",
])

export function filterToolsForAgent(tools: string[], isCustomAgent: boolean, isAsync: boolean): string[] {
  return tools.filter((tool) => {
    // Treat unknown tools (MCP tools) as allowed
    if (!ALL_LITEAI_TOOLS.has(tool)) {
      return true
    }

    if (ALL_AGENT_DISALLOWED_TOOLS.includes(tool)) {
      return false
    }

    if (isCustomAgent && tool === "agent") {
      return false
    }

    if (isAsync && !ASYNC_AGENT_ALLOWED_TOOLS.includes(tool)) {
      return false
    }

    return true
  })
}

export function resolveAgentTools(
  agentDefinition: Pick<Agent.AgentDefinition, "tools" | "disallowedTools">,
  availableTools: string[],
): { resolvedTools: string[]; allowedAgentTypes: string[] | undefined } {
  let allowedAgentTypes: string[] | undefined
  const set = new Set<string>()
  const specs = agentDefinition.tools

  let normalizedSpecs: string[] = []
  if (typeof specs === "string") {
    normalizedSpecs = [specs]
  } else if (Array.isArray(specs)) {
    normalizedSpecs = specs
  } else if (specs && typeof specs === "object") {
    // If it's a Record<string, boolean>, take keys where value is true
    normalizedSpecs = Object.entries(specs)
      .filter(([_, value]) => value === true)
      .map(([key]) => key)
  }

  if (normalizedSpecs.length === 0) {
    // No tools defined = wildcard (all tools). Matches MVP behavior where
    // undefined tools means "allow everything after disallowedTools filtering".
    for (const t of availableTools) {
      set.add(t)
    }
  } else {
    for (const spec of normalizedSpecs) {
      if (spec === "*") {
        for (const t of availableTools) {
          set.add(t)
        }
        continue
      }

      const agentMatch = spec.match(/^agent\((.+)\)$/i)
      if (agentMatch) {
        set.add("agent")
        allowedAgentTypes = agentMatch[1].split(",").map((s: string) => s.trim())
        continue
      }

      set.add(spec)
    }
  }

  if (agentDefinition.disallowedTools) {
    for (const dis of agentDefinition.disallowedTools) {
      if (dis.endsWith("*")) {
        const prefix = dis.slice(0, -1)
        for (const t of Array.from(set)) {
          if (t.startsWith(prefix)) {
            set.delete(t)
          }
        }
      } else {
        set.delete(dis)
      }
    }
  }

  return {
    resolvedTools: Array.from(set),
    allowedAgentTypes,
  }
}

export function pruneContext(
  agentDefinition: Pick<Agent.AgentDefinition, "omitLiteaiMd" | "name">,
  userContext: Record<string, unknown> | undefined,
  systemContext: Record<string, unknown> | undefined,
  options: {
    hasUserOverride?: boolean
    liteaiSlimSubagentLiteaimdFlag?: boolean
  } = {},
): {
  prunedUserContext?: Record<string, unknown>
  prunedSystemContext?: Record<string, unknown>
} {
  const { hasUserOverride = false, liteaiSlimSubagentLiteaimdFlag = true } = options

  if (!liteaiSlimSubagentLiteaimdFlag) {
    return { prunedUserContext: userContext, prunedSystemContext: systemContext }
  }

  let prunedUserContext = userContext ? { ...userContext } : undefined
  let prunedSystemContext = systemContext ? { ...systemContext } : undefined

  // LiteaiMd stripping
  if (agentDefinition.omitLiteaiMd && !hasUserOverride && prunedUserContext) {
    if ("liteaiMd" in prunedUserContext) {
      const { liteaiMd: _omitted, ...rest } = prunedUserContext
      prunedUserContext = rest
    }
  }

  // Git status stripping for Explore/Plan agents
  // Make it case insensitive to match Explore and Plan
  const agentType = typeof agentDefinition.name === "string" ? agentDefinition.name.toLowerCase() : ""
  const isReadOnlyAgent = agentType === "explore" || agentType === "plan"
  if (isReadOnlyAgent && prunedSystemContext) {
    if ("gitStatus" in prunedSystemContext) {
      const { gitStatus: _omitted, ...rest } = prunedSystemContext
      prunedSystemContext = rest
    }
  }

  return { prunedUserContext, prunedSystemContext }
}

export function filterUnresolvedToolUses(messages: TranscriptMessage[]): TranscriptMessage[] {
  return messages.filter((msg, index) => {
    if (msg.role !== "assistant" || !Array.isArray(msg.content)) return true
    // If it has a tool call or tool_use part
    const hasToolCall = msg.content.some(
      (part) =>
        typeof part === "object" &&
        part !== null &&
        "type" in part &&
        (part.type === "tool-call" || part.type === "tool_use"),
    )
    if (!hasToolCall) return true

    // Scan ahead for matching tool results
    for (let i = index + 1; i < messages.length; i++) {
      const nextMsg = messages[i]
      if (nextMsg.role === "tool") return true
      if (nextMsg.role === "user" && Array.isArray(nextMsg.content)) {
        if (
          nextMsg.content.some(
            (part) =>
              typeof part === "object" &&
              part !== null &&
              "type" in part &&
              (part.type === "tool-result" || part.type === "tool_result"),
          )
        ) {
          return true
        }
      }
      // Stop if we hit another assistant message with tool calls
      if (nextMsg.role === "assistant") break
    }

    return false
  })
}

export function filterOrphanedThinkingOnlyMessages(messages: TranscriptMessage[]): TranscriptMessage[] {
  return messages.filter((msg) => {
    if (msg.role !== "assistant") return true
    if (typeof msg.content === "string") return msg.content.trim().length > 0
    if (!Array.isArray(msg.content)) return true

    const containsNonThinking = msg.content.some(
      (part) =>
        typeof part === "object" &&
        part !== null &&
        "type" in part &&
        part.type !== "thinking" &&
        part.type !== "redacted-thinking",
    )
    return containsNonThinking
  })
}

export function filterWhitespaceOnlyAssistantMessages(messages: TranscriptMessage[]): TranscriptMessage[] {
  return messages.filter((msg) => {
    if (msg.role !== "assistant") return true
    if (typeof msg.content === "string") return msg.content.trim().length > 0
    if (!Array.isArray(msg.content)) return true

    const hasVisibleContent = msg.content.some((part) => {
      if (typeof part === "object" && part !== null && "type" in part && part.type === "text") {
        const text = (part as { text?: string }).text
        return typeof text === "string" ? text.trim().length > 0 : true
      }
      return true
    })
    return hasVisibleContent
  })
}
