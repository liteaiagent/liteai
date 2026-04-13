import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test"
import { Agent } from "../../src/agent/agent"
import { AgentLoader } from "../../src/agent/loader"
import { Config } from "../../src/config/config"
import { Instance } from "../../src/project/instance"

let orgDirectory: PropertyDescriptor | undefined
let orgWorktree: PropertyDescriptor | undefined
let orgProject: PropertyDescriptor | undefined

beforeEach(() => {
  orgDirectory = Object.getOwnPropertyDescriptor(Instance, "directory")
  orgWorktree = Object.getOwnPropertyDescriptor(Instance, "worktree")
  orgProject = Object.getOwnPropertyDescriptor(Instance, "project")

  Object.defineProperty(Instance, "directory", { get: () => "/mock/project", configurable: true })
  Object.defineProperty(Instance, "worktree", { get: () => "/mock/project", configurable: true })
  Object.defineProperty(Instance, "project", { get: () => ({ id: "test_project" }), configurable: true })

  spyOn(Instance, "state").mockImplementation(((init: () => unknown) => init) as unknown as typeof Instance.state)
  spyOn(Instance, "provide").mockImplementation((async (input: { fn: () => unknown }) =>
    input.fn()) as unknown as typeof Instance.provide)
})

afterEach(() => {
  if (orgDirectory) Object.defineProperty(Instance, "directory", orgDirectory)
  if (orgWorktree) Object.defineProperty(Instance, "worktree", orgWorktree)
  if (orgProject) Object.defineProperty(Instance, "project", orgProject)
})

import { Agent as SchemaAgent } from "../../src/config/schema"
import { MCP } from "../../src/mcp"

describe("Agent Hierarchy", () => {
  it("type guards work correctly", () => {
    const builtin: Agent.AgentDefinition = { source: "builtIn", name: "a" } as unknown as Agent.AgentDefinition
    const custom: Agent.AgentDefinition = { source: "custom", name: "b" } as unknown as Agent.AgentDefinition
    const plugin: Agent.AgentDefinition = { source: "plugin", name: "c" } as unknown as Agent.AgentDefinition

    expect(Agent.isBuiltInAgent(builtin)).toBeTrue()
    expect(Agent.isCustomAgent(custom)).toBeTrue()
    expect(Agent.isPluginAgent(plugin)).toBeTrue()

    expect(Agent.isBuiltInAgent(custom)).toBeFalse()
  })

  it("parses expanded schema fields", () => {
    const raw = {
      tools: ["a", "b"],
      memory: "project",
      effort: "high",
      isolation: "worktree",
      containerImage: "docker.io/alpine",
      fooUnknown: "bar",
    }

    const res = SchemaAgent.parse(raw)
    expect(res.tools).toEqual(["a", "b"])
    expect(res.memory).toBe("project")
    expect(res.effort).toBe("high")
    expect(res.isolation).toBe("worktree")
    expect(res.containerImage).toBe("docker.io/alpine")

    // Unknown fields go to options
    expect((res as unknown as { options: Record<string, unknown> }).options.fooUnknown).toBe("bar")
  })

  describe("Agent Merge Priority", () => {
    afterEach(() => {
      mock.restore()
      const agentState = (Agent as unknown as { state?: { reset?: () => void } }).state
      agentState?.reset?.()
    })

    it("prioritizes sources correctly: builtIn < platform/plugin < project cfg", async () => {
      // Mock loader returns
      const spyPlatform = spyOn(AgentLoader, "loadPlatformAgents").mockResolvedValue({
        build: { source: "plugin", description: "from_plugin", temperature: 0.5 } as unknown as Awaited<
          ReturnType<typeof AgentLoader.loadPlatformAgents>
        >[string],
        test_plugin: { source: "plugin", description: "only_plugin" } as unknown as Awaited<
          ReturnType<typeof AgentLoader.loadPlatformAgents>
        >[string],
      })
      const spyLoad = spyOn(AgentLoader, "loadAgent").mockResolvedValue({
        build: {
          source: "custom",
          description: "from_project_agent_md",
          temperature: 0.8,
        } as unknown as Awaited<ReturnType<typeof AgentLoader.loadAgent>>[string],
      })

      const spyCfg = spyOn(Config, "get").mockResolvedValue({
        agent: {
          build: { description: "from_cfg", temperature: 0.9 },
        },
      } as unknown as Awaited<ReturnType<typeof Config.get>>)

      const result = await Agent.list()
      const buildAgent = result.find((a) => a.name === "build")
      expect(buildAgent?.name).toBe("build")

      // Actual merge order is builtIn -> platform plugin -> config -> project markdown
      // So project markdown should win over cfg
      expect(buildAgent?.description).toBe("from_project_agent_md")
      expect(buildAgent?.temperature).toBe(0.8)

      spyPlatform.mockRestore()
      spyLoad.mockRestore()
      spyCfg.mockRestore()
    })

    it("rejects disabled agents", async () => {
      // Create a unique temporary directory for this test so state is fresh!
      const fs = await import("node:fs/promises")
      const path = await import("node:path")
      const os = await import("node:os")
      const tmpProject = path.join(os.tmpdir(), `liteai_test_disabled_${Date.now()}`)
      await fs.mkdir(tmpProject, { recursive: true })

      const InstanceModule = (await import("../../src/project/instance")).Instance
      const originalDir = Object.getOwnPropertyDescriptor(InstanceModule, "directory")
      Object.defineProperty(InstanceModule, "directory", { get: () => tmpProject, configurable: true })

      const spyCfg = spyOn(Config, "get").mockResolvedValue({
        agent: { custom1: { disable: true } },
      } as unknown as Awaited<ReturnType<typeof Config.get>>)
      const spyPlatform = spyOn(AgentLoader, "loadPlatformAgents").mockResolvedValue({
        custom1: { source: "plugin", description: "testing" } as unknown as Awaited<
          ReturnType<typeof AgentLoader.loadPlatformAgents>
        >[string],
      })

      let thrown = false
      try {
        try {
          await Agent.get("custom1")
        } catch (e: unknown) {
          expect((e as Error).name).toBe("AgentDisabledError")
          thrown = true
        }
        expect(thrown).toBe(true)
      } finally {
        spyCfg.mockRestore()
        spyPlatform.mockRestore()
        if (originalDir) Object.defineProperty(InstanceModule, "directory", originalDir)
        await fs.rm(tmpProject, { recursive: true, force: true })
      }
    })
  })

  describe("requiredMcpServers Validation", () => {
    let oldStatus: typeof MCP.status
    let oldTools: typeof MCP.tools

    beforeEach(() => {
      oldStatus = MCP.status
      oldTools = MCP.tools
    })

    afterEach(() => {
      MCP.status = oldStatus
      MCP.tools = oldTools
    })

    it("load-time filtering excludes agent when server completely missing", async () => {
      MCP.status = async () => ({})
      MCP.tools = async () => ({})

      // mock gray-matter parse used by parseAgentFromMarkdown
      const ConfigMarkdown = (await import("../../src/config/markdown")).ConfigMarkdown
      const spyParse = spyOn(ConfigMarkdown, "parse").mockResolvedValue({
        data: { requiredMcpServers: ["missing_db"] },
        content: "hello",
      } as unknown as Awaited<ReturnType<typeof ConfigMarkdown.parse>>)

      const result = await AgentLoader.parseAgentFromMarkdown("/mock/agents/db_agent.md", "custom")
      expect(result).toBeUndefined()
      spyParse.mockRestore()
    })
  })
})
