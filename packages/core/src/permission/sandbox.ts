import type { Agent } from "../agent/agent"

export interface SandboxOptions {
  isAsync: boolean
  canShowPermissionPrompts: boolean
}

export interface PermissionContext {
  permissionMode?: Agent.AgentDefinition["permissionMode"]
  shouldAvoidPermissionPrompts?: boolean
  // TODO: Phase 3 (swarm) will add canShowPermissionPrompts=true path for teammates
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
    // TODO: Phase 3 (swarm) — when isAsync && canShowPermissionPrompts,
    // teammates will need an automated-checks-first dialog path.

    return childContext
  }
}

export function applyPermissionSandboxToContext(
  context: import("../agent/context").SubagentContext,
  agentDef: Agent.AgentDefinition,
  opts: { isAsync: boolean; canShowPermissionPrompts: boolean },
) {
  const parentPermissionCtx = {
    permissionMode: context.getAppState().permissionMode,
    shouldAvoidPermissionPrompts: context.getAppState().shouldAvoidPermissionPrompts,
  }
  const derivedPermissionCtx = PermissionSandbox.apply(parentPermissionCtx, agentDef, opts)

  context.setAppState((state) => ({
    ...state,
    permissionMode: derivedPermissionCtx.permissionMode,
    ...(derivedPermissionCtx.shouldAvoidPermissionPrompts ? { shouldAvoidPermissionPrompts: true } : {}),
  }))
}
