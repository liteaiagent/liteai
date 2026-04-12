import { describe, expect, test } from "bun:test"
import type { Agent } from "@/agent/agent"
import type { SubagentContext } from "@/agent/context"
import { PermissionSandbox } from "@/permission/sandbox"

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
      toolDecisions: state.toolDecisions,
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
    const parentPermissionCtx = {
      permissionMode: context.getAppState().permissionMode,
      shouldAvoidPermissionPrompts: context.getAppState().shouldAvoidPermissionPrompts,
      toolDecisions: context.toolDecisions,
    }
    const derivedPermissionCtx = PermissionSandbox.apply(parentPermissionCtx, agentDef, {
      isAsync: !!agentDef.background,
      canShowPermissionPrompts: false,
    })

    context.setAppState((state) => ({
      ...state,
      permissionMode: derivedPermissionCtx.permissionMode,
      ...(derivedPermissionCtx.shouldAvoidPermissionPrompts ? { shouldAvoidPermissionPrompts: true } : {}),
    }))
    if (derivedPermissionCtx.toolDecisions) {
      context.toolDecisions = derivedPermissionCtx.toolDecisions
    }
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

  test("tool allow-list replacement (not merge)", () => {
    const context = createMockContext({
      toolDecisions: {
        read_file: { result: true, source: "user" },
        run_command: { result: false, source: "user" },
      },
    })
    const agentDef = createMockAgentDef({ tools: ["write_file", "search"] })

    applySandboxToContext(context, agentDef)

    const newDecisions = context.toolDecisions
    expect(newDecisions).toBeDefined()
    expect(newDecisions?.read_file).toBeUndefined()
    expect(newDecisions?.run_command).toBeUndefined()
    expect(newDecisions?.write_file).toEqual({ result: true, source: "sandbox" })
    expect(newDecisions?.search).toEqual({ result: true, source: "sandbox" })
  })

  test("tool allow-list object format replacement", () => {
    const context = createMockContext({
      toolDecisions: {
        read_file: { result: true, source: "user" },
      },
    })
    const agentDef = createMockAgentDef({ tools: { write_file: true, denied_tool: false } })

    applySandboxToContext(context, agentDef)

    const newDecisions = context.toolDecisions
    expect(newDecisions).toBeDefined()
    expect(newDecisions?.read_file).toBeUndefined()
    expect(newDecisions?.write_file).toEqual({ result: true, source: "sandbox" })
    expect(newDecisions?.denied_tool).toBeUndefined()
  })

  test("CLI-level rule preservation", () => {
    const context = createMockContext({
      toolDecisions: {
        mcp_server_1: { result: true, source: "cliArg" },
        run_command: { result: true, source: "user" },
      },
    })
    const agentDef = createMockAgentDef({ tools: ["write_file"] })

    applySandboxToContext(context, agentDef)

    const newDecisions = context.toolDecisions
    expect(newDecisions).toBeDefined()
    expect(newDecisions?.mcp_server_1).toEqual({ result: true, source: "cliArg" })
    expect(newDecisions?.run_command).toBeUndefined()
    expect(newDecisions?.write_file).toEqual({ result: true, source: "sandbox" })
  })
})
