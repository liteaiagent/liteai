import { describe, expect, test } from "bun:test"
import { StreamingToolExecutor } from "../../src/session/engine/streaming-tool-executor"
import type { EngineEvent } from "../../src/session/events"

function makeAbort() {
  const ctrl = new AbortController()
  return ctrl
}

function toolStart(id: string, toolName: string): EngineEvent.Any {
  return { type: "start", kind: "tool", id, toolName }
}

function toolDelta(id: string, text: string): EngineEvent.Any {
  return { type: "delta", part: "tool", id, toolName: "", text }
}

function toolCall(id: string, toolName: string, input: unknown): EngineEvent.Any {
  return { type: "call", kind: "tool", id, toolName, input }
}

function toolResult(id: string, toolName: string, input: unknown, output: unknown): EngineEvent.Any {
  return { type: "result", kind: "tool", id, toolName, input, output }
}

function toolError(id: string, toolName: string, input: unknown, error: unknown): EngineEvent.Any {
  return { type: "error", kind: "tool", id, toolName, input, error }
}

describe("StreamingToolExecutor", () => {
  test("registers tools on start event", () => {
    const ctrl = makeAbort()
    const executor = new StreamingToolExecutor(ctrl.signal)

    executor.processEvent(toolStart("t1", "read"))

    const summary = executor.getToolSummary()
    expect(summary).toHaveLength(1)
    expect(summary[0]).toEqual({
      id: "t1",
      toolName: "read",
      status: "pending",
      isConcurrencySafe: true,
    })
  })

  test("classifies read-only tools as concurrent-safe", () => {
    const ctrl = makeAbort()
    const executor = new StreamingToolExecutor(ctrl.signal)

    const readOnlyTools = ["glob", "grep", "read", "ls", "websearch", "webfetch", "codesearch", "lsp"]
    for (const tool of readOnlyTools) {
      executor.processEvent(toolStart(`t-${tool}`, tool))
    }

    const summary = executor.getToolSummary()
    expect(summary).toHaveLength(readOnlyTools.length)
    for (const entry of summary) {
      expect(entry.isConcurrencySafe).toBe(true)
    }
  })

  test("classifies write tools as exclusive (not concurrent-safe)", () => {
    const ctrl = makeAbort()
    const executor = new StreamingToolExecutor(ctrl.signal)

    const writeTools = ["edit", "write", "run_command", "multiedit", "task", "apply_patch"]
    for (const tool of writeTools) {
      executor.processEvent(toolStart(`t-${tool}`, tool))
    }

    const summary = executor.getToolSummary()
    expect(summary).toHaveLength(writeTools.length)
    for (const entry of summary) {
      expect(entry.isConcurrencySafe).toBe(false)
    }
  })

  test("accumulates input deltas", () => {
    const ctrl = makeAbort()
    const executor = new StreamingToolExecutor(ctrl.signal)

    executor.processEvent(toolStart("t1", "read"))
    executor.processEvent(toolDelta("t1", '{"file'))
    executor.processEvent(toolDelta("t1", '":"test.ts"}'))

    // Tool should be in accumulating status
    const summary = executor.getToolSummary()
    expect(summary[0]!.status).toBe("accumulating")
  })

  test("tracks tool lifecycle: pending → accumulating → executing → completed", () => {
    const ctrl = makeAbort()
    const executor = new StreamingToolExecutor(ctrl.signal)

    executor.processEvent(toolStart("t1", "read"))
    expect(executor.getToolSummary()[0]!.status).toBe("pending")

    executor.processEvent(toolDelta("t1", '{"file":"test.ts"}'))
    expect(executor.getToolSummary()[0]!.status).toBe("accumulating")

    executor.processEvent(toolCall("t1", "read", { file: "test.ts" }))
    expect(executor.getToolSummary()[0]!.status).toBe("executing")

    executor.processEvent(toolResult("t1", "read", { file: "test.ts" }, "file contents"))
    expect(executor.getToolSummary()[0]!.status).toBe("completed")
  })

  test("tracks error status", () => {
    const ctrl = makeAbort()
    const executor = new StreamingToolExecutor(ctrl.signal)

    executor.processEvent(toolStart("t1", "run_command"))
    executor.processEvent(toolCall("t1", "run_command", { command: "fail" }))
    executor.processEvent(toolError("t1", "run_command", { command: "fail" }, "command failed"))

    expect(executor.getToolSummary()[0]!.status).toBe("error")
  })

  test("sibling abort fires when a mutating tool errors", () => {
    const ctrl = makeAbort()
    const executor = new StreamingToolExecutor(ctrl.signal)

    expect(executor.siblingAbortSignal.aborted).toBe(false)
    expect(executor.hasSiblingError()).toBe(false)

    // Mutating tool errors
    executor.processEvent(toolStart("t1", "run_command"))
    executor.processEvent(toolCall("t1", "run_command", { command: "fail" }))
    executor.processEvent(toolError("t1", "run_command", { command: "fail" }, "exit code 1"))

    expect(executor.siblingAbortSignal.aborted).toBe(true)
    expect(executor.hasSiblingError()).toBe(true)
  })

  test("sibling abort does NOT fire when a read-only tool errors", () => {
    const ctrl = makeAbort()
    const executor = new StreamingToolExecutor(ctrl.signal)

    // Read-only tool errors (should not abort siblings)
    executor.processEvent(toolStart("t1", "grep"))
    executor.processEvent(toolCall("t1", "grep", { pattern: "foo" }))
    executor.processEvent(toolError("t1", "grep", { pattern: "foo" }, "no matches"))

    expect(executor.siblingAbortSignal.aborted).toBe(false)
    expect(executor.hasSiblingError()).toBe(false)
  })

  test("getConcurrencyState returns accurate counts", () => {
    const ctrl = makeAbort()
    const executor = new StreamingToolExecutor(ctrl.signal)

    // Add mixture of tools
    executor.processEvent(toolStart("t1", "read"))
    executor.processEvent(toolStart("t2", "grep"))
    executor.processEvent(toolStart("t3", "edit"))

    // Start executing two of them
    executor.processEvent(toolCall("t1", "read", { file: "a.ts" }))
    executor.processEvent(toolCall("t2", "grep", { pattern: "foo" }))

    const state = executor.getConcurrencyState()
    expect(state.total).toBe(3)
    expect(state.executing).toBe(2)
    expect(state.concurrentSafeExecuting).toBe(2)
    expect(state.exclusiveExecuting).toBe(0)
    expect(state.completed).toBe(0)
    expect(state.pending).toBe(1) // t3 still pending

    // Complete t1
    executor.processEvent(toolResult("t1", "read", { file: "a.ts" }, "contents"))
    const state2 = executor.getConcurrencyState()
    expect(state2.executing).toBe(1)
    expect(state2.completed).toBe(1)
  })

  test("processEvent always returns the event (passthrough)", () => {
    const ctrl = makeAbort()
    const executor = new StreamingToolExecutor(ctrl.signal)

    const events: EngineEvent.Any[] = [
      toolStart("t1", "read"),
      toolDelta("t1", '{"file":"a.ts"}'),
      toolCall("t1", "read", { file: "a.ts" }),
      toolResult("t1", "read", { file: "a.ts" }, "ok"),
    ]

    for (const event of events) {
      const result = executor.processEvent(event)
      expect(result).toBe(event) // same reference — not intercepted
    }
  })

  test("discard stops processing new events", () => {
    const ctrl = makeAbort()
    const executor = new StreamingToolExecutor(ctrl.signal)

    executor.processEvent(toolStart("t1", "read"))
    executor.discard()

    // After discard, new events are still returned but not tracked
    executor.processEvent(toolStart("t2", "grep"))
    expect(executor.getToolSummary()).toHaveLength(1) // only t1
  })

  test("multiple tools tracked independently", () => {
    const ctrl = makeAbort()
    const executor = new StreamingToolExecutor(ctrl.signal)

    executor.processEvent(toolStart("t1", "read"))
    executor.processEvent(toolStart("t2", "grep"))
    executor.processEvent(toolStart("t3", "edit"))

    executor.processEvent(toolCall("t1", "read", { file: "a.ts" }))
    executor.processEvent(toolResult("t1", "read", { file: "a.ts" }, "ok"))
    executor.processEvent(toolCall("t3", "edit", { file: "b.ts" }))
    executor.processEvent(toolError("t3", "edit", { file: "b.ts" }, "permission denied"))

    const summary = executor.getToolSummary()
    expect(summary[0]!.status).toBe("completed")
    expect(summary[1]!.status).toBe("pending") // never called
    expect(summary[2]!.status).toBe("error")
  })

  test("parent abort propagates to sibling abort signal", () => {
    const ctrl = makeAbort()
    const executor = new StreamingToolExecutor(ctrl.signal)

    expect(executor.siblingAbortSignal.aborted).toBe(false)
    ctrl.abort("user cancelled")
    expect(executor.siblingAbortSignal.aborted).toBe(true)
  })

  test("hasUnfinishedTools tracks completion correctly", () => {
    const ctrl = makeAbort()
    const executor = new StreamingToolExecutor(ctrl.signal)

    expect(executor.hasUnfinishedTools()).toBe(false)

    executor.processEvent(toolStart("t1", "read"))
    expect(executor.hasUnfinishedTools()).toBe(true)

    executor.processEvent(toolCall("t1", "read", { file: "a.ts" }))
    expect(executor.hasUnfinishedTools()).toBe(true)

    executor.processEvent(toolResult("t1", "read", { file: "a.ts" }, "ok"))
    expect(executor.hasUnfinishedTools()).toBe(true) // completed but not yielded

    // Error state counts as finished
    const ctrl2 = makeAbort()
    const executor2 = new StreamingToolExecutor(ctrl2.signal)
    executor2.processEvent(toolStart("t2", "edit"))
    executor2.processEvent(toolCall("t2", "edit", {}))
    executor2.processEvent(toolError("t2", "edit", {}, "fail"))
    expect(executor2.hasUnfinishedTools()).toBe(false) // error = finished
  })

  test("ignores events for unknown tool IDs", () => {
    const ctrl = makeAbort()
    const executor = new StreamingToolExecutor(ctrl.signal)

    // These should not throw
    executor.processEvent(toolDelta("unknown", "data"))
    executor.processEvent(toolCall("unknown", "read", {}))
    executor.processEvent(toolResult("unknown", "read", {}, "ok"))
    executor.processEvent(toolError("unknown", "read", {}, "fail"))

    expect(executor.getToolSummary()).toHaveLength(0)
  })

  test("non-tool events pass through without affecting state", () => {
    const ctrl = makeAbort()
    const executor = new StreamingToolExecutor(ctrl.signal)

    const textEvent: EngineEvent.Any = { type: "delta", part: "text", id: "txt1", text: "hello" }
    const startEvent: EngineEvent.Any = { type: "start", kind: "session" }

    executor.processEvent(textEvent)
    executor.processEvent(startEvent)

    expect(executor.getToolSummary()).toHaveLength(0)
    expect(executor.getConcurrencyState().total).toBe(0)
  })
})
