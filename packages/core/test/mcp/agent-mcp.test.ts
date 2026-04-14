import { describe, expect, it, mock, spyOn } from "bun:test"
import type { Agent } from "@/agent/agent"
import { McpConnectionError } from "@/agent/errors"
import { initializeAgentMcpServers } from "@/mcp/agent-mcp"
import { MCP } from "@/mcp/index"

describe("Dynamic MCP Server Lifecycle", () => {
  it("should return empty session when no mcpServers defined", async () => {
    const agentDef: Agent.AgentDefinition = {
      name: "test-agent",
      source: "custom",
      native: false,
      mode: "subagent",
      permission: [],
      options: {},
    }
    const session = await initializeAgentMcpServers(agentDef)
    expect(session.clients).toEqual([])
    await session.cleanup() // Should not throw
  })

  it("should bounce ONLY inline servers for agents restricted to plugin-only", async () => {
    const pluginOnlyDef: Agent.AgentDefinition = {
      name: "restricted-agent",
      source: "custom",
      native: false,
      mode: "subagent",
      permission: [],
      options: {},
      mcpServers: ["shared-db", { "my-scoped": { type: "local", command: "echo" } }],
    }

    const mockGetMcpConfigByName = spyOn(MCP, "getMcpConfigByName").mockResolvedValue({ type: "remote", url: "x" })
    const mockEnsureConnected = spyOn(MCP, "ensureConnected").mockResolvedValue()
    const mockState = spyOn(MCP, "state").mockResolvedValue({
      status: { "shared-db": { status: "connected" } },
      clients: { "shared-db": {} as unknown as MCP.MCPClient },
    })

    const session = await initializeAgentMcpServers(pluginOnlyDef)
    expect(session.clients.length).toBe(1)
    expect(session.clients[0].name).toBe("shared-db")

    mockGetMcpConfigByName.mockRestore()
    mockEnsureConnected.mockRestore()
    mockState.mockRestore()
  })

  it("should resolve string reference against global config", async () => {
    const agentDef: Agent.AgentDefinition = {
      name: "test",
      source: "custom",
      native: false,
      mode: "subagent",
      permission: [],
      options: {},
      mcpServers: ["shared-db"],
    }

    const mockGetMcpConfigByName = spyOn(MCP, "getMcpConfigByName").mockResolvedValue({ type: "remote", url: "x" })
    const mockEnsureConnected = spyOn(MCP, "ensureConnected").mockResolvedValue()
    const mockState = spyOn(MCP, "state").mockResolvedValue({
      status: { "shared-db": { status: "connected" } },
      clients: { "shared-db": {} as unknown as MCP.MCPClient },
    })

    const session = await initializeAgentMcpServers(agentDef)
    expect(session.clients.length).toBe(1)
    expect(session.clients[0].name).toBe("shared-db")

    mockGetMcpConfigByName.mockRestore()
    mockEnsureConnected.mockRestore()
    mockState.mockRestore()
  })

  it("should throw McpConnectionError if string reference fails to connect", async () => {
    const agentDef: Agent.AgentDefinition = {
      name: "test",
      source: "custom",
      native: false,
      mode: "subagent",
      permission: [],
      options: {},
      mcpServers: ["bad-server"],
    }

    spyOn(MCP, "getMcpConfigByName").mockResolvedValue({ type: "remote", url: "x" })
    spyOn(MCP, "ensureConnected").mockResolvedValue()
    spyOn(MCP, "state").mockResolvedValue({
      status: { "bad-server": { status: "failed", error: "ded" } },
      clients: {},
    })

    await expect(initializeAgentMcpServers(agentDef)).rejects.toThrow(McpConnectionError)

    mock.restore()
  })

  it("should create inline scoped servers and close them on cleanup", async () => {
    const agentDef: Agent.AgentDefinition = {
      name: "test",
      source: "builtIn",
      native: true,
      mode: "subagent",
      permission: [],
      options: {},
      mcpServers: [{ "my-scoped": { type: "local", command: "echo" } }],
    }

    let closed = false
    const mockClient = {
      close: async () => {
        closed = true
      },
    }

    spyOn(MCP, "create").mockResolvedValue({
      mcpClient: mockClient as unknown as MCP.MCPClient,
      status: { status: "connected" },
    })

    const session = await initializeAgentMcpServers(agentDef)
    expect(session.clients.length).toBe(1)
    expect(session.clients[0].name).toBe("my-scoped")

    await session.cleanup()
    expect(closed).toBe(true)

    mock.restore()
  })

  // SC-004: 1000-sequential-spawn stress test
  it("SC-004: should execute 1000 sequential spawns and close all inline connections within 5000ms", async () => {
    const agentDef: Agent.AgentDefinition = {
      name: "stress-tester",
      source: "builtIn",
      native: true,
      mode: "subagent",
      permission: [],
      options: {},
      mcpServers: [{ "stress-local": { type: "local", command: "echo" } }],
    }

    let activeClients = 0
    let totalClosed = 0

    spyOn(MCP, "create").mockImplementation(async () => {
      activeClients++
      return {
        mcpClient: {
          close: async () => {
            activeClients--
            totalClosed++
          },
        } as unknown as MCP.MCPClient,
        status: { status: "connected" },
      }
    })

    const start = Date.now()

    for (let i = 0; i < 1000; i++) {
      const session = await initializeAgentMcpServers(agentDef)
      expect(activeClients).toBe(1)
      await session.cleanup()
      expect(activeClients).toBe(0)
    }

    const duration = Date.now() - start

    expect(totalClosed).toBe(1000)
    expect(activeClients).toBe(0)
    expect(duration).toBeLessThan(5000)

    mock.restore()
  })
})
