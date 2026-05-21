import { AsyncLocalStorage } from "node:async_hooks"
import type { Config } from "@/config/config"
import type { TeammateTaskState } from "@/coordinator/teammate-types"
import type { MCP } from "@/mcp"
import type { Provider } from "@/provider/provider"
import type { AgentTaskInfo } from "@/task/task"
import type { Agent } from "./agent"
import type { CacheSafeParams } from "./fork"

export interface ThinkingConfig {
  enabled: boolean
  budget?: number
}

export interface ExecController {
  exec(
    cmd: string,
    args: string[],
    options?: { cwd?: string; env?: Record<string, string> },
  ): Promise<{ stdout: string; stderr: string; exitCode: number }>
}

export interface BackgroundTaskState {
  status?: "running" | "stopped" | "error" | "completed" | string
  pendingMessages?: string[]
  [key: string]: unknown
}

export interface AppState {
  shouldAvoidPermissionPrompts?: boolean
  permissionMode?: Agent.Info["permissionMode"]
  /** Root session ID for bubble mode. When set, permission/question prompts
   *  are routed to this session's UI instead of the current child session. */
  rootSessionID?: string
  /** Per-agent activity descriptions from the periodic summarization loop. */
  agentSummaries?: Record<string, string>
  /** Name-to-agentId registry for background agents. */
  agentNameRegistry?: Record<string, string>
  /** Tasks/state tracking for background agents and in-process teammates. */
  tasks?: Record<string, BackgroundTaskState | TeammateTaskState | AgentTaskInfo>
  /** Team context for coordinator/swarm mode. */
  teamContext?: {
    teamName: string
    teamFilePath: string
    leadAgentId: string
    teammates: Record<
      string,
      {
        name: string
        agentType: string
        color: string
        spawnedAt: number
        cwd: string
      }
    >
  }
}

export type AgentContext = SubagentContext | TeammateAgentContext | RootAgentContext

export interface Scope {
  readonly mode: "memory"
}

export interface ParentContext {
  sessionId: string
  agentId?: string
  abortController: AbortController
  // biome-ignore lint/suspicious/noExplicitAny: compatibility with FileStateMap and Session state requires any
  readFileState: Map<string, any>
  // biome-ignore lint/suspicious/noExplicitAny: compatibility with Session state requires any
  contentReplacementState?: any
  getAppState: () => AppState
  setAppState: (updater: (state: AppState) => AppState) => void
  /**
   * Root store passthrough for task management. Ensures task registration/kill
   * always reaches the root session's AppState, even when the sub-agent's
   * `setAppState` is no-op'd for isolation. Without this, background tasks
   * spawned by sub-agents become PPID=1 zombies.
   *
   */
  setAppStateForTasks?: (updater: (state: AppState) => AppState) => void
  queryTracking?: { depth: number }
  model?: { providerID: string; modelID: string } | Provider.Model
  thinkingConfig?: ThinkingConfig
  cwd?: string
}

export interface SubagentContext {
  type: "subagent"
  agentId: string
  /** Agent definition name (e.g., "explore", "liteai"). */
  agentType: string
  /** Human-readable agent name for HITL prompt badge display. */
  agentName?: string
  isFork: boolean
  parentSystemPrompt?: string
  cacheSafeParams?: CacheSafeParams
  /** Session ID of the parent that spawned this agent. */
  parentSessionId: string
  /** Whether this agent is a built-in (native) agent. */
  isBuiltIn: boolean
  abortController: AbortController
  // biome-ignore lint/suspicious/noExplicitAny: compatibility with Session state requires any
  readFileState: Map<string, any>
  // biome-ignore lint/suspicious/noExplicitAny: cloned from parent for cache stability (FR-004)
  contentReplacementState?: any
  /** Recursion depth tracking for nested sub-agent spawns. */
  queryTracking: { depth: number }
  /** Whether this invocation is a fresh spawn or a resume. */
  invocationKind: "spawn" | "resume"
  thinkingConfig?: ThinkingConfig
  getAppState: () => AppState
  setAppState: (updater: (state: AppState) => AppState) => void
  /**
   * Root store passthrough for task management. Ensures task registration/kill
   * always reaches the root session's AppState, even when this agent's
   * `setAppState` is no-op'd for isolation.
   */
  setAppStateForTasks: (updater: (state: AppState) => AppState) => void
  cwd: string
  effort?: string
  criticalSystemReminder?: string
  invokingRequestId?: string
  prunedUserContext?: Record<string, unknown>
  prunedSystemContext?: Record<string, unknown>
  mcpClients?: Array<{ name: string; client: MCP.MCPClient; config: Config.Mcp }>
  execController?: ExecController
}

