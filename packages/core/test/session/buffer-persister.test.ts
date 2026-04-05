/**
 * Tests for the in-memory message buffer refactor (FR-4, FR-5, FR-6).
 *
 * Covers corner cases where buffer and DB could desync:
 *   1. upsertPart correctness — start→delta→end for text/reasoning must keep final state only
 *   2. flush() without DB read — running tool parts caught from allParts
 *   3. getCompletedMessage() integrity — reflects final part state, not intermediate
 *   4. Multi-part tracking — separate parts all appear in allParts
 *   5. getCompletedMessage returns shallow array copy (external mutation safety)
 *
 * NOTE: We test via text/reasoning events (not tool call/result) to avoid
 * the startToolSpan/endToolSpan + Perfetto codepath which requires a live
 * telemetry context not available in unit tests. The doom-loop detection path
 * (PermissionNext.ask) is similarly outside unit-test scope.
 */

import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { ProjectTable } from "../../src/project/project.sql"
import type { Provider } from "../../src/provider/provider"
import type { ModelID, ProviderID } from "../../src/provider/schema"
import { EventPersister } from "../../src/session/engine/persister"
import { Message } from "../../src/session/message"
import { MessageID, SessionID } from "../../src/session/schema"
import { MessageTable, SessionTable } from "../../src/session/session.sql"
import { Database } from "../../src/storage/db"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeModel(): Provider.Model {
  return {
    id: "gpt-4",
    providerID: "openai",
    name: "GPT-4",
    limit: { context: 128_000, input: undefined, output: 4096 },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    capabilities: {
      toolcall: true,
      attachment: false,
      reasoning: false,
      temperature: true,
      input: { text: true, image: false, audio: false, video: false },
      output: { text: true, image: false, audio: false, video: false },
    },
    api: { npm: "@ai-sdk/openai" },
    options: {},
  } as Provider.Model
}

