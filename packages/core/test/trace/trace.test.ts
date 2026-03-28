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

/** Helper: create a minimal assistant message for FK constraints */
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

// ── T1: record() writes trace + content-addressable system/tools ────────────

describe("Trace.record()", () => {
  test("writes trace and content-addressable system/tools", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})
        const mid = await createMessage(session.id)

        const { id, step } = Trace.record({
          sessionID: session.id,
          messageID: mid,
          agent: "build",
          model: { id: "gpt-5", providerID: "openai" },
          system: "You are a helpful assistant.",
          tools: [{ name: "read_file", description: "Reads a file" }],
          contextIDs: [mid],
          timeStart: Date.now() - 1000,
          timeEnd: Date.now(),
        })

        expect(id).toBeDefined()
        expect(step).toBe(1) // first step in session

        // Verify trace_content has entries for this trace's system + tools
        const systemHash = createHash("sha256").update("You are a helpful assistant.").digest("hex")
        const toolsHash = createHash("sha256")
          .update(JSON.stringify([{ name: "read_file", description: "Reads a file" }]))
          .digest("hex")

        const systemRow = Database.use((db) =>
          db.select().from(TraceContentTable).where(eq(TraceContentTable.hash, systemHash)).get(),
        )
        expect(systemRow).toBeDefined()
        expect(systemRow?.type).toBe("system")
        expect(systemRow?.content).toBe("You are a helpful assistant.")

        const toolsRow = Database.use((db) =>
          db.select().from(TraceContentTable).where(eq(TraceContentTable.hash, toolsHash)).get(),
        )
        expect(toolsRow).toBeDefined()
        expect(toolsRow?.type).toBe("tools")

        await Session.remove(session.id)
      },
    })
  })

  // ── T2: Subtask trace — no system/tools ─────────────────────────────────

  test("subtask trace with null system and tools", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})
        const mid = await createMessage(session.id)

        const { step, id } = Trace.record({
          sessionID: session.id,
          messageID: mid,
          agent: "task-agent",
          model: { id: "gpt-5", providerID: "openai" },
          contextIDs: [mid],
          timeStart: Date.now() - 500,
          timeEnd: Date.now(),
        })

        expect(step).toBe(1)

        // Verify the trace row itself has null hashes (no content written for this trace)
        const detail = Trace.get(session.id, id)
        expect(detail).toBeDefined()
        expect(detail?.system).toBeNull()
        expect(detail?.tools).toBeNull()

        await Session.remove(session.id)
      },
    })
  })

  // ── T3: Content deduplication ────────────────────────────────────────────

  test("same system prompt across steps stored once in trace_content", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})
        const prompt = "You are a coding assistant uniqueDedup12345."

        // Compute expected hash
        const expectedHash = createHash("sha256").update(prompt).digest("hex")

        for (let i = 0; i < 3; i++) {
          const mid = await createMessage(session.id)
          Trace.record({
            sessionID: session.id,
            messageID: mid,
            agent: "build",
            model: { id: "gpt-5", providerID: "openai" },
            system: prompt,
            contextIDs: [mid],
            timeStart: Date.now() - 100,
            timeEnd: Date.now(),
          })
        }

        // Query for the specific hash to avoid cross-test pollution
        const content = Database.use((db) =>
          db.select().from(TraceContentTable).where(eq(TraceContentTable.hash, expectedHash)).all(),
        )
        expect(content.length).toBe(1) // Only ONE row despite 3 traces

        await Session.remove(session.id)
      },
    })
  })

  // ── T4: Step counter increments ──────────────────────────────────────────

  test("step counter increments per trace in same session", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})
        const steps: number[] = []

        for (let i = 0; i < 4; i++) {
          const mid = await createMessage(session.id)
          const { step } = Trace.record({
            sessionID: session.id,
            messageID: mid,
            agent: "build",
            model: { id: "gpt-5", providerID: "openai" },
            contextIDs: [mid],
            timeStart: Date.now(),
            timeEnd: Date.now(),
          })
          steps.push(step)
        }

        expect(steps).toEqual([1, 2, 3, 4])
        await Session.remove(session.id)
      },
    })
  })

  // ── T5: Hash determinism ─────────────────────────────────────────────────

  test("hash is deterministic for identical content", () => {
    const a = createHash("sha256").update("hello").digest("hex")
    const b = createHash("sha256").update("hello").digest("hex")
    expect(a).toBe(b)

    // Different content → different hashes
    const c = createHash("sha256").update("world").digest("hex")
    expect(a).not.toBe(c)
  })

  // ── T9: Error traces ────────────────────────────────────────────────────

  test("record includes error field", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})
        const mid = await createMessage(session.id)

        const { id } = Trace.record({
          sessionID: session.id,
          messageID: mid,
          agent: "build",
          model: { id: "gpt-5", providerID: "openai" },
          system: "prompt",
          contextIDs: [mid],
          timeStart: Date.now(),
          timeEnd: Date.now(),
          error: "context_length_exceeded",
        })

        const detail = Trace.get(session.id, id)
        expect(detail?.error).toBe("context_length_exceeded")

        await Session.remove(session.id)
      },
    })
  })

  // ── T10: Hooks preservation ──────────────────────────────────────────────

  test("record stores hooks_json correctly", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})
        const mid = await createMessage(session.id)

        const hooks = [
          {
            event: "before-prompt",
            type: "url",
            config: { url: "https://example.com" },
          },
        ]
        const { id } = Trace.record({
          sessionID: session.id,
          messageID: mid,
          agent: "build",
          model: { id: "gpt-5", providerID: "openai" },
          contextIDs: [mid],
          hooks: hooks as Parameters<typeof Trace.record>[0]["hooks"],
          timeStart: Date.now(),
          timeEnd: Date.now(),
        })

        const detail = Trace.get(session.id, id)
        expect(detail?.hooks?.length).toBe(1)
        expect((detail?.hooks?.[0] as Record<string, unknown>)?.event).toBe("before-prompt")

        await Session.remove(session.id)
      },
    })
  })
})

