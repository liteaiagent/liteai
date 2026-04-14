import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import type { Agent } from "../../src/agent/agent"
import { runAgent } from "../../src/agent/runner"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider/provider"
import { SessionPrompt } from "../../src/session/engine"
import { Session } from "../../src/session/index"

const orgDirectory = Object.getOwnPropertyDescriptor(Instance, "directory")
const orgWorktree = Object.getOwnPropertyDescriptor(Instance, "worktree")

describe("Agent Spawn Benchmark", () => {
  let originalEnv: typeof process.env

  beforeEach(() => {
    originalEnv = process.env
    process.env = { ...originalEnv }

    Object.defineProperty(Instance, "directory", { get: () => "/fake/dir", configurable: true })
    Object.defineProperty(Instance, "worktree", { get: () => "/fake/dir", configurable: true })

    const { MCP } = require("../../src/mcp/index")
    spyOn(MCP, "status").mockResolvedValue({})

    const { Bus } = require("../../src/bus/index")
    spyOn(Bus, "publish").mockResolvedValue([])

    // Mock SessionPrompt.prompt to return immediately to skip the inner query loop
    spyOn(SessionPrompt, "prompt").mockResolvedValue({
      info: {
        id: "test-msg-id",
        role: "assistant",
        finish: "stop",
        cost: 0,
        model: "test",
        tokens: { input: 10, output: 10 },
      },
      parts: [{ type: "text", text: "Benchmarked task result" }],
    } as unknown as Awaited<ReturnType<typeof SessionPrompt.prompt>>)
    spyOn(Session, "get").mockResolvedValue({ directory: "/tmp/benchmark" } as unknown as Awaited<
      ReturnType<typeof Session.get>
    >)
    spyOn(Session, "createNext").mockResolvedValue({ id: "sub-123" } as unknown as Awaited<
      ReturnType<typeof Session.createNext>
    >)
    spyOn(Provider, "defaultModel").mockResolvedValue({ providerID: "test", modelID: "test" } as unknown as Awaited<
      ReturnType<typeof Provider.defaultModel>
    >)
  })

  afterEach(() => {
    process.env = originalEnv
    if (orgDirectory) Object.defineProperty(Instance, "directory", orgDirectory)
    if (orgWorktree) Object.defineProperty(Instance, "worktree", orgWorktree)
    mock.restore()
  })

  test("SC-001: latency p95 < 100ms for createSubagentContext + runAgent startup", async () => {
    const iterations = 50
    const latenciesMs: number[] = []

    const agentDef: Agent.AgentDefinition = {
      name: "benchmark",
      prompt: "benchmark prompt",
    } as Agent.AgentDefinition

    for (let i = 0; i < iterations; i++) {
      const start = performance.now()
      await runAgent({
        agentDefinition: agentDef,
        sessionId: "bench-session",
      })
      const end = performance.now()
      latenciesMs.push(end - start)
    }

    latenciesMs.sort((a, b) => a - b)
    const p95Index = Math.floor(latenciesMs.length * 0.95)
    const p95 = latenciesMs[p95Index]

    // Console log to see the p95 result easily
    console.log(`[benchmark] p95 latency: ${p95.toFixed(2)}ms`)

    // Assert p95 < 100ms
    expect(p95).toBeLessThan(100)
  })
})
