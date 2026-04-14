import { describe, expect, test } from "bun:test"
import type { Agent } from "../../src/agent/agent"
import { filterToolsForAgent, pruneContext, resolveAgentTools } from "../../src/agent/filter"

describe("filterToolsForAgent", () => {
  test("removes ALL_AGENT_DISALLOWED_TOOLS for all agents", () => {
    const tools = ["read", "plan_enter", "plan_exit", "task_output", "write"]
    const filtered = filterToolsForAgent(tools, false, false)
    expect(filtered).toEqual(["read", "write"])
  })

  test("removes CUSTOM_AGENT_DISALLOWED_TOOLS for custom agents", () => {
    const tools = ["read", "task", "plan_enter", "write"]
    const filtered = filterToolsForAgent(tools, true, false)
    expect(filtered).not.toContain("task")
    expect(filtered).not.toContain("plan_enter")
    expect(filtered).toEqual(["read", "write"])
  })

  test("allows custom agents to use ASYNC_AGENT_ALLOWED_TOOLS if not async", () => {
    const tools = ["read", "mcp_tool"]
    const filtered = filterToolsForAgent(tools, false, false)
    expect(filtered).toEqual(["read", "mcp_tool"])
  })

  test("filters core tools for async agents", () => {
    const tools = ["read", "question", "task", "mcp_tool"]
    const filtered = filterToolsForAgent(tools, false, true)

    expect(filtered).toContain("read") // async allowed
    expect(filtered).not.toContain("question") // not async allowed
    expect(filtered).not.toContain("task") // not async allowed
    expect(filtered).toContain("mcp_tool") // MCP tool allowed
  })
})

describe("resolveAgentTools", () => {
  const available = ["read", "write", "edit", "task", "run_command"]

  test("returns all available tools if no spec provided", () => {
    const { resolvedTools } = resolveAgentTools(
      { tools: [] } as Pick<Agent.AgentDefinition, "tools" | "disallowedTools">,
      available,
    )
    expect(resolvedTools.sort()).toEqual(available.sort())
  })

  test("returns all tools for wildcard spec", () => {
    const { resolvedTools } = resolveAgentTools(
      { tools: ["*"] } as Pick<Agent.AgentDefinition, "tools" | "disallowedTools">,
      available,
    )
    expect(resolvedTools.sort()).toEqual(available.sort())
  })

  test("extracts allowedAgentTypes from task(type) pattern", () => {
    const { resolvedTools, allowedAgentTypes } = resolveAgentTools(
      { tools: ["read", "task(explore, plan)", "task"] } as Pick<Agent.AgentDefinition, "tools" | "disallowedTools">,
      available,
    )
    expect(resolvedTools.sort()).toEqual(["read", "task"].sort())
    expect(allowedAgentTypes).toEqual(["explore", "plan"])
  })

  test("disallows tools based on disallowedTools", () => {
    const { resolvedTools } = resolveAgentTools(
      { tools: ["*"], disallowedTools: ["write", "run_command"] } as Pick<
        Agent.AgentDefinition,
        "tools" | "disallowedTools"
      >,
      available,
    )
    expect(resolvedTools.sort()).toEqual(["edit", "read", "task"].sort())
  })

  test("disallows tools with wildcard", () => {
    const { resolvedTools } = resolveAgentTools(
      { tools: ["*"], disallowedTools: ["wri*"] } as Pick<Agent.AgentDefinition, "tools" | "disallowedTools">,
      available,
    )
    expect(resolvedTools.sort()).toEqual(["edit", "read", "run_command", "task"].sort())
  })
})

