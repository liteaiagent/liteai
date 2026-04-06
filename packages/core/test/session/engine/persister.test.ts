import { describe, expect, mock, test } from "bun:test"
import type { Provider } from "../../../src/provider/provider"
import { ModelID, ProviderID } from "../../../src/provider/schema"
import { EventPersister } from "../../../src/session/engine/persister"
import type { Message } from "../../../src/session/message"
import { MessageID, SessionID } from "../../../src/session/schema"

// Mock the DB and other dependencies for the test
mock.module("../index", () => ({
  Session: {
    updatePart: mock(async (part) => part),
    updateMessage: mock(async (msg) => msg),
    Event: { Error: "session.error" },
  },
}))

mock.module("../../bus", () => ({
  Bus: { publish: mock() },
}))

// Minimal test to verify AbortError handling in EventPersister
describe("EventPersister AbortError handling", () => {
  test("should catch AbortError without marking assistant message as errored", async () => {
    const sessionID = SessionID.make("test")
    const model = {
      providerID: ProviderID.make("test"),
      modelID: ModelID.make("test"),
      id: "test",
      name: "test",
      inputTokens: 0,
      outputTokens: 0,
    } as unknown as Provider.Model
    const abort = new AbortController()

    const assistantMessage = {
      id: MessageID.ascending(),
      parentID: MessageID.ascending(),
      sessionID,
      role: "assistant" as const,
      agent: "test",
      mode: "test",
      providerID: ProviderID.make("test"),
      modelID: ModelID.make("test"),
      time: { created: Date.now() },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    } as unknown as Message.Assistant

    const persister = new EventPersister(assistantMessage, sessionID, model, abort.signal)

    // Abort the signal to cause AbortError
    abort.abort()

    // process an event -- should throw AbortError inside and catch it
    const res = await persister.handleEvent({
      type: "delta",
      part: "text",
      id: "text-part-id",
      text: "hello",
    })

    // It should handle AbortError and return "stop"
    expect(res).toBe("stop")

    // The message should NOT be marked with an error
    expect(assistantMessage.error).toBeUndefined()
  })
})
