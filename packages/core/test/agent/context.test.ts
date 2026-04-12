import { describe, expect, it } from "bun:test"
import type { ParentContext } from "../../src/agent/context"
import {
  AgentExecutionContext,
  consumeInvokingRequestId,
  createSubagentContext,
  isRootAgent,
  runWithAgentContext,
} from "../../src/agent/context"

describe("Agent Context", () => {
  it("runWithAgentContext isolates concurrent contexts", async () => {
    const parent: ParentContext = {
      sessionId: "sess-1",
      abortController: new AbortController(),
      readFileState: new Map(),
      getAppState: () => ({}),
      setAppState: () => {},
    }

    const agent1 = { name: "agent1", background: false }
    const agent2 = { name: "agent2", background: true }

    const ctx1 = createSubagentContext(parent, agent1)
    const ctx2 = createSubagentContext(parent, agent2)

    await Promise.all([
      new Promise<void>((resolve) => {
        runWithAgentContext(ctx1, async () => {
          await Bun.sleep(10)
          expect(AgentExecutionContext.getStore()?.agentId).toBe("agent1")
          resolve()
        })
      }),
      new Promise<void>((resolve) => {
        runWithAgentContext(ctx2, async () => {
          await Bun.sleep(5)
          expect(AgentExecutionContext.getStore()?.agentId).toBe("agent2")
          resolve()
        })
      }),
    ])
  })

  it("consumeInvokingRequestId returns value only once", () => {
    const parent: ParentContext = {
      sessionId: "s",
      abortController: new AbortController(),
      readFileState: new Map(),
      getAppState: () => ({}),
      setAppState: () => {},
    }
    const ctx = createSubagentContext(parent, { name: "a" })
    ctx.invokingRequestId = "req-1"

    runWithAgentContext(ctx, () => {
      expect(consumeInvokingRequestId()).toBe("req-1")
      expect(consumeInvokingRequestId()).toBeUndefined()
    })
  })

  it("isRootAgent correctly discriminates", () => {
    const parent: ParentContext = {
      sessionId: "s",
      abortController: new AbortController(),
      readFileState: new Map(),
      getAppState: () => ({}),
      setAppState: () => {},
    }
    const ctx = createSubagentContext(parent, { name: "a" })

    runWithAgentContext(ctx, () => {
      expect(isRootAgent()).toBe(false)
    })

    expect(isRootAgent()).toBe(true)
  })
})