/**
 * Teammate agent context for in-process swarm teammates.
 *
 * Phase 3: Full execution context. Teammates carry the same capabilities as
 * subagents (AppState access, abort control, file state) while maintaining
 * type-safe discrimination via the 'teammate' type literal.
 *
 * Note: A future `BaseExecutableContext` extraction (shared by SubagentContext,
 * TeammateAgentContext, RootAgentContext) is deferred per Directive §4 (scope).
 */
export interface TeammateAgentContext {
  type: "teammate"
  agentId: string
  /** Human-readable name (e.g., "researcher") */
  agentName: string
  teamName: string
  agentColor?: string
  planModeRequired: boolean
  isTeamLead: boolean
  /** Session ID of the leader that spawned this teammate */
  parentSessionId: string
  invocationKind: "spawn"
  invokingRequestId?: string
  getAppState: () => AppState
  setAppState: (updater: (state: AppState) => AppState) => void
  setAppStateForTasks: (updater: (state: AppState) => AppState) => void
  abortController: AbortController
  // biome-ignore lint/suspicious/noExplicitAny: compatibility with FileStateMap and Session state requires any
  readFileState: Map<string, any>
  // biome-ignore lint/suspicious/noExplicitAny: compatibility with Session state requires any
  contentReplacementState?: any
  cwd: string
}

export interface RootAgentContext {
  type: "root"
  agentId?: undefined
  /** The session ID this root context is bound to. Used by tools that need
   *  to reference the active session (e.g., team_create for leadSessionId). */
  sessionId: string
  invokingRequestId?: string
  getAppState: () => AppState
  setAppState: (updater: (state: AppState) => AppState) => void
  setAppStateForTasks: (updater: (state: AppState) => AppState) => void
  cwd: string
  abortController: AbortController
  // biome-ignore lint/suspicious/noExplicitAny: compatibility with Session state requires any
  readFileState: Map<string, any>
  // biome-ignore lint/suspicious/noExplicitAny: compatibility with Session state requires any
  contentReplacementState?: any
}

export interface SubagentContextOverrides {
  shareSetAppState?: boolean
  shareSetResponseLength?: boolean // Not yet wired — response length sharing requires query loop integration
  shareAbortController?: boolean
  isFork?: boolean
  parentSystemPrompt?: string
  cacheSafeParams?: CacheSafeParams
  criticalSystemReminder?: string
  userContext?: Record<string, unknown>
  systemContext?: Record<string, unknown>
  mcpClients?: Array<{ name: string; client: MCP.MCPClient; config: Config.Mcp }>
  execController?: ExecController
  cwd?: string
  contentReplacementState?: Record<string, unknown>
  /** When true, sets permissionMode='bubble' and rootSessionID on the
   *  subagent's AppState so that HITL prompts surface to the root session. */
  bubbleMode?: boolean
}

export const AgentExecutionContext = new AsyncLocalStorage<AgentContext>()

export function runWithAgentContext<T>(context: AgentContext, fn: () => T): T {
  return AgentExecutionContext.run(context, fn)
}

export function consumeInvokingRequestId(): string | undefined {
  const ctx = AgentExecutionContext.getStore()
  if (!ctx) return undefined
  const reqId = ctx.invokingRequestId
  ctx.invokingRequestId = undefined
  return reqId
}

export function isRootAgent(): boolean {
  const ctx = AgentExecutionContext.getStore()
  return !ctx || ctx.agentId === undefined
}

