import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import path from "node:path"
import { eq } from "drizzle-orm"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import type { Message } from "../../src/session/message"
import { MessageID } from "../../src/session/schema"
import { Database } from "../../src/storage/db"
import { Trace } from "../../src/trace/trace"
import { TraceContentTable } from "../../src/trace/trace-content.sql"
import { Log } from "../../src/util/log"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

/** Helper: create a minimal message for FK constraints */
async function createMessage(sessionID: string) {
  const mid = MessageID.ascending()
  await Session.updateMessage({
    id: mid,
    sessionID,
    role: "user",
    time: { created: Date.now() },
    agent: "user",
    model: { providerID: "test", modelID: "test" },
    tools: {},
    mode: "",
  } as unknown as Message.Info)
  return mid
}

// ── T12: Upsert idempotency ─────────────────────────────────────────────

describe("trace_content store", () => {
  test("upsertContent is idempotent — same hash does not error", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})
        const systemPrompt = "Idempotency test prompt."

        // Record twice with the exact same system prompt
        const mid1 = await createMessage(session.id)
        Trace.record({
          sessionID: session.id,
          messageID: mid1,
          agent: "build",
          model: { id: "gpt-5", providerID: "openai" },
          system: systemPrompt,
          contextIDs: [mid1],
          timeStart: Date.now(),
          timeEnd: Date.now(),
        })

        const mid2 = await createMessage(session.id)
        // This should NOT throw — upsert is idempotent
        expect(() =>
          Trace.record({
            sessionID: session.id,
            messageID: mid2,
            agent: "build",
            model: { id: "gpt-5", providerID: "openai" },
            system: systemPrompt,
            contextIDs: [mid2],
            timeStart: Date.now(),
            timeEnd: Date.now(),
          }),
        ).not.toThrow()

        // Query for the specific hash to avoid cross-test pollution
        const expectedHash = createHash("sha256").update(systemPrompt).digest("hex")
        const rows = Database.use((db) =>
          db.select().from(TraceContentTable).where(eq(TraceContentTable.hash, expectedHash)).all(),
        )
        expect(rows.length).toBe(1)

        await Session.remove(session.id)
      },
    })
  })

  // ── T13: Different content produces different hashes ─────────────────────

  test("different content produces different hashes", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})

        const mid1 = await createMessage(session.id)
        Trace.record({
          sessionID: session.id,
          messageID: mid1,
          agent: "build",
          model: { id: "gpt-5", providerID: "openai" },
          system: "System prompt alpha",
          contextIDs: [mid1],
          timeStart: Date.now(),
          timeEnd: Date.now(),
        })

        const mid2 = await createMessage(session.id)
        Trace.record({
          sessionID: session.id,
          messageID: mid2,
          agent: "build",
          model: { id: "gpt-5", providerID: "openai" },
          system: "System prompt beta",
          contextIDs: [mid2],
          timeStart: Date.now(),
          timeEnd: Date.now(),
        })

        const expectedAlpha = createHash("sha256").update("System prompt alpha").digest("hex")
        const expectedBeta = createHash("sha256").update("System prompt beta").digest("hex")

        const alphaRows = Database.use((db) =>
          db.select().from(TraceContentTable).where(eq(TraceContentTable.hash, expectedAlpha)).all(),
        )
        expect(alphaRows.length).toBe(1)

        const betaRows = Database.use((db) =>
          db.select().from(TraceContentTable).where(eq(TraceContentTable.hash, expectedBeta)).all(),
        )
        expect(betaRows.length).toBe(1)

        expect(expectedAlpha).not.toBe(expectedBeta)

        await Session.remove(session.id)
      },
    })
  })
})
