/**
 * AsyncLocalStorage-based runtime context for in-process teammates.
 *
 * Provides execution isolation when multiple teammates run concurrently
 * within the same Node.js process. Each teammate's code sees its own
 * identity, AppState view, and abort controller via ALS.
 *
 * Reference: Claude Code `utils/teammateContext.ts`
 */
import { AsyncLocalStorage } from "node:async_hooks"
import type { AppState, ParentContext, TeammateAgentContext } from "../agent/context"

// ─── Storage ─────────────────────────────────────────────────────────────────

const teammateContextStorage = new AsyncLocalStorage<TeammateAgentContext>()

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Get the current in-process teammate context, if executing within one.
 *
 * Returns `undefined` when called from the leader or a normal subagent.
 */
export function getTeammateContext(): TeammateAgentContext | undefined {
  return teammateContextStorage.getStore()
}

/**
 * Run a function with teammate context set in AsyncLocalStorage.
 *
 * All code within `fn` — and any async continuations it spawns — will
 * see `ctx` when calling `getTeammateContext()`.
 */
export function runWithTeammateContext<T>(ctx: TeammateAgentContext, fn: () => T): T {
  return teammateContextStorage.run(ctx, fn)
}

/**
 * Fast check: is the current execution within an in-process teammate?
 */
export function isInProcessTeammate(): boolean {
  return teammateContextStorage.getStore() !== undefined
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export interface TeammateContextConfig {
  agentId: string
  agentName: string
  teamName: string
  color?: string
  planModeRequired: boolean
  parentSessionId: string
  abortController: AbortController
  parentContext: ParentContext
}

/**
 * Create a `TeammateAgentContext` from spawn config + parent context.
 *
 * Isolation semantics match `createSubagentContext()`:
 * - AppState is deep-cloned (teammates see an independent snapshot)
 * - `setAppStateForTasks` punches through to the root store
 * - `shouldAvoidPermissionPrompts` is forced true (background agent)
 * - `readFileState` is shallow-cloned
 */
export function createTeammateContext(config: TeammateContextConfig): TeammateAgentContext {
  const { agentId, agentName, teamName, color, planModeRequired, parentSessionId, abortController, parentContext } =
    config

  // Deep-clone parent AppState for isolation (teammates get independent snapshot)
  const parentState = parentContext.getAppState?.() ?? {}
  // biome-ignore lint/suspicious/noExplicitAny: generic AppState snapshot
  let independentState: any =
    typeof structuredClone === "function" ? structuredClone(parentState) : JSON.parse(JSON.stringify(parentState))

  // Force background agent permissions — teammates don't prompt the user (Phase 4 will refine)
  independentState.shouldAvoidPermissionPrompts = true

  const getAppState = (): AppState => independentState

  const setAppState = (updater: (state: AppState) => AppState) => {
    const result = updater(independentState)
    independentState = result === undefined ? independentState : result
  }

  // Task registration/kill must always reach the root store — same pattern as
  // createSubagentContext's setAppStateForTasks
  const setAppStateForTasks = parentContext.setAppStateForTasks ?? parentContext.setAppState

  return {
    type: "teammate",
    agentId,
    agentName,
    teamName,
    agentColor: color,
    planModeRequired,
    isTeamLead: false,
    parentSessionId,
    invocationKind: "spawn",
    getAppState,
    setAppState,
    setAppStateForTasks,
    abortController,
    readFileState: new Map(parentContext.readFileState),
    contentReplacementState: parentContext.contentReplacementState
      ? typeof structuredClone === "function"
        ? structuredClone(parentContext.contentReplacementState)
        : JSON.parse(JSON.stringify(parentContext.contentReplacementState))
      : undefined,
    cwd: parentContext.cwd ?? process.cwd(),
  }
}
