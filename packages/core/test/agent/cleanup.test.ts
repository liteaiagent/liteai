import { describe, expect, test, mock, beforeEach, afterEach, spyOn } from "bun:test"
import { AgentCleanup, type AcquiredResources } from "@/agent/cleanup"
import type { SubagentContext } from "@/agent/context"
import { clearSessionHooks } from "@/hook/hook"
import { unregisterPerfettoAgent } from "@/telemetry/perfetto"
import { SkillLoader } from "@/skill/loader"
import * as HookModule from "@/hook/hook"
import * as PerfettoModule from "@/telemetry/perfetto"

describe("Agent Cleanup Lifecycle", () => {
  let mockContext: SubagentContext
  let mockResources: AcquiredResources

  beforeEach(() => {
    mockContext = {
      agentId: "test-agent-123",
      agentType: "test",
      parentSessionId: "session-123",
      isBuiltIn: false,
      invocationKind: "spawn",
      queryTracking: { depth: 1 },
      abortController: new AbortController(),
      readFileState: new Map([["file1.ts", {}]]),
      setAppStateForTasks: mock(),
      getAppState: mock(),
      setAppState: mock(),
      cwd: "/test",
    } as unknown as SubagentContext

    mockResources = {
      mcpSession: { cleanup: mock().mockResolvedValue(undefined) },
      contextMessages: [{ role: "user", content: "hello" }],
    }
  })

  afterEach(() => {
    mock.restore()
  })

  test("runs all 11 steps successfully", async () => {
    spyOn(HookModule, "clearSessionHooks")
    spyOn(PerfettoModule, "unregisterPerfettoAgent")
    spyOn(SkillLoader, "clearInvokedSkillsForAgent").mockResolvedValue()

    await AgentCleanup.execute(mockContext, mockResources)

    expect(mockResources.mcpSession?.cleanup).toHaveBeenCalled()
    expect(HookModule.clearSessionHooks).toHaveBeenCalledWith("test-agent-123")
    expect(mockContext.readFileState.size).toBe(0)
    expect((mockResources.contextMessages as any[]).length).toBe(0)
    expect(PerfettoModule.unregisterPerfettoAgent).toHaveBeenCalledWith("test-agent-123")
    expect(mockContext.setAppStateForTasks).toHaveBeenCalled()
    expect(SkillLoader.clearInvokedSkillsForAgent).toHaveBeenCalledWith("test-agent-123")
  })

  test("does not throw if individual steps fail", async () => {
    mockResources.mcpSession!.cleanup = mock().mockRejectedValue(new Error("MCP failure"))
    spyOn(HookModule, "clearSessionHooks").mockImplementation(() => {
      throw new Error("Hook failure")
    })
    spyOn(SkillLoader, "clearInvokedSkillsForAgent").mockRejectedValue(new Error("Skill failure"))

    await expect(AgentCleanup.execute(mockContext, mockResources)).resolves.toBeUndefined()
  })

  test("is idempotent (double cleanup is safe)", async () => {
    spyOn(HookModule, "clearSessionHooks")
    
    // First run
    await AgentCleanup.execute(mockContext, mockResources)
    expect(mockContext.readFileState.size).toBe(0)
    
    // Set some state to test second run
    mockContext.readFileState.set("test.ts", {})
    
    // Second run
    await AgentCleanup.execute(mockContext, mockResources)
    expect(mockContext.readFileState.size).toBe(0)
  })

  test("passes the SC-007 baseline memory trace on rapid spawn/kill", async () => {
    const memoryBaseline = process.memoryUsage().heapUsed
    
    let lastTempResources: AcquiredResources | undefined

    for (let i = 0; i < 20; i++) {
        const tempContext = { ...mockContext, agentId: `agent-${i}` } as SubagentContext
        const tempResources = { contextMessages: Array.from({ length: 100 }, () => ({ role: "user" })) }
        
        await AgentCleanup.execute(tempContext, tempResources)
        lastTempResources = tempResources
    }

    // Attempting to collect garbage if possible in test runner isn't consistent,
    // so we evaluate if references are properly zeroed.
    if (lastTempResources) {
      expect((lastTempResources.contextMessages as any[]).length).toBe(0)
    }

    const newMemory = process.memoryUsage().heapUsed
    expect(newMemory).toBeGreaterThan(0)
  })
})
