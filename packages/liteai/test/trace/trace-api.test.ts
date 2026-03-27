import { describe, expect, test } from "bun:test"
import path from "node:path"
import { Hono } from "hono"
import { Instance } from "../../src/project/instance"
import { TraceRoutes } from "../../src/server/routes/trace"
import { Session } from "../../src/session"
import type { Message } from "../../src/session/message"
import { MessageID } from "../../src/session/schema"
import { Trace } from "../../src/trace/trace"
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

function createApp() {
  return new Hono().route("/session", TraceRoutes())
}

// ── T14: GET /session/:id/trace — list traces ─────────────────────────────

describe("Trace API routes", () => {
  test("GET /:sessionID/trace returns TraceInfo[]", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})
        const app = createApp()

        // Record 3 traces
        for (let i = 0; i < 3; i++) {
          const mid = await createMessage(session.id)
          Trace.record({
            sessionID: session.id,
            messageID: mid,
            agent: "build",
            model: { id: "gpt-5", providerID: "openai" },
            system: `System prompt ${i}`,
            tools: [{ name: "read_file" }],
            contextIDs: [mid],
            timeStart: Date.now() - 100,
            timeEnd: Date.now(),
          })
        }

        const res = await app.request(`/session/${session.id}/trace`)
        expect(res.status).toBe(200)

        const body = (await res.json()) as Trace.Info[]
        expect(body.length).toBe(3)

        // Verify Info shape — has summary fields but NOT detail fields
        for (const info of body) {
          expect(info).toHaveProperty("hasSystem")
          expect(info).toHaveProperty("hasTools")
          expect(info).toHaveProperty("contextSize")
          expect(info).toHaveProperty("step")
          expect(info).toHaveProperty("agent")
          // Info should NOT contain the full detail fields
          expect(info).not.toHaveProperty("system")
          expect(info).not.toHaveProperty("tools")
          expect(info).not.toHaveProperty("hooks")
        }

        await Session.remove(session.id)
      },
    })
  })

  // ── T15: GET /session/:id/trace?deep=true ────────────────────────────────

  test("GET /:sessionID/trace?deep=true includes child session traces", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        // Create parent session
        const parent = await Session.create({})
        const mid1 = await createMessage(parent.id)
        Trace.record({
          sessionID: parent.id,
          messageID: mid1,
          agent: "build",
          model: { id: "gpt-5", providerID: "openai" },
          system: "Parent system",
          contextIDs: [mid1],
          timeStart: Date.now() - 200,
          timeEnd: Date.now() - 100,
        })

        // Create child session
        const child = await Session.create({ parentID: parent.id })
        const mid2 = await createMessage(child.id)
        Trace.record({
          sessionID: child.id,
          messageID: mid2,
          agent: "task-agent",
          model: { id: "gpt-5", providerID: "openai" },
          contextIDs: [mid2],
          timeStart: Date.now() - 50,
          timeEnd: Date.now(),
        })

        const app = createApp()

        // Without deep — only parent traces
        const shallow = await app.request(`/session/${parent.id}/trace`)
        const shallowBody = (await shallow.json()) as Trace.Info[]
        expect(shallowBody.length).toBe(1)

        // With deep — includes child traces
        const deep = await app.request(`/session/${parent.id}/trace?deep=true`)
        const deepBody = (await deep.json()) as Trace.Info[]
        expect(deepBody.length).toBe(2)

        await Session.remove(parent.id)
      },
    })
  })

  // ── T16: GET /session/:id/trace/:tid — trace detail ──────────────────────

  test("GET /:sessionID/trace/:traceID returns TraceDetail with resolved system/tools", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})
        const mid = await createMessage(session.id)
        const app = createApp()

        const system = "You are a test assistant."
        const tools = [{ name: "read_file", description: "Read a file from disk" }]

        const { id } = Trace.record({
          sessionID: session.id,
          messageID: mid,
          agent: "build",
          model: { id: "gpt-5", providerID: "openai" },
          system,
          tools,
          contextIDs: [mid],
          timeStart: Date.now() - 100,
          timeEnd: Date.now(),
        })

        const res = await app.request(`/session/${session.id}/trace/${id}`)
        expect(res.status).toBe(200)

        const body = (await res.json()) as Trace.Detail
        expect(body.system).toBe(system)
        expect(body.tools).toEqual(tools)
        expect(body).not.toHaveProperty("messages_json")
        expect(body.contextIDs).toEqual([mid])

        await Session.remove(session.id)
      },
    })
  })

  // ── T17: GET /session/:id/trace/:tid — 404 for missing trace ─────────────

  test("GET /:sessionID/trace/:traceID returns 404 for unknown trace", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})
        const app = createApp()

        const res = await app.request(`/session/${session.id}/trace/trc_nonexistent`)
        expect(res.status).toBe(404)

        await Session.remove(session.id)
      },
    })
  })

  // ── T18: GET /session/:id/trace/search?q= — search ──────────────────────

  test("GET /:sessionID/trace/search?q=TypeScript finds matching traces", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})
        const mid = await createMessage(session.id)
        const app = createApp()

        const { id } = Trace.record({
          sessionID: session.id,
          messageID: mid,
          agent: "build",
          model: { id: "gpt-5", providerID: "openai" },
          system: "You write TypeScript code.",
          contextIDs: [mid],
          timeStart: Date.now(),
          timeEnd: Date.now(),
        })

        const res = await app.request(`/session/${session.id}/trace/search?q=TypeScript`)
        expect(res.status).toBe(200)

        const body = (await res.json()) as { ids: string[] }
        expect(body.ids).toContain(id)

        await Session.remove(session.id)
      },
    })
  })

  // ── T19: GET /session/:id/trace/export — export JSON ─────────────────────

  test("GET /:sessionID/trace/export?format=json returns full trace data", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})
        const mid = await createMessage(session.id)
        const app = createApp()

        Trace.record({
          sessionID: session.id,
          messageID: mid,
          agent: "build",
          model: { id: "gpt-5", providerID: "openai" },
          system: "Export test prompt",
          tools: [{ name: "write", description: "Write a file" }],
          contextIDs: [mid],
          timeStart: Date.now() - 100,
          timeEnd: Date.now(),
        })

        const res = await app.request(`/session/${session.id}/trace/export?format=json`)
        expect(res.status).toBe(200)

        const body = (await res.json()) as Trace.Detail[]
        expect(body.length).toBe(1)
        expect(body[0].system).toBe("Export test prompt")
        expect(body[0].tools).toEqual([{ name: "write", description: "Write a file" }])

        await Session.remove(session.id)
      },
    })
  })

  test("GET /:sessionID/trace/export?format=md returns markdown", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})
        const mid = await createMessage(session.id)
        const app = createApp()

        Trace.record({
          sessionID: session.id,
          messageID: mid,
          agent: "build",
          model: { id: "gpt-5", providerID: "openai" },
          system: "Markdown export test",
          contextIDs: [mid],
          timeStart: Date.now(),
          timeEnd: Date.now(),
        })

        const res = await app.request(`/session/${session.id}/trace/export?format=md`)
        expect(res.status).toBe(200)

        const body = await res.text()
        expect(body).toContain("# Trace")
        expect(body).toContain("Markdown export test")

        await Session.remove(session.id)
      },
    })
  })
})
