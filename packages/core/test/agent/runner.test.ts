import { afterEach, beforeEach, describe, expect, it, jest, spyOn } from "bun:test"

import { Instance } from "../../src/project/instance"

const orgDirectory = Object.getOwnPropertyDescriptor(Instance, "directory")
const orgWorktree = Object.getOwnPropertyDescriptor(Instance, "worktree")

beforeEach(() => {
  Object.defineProperty(Instance, "directory", { get: () => "/fake/dir", configurable: true })
  Object.defineProperty(Instance, "worktree", { get: () => "/fake/dir", configurable: true })
})

afterEach(() => {
  if (orgDirectory) Object.defineProperty(Instance, "directory", orgDirectory)
  if (orgWorktree) Object.defineProperty(Instance, "worktree", orgWorktree)
})

import { AgentMemory } from "../../src/agent/memory"
import { MCP } from "../../src/mcp/index"
import { SessionPrompt } from "../../src/session/engine"
import { SidechainTranscript } from "../../src/session/transcript"
import { SkillLoader } from "../../src/skill/loader"

let promptImpl: (() => Promise<unknown>) | undefined

beforeEach(() => {
  spyOn(SidechainTranscript, "create").mockReturnValue({
    getPath: () => "/fake/path",
    recordMessage: async () => {},
    recordChain: async () => {},
  } as unknown as ReturnType<typeof SidechainTranscript.create>)

  spyOn(SessionPrompt, "prompt").mockImplementation((async () => {
    if (promptImpl) return promptImpl()
    return {
      info: { role: "assistant", tokens: { input: 10, output: 20 } },
      parts: [{ type: "text", text: "Mock output" }],
    }
  }) as unknown as typeof SessionPrompt.prompt)

  spyOn(MCP, "status").mockResolvedValue({
    "test-server": { status: "connected" },
    "offline-server": { status: "disconnected" },
  } as unknown as Exclude<Awaited<ReturnType<typeof MCP.status>>, undefined>)

  spyOn(AgentMemory, "isAutoMemoryEnabled").mockResolvedValue(false)
  spyOn(AgentMemory, "loadAgentMemoryPrompt").mockResolvedValue("")

  spyOn(SkillLoader, "resolveSkillName").mockResolvedValue(undefined)
  spyOn(SkillLoader, "registerInvokedSkill").mockImplementation(() => {})
  spyOn(SkillLoader, "clearInvokedSkillsForAgent").mockImplementation(() => {})
})

import { Agent } from "../../src/agent/agent"
import {
  AgentSpawnError,
  AgentTimeoutError,
  ConcurrentAgentLimitError,
  RequiredMcpServerError,
} from "../../src/agent/errors"
import { DEFAULT_CONCURRENT_AGENT_LIMIT, runAgent, runAgentByName } from "../../src/agent/runner"
import { Bus } from "../../src/bus/index"
import { Provider } from "../../src/provider/provider"
import { Session } from "../../src/session/index"
import type { SessionID } from "../../src/session/schema"

/**
 * Helper to create a minimal AgentDefinition for tests.
 * Callers can override individual fields as needed.
 */
function createTestAgent(overrides: Partial<Agent.AgentDefinition> = {}): Agent.AgentDefinition {
  return {
    name: "test-agent",
    ...overrides,
  } as Agent.AgentDefinition
}

describe("runAgent", () => {
  beforeEach(() => {
    promptImpl = undefined
    spyOn(Bus, "publish").mockResolvedValue([])
    spyOn(Provider, "defaultModel").mockResolvedValue({
      providerID: "test-provider",
      modelID: "test-model",
    } as unknown as Awaited<ReturnType<typeof Provider.defaultModel>>)
    spyOn(Session, "get").mockResolvedValue({ directory: "/fake/dir" } as unknown as Awaited<
      ReturnType<typeof Session.get>
    >)
    spyOn(Session, "createNext").mockResolvedValue({ id: "fake_child_1" } as unknown as Awaited<
      ReturnType<typeof Session.createNext>
    >)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it("successfully passes validation and executes", async () => {
    const agentDef = createTestAgent({
      requiredMcpServers: ["test-server"],
      model: undefined,
    })

    const result = await runAgent({
      agentDefinition: agentDef,
      sessionId: "sess_1" as SessionID,
    })
    expect(result.status).toBe("completed")
    expect(result.result).toBe("Mock output")
  })

  it("throws RequiredMcpServerError if server missing", async () => {
    const agentDef = createTestAgent({
      requiredMcpServers: ["missing-server"],
    })

    await expect(runAgent({ agentDefinition: agentDef, sessionId: "sess_1" as SessionID })).rejects.toThrow(
      RequiredMcpServerError,
    )
  })

  it("enforces concurrent limit", async () => {
    const agentDef = createTestAgent()
    spyOn(Session, "getAgentCount").mockReturnValue(DEFAULT_CONCURRENT_AGENT_LIMIT + 1)

    await expect(runAgent({ agentDefinition: agentDef, sessionId: "sess_1" as SessionID })).rejects.toThrow(
      ConcurrentAgentLimitError,
    )
  })

  it("enforces timeout", async () => {
    // Simulate a prompt that never resolves
    promptImpl = () => new Promise(() => {})

    const agentDef = createTestAgent({ timeout: 10 })
    spyOn(Session, "incrementAgentCount").mockReturnValue(1)

    const result = await runAgent({
      agentDefinition: agentDef,
      sessionId: "sess_1" as SessionID,
    })
    expect(result.status).toBe("killed")
    expect(result.error).toBeInstanceOf(AgentTimeoutError)
  })
})

describe("runAgentByName", () => {
  beforeEach(() => {
    promptImpl = undefined
    spyOn(Bus, "publish").mockResolvedValue([])
    spyOn(Provider, "defaultModel").mockResolvedValue({
      providerID: "test-provider",
      modelID: "test-model",
    } as unknown as Awaited<ReturnType<typeof Provider.defaultModel>>)
    spyOn(Session, "get").mockResolvedValue({ directory: "/fake/dir" } as unknown as Awaited<
      ReturnType<typeof Session.get>
    >)
    spyOn(Session, "createNext").mockResolvedValue({ id: "fake_child_1" } as unknown as Awaited<
      ReturnType<typeof Session.createNext>
    >)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it("throws AgentSpawnError when agent is not found", async () => {
    spyOn(Agent, "get").mockResolvedValue(undefined as unknown as Agent.AgentDefinition)

    await expect(runAgentByName("nonexistent-agent", "sess_1" as SessionID)).rejects.toThrow(AgentSpawnError)
  })

  it("delegates to runAgent when agent is found", async () => {
    spyOn(Agent, "get").mockResolvedValue(
      createTestAgent({
        requiredMcpServers: ["test-server"],
        model: undefined,
      }),
    )

    const result = await runAgentByName("test-agent", "sess_1" as SessionID)
    expect(result.status).toBe("completed")
    expect(result.result).toBe("Mock output")
  })
})
