import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { type AppState, type RootAgentContext, runWithAgentContext } from "../../src/agent/context"

// ─── Shared test helpers ────────────────────────────────────────────────────

/** Build a minimal RootAgentContext backed by a mutable AppState object. */
function createMockRootContext(overrides?: { appState?: AppState; sessionId?: string }): {
  ctx: RootAgentContext
  getState: () => AppState
} {
  let appState: AppState = overrides?.appState ?? {}
  return {
    ctx: {
      type: "root",
      sessionId: overrides?.sessionId ?? "test-session-001",
      getAppState: () => appState,
      setAppState: (updater) => {
        appState = updater(appState)
      },
      setAppStateForTasks: (updater) => {
        appState = updater(appState)
      },
      cwd: process.cwd(),
      abortController: new AbortController(),
      readFileState: new Map(),
    },
    getState: () => appState,
  }
}

/** Minimal tool execution context for Tool.execute's second argument. */
function createMockToolCtx(sessionID = "test-session-001") {
  return {
    sessionID,
    messageID: "msg-001",
    agent: "test",
    messages: [],
    metadata: () => {},
    ask: async () => {},
    abort: new AbortController().signal,
    extra: {},
    // biome-ignore lint/suspicious/noExplicitAny: test mock does not implement full Tool.Context
  } as any
}

/**
 * Initialize a tool and return its execute function.
 * Tool.define returns a Tool.Info with an init() method;
 * calling init() returns the { execute, description, parameters } object.
 */
async function initTool(tool: {
  // biome-ignore lint/suspicious/noExplicitAny: Tool.Info init return type is generic
  init: (ctx?: any) => Promise<{ execute: (...args: any[]) => any }>
}) {
  const initialized = await tool.init()
  return initialized.execute as (
    params: Record<string, unknown>,
    ctx: unknown,
  ) => Promise<{
    title: string
    metadata: Record<string, unknown>
    output: string
  }>
}

// ─── team_create ────────────────────────────────────────────────────────────

describe("TeamCreateTool", () => {
  // _path and _data are required by the function signature so we can inspect mock.calls arguments in tests
  const mockWriteTeamFile = mock((_path: string, _data: unknown) => Promise.resolve("/tmp/test-team/config.json"))
  const mockReadTeamFile = mock(() => Promise.resolve(null))
  const mockSanitizeTeamName = mock((name: string) =>
    name
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 64),
  )

  beforeEach(() => {
    // Constitution §9: mock.module replaces the entire module in Bun's cache.
    // We MUST include ALL exports that any other test might import from this module,
    // otherwise cross-test cache pollution will cause SyntaxError.
    mock.module("../../src/coordinator/team-helpers", () => ({
      writeTeamFile: mockWriteTeamFile,
      readTeamFile: mockReadTeamFile,
      sanitizeTeamName: mockSanitizeTeamName,
      cleanupTeamDirectories: mock(() => Promise.resolve()),
      teamsBaseDir: mock(() => "/tmp/teams"),
      teamDir: mock((name: string) => `/tmp/teams/${name}`),
      teamConfigPath: mock((name: string) => `/tmp/teams/${name}/config.json`),
      teamScratchpadDir: mock(async (name: string) => `/tmp/teams/${name}/scratchpad`),
    }))
    mockWriteTeamFile.mockClear()
    mockReadTeamFile.mockClear()
  })

  afterEach(() => {
    mock.restore()
  })

  test("H-1: rejects empty team_name", async () => {
    const { TeamCreateTool } = await import("../../src/tool/team_create")
    const execute = await initTool(TeamCreateTool)
    const { ctx } = createMockRootContext()
    const toolCtx = createMockToolCtx()

    await expect(
      runWithAgentContext(ctx, () =>
        execute({ team_name: "", description: undefined, agent_type: undefined }, toolCtx),
      ),
    ).rejects.toThrow("team_name is required and must not be empty")
  })

  test("H-1: rejects whitespace-only team_name", async () => {
    const { TeamCreateTool } = await import("../../src/tool/team_create")
    const execute = await initTool(TeamCreateTool)
    const { ctx } = createMockRootContext()
    const toolCtx = createMockToolCtx()

    await expect(
      runWithAgentContext(ctx, () =>
        execute({ team_name: "   ", description: undefined, agent_type: undefined }, toolCtx),
      ),
    ).rejects.toThrow("team_name is required and must not be empty")
  })

  test("M-5: throws when team already active", async () => {
    const { TeamCreateTool } = await import("../../src/tool/team_create")
    const execute = await initTool(TeamCreateTool)
    const { ctx } = createMockRootContext({
      appState: {
        teamContext: {
          teamName: "existing-team",
          teamFilePath: "/tmp/existing/config.json",
          leadAgentId: "team-lead",
          teammates: {},
        },
      },
    })
    const toolCtx = createMockToolCtx()

    await expect(
      runWithAgentContext(ctx, () =>
        execute({ team_name: "new-team", description: undefined, agent_type: undefined }, toolCtx),
      ),
    ).rejects.toThrow('Already leading team "existing-team"')
  })

  test("H-4: uses sessionId from root context for leadSessionId", async () => {
    const { TeamCreateTool } = await import("../../src/tool/team_create")
    const execute = await initTool(TeamCreateTool)
    const { ctx } = createMockRootContext({ sessionId: "root-session-xyz" })
    const toolCtx = createMockToolCtx("root-session-xyz")

    await runWithAgentContext(ctx, () =>
      execute({ team_name: "my-team", description: undefined, agent_type: undefined }, toolCtx),
    )

    // Verify writeTeamFile was called with the correct leadSessionId
    expect(mockWriteTeamFile).toHaveBeenCalledTimes(1)
    const writtenTeamFile = mockWriteTeamFile.mock.calls[0][1] as { leadSessionId: string }
    expect(writtenTeamFile.leadSessionId).toBe("root-session-xyz")
  })

  test("creates team and updates AppState", async () => {
    const { TeamCreateTool } = await import("../../src/tool/team_create")
    const execute = await initTool(TeamCreateTool)
    const { ctx, getState } = createMockRootContext()
    const toolCtx = createMockToolCtx()

    const result = await runWithAgentContext(ctx, () =>
      execute({ team_name: "alpha-team", description: "Test team", agent_type: "coordinator" }, toolCtx),
    )

    expect(result.metadata.success).toBe(true)
    const state = getState()
    expect(state.teamContext).toBeDefined()
    expect(state.teamContext?.teamName).toBe("alpha-team")
    expect(state.teamContext?.leadAgentId).toBe("team-lead")
  })
})

