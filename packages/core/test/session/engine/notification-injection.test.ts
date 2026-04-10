import { describe, expect, mock, test } from "bun:test"
import { type BackgroundTask, BackgroundTaskRegistry } from "../../../src/command/background"
import type { Message } from "../../../src/session/message"
import { MessageID, SessionID } from "../../../src/session/schema"

// Mock the Session module to break the circular dependency chain:
// test → loop.ts → Session (from "..") → engine/index → namespace.ts → loop.ts (circular)
// By mocking session/index, Bun never loads the real barrel and the cycle is broken.
mock.module("../../../src/session/index", () => ({
  Session: {
    updateMessage: mock(async (msg: unknown) => msg),
    updatePart: mock(async (part: unknown) => part),
  },
}))

// Also mock the namespace directly to break the loop.ts -> namespace.ts cycle definitively
mock.module("../../../src/session/engine/namespace", () => ({
  SessionPrompt: {},
}))

// Now we can safely import from loop.ts
const { injectTaskNotifications } = await import("../../../src/session/engine/loop")

describe("injectTaskNotifications", () => {
  test("injects synthetic user message when tasks complete", async () => {
    const registry = new BackgroundTaskRegistry()
    const sessionID = SessionID.make("test")
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

    await injectTaskNotifications({
      registry,
      sessionID,
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
  })

  test("noop when no tasks completed", async () => {
    const registry = new BackgroundTaskRegistry()
    const msgsBuffer: { current: Message.WithParts[] } = { current: [] }
    const sessionID = SessionID.make("test")
    const lastUser = { id: MessageID.make("usr"), agent: "a", model: {} } as unknown as Message.User

    await injectTaskNotifications({
      registry,
      sessionID,
      lastUser,
      msgsBuffer,
    })

    expect(msgsBuffer.current.length).toBe(0)
  })

  test("injection failure propagates (call-site .catch absorbs it)", async () => {
    // Re-mock Session to throw on updateMessage
    const { Session } = await import("../../../src/session/index")
    const originalUpdateMessage = Session.updateMessage
    // @ts-expect-error — overriding for test
    Session.updateMessage = mock(async () => {
      throw new Error("DB write failed")
    })

    const registry = new BackgroundTaskRegistry()
    const sessionID = SessionID.make("test-err")
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

    // injectTaskNotifications itself DOES throw — the .catch() is at the call site in loop.ts.
    // Verify it throws so we know the call-site .catch() is necessary.
    await expect(injectTaskNotifications({ registry, sessionID, lastUser, msgsBuffer })).rejects.toThrow(
      "DB write failed",
    )

    // Buffer should NOT have been updated (persist failed before buffer push)
    expect(msgsBuffer.current.length).toBe(0)

    // Task should NOT be marked notified (markNotified is called after persist)
    expect(registry.getUnnotifiedCompletedTasks().length).toBe(1)

    // Restore
    // @ts-expect-error
    Session.updateMessage = originalUpdateMessage
  })

  test("multiple completed tasks batched into one user message", async () => {
    const registry = new BackgroundTaskRegistry()
    const sessionID = SessionID.make("test-multi")
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

    await injectTaskNotifications({ registry, sessionID, lastUser, msgsBuffer })

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
  })
})