describe("pruneContext", () => {
  test("strips liteaiMd when omitLiteaiMd is true and no user override", () => {
    const agentDef = { omitLiteaiMd: true, name: "custom" } as Agent.AgentDefinition
    const userCtx = { liteaiMd: "some content", other: 123 }
    const sysCtx = { gitStatus: "status", other: 456 }

    const result = pruneContext(agentDef, userCtx, sysCtx)

    expect(result.prunedUserContext).toEqual({ other: 123 })
    expect(result.prunedSystemContext).toEqual(sysCtx)
  })

  test("preserves liteaiMd when omitLiteaiMd is false", () => {
    const agentDef = { omitLiteaiMd: false, name: "custom" } as Agent.AgentDefinition
    const userCtx = { liteaiMd: "some content", other: 123 }
    const sysCtx = {}

    const result = pruneContext(agentDef, userCtx, sysCtx)
    expect(result.prunedUserContext?.liteaiMd).toBeDefined()
  })

  test("preserves liteaiMd when user override is true", () => {
    const agentDef = { omitLiteaiMd: true, name: "custom" } as Agent.AgentDefinition
    const userCtx = { liteaiMd: "some content", other: 123 }

    const result = pruneContext(agentDef, userCtx, undefined, { hasUserOverride: true })
    expect(result.prunedUserContext?.liteaiMd).toBeDefined()
  })

  test("strips gitStatus for explore and plan agents", () => {
    const userCtx = {}
    const sysCtx = { gitStatus: "status", other: 456 }

    const exploreAgent = { name: "explore" } as Agent.AgentDefinition
    const result1 = pruneContext(exploreAgent, userCtx, sysCtx)
    expect(result1.prunedSystemContext?.gitStatus).toBeUndefined()
    expect(result1.prunedSystemContext?.other).toBe(456)

    const planAgent = { name: "plan" } as Agent.AgentDefinition
    const result2 = pruneContext(planAgent, userCtx, sysCtx)
    expect(result2.prunedSystemContext?.gitStatus).toBeUndefined()

    const otherAgent = { name: "other" } as Agent.AgentDefinition
    const result3 = pruneContext(otherAgent, userCtx, sysCtx)
    expect(result3.prunedSystemContext?.gitStatus).toBeDefined()
  })

  test("does not strip anything if liteaiSlimSubagentLiteaimdFlag is false", () => {
    const agentDef = { omitLiteaiMd: true, name: "explore" } as Agent.AgentDefinition
    const userCtx = { liteaiMd: "some content" }
    const sysCtx = { gitStatus: "status" }

    const result = pruneContext(agentDef, userCtx, sysCtx, { liteaiSlimSubagentLiteaimdFlag: false })
    expect(result.prunedUserContext?.liteaiMd).toBeDefined()
    expect(result.prunedSystemContext?.gitStatus).toBeDefined()
  })

  test("token reduction verification: Explore agent with pruning enabled vs disabled (>= 30% reduction)", () => {
    // SC-002 Verification
    const agentDef = { omitLiteaiMd: true, name: "explore" } as Agent.AgentDefinition

    // Simulate a heavy user context and system context
    const heavyLiteaiMd = "a".repeat(5000)
    const heavyGitStatus = "b".repeat(5000)

    const userCtx = { liteaiMd: heavyLiteaiMd, query: "help me explore", other: "small" }
    const sysCtx = { gitStatus: heavyGitStatus, os: "windows", memory: "16gb" }

    // Baseline (pruning disabled)
    const disabledResult = pruneContext(agentDef, userCtx, sysCtx, { liteaiSlimSubagentLiteaimdFlag: false })
    const baselineTokens = JSON.stringify(disabledResult).length

    // Pruned (pruning enabled)
    const enabledResult = pruneContext(agentDef, userCtx, sysCtx, {
      liteaiSlimSubagentLiteaimdFlag: true,
      hasUserOverride: false,
    })
    const prunedTokens = JSON.stringify(enabledResult).length

    // Assert >= 30% reduction
    const reductionPercent = ((baselineTokens - prunedTokens) / baselineTokens) * 100
    expect(reductionPercent).toBeGreaterThanOrEqual(30)
  })
})
