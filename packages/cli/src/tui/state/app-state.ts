/**
 * AppState — the canonical TUI state shape.
 *
 * Replaces SyncState from sync.tsx. All fields are immutable by convention
 * (consumers receive read-only snapshots via selectors). Mutations go
 * through AppStore.setState with explicit spread patterns.
 */

import type { Snapshot } from "@liteai/core/snapshot/index"
import type {
  Agent,
  Command,
  Config,
  FormatterStatus,
  LspStatus,
  McpResource,
  McpStatus,
  Message,
  Part,
  PermissionRequest,
  ProviderAuthMethod,
  ProviderListResponse,
  QuestionRequest,
  Session,
  SessionStatus,
  Todo,
  VcsInfo,
  Workspace,
} from "@liteai/sdk"

// ── Agent instance state (subagents spawned during a session) ─────────
export interface AgentInstanceInfo {
  readonly type: string
  readonly parentId: string
  readonly isAsync: boolean
  readonly activity?: string
  readonly status: "running" | "completed" | "failed" | "killed"
  readonly startTime: number
  readonly duration?: number
  readonly usage?: { totalTokens: number; toolCalls: number; duration: number }
}

export interface PlanApprovalRequest {
  readonly sessionID: string
  readonly planText: string
  readonly planFilePath: string
}

// ── Main state shape ──────────────────────────────────────────────────
export interface AppState {
  readonly status: "loading" | "partial" | "complete"
  readonly provider: ProviderListResponse["all"]
  readonly provider_default: Record<string, string>
  readonly provider_next: ProviderListResponse
  readonly provider_auth: Record<string, ProviderAuthMethod[]>
  readonly agent: readonly Agent[]
  readonly command: readonly Command[]
  readonly permission: { readonly [sessionID: string]: readonly PermissionRequest[] }
  readonly question: { readonly [sessionID: string]: readonly QuestionRequest[] }
  readonly config: Config
  readonly sessions: readonly Session[]
  readonly session_status: { readonly [sessionID: string]: SessionStatus }
  readonly session_diff: { readonly [sessionID: string]: readonly Snapshot.FileDiff[] }
  readonly todo: { readonly [sessionID: string]: readonly Todo[] }
  readonly message: { readonly [sessionID: string]: readonly Message[] }
  readonly part: { readonly [messageID: string]: readonly Part[] }
  readonly lsp: readonly LspStatus[]
  readonly mcp: { readonly [key: string]: McpStatus }
  readonly mcp_resource: { readonly [key: string]: McpResource }
  readonly formatter: readonly FormatterStatus[]
  readonly vcs: VcsInfo | undefined
  readonly path: {
    readonly home: string
    readonly state: string
    readonly config: string
    readonly worktree: string
    readonly directory: string
  }
  readonly workspaceList: readonly Workspace[]
  readonly agents: { readonly [agentId: string]: AgentInstanceInfo }
  readonly planApproval: PlanApprovalRequest | null
  /**
   * Note: This uses a loose string type instead of the PermissionMode union.
   * The TUI expects a 4-mode set while core exposes a 6-mode superset (including "dontAsk" and "bubble").
   * This is an intentional compatibility choice to allow storing core-only modes.
   * See tui/util/permission-mode.ts for the mapping logic.
   */
  readonly permissionMode: { readonly [sessionID: string]: string }
}

// ── Default / initial state factory ──────────────────────────────────

export function getDefaultAppState(): AppState {
  return {
    status: "loading",
    provider: [],
    provider_default: {},
    provider_next: { all: [], default: {}, connected: [] },
    provider_auth: {},
    agent: [],
    command: [],
    permission: {},
    question: {},
    config: {},
    sessions: [],
    session_status: {},
    session_diff: {},
    todo: {},
    message: {},
    part: {},
    lsp: [],
    mcp: {},
    mcp_resource: {},
    formatter: [],
    vcs: undefined,
    path: { home: "", state: "", config: "", worktree: "", directory: "" },
    workspaceList: [],
    agents: {},
    planApproval: null,
    permissionMode: {},
  }
}

// ── Empty sentinel arrays (stable references for selector returns) ────
// Using these prevents useAppState(s => s.message[id] ?? []) from creating
// a new array identity on every call, which would defeat Object.is.

export const EMPTY_MESSAGES: readonly Message[] = Object.freeze([])
export const EMPTY_PARTS: readonly Part[] = Object.freeze([])
export const EMPTY_PERMISSIONS: readonly PermissionRequest[] = Object.freeze([])
export const EMPTY_QUESTIONS: readonly QuestionRequest[] = Object.freeze([])
export const EMPTY_TODOS: readonly Todo[] = Object.freeze([])
export const EMPTY_DIFFS: readonly Snapshot.FileDiff[] = Object.freeze([])
export const EMPTY_SESSIONS: readonly Session[] = Object.freeze([])
