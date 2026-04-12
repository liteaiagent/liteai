import { afterEach, beforeEach, describe, expect, it, jest, mock, spyOn } from "bun:test"

// Mock the prompt and other dependencies before importing runner
mock.module("../../src/session/engine", () => ({
  SessionPrompt: {
    prompt: mock(() => Promise.resolve({ parts: [{ type: "text", text: "Mock output" }] })),
  },
}))

mock.module("../../src/mcp/index", () => ({
  MCP: {
    status: mock(() =>
      Promise.resolve({
        "test-server": { status: "connected" },
        "offline-server": { status: "disconnected" },
      }),
    ),
  },
}))

import { Agent } from "../../src/agent/agent"
import { AgentTimeoutError, ConcurrentAgentLimitError, RequiredMcpServerError } from "../../src/agent/errors"
import { runAgent } from "../../src/agent/runner"
import { Bus } from "../../src/bus/index"
import { Provider } from "../../src/provider/provider"
import { Session } from "../../src/session/index"
import type { SessionID } from "../../src/session/schema"

describe("runAgent", () => {
  beforeEach(() => {
    spyOn(Bus, "publish").mockResolvedValue([])
    spyOn(Provider, "defaultModel").mockResolvedValue({
      providerID: "test-provider",
      modelID: "test-model",
    } as unknown as Awaited<ReturnType<typeof Provider.defaultModel>>)
  })

  afterEach(() => {
    // Reset any mocks if necessary
    jest.restoreAllMocks()
  })

  it("successfully passes validation and executes", async () => {
    spyOn(Agent, "get").mockResolvedValue({
      name: "test-agent",
      requiredMcpServers: ["test-server"],
      model: undefined,
    } as unknown as Agent.AgentDefinition)

    const result = await runAgent("test-agent", "sess_1" as SessionID)
    expect(result.status).toBe("completed")
    expect(result.result).toBe("Mock output")
  })

  it("throws RequiredMcpServerError if server missing", async () => {
    spyOn(Agent, "get").mockResolvedValue({
      name: "test-agent",
      requiredMcpServers: ["missing-server"],
    } as unknown as Agent.AgentDefinition)

    await expect(runAgent("test-agent", "sess_1" as SessionID)).rejects.toThrow(RequiredMcpServerError)
  })

  it("enforces concurrent limit", async () => {
    spyOn(Agent, "get").mockResolvedValue({ name: "test" } as unknown as Agent.AgentDefinition)
    spyOn(Session, "getAgentCount").mockReturnValue(11) // Exceeds 5

    await expect(runAgent("test-agent", "sess_1" as SessionID)).rejects.toThrow(ConcurrentAgentLimitError)
  })

  it("enforces timeout", async () => {
    // Simulate a prompt that never resolves
    mock.module("../../src/session/engine", () => ({
      SessionPrompt: {
        prompt: mock(() => new Promise(() => {})),
      },
    }))

    spyOn(Agent, "get").mockResolvedValue({ name: "test", timeout: 10 } as unknown as Agent.AgentDefinition)
    spyOn(Session, "incrementAgentCount").mockReturnValue(1)

    await expect(runAgent("test-agent", "sess_1" as SessionID)).rejects.toThrow(AgentTimeoutError)
  })
})
