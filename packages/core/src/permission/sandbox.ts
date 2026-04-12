import type { Agent } from "../agent/agent"
import type { SubagentContext } from "../agent/context"

export interface SandboxOptions {
  agentDef: Agent.AgentDefinition
}

const PERMISSION_MODE_RANKS: Record<string, number> = {
  plan: 1,
  default: 2,
  bubble: 3,
  acceptEdits: 4,
  dontAsk: 5,
  bypassPermissions: 6,
}

// biome-ignore lint/complexity/noStaticOnlyClass: Architectural pattern — LiteAI services use static classes as organizational namespaces (e.g., PermissionNext, AgentLoader).
export class PermissionSandbox {
  static apply(context: SubagentContext, options: SandboxOptions) {
    const parentState = context.getAppState()
    const parentMode: Agent.AgentDefinition["permissionMode"] = parentState.permissionMode || "default"
    let childMode: Agent.AgentDefinition["permissionMode"] = options.agentDef.permissionMode || "default"

    const parentRank = PERMISSION_MODE_RANKS[parentMode ?? "default"] ?? 0
    let childRank = PERMISSION_MODE_RANKS[childMode ?? "default"] ?? 0

    // Bubble mode support
    if (options.agentDef.options?.bubble === true) {
      childMode = "bubble"
      childRank = PERMISSION_MODE_RANKS.bubble
    }

    if (parentRank > childRank) {
      childMode = parentMode
    }

    context.setAppState((state) => ({
      ...state,
      permissionMode: childMode,
    }))

    if (options.agentDef.background) {
      context.setAppState((state) => ({
        ...state,
        shouldAvoidPermissionPrompts: true,
      }))
    }

    if (options.agentDef.tools) {
      const allowedTools: string[] = []
      if (Array.isArray(options.agentDef.tools)) {
        allowedTools.push(...options.agentDef.tools)
      } else if (typeof options.agentDef.tools === "object") {
        for (const [key, val] of Object.entries(options.agentDef.tools)) {
          if (val) allowedTools.push(key)
        }
      }

      const newDecisions: Record<string, import("../agent/context").ToolDecision> = {}

      // Preserve CLI-level rules
      const parentDecisions = parentState.toolDecisions
      if (parentDecisions) {
        for (const [tool, decision] of Object.entries(parentDecisions)) {
          if (typeof decision === "object" && decision !== null && decision.source === "cliArg") {
            newDecisions[tool] = decision
          }
        }
      }

      for (const tool of allowedTools) {
        if (!newDecisions[tool]) {
          newDecisions[tool] = { result: true, source: "sandbox" }
        }
      }

      context.toolDecisions = newDecisions
    }
  }
}
