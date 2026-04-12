import { describe, expect, it } from "bun:test"
import { Agent } from "../../src/agent/agent"
import { Agent as SchemaAgent } from "../../src/config/schema"

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
})