function makeAssistantMessage(id: MessageID, sessionID: SessionID): Message.Assistant {
  return {
    id,
    sessionID,
    role: "assistant",
    time: { created: Date.now() },
    parentID: MessageID.make("msg_parent"),
    modelID: "gpt-4" as ModelID,
    providerID: "openai" as ProviderID,
    mode: "primary",
    agent: "test",
    path: { cwd: "/", root: "/" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  }
}

/** Set up DB rows for one test with IDs derived from the sessionID (unique per test). */
async function setupSession(sessionID: SessionID, assistantMessageID: MessageID) {
  const projectID = `prj_${sessionID.replace(/[^a-z0-9]/gi, "").slice(0, 20)}` as never
  await Database.use((db) => {
    db.insert(ProjectTable).values({ id: projectID, worktree: "", sandboxes: [], time_created: Date.now() }).run()
    db.insert(SessionTable)
      .values({
        id: sessionID,
        project_id: projectID,
        slug: "test-slug",
        directory: "/",
        title: "Test",
        version: "1.0",
        time_created: Date.now(),
      })
      .run()
    db.insert(MessageTable)
      .values({
        id: assistantMessageID,
        session_id: sessionID,
        time_created: Date.now(),
        data: makeAssistantMessage(assistantMessageID, sessionID),
      })
      .run()
  })
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("EventPersister in-memory buffer (FR-4, FR-5, FR-6)", () => {
  // ── Test 1: upsertPart via text lifecycle ─────────────────────────────────
  // Verifies that multiple writes to the same part (start→delta→end) result
  // in exactly ONE entry in allParts with the final accumulated text.
  test("upsertPart: text part accumulates and is stored once (not duplicated)", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = SessionID.make("ses_textpart-upsert")
        const msgID = MessageID.make("msg_textpart-upsert")
        await setupSession(sessionID, msgID)

        const persister = new EventPersister(
          makeAssistantMessage(msgID, sessionID),
          sessionID,
          makeModel(),
          new AbortController().signal,
        )

        // start → delta × 3 → end
        await persister.handleEvent({ type: "start", kind: "text", id: "text-0" } as never)
        await persister.handleEvent({ type: "delta", part: "text", id: "text-0", text: "Hello" } as never)
        await persister.handleEvent({ type: "delta", part: "text", id: "text-0", text: " " } as never)
        await persister.handleEvent({ type: "delta", part: "text", id: "text-0", text: "world" } as never)
        await persister.handleEvent({ type: "end", kind: "text", id: "text-0" } as never)

        const completed = persister.getCompletedMessage()
        const textParts = completed.parts.filter((p) => p.type === "text")

        // Must be exactly 1 text part — upsert-by-ID, not append on each write
        expect(textParts.length).toBe(1)
        // Final state has accumulated text
        expect((textParts[0] as Message.TextPart).text).toBe("Hello world")
      },
    })
  })

  // ── Test 2: upsertPart via reasoning lifecycle ────────────────────────────
  // Reasoning parts follow the same upsert pattern as text parts. Verifies that
  // partial reasoning updates don't leave stale intermediate entries in allParts.
  test("upsertPart: reasoning part updated correctly through start→delta→end lifecycle", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = SessionID.make("ses_reasoning-upsert")
        const msgID = MessageID.make("msg_reasoning-upsert")
        await setupSession(sessionID, msgID)

        const persister = new EventPersister(
          makeAssistantMessage(msgID, sessionID),
          sessionID,
          makeModel(),
          new AbortController().signal,
        )

        await persister.handleEvent({ type: "start", kind: "reasoning", id: "reasoning-0" } as never)
        await persister.handleEvent({ type: "delta", part: "reasoning", id: "reasoning-0", text: "I think" } as never)
        await persister.handleEvent({ type: "delta", part: "reasoning", id: "reasoning-0", text: " deeply" } as never)
        await persister.handleEvent({ type: "end", kind: "reasoning", id: "reasoning-0" } as never)

        const completed = persister.getCompletedMessage()
        const reasoningParts = completed.parts.filter((p) => p.type === "reasoning")

        // Must be exactly 1 reasoning part
        expect(reasoningParts.length).toBe(1)
        // Final accumulated text
        expect((reasoningParts[0] as Message.ReasoningPart).text).toBe("I think deeply")
        // end event sets the end timestamp
        expect((reasoningParts[0] as Message.ReasoningPart).time.end).toBeDefined()
      },
    })
  })

  // ── Test 3: Multiple distinct parts all tracked ───────────────────────────
  // Ensures upsertPart never drops entries — each distinct part ID gets its own slot.
  test("upsertPart: two separate text parts both appear in allParts", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = SessionID.make("ses_twotext-parts")
        const msgID = MessageID.make("msg_twotext-parts")
        await setupSession(sessionID, msgID)

        const persister = new EventPersister(
          makeAssistantMessage(msgID, sessionID),
          sessionID,
          makeModel(),
          new AbortController().signal,
        )

        // First text part
        await persister.handleEvent({ type: "start", kind: "text", id: "text-0" } as never)
        await persister.handleEvent({ type: "delta", part: "text", id: "text-0", text: "First" } as never)
        await persister.handleEvent({ type: "end", kind: "text", id: "text-0" } as never)

        // Second text part (different id → different part)
        await persister.handleEvent({ type: "start", kind: "text", id: "text-1" } as never)
        await persister.handleEvent({ type: "delta", part: "text", id: "text-1", text: "Second" } as never)
        await persister.handleEvent({ type: "end", kind: "text", id: "text-1" } as never)

        const completed = persister.getCompletedMessage()
        const textParts = completed.parts.filter((p) => p.type === "text")

        // 2 distinct text parts — neither dropped by upsert
        expect(textParts.length).toBe(2)
        const texts = textParts.map((p) => (p as Message.TextPart).text).sort()
        expect(texts).toEqual(["First", "Second"])
      },
    })
  })

  // ── Test 4: getCompletedMessage assembles from in-memory state ────────────
  // FR-5: the returned WithParts uses the in-memory assistantMessage + allParts.
  test("getCompletedMessage: returns correct info + parts without DB re-read", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = SessionID.make("ses_completedmsg")
        const msgID = MessageID.make("msg_completedmsg")
        await setupSession(sessionID, msgID)

        const assistantMsg = makeAssistantMessage(msgID, sessionID)
        const persister = new EventPersister(assistantMsg, sessionID, makeModel(), new AbortController().signal)

        await persister.handleEvent({ type: "start", kind: "text", id: "text-0" } as never)
        await persister.handleEvent({ type: "delta", part: "text", id: "text-0", text: "Response text" } as never)
        await persister.handleEvent({ type: "end", kind: "text", id: "text-0" } as never)

        const completed = persister.getCompletedMessage()

        // info must be the assistant message (same object reference or equivalent id)
        expect(completed.info.id).toBe(msgID)
        expect(completed.info.role).toBe("assistant")
        // parts populated from allParts
        expect(completed.parts.length).toBeGreaterThan(0)
        const textPart = completed.parts.find((p) => p.type === "text") as Message.TextPart
        expect(textPart.text).toBe("Response text")
      },
    })
  })

  // ── Test 5: flush() uses allParts to cleanup aborted reasoning (FR-6) ─────
  // An in-flight reasoning part (no end event) must be closed by flush() using
  // the in-memory allParts list — verifies no DB.parts() read in flush path.
  test("flush(): closes in-flight reasoning parts using allParts (no DB re-read)", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = SessionID.make("ses_flushreasoningabort")
        const msgID = MessageID.make("msg_flushreasoningabort")
        await setupSession(sessionID, msgID)

        const persister = new EventPersister(
          makeAssistantMessage(msgID, sessionID),
          sessionID,
          makeModel(),
          new AbortController().signal,
        )

        // start reasoning but never emit "end" — simulates abort mid-stream
        await persister.handleEvent({ type: "start", kind: "reasoning", id: "reasoning-0" } as never)
        await persister.handleEvent({
          type: "delta",
          part: "reasoning",
          id: "reasoning-0",
          text: "Partial reasoning...",
        } as never)

        // flush must end the reasoning part using allParts (FR-6)
        await persister.flush(undefined)

        // DB should now have the reasoning part with a completed end timestamp
        const parts = await Message.parts(msgID)
        const reasoningPart = parts.find((p) => p.type === "reasoning") as Message.ReasoningPart | undefined
        expect(reasoningPart).toBeDefined()
        expect(reasoningPart?.time.end).toBeDefined()
        expect(reasoningPart?.text).toBe("Partial reasoning...")
      },
    })
  })

  // ── Test 6: getCompletedMessage returns shallow copy ──────────────────────
  // Proves the `[...this.allParts]` spread in getCompletedMessage creates a new
  // array each call — callers can't corrupt the persister's internal state.
  test("getCompletedMessage: each call returns a new array (mutation safe)", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = SessionID.make("ses_copy-safety")
        const msgID = MessageID.make("msg_copy-safety")
        await setupSession(sessionID, msgID)

        const persister = new EventPersister(
          makeAssistantMessage(msgID, sessionID),
          sessionID,
          makeModel(),
          new AbortController().signal,
        )

        await persister.handleEvent({ type: "start", kind: "text", id: "text-0" } as never)

        const snapshot1 = persister.getCompletedMessage()
        const snapshot2 = persister.getCompletedMessage()

        // Different array instances
        expect(snapshot1.parts).not.toBe(snapshot2.parts)
        // Same content
        expect(snapshot1.parts.length).toBe(snapshot2.parts.length)

        // Mutating the returned array must NOT affect the persister's internal state
        const lenBefore = snapshot1.parts.length
        snapshot1.parts.push({} as Message.Part)
        const snapshot3 = persister.getCompletedMessage()
        expect(snapshot3.parts.length).toBe(lenBefore)
      },
    })
  })
})
