import { afterEach, beforeEach, describe, expect, it, jest, spyOn } from "bun:test"
import { AgentMemory } from "../../src/agent/memory"
import { MCP } from "../../src/mcp/index"
import { Instance } from "../../src/project/instance"
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

import type { Agent } from "../../src/agent/agent"
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
  let originalDir: PropertyDescriptor | undefined
  let originalWorktree: PropertyDescriptor | undefined

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

    originalDir = Object.getOwnPropertyDescriptor(Instance, "directory")
    originalWorktree = Object.getOwnPropertyDescriptor(Instance, "worktree")
    Object.defineProperty(Instance, "directory", { get: () => "/fake/dir", configurable: true })
    Object.defineProperty(Instance, "worktree", { get: () => "/fake/dir", configurable: true })
  })

  afterEach(() => {
    jest.restoreAllMocks()
    if (originalDir) Object.defineProperty(Instance, "directory", originalDir)
    if (originalWorktree) Object.defineProperty(Instance, "worktree", originalWorktree)
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
    for (let i = 0; i <= DEFAULT_CONCURRENT_AGENT_LIMIT; i++) {
      Session.incrementAgentCount("sess_1" as SessionID)
    }

    try {
      await expect(runAgent({ agentDefinition: agentDef, sessionId: "sess_1" as SessionID })).rejects.toThrow(
        ConcurrentAgentLimitError,
      )
    } finally {
      // cleanup
      for (let i = 0; i <= DEFAULT_CONCURRENT_AGENT_LIMIT; i++) {
        Session.decrementAgentCount("sess_1" as SessionID)
      }
    }
  })

  it("enforces timeout", async () => {
    // Simulate a prompt that never resolves
    promptImpl = () => new Promise(() => {})

    const agentDef = createTestAgent({ timeout: 10 })

    const result = await runAgent({
      agentDefinition: agentDef,
      sessionId: "sess_1" as SessionID,
    })
    expect(result.status).toBe("killed")
    expect(result.error).toBeInstanceOf(AgentTimeoutError)
  })
})

describe("runAgentByName", () => {
  let originalDir: PropertyDescriptor | undefined
  let originalWorktree: PropertyDescriptor | undefined

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

    originalDir = Object.getOwnPropertyDescriptor(Instance, "directory")
    originalWorktree = Object.getOwnPropertyDescriptor(Instance, "worktree")
    Object.defineProperty(Instance, "directory", { get: () => "/fake/dir", configurable: true })
    Object.defineProperty(Instance, "worktree", { get: () => "/fake/dir", configurable: true })
  })

  afterEach(() => {
    jest.restoreAllMocks()
    if (originalDir) Object.defineProperty(Instance, "directory", originalDir)
    if (originalWorktree) Object.defineProperty(Instance, "worktree", originalWorktree)
  })

  it("throws AgentSpawnError when agent is not found", async () => {
    // "nonexistent-agent" naturally returns undefined from Agent.get
    await expect(runAgentByName("nonexistent-agent", "sess_1" as SessionID)).rejects.toThrow(AgentSpawnError)
  })

  it("delegates to runAgent when agent is found", async () => {
    // We use the builtin 'plan-explore' agent and mock MCP status appropriately since we don't need test-server
    // 'plan-explore' naturally exists.
    const result = await runAgentByName("plan-explore", "sess_1" as SessionID)
    expect(result.status).toBe("completed")
    expect(result.result).toBe("Mock output")
  })
})
