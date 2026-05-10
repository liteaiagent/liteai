import { afterEach, beforeEach, describe, expect, jest, spyOn, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { type AppState, type RootAgentContext, runWithAgentContext } from "../../src/agent/context"
import * as resumeModule from "../../src/agent/resume"
import { readMailbox } from "../../src/coordinator/teammate-mailbox"
import { Global } from "../../src/global"

/** Build a minimal RootAgentContext backed by a mutable AppState object. */
function createMockRootContext(overrides?: { appState?: AppState; sessionId?: string; type?: string }): {
  ctx: RootAgentContext
  getState: () => AppState
} {
  let appState: AppState = overrides?.appState ?? {}
  return {
    ctx: {
      type: (overrides?.type ?? "root") as "root",
      sessionId: overrides?.sessionId ?? "test-session-001",
      getAppState: () => appState,
      setAppState: (updater: (state: AppState) => AppState) => {
        appState = updater(appState)
      },
      setAppStateForTasks: (updater: (state: AppState) => AppState) => {
        appState = updater(appState)
      },
      cwd: process.cwd(),
      abortController: new AbortController(),
      readFileState: new Map(),
    },
    getState: () => appState,
  }
}

/** Minimal tool execution context */
function createMockToolCtx() {
  return {
    sessionID: "test-session-001",
    messageID: "msg-001",
    agent: "test",
    messages: [],
    metadata: () => {},
    ask: async () => {},
    abort: new AbortController().signal,
    extra: {},
    // biome-ignore lint/suspicious/noExplicitAny: test mock — full ToolContext typing not needed for unit tests
  } as any
}

async function initTool(tool: { init: () => Promise<{ execute: unknown }> }) {
  const initialized = await tool.init()
  return initialized.execute as (
    params: { to: string; message: unknown; summary?: string },
    ctx: ReturnType<typeof createMockToolCtx>,
  ) => Promise<{ title: string; metadata: { success: boolean }; output: string }>
}

describe("SendMessageTool", () => {
  let resumeSpy: ReturnType<typeof spyOn>

  beforeEach(async () => {
    // Constitution §9: Use spyOn instead of mock.module for safe, scoped mocking
    resumeSpy = spyOn(resumeModule, "resumeAgentBackground").mockResolvedValue({
      agentId: "test-agent",
      description: "test",
    })
    Global.Path.root = path.join(process.cwd(), `.liteai-test-send-msg-${Date.now()}`)
  })

  afterEach(async () => {
    jest.restoreAllMocks()
    try {
      await fs.rm(Global.Path.root, { recursive: true, force: true })
    } catch {}
  })

  test("rejects teammate context", async () => {
    const { SendMessageTool } = await import("../../src/tool/send_message")
    const execute = await initTool(SendMessageTool)
    // TeammateAgentContext requires specific fields — use a minimal mock
    const teammateCtx = {
      type: "teammate" as const,
      agentId: "tm-1",
      teamName: "team-x",
      agentColor: "blue",
      planModeRequired: false,
      isTeamLead: false,
    }

    await expect(
      runWithAgentContext(teammateCtx, () => execute({ to: "worker1", message: "hello" }, createMockToolCtx())),
    ).rejects.toThrow("Teammates do not support sending messages yet")
  })

  test("queues message for running subagent", async () => {
    const { SendMessageTool } = await import("../../src/tool/send_message")
    const execute = await initTool(SendMessageTool)
    const { ctx, getState } = createMockRootContext({
      appState: {
        tasks: {
          worker1: { status: "running", pendingMessages: [] },
        },
      },
    })

    const res = await runWithAgentContext(ctx, () => execute({ to: "worker1", message: "hello" }, createMockToolCtx()))

    expect(res.metadata.success).toBe(true)
    const state = getState()
    expect(state.tasks?.worker1?.pendingMessages).toContain("hello")
    expect(resumeSpy).not.toHaveBeenCalled()
  })

  test("resumes stopped subagent", async () => {
    const { SendMessageTool } = await import("../../src/tool/send_message")
    const execute = await initTool(SendMessageTool)
    const { ctx } = createMockRootContext({
      appState: {
        tasks: {
          worker1: { status: "completed" },
        },
      },
    })

    const res = await runWithAgentContext(ctx, () => execute({ to: "worker1", message: "hello" }, createMockToolCtx()))

    expect(res.metadata.success).toBe(true)
    expect(resumeSpy).toHaveBeenCalledTimes(1)
  })

  test("routes to teammate mailbox", async () => {
    const { SendMessageTool } = await import("../../src/tool/send_message")
    const execute = await initTool(SendMessageTool)
    const { ctx } = createMockRootContext({
      appState: {
        teamContext: {
          teamName: "test-team",
          leadAgentId: "lead",
          teamFilePath: "/tmp",
          teammates: {
            worker1: { name: "worker1", agentType: "r", color: "blue", spawnedAt: 0, cwd: "" },
          },
        },
      },
    })

    const res = await runWithAgentContext(ctx, () =>
      execute({ to: "worker1", message: "hello teammate" }, createMockToolCtx()),
    )

    expect(res.metadata.success).toBe(true)

    const mailbox = await readMailbox("worker1", "test-team")
    expect(mailbox).toHaveLength(1)
    expect(mailbox[0].text).toBe("hello teammate")
    expect(resumeSpy).not.toHaveBeenCalled()
  })

  test("broadcasts to all other teammates", async () => {
    const { SendMessageTool } = await import("../../src/tool/send_message")
    const execute = await initTool(SendMessageTool)
    const { ctx } = createMockRootContext({
      appState: {
        teamContext: {
          teamName: "test-team",
          leadAgentId: "lead",
          teamFilePath: "/tmp",
          teammates: {
            coordinator: { name: "coordinator", agentType: "c", color: "red", spawnedAt: 0, cwd: "" },
            worker1: { name: "worker1", agentType: "r", color: "blue", spawnedAt: 0, cwd: "" },
            worker2: { name: "worker2", agentType: "r", color: "green", spawnedAt: 0, cwd: "" },
          },
        },
      },
    })

    const res = await runWithAgentContext(ctx, () =>
      execute({ to: "*", message: "hello everyone" }, createMockToolCtx()),
    )

    expect(res.metadata.success).toBe(true)
    expect(res.output).toContain("2")

    const mailbox1 = await readMailbox("worker1", "test-team")
    const mailbox2 = await readMailbox("worker2", "test-team")
    const mailboxCoord = await readMailbox("coordinator", "test-team")

    expect(mailbox1).toHaveLength(1)
    expect(mailbox2).toHaveLength(1)
    expect(mailboxCoord).toHaveLength(0) // Should not broadcast to self
  })

  test("sends structured protocol messages", async () => {
    const { SendMessageTool } = await import("../../src/tool/send_message")
    const execute = await initTool(SendMessageTool)
    const { ctx } = createMockRootContext({
      appState: {
        teamContext: {
          teamName: "test-team",
          leadAgentId: "lead",
          teamFilePath: "/tmp",
          teammates: {
            worker1: { name: "worker1", agentType: "r", color: "blue", spawnedAt: 0, cwd: "" },
          },
        },
      },
    })

    const payload = { type: "shutdown_request", reason: "Done" }

    const res = await runWithAgentContext(ctx, () => execute({ to: "worker1", message: payload }, createMockToolCtx()))

    expect(res.metadata.success).toBe(true)

    const mailbox = await readMailbox("worker1", "test-team")
    expect(mailbox).toHaveLength(1)

    const parsed = JSON.parse(mailbox[0].text)
    expect(parsed.type).toBe("shutdown_request")
    expect(parsed.reason).toBe("Done")
    expect(parsed.request_id).toBeDefined()
  })

  test("rejects broadcast of structured protocol messages", async () => {
    const { SendMessageTool } = await import("../../src/tool/send_message")
    const execute = await initTool(SendMessageTool)
    const { ctx } = createMockRootContext()

    const payload = { type: "shutdown_request", reason: "Done" }

    await expect(
      runWithAgentContext(ctx, () => execute({ to: "*", message: payload }, createMockToolCtx())),
    ).rejects.toThrow("Structured protocol messages cannot be broadcast")
  })

  // ─── M-4: Missing agentNameRegistry integration test ──────────────
  test("resolves name via agentNameRegistry and routes to teammate mailbox (C-1 regression)", async () => {
    const { SendMessageTool } = await import("../../src/tool/send_message")
    const execute = await initTool(SendMessageTool)
    const { ctx } = createMockRootContext({
      appState: {
        // Registry maps user-friendly name → UUID
        agentNameRegistry: {
          "my-worker": "uuid-abc-123",
        },
        teamContext: {
          teamName: "test-team",
          leadAgentId: "lead",
          teamFilePath: "/tmp",
          teammates: {
            // Teammates keyed by NAME, not UUID
            "my-worker": { name: "my-worker", agentType: "r", color: "blue", spawnedAt: 0, cwd: "" },
          },
        },
      },
    })

    // Send using the name "my-worker" — should resolve via registry AND still
    // match the teammate lookup (which is keyed by name).
    const res = await runWithAgentContext(ctx, () =>
      execute({ to: "my-worker", message: "routed via registry" }, createMockToolCtx()),
    )

    expect(res.metadata.success).toBe(true)
    expect(res.output).toContain("mailbox")

    // Verify the message arrived in the name-keyed mailbox, not a UUID-keyed one
    const mailbox = await readMailbox("my-worker", "test-team")
    expect(mailbox).toHaveLength(1)
    expect(mailbox[0].text).toBe("routed via registry")

    // Should NOT fall through to resume
    expect(resumeSpy).not.toHaveBeenCalled()
  })
})
