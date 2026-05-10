import { describe, expect, test } from "bun:test"
import type { Agent } from "@/agent/agent"
import type { SubagentContext } from "@/agent/context"
import { applyPermissionSandboxToContext } from "@/permission/sandbox"

describe("PermissionSandbox", () => {
  // Mock contexts and definitions
  // biome-ignore lint/suspicious/noExplicitAny: Mocking partial deep states requires flexible inputs to avoid imposing strict domain types structurally onto the test setups.
  const createMockContext = (initialState: any = {}): SubagentContext => {
    let state = { ...initialState }
    return {
      type: "subagent",
      agentId: "test-agent",
      sessionId: "test-session",
      abortController: new AbortController(),
      readFileState: new Map(),
      getAppState: () => state,
      // biome-ignore lint/suspicious/noExplicitAny: mock
      setAppState: (updater: any) => {
        if (typeof updater === "function") {
          state = updater(state)
        } else {
          state = { ...state, ...updater }
        }
      },
      setAppStateForTasks: () => {},
      cwd: process.cwd(),
    } as SubagentContext
  }

  const createMockAgentDef = (overrides: Partial<Agent.AgentDefinition> = {}): Agent.AgentDefinition => {
    return {
      name: "test-agent",
      source: "custom",
      mode: "subagent",
      permission: [],
      options: {},
      ...overrides,
    } as Agent.AgentDefinition
  }

  const applySandboxToContext = (context: SubagentContext, agentDef: Agent.AgentDefinition) => {
    applyPermissionSandboxToContext(context, agentDef, {
      isAsync: !!agentDef.background,
      canShowPermissionPrompts: false,
    })
  }

  test("mode inheritance precedence: parent elevated mode overrides child plan", () => {
    const context = createMockContext({ permissionMode: "bypassPermissions" })
    const agentDef = createMockAgentDef({ permissionMode: "plan" })

    applySandboxToContext(context, agentDef)

    expect(context.getAppState().permissionMode).toBe("bypassPermissions")
  })

  test("mode inheritance precedence: child elevated mode overrides parent plan", () => {
    const context = createMockContext({ permissionMode: "plan" })
    const agentDef = createMockAgentDef({ permissionMode: "acceptEdits" })

    applySandboxToContext(context, agentDef)

    expect(context.getAppState().permissionMode).toBe("acceptEdits")
  })

  test("background silent deny sets shouldAvoidPermissionPrompts", () => {
    const context = createMockContext({})
    const agentDef = createMockAgentDef({ background: true })

    applySandboxToContext(context, agentDef)

    expect(context.getAppState().shouldAvoidPermissionPrompts).toBe(true)
  })

  test("bubble mode prompt passthrough", () => {
    const context = createMockContext({})
    const agentDef = createMockAgentDef({ options: { bubble: true } })

    applySandboxToContext(context, agentDef)

    expect(context.getAppState().permissionMode).toBe("bubble")
  })
})
