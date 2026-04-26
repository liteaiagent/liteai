import { describe, expect, test } from "bun:test"
import path from "node:path"
import { Log } from "@liteai/util/log"
import { Instance } from "../../src/project/instance"
import { Project } from "../../src/project/project"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import type { Message } from "../../src/session/message"
import { MessageID, PartID, type SessionID } from "../../src/session/schema"

const root = path.join(__dirname, "../..")
Log.init({ dir: require("node:os").tmpdir(), print: false })

async function fill(sessionID: SessionID, count: number, time = (i: number) => Date.now() + i) {
  const ids = [] as MessageID[]
  for (let i = 0; i < count; i++) {
    const id = MessageID.ascending()
    ids.push(id)
    await Session.updateMessage({
      id,
      sessionID,
      role: "user",
      time: { created: time(i) },
      agent: "test",
      model: { providerID: "test", modelID: "test" },
      tools: {},
      mode: "",
    } as unknown as Message.Info)
    await Session.updatePart({
      id: PartID.ascending(),
      sessionID,
      messageID: id,
      type: "text",
      text: `m${i}`,
    })
  }
  return ids
}

describe("session messages endpoint", () => {
  test("returns cursor headers for older pages", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const session = await Session.create({})
        const resolved = await Project.resolve(root)
        const ids = await fill(session.id, 5)
        const app = Server.Default()

        const a = await app.request(`/project/${resolved.id}/session/${session.id}/message?limit=2`)
        if (a.status !== 200) console.error(await a.text())
        expect(a.status).toBe(200)
        const aBody = (await a.json()) as Message.WithParts[]
        expect(aBody.map((item) => item.info.id)).toEqual(ids.slice(-2))
        const cursor = a.headers.get("x-next-cursor")
        expect(cursor).toBeTruthy()
        if (!cursor) throw new Error("expected cursor")
        expect(a.headers.get("link")).toContain('rel="next"')

        const b = await app.request(
          `/project/${resolved.id}/session/${session.id}/message?limit=2&before=${encodeURIComponent(cursor)}`,
        )
        expect(b.status).toBe(200)
        const bBody = (await b.json()) as Message.WithParts[]
        expect(bBody.map((item) => item.info.id)).toEqual(ids.slice(-4, -2))

        await Session.remove(session.id)
      },
    })
  })

  test("keeps full-history responses when limit is omitted", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const session = await Session.create({})
        const resolved = await Project.resolve(root)
        const ids = await fill(session.id, 3)
        const app = Server.Default()

        const res = await app.request(`/project/${resolved.id}/session/${session.id}/message`)
        expect(res.status).toBe(200)
        const body = (await res.json()) as Message.WithParts[]
        expect(body.map((item) => item.info.id)).toEqual(ids)

        await Session.remove(session.id)
      },
    })
  })

  test("rejects invalid cursors and missing sessions", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const session = await Session.create({})
        const resolved = await Project.resolve(root)
        const app = Server.Default()

        const bad = await app.request(`/project/${resolved.id}/session/${session.id}/message?limit=2&before=bad`)
        expect(bad.status).toBe(400)

        const miss = await app.request(`/project/${resolved.id}/session/ses_missing/message?limit=2`)
        expect(miss.status).toBe(404)

        await Session.remove(session.id)
      },
    })
  })

  test("does not truncate large legacy limit requests", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const session = await Session.create({})
        const resolved = await Project.resolve(root)
        await fill(session.id, 520)
        const app = Server.Default()

        const res = await app.request(`/project/${resolved.id}/session/${session.id}/message?limit=510`)
        expect(res.status).toBe(200)
        const body = (await res.json()) as Message.WithParts[]
        expect(body).toHaveLength(510)

        await Session.remove(session.id)
      },
    })
  })
})
