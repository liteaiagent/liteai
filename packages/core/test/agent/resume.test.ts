import { describe, expect, mock, test } from "bun:test"
import type { ParentContext } from "../../src/agent/context"
import { reconstructContentOptimizationState, resumeAgentBackground } from "../../src/agent/resume"
import type { TranscriptMessage } from "../../src/session/transcript"

describe("Resume Orchestrator", () => {
  test("reconstructs content optimization state from messages", () => {
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

  test("resumeAgentBackground handles worktree fallback gracefully", async () => {
    // Basic mock test for worktree GC'd fallback (Tier 3 fail is expected if system prompt missing)
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
    mock.module("../../src/worktree/index", () => ({
      Worktree: {
        refreshWorktreeMtime: mock(() => Promise.resolve(true)),
      },
    }))

    const context = { sessionId: "sess-123", cwd: "/test/parent" } as unknown as ParentContext

    // It should throw because transcript is empty (simulate fail-fast constraint)
    await expect(
      resumeAgentBackground({
        agentId: "agent-123",
        prompt: "resume now",
        sessionContext: context,
      }),
    ).rejects.toThrow("No transcript found")
  })
})
