/**
 * Tests for verification-agent.ts and built-in-agents.ts
 *
 * Validates agent profile definitions, registry, and tool restrictions.
 */
import { describe, expect, it } from "bun:test"
import {
  findBuiltInAgent,
  getBuiltInAgents,
  isBuiltInAgentType,
  VERIFICATION_AGENT,
} from "../../src/coordinator/built-in-agents"
import {
  VERIFICATION_AGENT_TYPE,
  VERIFICATION_CRITICAL_REMINDER,
  VERIFICATION_DISALLOWED_TOOLS,
  VERIFICATION_SYSTEM_PROMPT,
  VERIFICATION_WHEN_TO_USE,
} from "../../src/coordinator/verification-agent"

// ─── Verification Agent Constants ────────────────────────────────────────────

describe("verification agent constants", () => {
  it("has a correct agent type", () => {
    expect(VERIFICATION_AGENT_TYPE).toBe("verification")
  })

  it("disallows write/mutate tools", () => {
    expect(VERIFICATION_DISALLOWED_TOOLS).toContain("write_to_file")
    expect(VERIFICATION_DISALLOWED_TOOLS).toContain("replace_file_content")
    expect(VERIFICATION_DISALLOWED_TOOLS).toContain("multi_replace_file_content")
    expect(VERIFICATION_DISALLOWED_TOOLS).toContain("apply_patch")
    expect(VERIFICATION_DISALLOWED_TOOLS).toContain("delete_file")
  })

  it("does not disallow read/command tools", () => {
    const disallowed = new Set(VERIFICATION_DISALLOWED_TOOLS)
    expect(disallowed.has("view_file")).toBe(false)
    expect(disallowed.has("run_command")).toBe(false)
    expect(disallowed.has("grep_search")).toBe(false)
  })

  it("system prompt mentions VERDICT format", () => {
    expect(VERIFICATION_SYSTEM_PROMPT).toContain("VERDICT: PASS")
    expect(VERIFICATION_SYSTEM_PROMPT).toContain("VERDICT: FAIL")
    expect(VERIFICATION_SYSTEM_PROMPT).toContain("VERDICT: PARTIAL")
  })

  it("system prompt enforces read-only constraint", () => {
    expect(VERIFICATION_SYSTEM_PROMPT).toContain("CANNOT edit, write, create, or delete files")
  })

  it("critical reminder reinforces verification-only role", () => {
    expect(VERIFICATION_CRITICAL_REMINDER).toContain("Verification Agent")
    expect(VERIFICATION_CRITICAL_REMINDER).toContain("CANNOT edit")
  })

  it("whenToUse is descriptive", () => {
    expect(VERIFICATION_WHEN_TO_USE.length).toBeGreaterThan(50)
  })
})

// ─── Built-in Agent Profile ──────────────────────────────────────────────────

describe("VERIFICATION_AGENT profile", () => {
  it("has correct shape", () => {
    expect(VERIFICATION_AGENT.agentType).toBe("verification")
    expect(VERIFICATION_AGENT.color).toBe("red")
    expect(VERIFICATION_AGENT.background).toBe(true)
    expect(VERIFICATION_AGENT.model).toBe("inherit")
  })

  it("disallowedTools matches the constant", () => {
    expect(VERIFICATION_AGENT.disallowedTools).toEqual(VERIFICATION_DISALLOWED_TOOLS)
  })

  it("has a systemPrompt and criticalReminder", () => {
    expect(VERIFICATION_AGENT.systemPrompt.length).toBeGreaterThan(100)
    expect(VERIFICATION_AGENT.criticalReminder).toBeDefined()
    expect(VERIFICATION_AGENT.criticalReminder?.length).toBeGreaterThan(10)
  })
})

// ─── Registry ────────────────────────────────────────────────────────────────

describe("getBuiltInAgents", () => {
  it("returns an array containing the verification agent", () => {
    const agents = getBuiltInAgents()
    expect(agents.length).toBeGreaterThanOrEqual(1)
    expect(agents.some((a) => a.agentType === "verification")).toBe(true)
  })
})

describe("findBuiltInAgent", () => {
  it("returns the verification agent for its type", () => {
    const agent = findBuiltInAgent("verification")
    expect(agent).toBeDefined()
    expect(agent?.agentType).toBe("verification")
    expect(agent?.color).toBe("red")
  })

  it("returns undefined for unknown types", () => {
    expect(findBuiltInAgent("nonexistent")).toBeUndefined()
    expect(findBuiltInAgent("")).toBeUndefined()
  })
})

describe("isBuiltInAgentType", () => {
  it("returns true for verification", () => {
    expect(isBuiltInAgentType("verification")).toBe(true)
  })

  it("returns false for unknown types", () => {
    expect(isBuiltInAgentType("unknown")).toBe(false)
    expect(isBuiltInAgentType("")).toBe(false)
    expect(isBuiltInAgentType("teammate")).toBe(false)
  })
})
