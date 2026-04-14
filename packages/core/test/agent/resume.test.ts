import { describe, expect, mock, test } from "bun:test"
import type { ParentContext } from "../../src/agent/context"
import { reconstructContentOptimizationState, resumeAgentBackground } from "../../src/agent/resume"
import type { TranscriptMessage } from "../../src/session/transcript"

// ─── reconstructContentOptimizationState ──────────────────────────────────────

describe("reconstructContentOptimizationState", () => {
  test("merges parent state and persisted replacements", () => {
    const parentState = { "id-1": "some-value" }
    const messages = [
      {
        role: "assistant",
        content: [{ type: "tool_result", contentReplacementId: "id-2" }],
      },
    ] as unknown as TranscriptMessage[]
    const state = reconstructContentOptimizationState(parentState, messages, { "id-3": "other-val" })

    expect(state).toHaveProperty("id-1", "some-value")
    expect(state).toHaveProperty("id-3", "other-val")
  })

  test("sets null sentinel for unresolvable content replacement references", () => {
    const messages = [
      {
        role: "assistant",
        content: [{ type: "tool_result", contentReplacementId: "orphan-ref" }],
      },
    ] as unknown as TranscriptMessage[]
    const state = reconstructContentOptimizationState({}, messages)

    expect(state).toHaveProperty("orphan-ref", null)
  })

  test("preserves existing references over null fill", () => {
    const parentState = { "ref-1": "cached-payload" }
    const messages = [
      {
        role: "assistant",
        content: [{ type: "tool_result", contentReplacementId: "ref-1" }],
      },
    ] as unknown as TranscriptMessage[]
    const state = reconstructContentOptimizationState(parentState, messages)

    expect(state).toHaveProperty("ref-1", "cached-payload")
  })

  test("returns empty state when no parent state and no messages", () => {
    const state = reconstructContentOptimizationState(undefined, [])
    expect(state).toEqual({})
  })
})

// ─── resumeAgentBackground ────────────────────────────────────────────────────

describe("resumeAgentBackground", () => {
  test("throws when transcript is empty", async () => {
    mock.module("../../src/session/index", () => ({
      Session: {
        get: mock(() => Promise.resolve({ directory: "/test/dir" })),
        children: mock(() => Promise.resolve([{ title: "Subagent: fork (agent-123)" }])),
      },
    }))
    mock.module("../../src/session/transcript", () => ({
      SidechainTranscript: {
        read: mock(() => Promise.resolve([])),
      },
    }))
    mock.module("../../src/agent/agent-meta", () => ({
      AgentMeta: {
        read: mock(() => Promise.resolve(null)),
      },
    }))
    mock.module("../../src/worktree/index", () => ({
      Worktree: {
        refreshWorktreeMtime: mock(() => Promise.resolve(true)),
      },
    }))

    const context = { sessionId: "sess-123", cwd: "/test/parent" } as unknown as ParentContext

    await expect(
      resumeAgentBackground({
        agentId: "agent-123",
        prompt: "resume now",
        sessionContext: context,
      }),
    ).rejects.toThrow("No transcript found")
  })

  test("throws Tier 3 when fork child has no system prompt available", async () => {
    const forkTranscript: TranscriptMessage[] = [
      { isSidechain: true, uuid: "m1", role: "user", content: "do something", timestamp: 1 },
      { isSidechain: true, uuid: "m2", role: "assistant", content: "done", timestamp: 2 },
    ]

    mock.module("../../src/session/index", () => ({
      Session: {
        get: mock(() => Promise.resolve({ directory: "/test/dir" })),
        children: mock(() => Promise.resolve([{ title: "Subagent: fork (agent-fork-1)" }])),
      },
    }))
    mock.module("../../src/session/transcript", () => ({
      SidechainTranscript: {
        read: mock(() => Promise.resolve(forkTranscript)),
      },
    }))
    mock.module("../../src/agent/agent-meta", () => ({
      AgentMeta: {
        // Metadata exists but has no renderedSystemPrompt
        read: mock(() => Promise.resolve({ agentType: "fork", agentId: "agent-fork-1" })),
      },
    }))
    mock.module("../../src/agent/fork", () => ({
      ForkAgentConfig: { name: "fork", wallClockTimeout: 300_000, background: true, source: "builtIn" },
      getLastCacheSafeParams: mock(() => null),
      filterOrphanedThinkingOnlyMessages: (msgs: TranscriptMessage[]) => msgs,
      filterUnresolvedToolUses: (msgs: TranscriptMessage[]) => msgs,
      filterWhitespaceOnlyAssistantMessages: (msgs: TranscriptMessage[]) => msgs,
    }))
    mock.module("../../src/worktree/index", () => ({
      Worktree: { refreshWorktreeMtime: mock(() => Promise.resolve()) },
    }))

    const context = { sessionId: "sess-456", cwd: "/test/parent" } as unknown as ParentContext

    await expect(
      resumeAgentBackground({
        agentId: "agent-fork-1",
        prompt: "continue",
        sessionContext: context,
      }),
    ).rejects.toThrow("Cannot resume fork agent: unable to reconstruct parent system prompt")
  })

  test("resolves agent type from metadata sidecar over title regex", async () => {
    const transcript: TranscriptMessage[] = [
      { isSidechain: true, uuid: "m1", role: "user", content: "task", timestamp: 1 },
    ]

    const mockMeta = {
      agentType: "custom-agent",
      agentId: "agent-meta-test",
      description: "Custom task from metadata",
    }

    mock.module("../../src/session/index", () => ({
      Session: {
        get: mock(() => Promise.resolve({ directory: "/test/dir" })),
        // Title says "explore" but metadata says "custom-agent"
        children: mock(() => Promise.resolve([{ title: "Subagent: explore (agent-meta-test)" }])),
      },
    }))
    mock.module("../../src/session/transcript", () => ({
      SidechainTranscript: {
        read: mock(() => Promise.resolve(transcript)),
      },
    }))
    mock.module("../../src/agent/agent-meta", () => ({
      AgentMeta: {
        read: mock(() => Promise.resolve(mockMeta)),
      },
    }))
    mock.module("../../src/agent/agent", () => ({
      Agent: {
        // Verifying the correct agentType was used
        get: mock((name: string) => {
          if (name === "custom-agent")
            return Promise.resolve({ name: "custom-agent", timeout: 1000, prompt: "test prompt" })
          return Promise.reject(new Error(`Agent ${name} not found`))
        }),
      },
    }))
    mock.module("../../src/worktree/index", () => ({
      Worktree: { refreshWorktreeMtime: mock(() => Promise.resolve()) },
    }))
    mock.module("../../src/agent/context", () => ({
      createSubagentContext: mock(() => ({
        invocationKind: undefined,
        invokingRequestId: undefined,
        abortController: new AbortController(),
      })),
      runWithAgentContext: mock((_ctx: unknown, fn: () => unknown) => fn()),
      AgentExecutionContext: { getStore: () => null },
    }))
    mock.module("../../src/agent/lifecycle", () => ({
      runAsyncAgentLifecycle: mock(() => Promise.resolve()),
    }))

    const context = {
      sessionId: "sess-meta",
      cwd: "/test/parent",
      getAppState: () => ({}),
      setAppState: () => {},
    } as unknown as ParentContext

    // The function should not throw — it successfully resolves the agent type from metadata
    const result = await resumeAgentBackground({
      agentId: "agent-meta-test",
      prompt: "test",
      sessionContext: context,
    })
    // Agent type was resolved (function returned, not threw)
    expect(result.agentId).toBe("agent-meta-test")
    expect(result.description).toBe("Custom task from metadata")
  })
})
