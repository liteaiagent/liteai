import { AsyncLocalStorage } from "node:async_hooks"
import type { Provider } from "@/provider/provider"
import type { Agent } from "./agent"

export interface ThinkingConfig {
  enabled: boolean
  budget?: number
}

export interface AppState {
  shouldAvoidPermissionPrompts?: boolean
}

export type AgentContext = SubagentContext | TeammateAgentContext

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
  model?: { providerID: string; modelID: string } | Provider.Model
  thinkingConfig?: ThinkingConfig
}

export interface SubagentContext {
  type: "subagent"
  agentId: string
  sessionId: string
  abortController: AbortController
  // biome-ignore lint/suspicious/noExplicitAny: compatibility with Session state requires any
  readFileState: Map<string, any>
  // biome-ignore lint/suspicious/noExplicitAny: compatibility with Session state requires any
  toolDecisions?: Record<string, any>
  thinkingConfig?: ThinkingConfig
  getAppState: () => AppState
  setAppState: (updater: (state: AppState) => AppState) => void
  setAppStateForTasks: (action: "registerTask" | "killTask" | "deleteTodo", payload: unknown) => void
  cwd: string
  effort?: string
  criticalSystemReminder?: string
  invokingRequestId?: string
}

export interface TeammateAgentContext {
  type: "teammate"
  agentId: string
  teamName: string
  agentColor: string
  planModeRequired: boolean
  isTeamLead: boolean
  invokingRequestId?: string
}

export interface SubagentContextOverrides {
  shareSetAppState?: boolean
  shareSetResponseLength?: boolean
  shareAbortController?: boolean
  criticalSystemReminder?: string
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
  overrides?: SubagentContextOverrides,
): SubagentContext {
  const abortController = overrides?.shareAbortController ? parent.abortController : new AbortController()

  if (!overrides?.shareAbortController) {
    const parentSignal = parent.abortController.signal
    const onAbort = () => abortController.abort(parentSignal.reason)
    if (parentSignal.aborted) {
      abortController.abort(parentSignal.reason)
    } else {
      parentSignal.addEventListener("abort", onAbort)
    }
  }

  const getAppState = () => {
    const state = parent.getAppState()
    if (agent.background) {
      return { ...state, shouldAvoidPermissionPrompts: true }
    }
    return state
  }

  const setAppState = overrides?.shareSetAppState ? parent.setAppState : () => {} // NOOP wrapper by default

  const setAppStateForTasks = (_action: "registerTask" | "killTask" | "deleteTodo", _payload: unknown) => {
    // biome-ignore lint/suspicious/noExplicitAny: state requires any for now due to AppState typing
    parent.setAppState((_state: any) => {
      // Just a mock implementation for tasks scoping right now
      return _state
    })
  }

  return {
    type: "subagent",
    agentId: agent.name || "unknown", // This is usually a uuid assigned later, handling properly in runner
    sessionId: parent.sessionId,
    abortController,
    readFileState: new Map(parent.readFileState), // shallow clone
    toolDecisions: undefined, // fresh
    thinkingConfig: agent.thinking ? { enabled: true, budget: agent.thinkingBudget } : undefined,
    getAppState,
    setAppState,
    setAppStateForTasks,
    cwd: process.cwd(), // Will be updated if worktree mode
    effort: agent.effort,
    criticalSystemReminder: overrides?.criticalSystemReminder,
  }
}
