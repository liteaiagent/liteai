import { describe, expect, it } from "bun:test"
import type { Agent } from "../../src/agent/agent"
import type { ParentContext } from "../../src/agent/context"
import {
  AgentExecutionContext,
  consumeInvokingRequestId,
  createSubagentContext,
  isRootAgent,
  runWithAgentContext,
} from "../../src/agent/context"

/**
 * Helper to create a minimal ParentContext for tests.
 */
function createParent(overrides: Partial<ParentContext> = {}): ParentContext {
  return {
    sessionId: "sess-1",
    abortController: new AbortController(),
    readFileState: new Map(),
    getAppState: () => ({}),
    setAppState: () => {},
    ...overrides,
  }
}

/**
 * Helper to create a minimal Agent.Info for tests.
 */
function createAgent(overrides: Partial<Agent.Info> = {}): Agent.Info {
  return {
    name: "test-agent",
    mode: "all",
    permission: [],
    options: {},
    ...overrides,
  }
}

describe("Agent Context", () => {
  it("runWithAgentContext isolates concurrent contexts", async () => {
    const parent = createParent()

    const agent1 = createAgent({ name: "agent1", background: false })
    const agent2 = createAgent({ name: "agent2", background: true })

    const ctx1 = createSubagentContext(parent, agent1)
    ctx1.agentId = "agent1-id" // Simulate runner assigning agentId
    const ctx2 = createSubagentContext(parent, agent2)
    ctx2.agentId = "agent2-id"

    await Promise.all([
      new Promise<void>((resolve) => {
        runWithAgentContext(ctx1, async () => {
          await Bun.sleep(10)
          expect(AgentExecutionContext.getStore()?.agentId).toBe("agent1-id")
          resolve()
        })
      }),
      new Promise<void>((resolve) => {
        runWithAgentContext(ctx2, async () => {
          await Bun.sleep(5)
          expect(AgentExecutionContext.getStore()?.agentId).toBe("agent2-id")
          resolve()
        })
      }),
    ])
  })

  it("consumeInvokingRequestId returns value only once", () => {
    const parent = createParent()
    const ctx = createSubagentContext(parent, createAgent({ name: "a" }))
    ctx.invokingRequestId = "req-1"

    runWithAgentContext(ctx, () => {
      expect(consumeInvokingRequestId()).toBe("req-1")
      expect(consumeInvokingRequestId()).toBeUndefined()
    })
  })

  it("isRootAgent correctly discriminates", () => {
    const parent = createParent()
    const ctx = createSubagentContext(parent, createAgent({ name: "a" }))
    ctx.agentId = "test-id"

    runWithAgentContext(ctx, () => {
      expect(isRootAgent()).toBe(false)
    })

    expect(isRootAgent()).toBe(true)
  })

  describe("R006 — data-model alignment", () => {
    it("createSubagentContext populates all data-model fields", () => {
      const parent = createParent()
      const ctx = createSubagentContext(
        parent,
        createAgent({
          name: "explore",
          native: true,
        }),
      )

      expect(ctx.type).toBe("subagent")
      expect(ctx.agentId).toBe("") // Placeholder — runner sets it
      expect(ctx.agentType).toBe("explore")
      expect(ctx.parentSessionId).toBe("sess-1")
      expect(ctx.isBuiltIn).toBe(true)
      expect(ctx.queryTracking.depth).toBe(1)
      expect(ctx.invocationKind).toBe("spawn")
      expect(ctx.contentReplacementState).toBeUndefined()
    })

    it("isBuiltIn is false for non-native agents", () => {
      const parent = createParent()
      const ctx = createSubagentContext(parent, createAgent({ name: "custom-agent" }))
      expect(ctx.isBuiltIn).toBe(false)
    })

    it("increments queryTracking.depth for nested forks", () => {
      const parent = createParent()
      const ctx1 = createSubagentContext(parent, createAgent({ name: "a" }))
      expect(ctx1.queryTracking.depth).toBe(1)

      // Fork from ctx1 as parent (simulate nested spawn)
      const nestedParent = createParent({ queryTracking: { depth: ctx1.queryTracking.depth } })
      const ctx2 = createSubagentContext(nestedParent, createAgent({ name: "b" }))
      expect(ctx2.queryTracking.depth).toBe(2)
    })

    it("clones contentReplacementState from parent", () => {
      const parent = createParent({
        contentReplacementState: { key: "value", nested: { a: 1 } },
      })
      const ctx = createSubagentContext(parent, createAgent({ name: "a" }))
      expect(ctx.contentReplacementState).toEqual({ key: "value", nested: { a: 1 } })
      // Verify it's a clone, not the same reference
      expect(ctx.contentReplacementState).not.toBe(parent.contentReplacementState)
    })
  })

  describe("R013 — context isolation", () => {
    it("file state cloning provides isolation from parent", () => {
      const parent = createParent({
        readFileState: new Map([["file.ts", { content: "original" }]]),
      })
      const ctx = createSubagentContext(parent, createAgent({ name: "a" }))

      // Mutate child's file state
      ctx.readFileState.set("new-file.ts", { content: "new" })

      // Parent must be unaffected
      expect(parent.readFileState.has("new-file.ts")).toBe(false)
      expect(parent.readFileState.size).toBe(1)
    })

    it("abort propagates parent→child but not child→parent", () => {
      const parent = createParent()
      const ctx = createSubagentContext(parent, createAgent({ name: "a" }))

      // Child abort does NOT propagate to parent
      ctx.abortController.abort("child-reason")
      expect(parent.abortController.signal.aborted).toBe(false)
    })

    it("parent abort propagates to child", () => {
      const parent = createParent()
      const ctx = createSubagentContext(parent, createAgent({ name: "a" }))

      parent.abortController.abort("parent-reason")
      expect(ctx.abortController.signal.aborted).toBe(true)
    })

    it("toolDecisions are always reset to undefined", () => {
      const parent = createParent({
        toolDecisions: { "some-tool": { result: true, source: "user" } },
      })
      const ctx = createSubagentContext(parent, createAgent({ name: "a" }))
      expect(ctx.toolDecisions).toBeUndefined()
    })
  })

  describe("R010 — setAppStateForTasks passthrough", () => {
    it("forwards to parent.setAppStateForTasks when available", () => {
      let called = false
      const rootSetter = () => {
        called = true
      }
      const parent = createParent({
        setAppState: () => {},
        setAppStateForTasks: rootSetter as unknown as ParentContext["setAppStateForTasks"],
      })
      const ctx = createSubagentContext(parent, createAgent({ name: "a" }))
      ctx.setAppStateForTasks((prev) => prev)
      expect(called).toBe(true)
    })

    it("falls back to parent.setAppState when setAppStateForTasks not provided", () => {
      let called = false
      const parent = createParent({
        setAppState: (() => {
          called = true
        }) as unknown as ParentContext["setAppState"],
      })
      const ctx = createSubagentContext(parent, createAgent({ name: "a" }))
      ctx.setAppStateForTasks((prev) => prev)
      expect(called).toBe(true)
    })
  })
})