// ─── team_delete ────────────────────────────────────────────────────────────
// Tests focus on AppState mutation logic which doesn't require mocking the
// filesystem cleanup function. The cleanupTeamDirectories function is tested
// separately and the tool's control flow can be verified via AppState checks.

describe("TeamDeleteTool", () => {
  afterEach(() => {
    mock.restore()
  })

  test("returns output for no team active", async () => {
    const { TeamDeleteTool } = await import("../../src/tool/team_delete")
    const execute = await initTool(TeamDeleteTool)
    const { ctx } = createMockRootContext()
    const toolCtx = createMockToolCtx()

    const result = await runWithAgentContext(ctx, () => execute({}, toolCtx))

    expect(result.metadata.success).toBe(false)
    expect(result.output).toContain("No team name found")
  })

  test("Phase 3: force-kills running teammates and succeeds", async () => {
    // Mock cleanup so it doesn't touch the filesystem
    mock.module("../../src/coordinator/team-helpers", () => ({
      cleanupTeamDirectories: mock(() => Promise.resolve()),
      readTeamFile: mock(() => Promise.resolve(null)),
      writeTeamFile: mock(() => Promise.resolve("/tmp/test/config.json")),
      sanitizeTeamName: mock((name: string) => name),
      teamsBaseDir: mock(() => "/tmp/teams"),
      teamDir: mock((name: string) => `/tmp/teams/${name}`),
      teamConfigPath: mock((name: string) => `/tmp/teams/${name}/config.json`),
      teamScratchpadDir: mock(async (name: string) => `/tmp/teams/${name}/scratchpad`),
    }))

    const { TeamDeleteTool } = await import("../../src/tool/team_delete")
    const execute = await initTool(TeamDeleteTool)
    const { ctx, getState } = createMockRootContext({
      appState: {
        teamContext: {
          teamName: "busy-team",
          teamFilePath: "/tmp/busy/config.json",
          leadAgentId: "team-lead",
          teammates: {
            "team-lead": {
              name: "team-lead",
              agentType: "coordinator",
              color: "blue",
              spawnedAt: Date.now(),
              cwd: "/tmp",
            },
            worker1: {
              name: "worker1",
              agentType: "researcher",
              color: "green",
              spawnedAt: Date.now(),
              cwd: "/tmp",
            },
          },
        },
        // BackgroundTaskState entries (not TeammateTaskState) won't be killed
        // by killInProcessTeammate — but team_delete should still succeed
        tasks: { worker1: { status: "running" } },
      },
    })
    const toolCtx = createMockToolCtx()

    // Phase 3: team_delete no longer throws — it force-kills and proceeds
    const result = await runWithAgentContext(ctx, () => execute({}, toolCtx))

    expect(result.metadata.success).toBe(true)
    expect(result.output).toContain('Cleaned up directories for team "busy-team"')
    expect(getState().teamContext).toBeUndefined()
  })
})

// ─── task_stop ──────────────────────────────────────────────────────────────

describe("AgentStopTool", () => {
  afterEach(() => {
    mock.restore()
  })

  test("H-1: rejects empty task_id", async () => {
    const { AgentStopTool } = await import("../../src/tool/agent_stop")
    const execute = await initTool(AgentStopTool)
    const { ctx } = createMockRootContext()
    const toolCtx = createMockToolCtx()

    await expect(runWithAgentContext(ctx, () => execute({ task_id: "" }, toolCtx))).rejects.toThrow(
      "task_id is required and must not be empty",
    )
  })

  test("H-3: rejects invalid task_id format", async () => {
    const { AgentStopTool } = await import("../../src/tool/agent_stop")
    const execute = await initTool(AgentStopTool)
    const { ctx } = createMockRootContext()
    const toolCtx = createMockToolCtx()

    await expect(
      runWithAgentContext(ctx, () => execute({ task_id: "not-a-valid-session-id" }, toolCtx)),
    ).rejects.toThrow("Invalid task_id format")
  })
})
