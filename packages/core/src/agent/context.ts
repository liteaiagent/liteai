import { AsyncLocalStorage } from "node:async_hooks"
import type { Provider } from "@/provider/provider"
import type { Agent } from "./agent"

export interface ThinkingConfig {
  enabled: boolean
  budget?: number
}

export interface ToolDecision {
  result: boolean
  source: string
  [key: string]: unknown
}

export interface AppState {
  shouldAvoidPermissionPrompts?: boolean
  permissionMode?: Agent.Info["permissionMode"]
  toolDecisions?: Record<string, ToolDecision>
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
  toolDecisions?: Record<string, ToolDecision>
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
  toolDecisions?: Record<string, ToolDecision>
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
          independentState = arg(independentState) ?? independentState
        } else {
          independentState = { ...independentState, ...arg }
        }
      }

  const setAppStateForTasks = (_action: "registerTask" | "killTask" | "deleteTodo", _payload: unknown) => {
    if (!overrides?.shareSetAppState) {
      return // Short-circuit when not sharing state
    }

    // TODO: Implement the intended state updates based on _action and _payload
    // (e.g., call parent.setAppState(prev => updatedState) applying registerTask/killTask/deleteTodo logic).
    // biome-ignore lint/suspicious/noExplicitAny: currently a no-op identity function placeholder
    parent.setAppState((state: any) => state)
  }

  return {
    type: "subagent",
    agentId: agent.name || "unknown", // This is usually a uuid assigned later, handling properly in runner
    sessionId: parent.sessionId,
    abortController,
    readFileState: new Map(parent.readFileState), // shallow clone
    toolDecisions: undefined, // fresh
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
    cwd: process.cwd(), // Will be updated if worktree mode
    effort: agent.effort,
    criticalSystemReminder: overrides?.criticalSystemReminder,
  }
}
