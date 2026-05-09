import { describe, expect, mock, test } from "bun:test"
import { type BackgroundTask, BackgroundTaskRegistry } from "../../../src/command/background"
import { CorrectionInjector } from "../../../src/session/engine/correction-injector"
import type { Checkpointer } from "../../../src/session/engine/loop/checkpointer"
import type { Message } from "../../../src/session/message"
import { MessageID, SessionID } from "../../../src/session/schema"

/**
 * Creates a mock Checkpointer that stubs saveMessage/savePart as identity passthrough.
 * These tests verify buffer behavior and call routing, not actual persistence.
 */
function createMockCheckpointer(): Checkpointer & {
  saveMessageMock: ReturnType<typeof mock>
  savePartMock: ReturnType<typeof mock>
} {
  const saveMessageMock = mock(async (msg: unknown) => msg)
  const savePartMock = mock(async (part: unknown) => part)
  return {
    saveMessage: saveMessageMock as Checkpointer["saveMessage"],
    savePart: savePartMock as Checkpointer["savePart"],
    saveMessageMock,
    savePartMock,
    // Remaining Checkpointer methods — not exercised by CorrectionInjector
    loadHistory: mock(async () => []),
    write: mock(async () => {}),
    updateMessage: mock(async (msg: unknown) => msg) as Checkpointer["updateMessage"],
    deletePart: mock(async () => {}),
  }
}

