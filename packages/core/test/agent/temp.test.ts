import { describe, expect, it } from "bun:test"
import { Agent } from "../../src/agent/agent"

describe("Agent Hierarchy", () => {
  it("built-in agents preserve configuration properties like tools", async () => {
    const agentState = (Agent as unknown as { state?: { reset?: () => void } }).state
    agentState?.reset?.()

    const explore = await Agent.get("explore")
    expect(explore.name).toBe("explore")
    expect(explore.tools).toBeDefined()
    expect(Array.isArray(explore.tools)).toBeTrue()
    expect((explore.tools as string[]).length).toBeGreaterThan(0)
  })
})
