import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test"
import { Agent } from "../../src/agent/agent"
import { AgentLoader } from "../../src/agent/loader"
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
      // Create a unique temporary directory for this test so state is fresh!
      const fs = await import("node:fs/promises")
      const path = await import("node:path")
      const os = await import("node:os")
      const tmpProject = path.join(os.tmpdir(), `liteai_test_merge_${Date.now()}`)
      await fs.mkdir(tmpProject, { recursive: true })

      const InstanceModule = (await import("../../src/project/instance")).Instance
      const originalDir = Object.getOwnPropertyDescriptor(InstanceModule, "directory")
      const originalWorktree = Object.getOwnPropertyDescriptor(InstanceModule, "worktree")
      Object.defineProperty(InstanceModule, "directory", { get: () => tmpProject, configurable: true })
      Object.defineProperty(InstanceModule, "worktree", { get: () => tmpProject, configurable: true })

      try {
        // Write .liteai/settings.json
        const liteaiDir = path.join(tmpProject, ".liteai")
        await fs.mkdir(liteaiDir, { recursive: true })
        await fs.writeFile(
          path.join(liteaiDir, "settings.json"),
          JSON.stringify({
            $schema: "https://liteai.com/config.json",
            agent: {
              build: { description: "from_cfg", temperature: 0.9 },
            },
          }),
        )

        // Write .liteai/agents/build.md
        const agentsDir = path.join(liteaiDir, "agents")
        await fs.mkdir(agentsDir, { recursive: true })
        await fs.writeFile(
          path.join(agentsDir, "build.md"),
          `---
description: from_project_agent_md
temperature: 0.8
---
Prompt`,
        )

        // Mock platform agents safely
        const spyPlatform = spyOn(AgentLoader, "loadPlatformAgents").mockResolvedValue({
          build: { source: "plugin", description: "from_plugin", temperature: 0.5 } as unknown as Awaited<
            ReturnType<typeof AgentLoader.loadPlatformAgents>
          >[string],
        })

        const result = await Agent.list()
        const buildAgent = result.find((a) => a.name === "build")
        expect(buildAgent?.name).toBe("build")

        // Actual merge order is builtIn -> platform plugin -> config -> project markdown
        // So project markdown should win over cfg
        expect(buildAgent?.description).toBe("from_project_agent_md")
        expect(buildAgent?.temperature).toBe(0.8)

        spyPlatform.mockRestore()
      } finally {
        if (originalDir) Object.defineProperty(InstanceModule, "directory", originalDir)
        if (originalWorktree) Object.defineProperty(InstanceModule, "worktree", originalWorktree)
        await fs.rm(tmpProject, { recursive: true, force: true })
      }
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
      const originalWorktree = Object.getOwnPropertyDescriptor(InstanceModule, "worktree")
      Object.defineProperty(InstanceModule, "directory", { get: () => tmpProject, configurable: true })
      Object.defineProperty(InstanceModule, "worktree", { get: () => tmpProject, configurable: true })

      try {
        // Write .liteai/settings.json mapped to custom disabled behavior
        const liteaiDir = path.join(tmpProject, ".liteai")
        await fs.mkdir(liteaiDir, { recursive: true })
        await fs.writeFile(
          path.join(liteaiDir, "settings.json"),
          JSON.stringify({
            $schema: "https://liteai.com/config.json",
            agent: { custom1: { disable: true } },
          }),
        )

        const agentsDir = path.join(liteaiDir, "agents")
        await fs.mkdir(agentsDir, { recursive: true })
        await fs.writeFile(
          path.join(agentsDir, "custom1.md"),
          `---
description: testing
---
Prompt`,
        )

        let thrown = false
        try {
          await Agent.get("custom1")
        } catch (e: unknown) {
          expect((e as Error).name).toBe("AgentDisabledError")
          thrown = true
        }
        expect(thrown).toBe(true)
      } finally {
        if (originalDir) Object.defineProperty(InstanceModule, "directory", originalDir)
        if (originalWorktree) Object.defineProperty(InstanceModule, "worktree", originalWorktree)
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

      // Create a unique temporary directory for this test so state is fresh
      const fs = await import("node:fs/promises")
      const path = await import("node:path")
      const os = await import("node:os")
      const tmpProject = path.join(os.tmpdir(), `liteai_test_missing_mcp_${Date.now()}`)
      await fs.mkdir(tmpProject, { recursive: true })

      try {
        const agentFile = path.join(tmpProject, "db_agent.md")
        await fs.writeFile(
          agentFile,
          `---
requiredMcpServers: ["missing_db"]
---
prompt content`,
        )

        const result = await AgentLoader.parseAgentFromMarkdown(agentFile, "custom")
        expect(result).toBeUndefined()
      } finally {
        await fs.rm(tmpProject, { recursive: true, force: true })
      }
    })
  })
})
