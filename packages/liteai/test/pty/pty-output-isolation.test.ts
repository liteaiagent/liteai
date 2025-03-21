import { describe, expect, test } from "bun:test"
import { setTimeout as sleep } from "node:timers/promises"
import { Instance } from "../../src/project/instance"
import { Pty } from "../../src/pty"
import { tmpdir } from "../fixture/fixture"

const cat =
  process.platform === "win32" ? { command: "findstr", args: [".*"] } : { command: "cat", args: [] as string[] }

describe("pty", () => {
  test("does not leak output when websocket objects are reused", async () => {
    await using dir = await tmpdir({ git: true })

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        const a = await Pty.create({ ...cat, title: "a" })
        const b = await Pty.create({ ...cat, title: "b" })
        try {
          const outA: string[] = []
          const outB: string[] = []

          const ws: Parameters<typeof Pty.connect>[1] = {
            readyState: 1,
            data: { events: { connection: "a" } },
            send: (data) => {
              outA.push(typeof data === "string" ? data : Buffer.from(data as Uint8Array).toString("utf8"))
            },
            close: () => {
              // no-op (simulate abrupt drop)
            },
          }

          // Connect "a" first with ws.
          Pty.connect(a.id, ws)

          // Now "reuse" the same ws object for another connection.
          ws.data = { events: { connection: "b" } }
          ws.send = (data) => {
            outB.push(typeof data === "string" ? data : Buffer.from(data as Uint8Array).toString("utf8"))
          }
          Pty.connect(b.id, ws)

          // Clear connect metadata writes.
          outA.length = 0
          outB.length = 0

          // Output from a must never show up in b.
          Pty.write(a.id, "AAA\n")
          await sleep(100)

          expect(outB.join("")).not.toContain("AAA")
        } finally {
          await Pty.remove(a.id)
          await Pty.remove(b.id)
        }
      },
    })
  }, 10_000)

  test("does not leak output when Bun recycles websocket objects before re-connect", async () => {
    await using dir = await tmpdir({ git: true })

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        const a = await Pty.create({ ...cat, title: "a" })
        try {
          const outA: string[] = []
          const outB: string[] = []

          const ws: Parameters<typeof Pty.connect>[1] = {
            readyState: 1,
            data: { events: { connection: "a" } },
            send: (data) => {
              outA.push(typeof data === "string" ? data : Buffer.from(data as Uint8Array).toString("utf8"))
            },
            close: () => {
              // no-op (simulate abrupt drop)
            },
          }

          // Connect "a" first.
          Pty.connect(a.id, ws)
          outA.length = 0

          // Simulate Bun reusing the same websocket object for another
          // connection before the next onOpen calls Pty.connect.
          ws.data = { events: { connection: "b" } }
          ws.send = (data) => {
            outB.push(typeof data === "string" ? data : Buffer.from(data as Uint8Array).toString("utf8"))
          }

          Pty.write(a.id, "AAA\n")
          await sleep(100)

          expect(outB.join("")).not.toContain("AAA")
        } finally {
          await Pty.remove(a.id)
        }
      },
    })
  })

  test("treats in-place socket data mutation as the same connection", async () => {
    await using dir = await tmpdir({ git: true })

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        const a = await Pty.create({ ...cat, title: "a" })
        try {
          const out: string[] = []

          const ctx = { connId: 1 }
          const ws: Parameters<typeof Pty.connect>[1] = {
            readyState: 1,
            data: ctx,
            send: (data) => {
              out.push(typeof data === "string" ? data : Buffer.from(data as Uint8Array).toString("utf8"))
            },
            close: () => {
              // no-op
            },
          }

          Pty.connect(a.id, ws)
          out.length = 0

          // Mutating fields on ws.data should not look like a new
          // connection lifecycle when the object identity stays stable.
          ctx.connId = 2

          Pty.write(a.id, "AAA\n")
          await sleep(100)

          expect(out.join("")).toContain("AAA")
        } finally {
          await Pty.remove(a.id)
        }
      },
    })
  })
})
