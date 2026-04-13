import type { Agent } from "./agent"

const ALL_AGENT_DISALLOWED_TOOLS = [
  "task_output",
  "plan_exit",
  "plan_enter",
  // task is allowed for subagents according to liteai2 if user is ant, removing it from global disallow usually.
  // Actually, we'll keep our implementation of custom agent disallowed tools
  "question",
  "task_stop",
  "workflow",
]

const ASYNC_AGENT_ALLOWED_TOOLS = [
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
  "synthetic_output",
  "tool_search",
  "enter_worktree",
  "exit_worktree",
]

// Deduplication via Set is intentional and overlaps between ALL_AGENT_DISALLOWED_TOOLS
// and the explicit literals are expected.
const ALL_LITEAI_TOOLS = new Set([
  ...ALL_AGENT_DISALLOWED_TOOLS,
  ...ASYNC_AGENT_ALLOWED_TOOLS,
  "invalid",
  "list",
  "lsp",
  "task",
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

    if (isCustomAgent && tool === "task") {
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

      const agentMatch = spec.match(/^(?:agent|task)\((.+)\)$/i)
      if (agentMatch) {
        set.add("task")
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
