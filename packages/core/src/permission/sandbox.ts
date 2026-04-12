import type { Agent } from "../agent/agent"

export interface SandboxOptions {
  isAsync: boolean
  canShowPermissionPrompts: boolean
}

export interface PermissionContext {
  permissionMode?: Agent.AgentDefinition["permissionMode"]
  shouldAvoidPermissionPrompts?: boolean
  toolDecisions?: Record<string, import("../agent/context").ToolDecision>
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
  static apply(parent: PermissionContext, agentDef: Agent.AgentDefinition, options: SandboxOptions): PermissionContext {
    const parentMode = parent.permissionMode || "default"
    let childMode = agentDef.permissionMode || "default"

    const parentRank = PERMISSION_MODE_RANKS[parentMode ?? "default"] ?? 0
    let childRank = PERMISSION_MODE_RANKS[childMode ?? "default"] ?? 0

    // Bubble mode support
    if (agentDef.options?.bubble === true) {
      childMode = "bubble"
      childRank = PERMISSION_MODE_RANKS.bubble
    }

    if (parentRank > childRank) {
      childMode = parentMode
    }

    const childContext: PermissionContext = {
      permissionMode: childMode,
      shouldAvoidPermissionPrompts: false,
    }

    if (options.isAsync && !options.canShowPermissionPrompts) {
      childContext.shouldAvoidPermissionPrompts = true
    }

    if (agentDef.tools) {
      const allowedTools: string[] = []
      if (Array.isArray(agentDef.tools)) {
        allowedTools.push(...agentDef.tools)
      } else if (typeof agentDef.tools === "object") {
        for (const [key, val] of Object.entries(agentDef.tools)) {
          if (val) allowedTools.push(key)
        }
      }

      const newDecisions: Record<string, import("../agent/context").ToolDecision> = {}

      // Preserve CLI-level rules
      const parentDecisions = parent.toolDecisions
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

      childContext.toolDecisions = newDecisions
    }

    return childContext
  }
}