// ── T6: Trace.get() resolves from content-addressable store ───────────────

describe("Trace.get()", () => {
  test("returns full system/tools via hash lookup", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})
        const mid = await createMessage(session.id)

        const system = "You are an AI coding assistant."
        const tools = [{ name: "bash", description: "Run a shell command" }]

        const { id } = Trace.record({
          sessionID: session.id,
          messageID: mid,
          agent: "build",
          model: { id: "gpt-5", providerID: "openai" },
          system,
          tools,
          contextIDs: [mid],
          timeStart: Date.now(),
          timeEnd: Date.now(),
        })

        const detail = Trace.get(session.id, id)
        expect(detail).toBeDefined()
        expect(detail?.system).toBe(system)
        expect(detail?.tools).toEqual(tools)

        await Session.remove(session.id)
      },
    })
  })

  test("returns undefined for missing trace", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})
        const detail = Trace.get(session.id, "trace_nonexistent" as Parameters<typeof Trace.get>[1])
        expect(detail).toBeUndefined()
        await Session.remove(session.id)
      },
    })
  })
})

// ── T7: Trace.list() returns correct info flags ──────────────────────────

describe("Trace.list()", () => {
  test("returns hasSystem/hasTools based on hash presence", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})

        // Trace with system + tools
        const mid1 = await createMessage(session.id)
        Trace.record({
          sessionID: session.id,
          messageID: mid1,
          agent: "build",
          model: { id: "gpt-5", providerID: "openai" },
          system: "prompt",
          tools: [{ name: "bash" }],
          contextIDs: [mid1],
          timeStart: Date.now(),
          timeEnd: Date.now(),
        })

        // Trace without system/tools (subtask)
        const mid2 = await createMessage(session.id)
        Trace.record({
          sessionID: session.id,
          messageID: mid2,
          agent: "task-agent",
          model: { id: "gpt-5", providerID: "openai" },
          contextIDs: [mid2],
          timeStart: Date.now(),
          timeEnd: Date.now(),
        })

        const items = Trace.list(session.id)
        expect(items.length).toBe(2)
        expect(items[0].hasSystem).toBe(true)
        expect(items[0].hasTools).toBe(true)
        expect(items[1].hasSystem).toBe(false)
        expect(items[1].hasTools).toBe(false)

        await Session.remove(session.id)
      },
    })
  })
})

// ── T8: Trace.search() searches content-addressable store ─────────────────

describe("Trace.search()", () => {
  test("finds traces by system prompt content", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})
        const mid = await createMessage(session.id)

        const { id } = Trace.record({
          sessionID: session.id,
          messageID: mid,
          agent: "build",
          model: { id: "gpt-5", providerID: "openai" },
          system: "You are a coding assistant that writes TypeScript.",
          contextIDs: [mid],
          timeStart: Date.now(),
          timeEnd: Date.now(),
        })

        const results = Trace.search(session.id, "TypeScript")
        expect(results).toContain(id)

        await Session.remove(session.id)
      },
    })
  })

  test("returns empty array when no match", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})
        const mid = await createMessage(session.id)

        Trace.record({
          sessionID: session.id,
          messageID: mid,
          agent: "build",
          model: { id: "gpt-5", providerID: "openai" },
          system: "You are a coding assistant.",
          contextIDs: [mid],
          timeStart: Date.now(),
          timeEnd: Date.now(),
        })

        const results = Trace.search(session.id, "xyznonexistent")
        expect(results.length).toBe(0)

        await Session.remove(session.id)
      },
    })
  })
})

// ── T11: messages_json no longer returned ─────────────────────────────────

describe("Trace.Detail shape", () => {
  test("does not include messages_json", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})
        const mid = await createMessage(session.id)

        const { id } = Trace.record({
          sessionID: session.id,
          messageID: mid,
          agent: "build",
          model: { id: "gpt-5", providerID: "openai" },
          system: "prompt",
          contextIDs: [mid],
          timeStart: Date.now(),
          timeEnd: Date.now(),
        })

        const detail = Trace.get(session.id, id)
        expect(detail).toBeDefined()
        expect("messages_json" in (detail as Record<string, unknown>)).toBe(false)

        await Session.remove(session.id)
      },
    })
  })
})