describe("CorrectionInjector.injectNotifications", () => {
  test("injects synthetic user message when tasks complete", async () => {
    const registry = new BackgroundTaskRegistry()
    const sessionID = SessionID.make("test")
    const checkpointer = createMockCheckpointer()
    const injector = new CorrectionInjector(sessionID, checkpointer)
    const msgsBuffer: { current: Message.WithParts[] } = { current: [] }

    const lastUser: Message.User = {
      id: MessageID.make("usr"),
      sessionID,
      role: "user",
      agent: "test-agent",
      model: { providerID: "test", modelID: "test" } as unknown as Message.User["model"],
      time: { created: Date.now() },
    }

    // Stub a completed task directly to avoid dealing with real child_processes
    const stubTask = {
      id: "cmd_test123",
      command: "echo test",
      status: "done",
      exitCode: 0,
      output: { getChars: () => "test output" },
    } as unknown as BackgroundTask

    // @ts-expect-error - bypassing private for testing
    registry._tasks.set(stubTask.id, stubTask)

    await injector.injectNotifications({
      registry,
      lastUser,
      msgsBuffer,
    })

    // Verify buffer was updated
    expect(msgsBuffer.current.length).toBe(1)
    const injected = msgsBuffer.current[0]
    expect(injected.info.role).toBe("user")

    // Check parts
    expect(injected.parts.length).toBe(1)
    const part = injected.parts[0]
    expect(part.type).toBe("text")
    const textPart = part as Extract<typeof part, { type: "text" }>
    expect(textPart.synthetic).toBe(true)
    expect(textPart.text).toContain("<task-notification>")
    expect(textPart.text).toContain("cmd_test123")
    expect(textPart.text).toContain("test output")
    expect(textPart.text).toContain("</task-notification>")

    // Verify markNotified was called (idempotency/tracking check)
    const pending = registry.getUnnotifiedCompletedTasks()
    expect(pending.length).toBe(0)

    // Verify checkpointer was called (not Session directly)
    expect(checkpointer.saveMessageMock).toHaveBeenCalledTimes(1)
    expect(checkpointer.savePartMock).toHaveBeenCalledTimes(1)
  })

  test("noop when no tasks completed", async () => {
    const registry = new BackgroundTaskRegistry()
    const msgsBuffer: { current: Message.WithParts[] } = { current: [] }
    const sessionID = SessionID.make("test")
    const checkpointer = createMockCheckpointer()
    const injector = new CorrectionInjector(sessionID, checkpointer)
    const lastUser = { id: MessageID.make("usr"), agent: "a", model: {} } as unknown as Message.User

    await injector.injectNotifications({
      registry,
      lastUser,
      msgsBuffer,
    })

    expect(msgsBuffer.current.length).toBe(0)
    // Checkpointer should NOT be called when there's nothing to inject
    expect(checkpointer.saveMessageMock).not.toHaveBeenCalled()
  })

  test("injection failure propagates (call-site .catch absorbs it)", async () => {
    const checkpointer = createMockCheckpointer()
    // Override saveMessage to throw — simulates persistence failure
    checkpointer.saveMessage = mock(async () => {
      throw new Error("DB write failed")
    }) as Checkpointer["saveMessage"]

    const registry = new BackgroundTaskRegistry()
    const sessionID = SessionID.make("test-err")
    const injector = new CorrectionInjector(sessionID, checkpointer)
    const msgsBuffer: { current: Message.WithParts[] } = { current: [] }
    const lastUser: Message.User = {
      id: MessageID.make("usr"),
      sessionID,
      role: "user",
      agent: "test-agent",
      model: { providerID: "test", modelID: "test" } as unknown as Message.User["model"],
      time: { created: Date.now() },
    }

    const stubTask = {
      id: "cmd_fail0001",
      command: "echo fail",
      status: "done",
      exitCode: 0,
      output: { getChars: () => "output" },
    } as unknown as BackgroundTask
    // @ts-expect-error - bypassing private for testing
    registry._tasks.set(stubTask.id, stubTask)

    // injectNotifications itself DOES throw — the .catch() is at the call site in loop.ts.
    // Verify it throws so we know the call-site .catch() is necessary.
    await expect(injector.injectNotifications({ registry, lastUser, msgsBuffer })).rejects.toThrow("DB write failed")

    // Buffer should NOT have been updated (persist failed before buffer push)
    expect(msgsBuffer.current.length).toBe(0)

    // Task should NOT be marked notified (markNotified is called after persist)
    expect(registry.getUnnotifiedCompletedTasks().length).toBe(1)
  })

  test("multiple completed tasks batched into one user message", async () => {
    const registry = new BackgroundTaskRegistry()
    const sessionID = SessionID.make("test-multi")
    const checkpointer = createMockCheckpointer()
    const injector = new CorrectionInjector(sessionID, checkpointer)
    const msgsBuffer: { current: Message.WithParts[] } = { current: [] }

    const lastUser: Message.User = {
      id: MessageID.make("usr"),
      sessionID,
      role: "user",
      agent: "test-agent",
      model: { providerID: "test", modelID: "test" } as unknown as Message.User["model"],
      time: { created: Date.now() },
    }

    // Inject two completed tasks
    const stub1 = {
      id: "cmd_batch001",
      command: "echo first",
      status: "done",
      exitCode: 0,
      output: { getChars: () => "first output" },
    } as unknown as BackgroundTask
    const stub2 = {
      id: "cmd_batch002",
      command: "echo second",
      status: "error",
      exitCode: 1,
      output: { getChars: () => "second output" },
    } as unknown as BackgroundTask

    // @ts-expect-error - bypassing private for testing
    registry._tasks.set(stub1.id, stub1)
    // @ts-expect-error - bypassing private for testing
    registry._tasks.set(stub2.id, stub2)

    await injector.injectNotifications({ registry, lastUser, msgsBuffer })

    // Should be exactly ONE synthetic user message (batched)
    expect(msgsBuffer.current.length).toBe(1)
    const injected = msgsBuffer.current[0]
    expect(injected.parts.length).toBe(1)

    const part = injected.parts[0]
    expect(part.type).toBe("text")
    const textPart = part as Extract<typeof part, { type: "text" }>

    // Both tasks present in the single message
    expect(textPart.text).toContain("cmd_batch001")
    expect(textPart.text).toContain("cmd_batch002")
    expect(textPart.text).toContain("first output")
    expect(textPart.text).toContain("second output")
    // Contains both statuses
    expect(textPart.text).toContain("Status: done")
    expect(textPart.text).toContain("Status: error")

    // Both tasks marked notified
    expect(registry.getUnnotifiedCompletedTasks().length).toBe(0)

    // Verify single saveMessage + single savePart (batched into one message)
    expect(checkpointer.saveMessageMock).toHaveBeenCalledTimes(1)
    expect(checkpointer.savePartMock).toHaveBeenCalledTimes(1)
  })
})
