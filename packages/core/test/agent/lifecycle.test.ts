import { describe, expect, it, mock, spyOn } from "bun:test"
import { AgentEvent } from "@/agent/events"
import {
  buildSummarizationPrompt,
  classifyHandoffIfNeeded,
  enqueueAgentNotification,
  extractPartialResult,
  ProgressTracker,
  type SummarizationDeps,
  startAgentSummarization,
} from "@/agent/lifecycle"
import { Bus } from "@/bus/index"
import type { TranscriptMessage } from "@/session/transcript"

describe("Agent Lifecycle", () => {
  describe("ProgressTracker", () => {
    it("should map tool names to human readable descriptions", () => {
      const tracker = new ProgressTracker()
      tracker.updateActivity("edit_file")
      expect(tracker.currentActivity).toBe("Editing file...")
    })
  })

  describe("Terminal Notification", () => {
    it("enqueueAgentNotification publishes Bus event with correct payload", () => {
      const spy = spyOn(Bus, "publish").mockResolvedValue([])

      enqueueAgentNotification("test-session", {
        agentId: "agent-123",
        status: "completed",
        description: "Agent test completed",
        usage: { totalTokens: 100, toolCalls: 2, duration: 1000 },
      })

      expect(spy).toHaveBeenCalledWith(
        AgentEvent.TerminalNotification,
        expect.objectContaining({
          agentId: "agent-123",
          status: "completed",
          description: "Agent test completed",
        }),
      )
      spy.mockRestore()
    })

    it("enqueueAgentNotification includes error message when present", () => {
      const spy = spyOn(Bus, "publish").mockResolvedValue([])

      enqueueAgentNotification("test-session", {
        agentId: "agent-456",
        status: "failed",
        description: "Agent failed",
        usage: { totalTokens: 50, toolCalls: 1, duration: 500 },
        error: new Error("Timeout exceeded"),
      })

      expect(spy).toHaveBeenCalledWith(
        AgentEvent.TerminalNotification,
        expect.objectContaining({
          agentId: "agent-456",
          status: "failed",
          error: "Timeout exceeded",
        }),
      )
      spy.mockRestore()
    })

    it("enqueueAgentNotification includes partial result for killed agents", () => {
      const spy = spyOn(Bus, "publish").mockResolvedValue([])

      enqueueAgentNotification("test-session", {
        agentId: "agent-789",
        status: "killed",
        description: "Agent killed",
        usage: { totalTokens: 0, toolCalls: 0, duration: 200 },
        partialResult: "Partial work completed...",
      })

      expect(spy).toHaveBeenCalledWith(
        AgentEvent.TerminalNotification,
        expect.objectContaining({
          agentId: "agent-789",
          status: "killed",
          partialResult: "Partial work completed...",
        }),
      )
      spy.mockRestore()
    })
  })

  describe("extractPartialResult", () => {
    it("should extract last partial result and truncate to 2000 chars", () => {
      const longText = "a".repeat(3000)
      const messages: TranscriptMessage[] = [
        { isSidechain: true, uuid: "1", role: "user", content: "do something", timestamp: 1 },
        { isSidechain: true, uuid: "2", role: "assistant", content: longText, timestamp: 2 },
      ]
      const extracted = extractPartialResult(messages)
      expect(extracted?.length).toBe(2000)
    })
  })

  describe("Handoff Security Review", () => {
    it("should prepend security warning if flag is enabled and YOLO action found", async () => {
      const originalFlag = process.env.TRANSCRIPT_CLASSIFIER
      process.env.TRANSCRIPT_CLASSIFIER = "true"
      const messages: TranscriptMessage[] = [
        { isSidechain: true, uuid: "1", role: "user", content: "do it", timestamp: 1 },
        { isSidechain: true, uuid: "2", role: "assistant", content: "rm -rf /", timestamp: 2 },
      ]
      const result = await classifyHandoffIfNeeded("original result", "test-session", "auto", messages)
      expect(result).toContain("[SECURITY WARNING]")
      expect(result).toContain("original result")
      process.env.TRANSCRIPT_CLASSIFIER = originalFlag
    })
  })

  describe("ALS Isolation", () => {
    it("should isolate 3 concurrent background agents", async () => {
      const { AgentExecutionContext, runWithAgentContext } = await import("@/agent/context")
      const results: string[] = []

      const makeAgent = (id: string, delayMs: number) =>
        new Promise<void>((resolve) => {
          const ctx = {
            type: "subagent" as const,
            agentId: id,
            agentType: `test-${id}`,
            parentSessionId: "sess-test",
            isBuiltIn: false,
            invocationKind: "spawn" as const,
            queryTracking: { depth: 1 },
            abortController: new AbortController(),
            readFileState: new Map(),
            toolDecisions: undefined,
            getAppState: () => ({}),
            setAppState: () => {},
            setAppStateForTasks: () => {},
            cwd: process.cwd(),
          } as import("@/agent/context").SubagentContext

          runWithAgentContext(ctx, async () => {
            await Bun.sleep(delayMs)
            const store = AgentExecutionContext.getStore()
            if (store?.agentId) {
              results.push(store.agentId)
            }
            resolve()
          })
        })

      await Promise.all([makeAgent("agent-A", 30), makeAgent("agent-B", 10), makeAgent("agent-C", 20)])

      // All 3 agents must report their own ID — zero cross-contamination
      expect(results).toContain("agent-A")
      expect(results).toContain("agent-B")
      expect(results).toContain("agent-C")
      expect(results).toHaveLength(3)
    })
  })

  // ─── Summarization Tests ──────────────────────────────────────────────────

  describe("buildSummarizationPrompt", () => {
    it("should include transcript messages in the prompt", () => {
      const messages: TranscriptMessage[] = [
        { isSidechain: true, uuid: "1", role: "user", content: "Fix the bug", timestamp: 1 },
        { isSidechain: true, uuid: "2", role: "assistant", content: "Reading src/foo.ts", timestamp: 2 },
      ]
      const prompt = buildSummarizationPrompt(messages, null)
      expect(prompt).toContain("[user] Fix the bug")
      expect(prompt).toContain("[assistant] Reading src/foo.ts")
      expect(prompt).toContain("3-5 words")
      expect(prompt).toContain("present tense")
    })

    it("should include previous summary for novelty enforcement", () => {
      const messages: TranscriptMessage[] = [
        { isSidechain: true, uuid: "1", role: "assistant", content: "Done", timestamp: 1 },
      ]
      const prompt = buildSummarizationPrompt(messages, "Reading runAgent.ts")
      expect(prompt).toContain('Previous: "Reading runAgent.ts"')
      expect(prompt).toContain("say something NEW")
    })

    it("should truncate long message content", () => {
      const longContent = "x".repeat(500)
      const messages: TranscriptMessage[] = [
        { isSidechain: true, uuid: "1", role: "assistant", content: longContent, timestamp: 1 },
      ]
      const prompt = buildSummarizationPrompt(messages, null)
      // Full 500-char content must NOT survive into the prompt
      expect(prompt).not.toContain(longContent)
      // The 200-char prefix must be present (truncation boundary)
      expect(prompt).toContain("x".repeat(200))
      // Truncation marker must appear after the prefix
      expect(prompt).toContain("…")
    })
  })

  describe("startAgentSummarization", () => {
    it("should return a cleanup function", () => {
      const deps: SummarizationDeps = {
        getTranscript: () => [],
        setAppStateForTasks: () => {},
      }
      const stop = startAgentSummarization("sess-1", "agent-1", deps)
      expect(typeof stop).toBe("function")
      // Clean up without errors
      stop()
    })

    it("cleanup should be idempotent (safe to call multiple times)", () => {
      const deps: SummarizationDeps = {
        getTranscript: () => [],
        setAppStateForTasks: () => {},
      }
      const stop = startAgentSummarization("sess-1", "agent-1", deps)
      // Should not throw when called multiple times
      stop()
      stop()
      stop()
    })

    it("should skip summarization when transcript has fewer than 3 messages", async () => {
      const setAppStateSpy = mock(() => {})
      const deps: SummarizationDeps = {
        getTranscript: () => [{ isSidechain: true, uuid: "1", role: "user", content: "hello", timestamp: 1 }],
        setAppStateForTasks: setAppStateSpy,
      }

      // Use a 1 ms interval so the timer fires during the sleep — without
      // this the default 30 s interval would never fire and the test would
      // trivially pass (false positive).
      const stop = startAgentSummarization("sess-1", "agent-1", deps, { intervalMs: 1 })

      // Wait long enough for several ticks to fire
      await Bun.sleep(100)
      stop()

      // runSummary must early-return because transcript.length < 3,
      // so setAppStateForTasks should never be called.
      expect(setAppStateSpy).not.toHaveBeenCalled()
    })
  })
})