export function createSubagentContext(
  parent: ParentContext,
  agent: Agent.Info,
  agentId: string,
  overrides?: SubagentContextOverrides,
): SubagentContext {
  const abortController = overrides?.shareAbortController ? parent.abortController : new AbortController()

  if (!overrides?.shareAbortController) {
    const parentSignal = parent.abortController.signal
    const onAbort = () => abortController.abort(parentSignal.reason)
    if (parentSignal.aborted) {
      abortController.abort(parentSignal.reason)
    } else {
      parentSignal.addEventListener("abort", onAbort, { once: true })
    }
  }

  // Implement deep isolation unless shareSetAppState is explicitly true
  // biome-ignore lint/suspicious/noExplicitAny: generic application state
  let independentState: any
  if (!overrides?.shareSetAppState) {
    const parentState = parent.getAppState?.() || {}
    independentState =
      typeof structuredClone === "function" ? structuredClone(parentState) : JSON.parse(JSON.stringify(parentState))

    if (agent.background) {
      independentState.shouldAvoidPermissionPrompts = true
    }
    // Bubble mode: set permissionMode and rootSessionID so permission
    // requests are routed to the root session's UI instead of auto-denied.
    if (overrides?.bubbleMode) {
      independentState.permissionMode = "bubble"
      independentState.rootSessionID = parent.sessionId
    }
  }

  const getAppState = () => {
    if (overrides?.shareSetAppState) {
      const state = parent.getAppState?.() || {}
      if (agent.background) {
        return { ...state, shouldAvoidPermissionPrompts: true }
      }
      return state
    }
    return independentState
  }

  const setAppState = overrides?.shareSetAppState
    ? parent.setAppState
    : // biome-ignore lint/suspicious/noExplicitAny: generic app state
      (arg: any) => {
        if (typeof arg === "function") {
          const temp = arg(independentState)
          independentState = temp === undefined ? independentState : temp
        } else {
          independentState = { ...independentState, ...arg }
        }
      }

  // Task registration/kill must always reach the root store, even when
  // setAppState is a no-op — otherwise background tasks are never
  // registered and never killed (PPID=1 zombie).
  const setAppStateForTasks = parent.setAppStateForTasks ?? parent.setAppState

  // Clone contentReplacementState for cache stability (FR-004) or use override
  // biome-ignore lint/suspicious/noExplicitAny: generic content replacement state
  let contentReplacementState: any
  if (overrides?.contentReplacementState) {
    contentReplacementState = overrides.contentReplacementState
  } else if (parent.contentReplacementState) {
    contentReplacementState =
      typeof structuredClone === "function"
        ? structuredClone(parent.contentReplacementState)
        : JSON.parse(JSON.stringify(parent.contentReplacementState))
  }

  return {
    type: "subagent",
    agentId,
    agentType: agent.name || "unknown",
    agentName: overrides?.bubbleMode ? agent.name || "unknown" : undefined,
    isFork: overrides?.isFork ?? false,
    parentSystemPrompt: overrides?.parentSystemPrompt,
    cacheSafeParams: overrides?.cacheSafeParams,
    parentSessionId: parent.sessionId,
    isBuiltIn: agent.native === true,
    invocationKind: "spawn",
    queryTracking: {
      depth: (parent.queryTracking?.depth ?? 0) + 1,
    },
    abortController,
    readFileState: new Map(parent.readFileState), // shallow clone
    contentReplacementState,
    thinkingConfig: agent.thinking
      ? {
          ...(parent.thinkingConfig || {}),
          enabled: true,
          ...(agent.thinkingBudget !== undefined ? { budget: agent.thinkingBudget } : {}),
        }
      : undefined,
    getAppState,
    setAppState,
    setAppStateForTasks,
    cwd: overrides?.cwd ?? parent.cwd ?? process.cwd(),
    effort: agent.effort,
    criticalSystemReminder: overrides?.criticalSystemReminder,
    mcpClients: overrides?.mcpClients,
    execController: overrides?.execController,
  }
}
