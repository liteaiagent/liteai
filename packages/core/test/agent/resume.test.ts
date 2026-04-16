import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { Agent } from "../../src/agent/agent"
import { AgentMeta } from "../../src/agent/agent-meta"
import type { ParentContext } from "../../src/agent/context"
import * as contextModule from "../../src/agent/context"
import * as fork from "../../src/agent/fork"
import * as lifecycle from "../../src/agent/lifecycle"
import { reconstructContentOptimizationState, resumeAgentBackground } from "../../src/agent/resume"
import { Session } from "../../src/session/index"
import { SidechainTranscript, type TranscriptMessage } from "../../src/session/transcript"
import { Worktree } from "../../src/worktree/index"

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
  afterEach(() => {
    mock.restore()
  })

  test("throws when transcript is empty", async () => {
    spyOn(Session, "get").mockResolvedValue({ directory: "/test/dir" } as unknown as Awaited<
      ReturnType<typeof Session.get>
    >)
    spyOn(Session, "children").mockResolvedValue([{ title: "Subagent: fork (agent-123)" }] as unknown as Awaited<
      ReturnType<typeof Session.children>
    >)
    spyOn(SidechainTranscript, "read").mockResolvedValue([])
    spyOn(AgentMeta, "read").mockResolvedValue(null)
    spyOn(Worktree, "refreshWorktreeMtime").mockResolvedValue(true)

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

    spyOn(Session, "get").mockResolvedValue({ directory: "/test/dir" } as unknown as Awaited<
      ReturnType<typeof Session.get>
    >)
    spyOn(Session, "children").mockResolvedValue([{ title: "Subagent: fork (agent-fork-1)" }] as unknown as Awaited<
      ReturnType<typeof Session.children>
    >)
    spyOn(SidechainTranscript, "read").mockResolvedValue(forkTranscript)
    spyOn(AgentMeta, "read").mockResolvedValue({ agentType: "fork", agentId: "agent-fork-1" })
    spyOn(Worktree, "refreshWorktreeMtime").mockResolvedValue(true)
    spyOn(fork, "getLastCacheSafeParams").mockReturnValue(null)

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

    spyOn(Session, "get").mockResolvedValue({ directory: "/test/dir" } as unknown as Awaited<
      ReturnType<typeof Session.get>
    >)
    spyOn(Session, "children").mockResolvedValue([
      { title: "Subagent: explore (agent-meta-test)" },
    ] as unknown as Awaited<ReturnType<typeof Session.children>>)
    spyOn(SidechainTranscript, "read").mockResolvedValue(transcript)
    spyOn(AgentMeta, "read").mockResolvedValue(mockMeta)
    spyOn(Worktree, "refreshWorktreeMtime").mockResolvedValue(true)

    spyOn(Agent, "get").mockImplementation(async (name) => {
      if (name === "custom-agent") {
        return { name: "custom-agent", timeout: 1000, prompt: "test prompt" } as unknown as Awaited<
          ReturnType<typeof Agent.get>
        >
      }
      throw new Error(`Agent ${name} not found`)
    })

    spyOn(contextModule, "createSubagentContext").mockReturnValue({
      invocationKind: undefined,
      invokingRequestId: undefined,
      abortController: new AbortController(),
    } as unknown as contextModule.SubagentContext)

    spyOn(contextModule, "runWithAgentContext").mockImplementation(<T>(_ctx: contextModule.AgentContext, fn: () => T) =>
      fn(),
    )

    spyOn(lifecycle, "runAsyncAgentLifecycle").mockResolvedValue(
      undefined as unknown as Awaited<ReturnType<typeof lifecycle.runAsyncAgentLifecycle>>,
    )

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
