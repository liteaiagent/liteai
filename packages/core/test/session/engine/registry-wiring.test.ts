import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test"
import { z } from "zod"
import { BackgroundTaskRegistry } from "../../../src/command/background"
import { MessageID, SessionID } from "../../../src/session/schema"

// Mock the ToolRegistry to return a minimal tool set, avoiding the deep
// import graph (AgentTool, etc.) that causes initialization failures in test.
mock.module("../../../src/tool/registry", () => ({
  ToolRegistry: {
    tools: mock(async () => [
      {
        id: "run_command",
        description: "Run a command",
        parameters: z.object({}),
        async execute(_args: unknown, ctx: unknown) {
          return { output: "", title: "", __ctx: ctx }
        },
      },
    ]),
  },
}))

// Mock MCP tools (returns empty map)
mock.module("../../../src/mcp", () => ({
  MCP: { tools: async () => ({}) },
}))

// Mock external dependencies that resolveTools reaches into
mock.module("../../../src/plugin", () => ({
  Plugin: {
    getToolSchemas: async () => [],
    trigger: async () => {},
  },
}))

mock.module("../../../src/hook", () => ({
  Hook: {
    dispatch: async () => ({ proceed: true }),
  },
}))
mock.module("../../../src/permission/next", () => ({
  PermissionNext: {
    evaluate: () => true,
    ask: async () => {},
    merge: () => [],
    Ruleset: z.any(),
  },
}))

const { resolveTools } = await import("../../../src/session/engine/tools")

import { Instance } from "../../../src/project/instance"

describe("resolveTools background task registry wiring", () => {
  let originalDirectory: PropertyDescriptor | undefined
  let originalWorktree: PropertyDescriptor | undefined

  beforeAll(() => {
    originalDirectory = Object.getOwnPropertyDescriptor(Instance, "directory")
    originalWorktree = Object.getOwnPropertyDescriptor(Instance, "worktree")

    Object.defineProperty(Instance, "directory", {
      get: () => "/mock/dir",
      configurable: true,
    })
    Object.defineProperty(Instance, "worktree", {
      get: () => "/mock/dir",
      configurable: true,
    })
  })

  afterAll(() => {
    if (originalDirectory) Object.defineProperty(Instance, "directory", originalDirectory)
    if (originalWorktree) Object.defineProperty(Instance, "worktree", originalWorktree)
  })

  test("threads backgroundTaskRegistry into tool ctx.extra when tool is executed", async () => {
    const registry = new BackgroundTaskRegistry()
    const sessionID = SessionID.make("test")
    const messageID = MessageID.make("test")

    const mockAgent = { name: "test-agent", tools: undefined } as unknown as Parameters<typeof resolveTools>[0]["agent"]
    const mockModel = {
      id: "test-model",
      api: { id: "test-api" },
      providerID: "test-provider",
    } as unknown as Parameters<typeof resolveTools>[0]["model"]
    const mockSession = { id: sessionID } as unknown as Parameters<typeof resolveTools>[0]["session"]
    const mockProcessor = {
      message: { id: messageID },
      partFromToolCall: () => undefined,
    } as unknown as Parameters<typeof resolveTools>[0]["processor"]

    const tools = await resolveTools({
      agent: mockAgent,
      model: mockModel,
      session: mockSession,
      processor: mockProcessor,
      bypassAgentCheck: true,
      messages: [],
      backgroundTaskRegistry: registry,
    })

    // Verify the tool set includes run_command
    expect(tools).toBeTypeOf("object")
    expect(tools.run_command).toBeDefined()
    expect(typeof tools.run_command?.execute).toBe("function")

    const executeFn = tools.run_command.execute as (a: unknown, c: unknown) => Promise<unknown>
    const result = (await executeFn({}, {})) as { __ctx: { extra?: { backgroundTaskRegistry?: unknown } } }
    expect(result.__ctx.extra?.backgroundTaskRegistry).toBe(registry)
  })

  test("resolveTools works without backgroundTaskRegistry (optional)", async () => {
    const sessionID = SessionID.make("test-no-reg")
    const messageID = MessageID.make("test-no-reg")

    const tools = await resolveTools({
      agent: { name: "test-agent", tools: undefined } as unknown as Parameters<typeof resolveTools>[0]["agent"],
      model: {
        id: "test-model",
        api: { id: "test-api" },
        providerID: "test-provider",
      } as unknown as Parameters<typeof resolveTools>[0]["model"],
      session: { id: sessionID } as unknown as Parameters<typeof resolveTools>[0]["session"],
      processor: {
        message: { id: messageID },
        partFromToolCall: () => undefined,
      } as unknown as Parameters<typeof resolveTools>[0]["processor"],
      bypassAgentCheck: true,
      messages: [],
      // backgroundTaskRegistry intentionally omitted
    })

    // Should still resolve tools without error
    expect(tools).toBeTypeOf("object")
    expect(tools.run_command).toBeDefined()
  })
})
