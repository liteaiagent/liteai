import { afterEach, describe, expect, test } from "bun:test"
import { GlobalBus } from "../../src/bus/global"
import { parseSSE } from "../../src/control-plane/sse"
import { WorkspaceServer } from "../../src/control-plane/workspace-server/server"
import { Instance } from "../../src/project/instance"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await resetDatabase()
}, 10_000)

Log.init({ print: false })

describe("control-plane/workspace-server SSE", () => {
  test("streams GlobalBus events and parseSSE reads them", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = WorkspaceServer.App()
    const stop = new AbortController()
    const seen: unknown[] = []
    try {
      const response = await app.request("/event", {
        signal: stop.signal,
        headers: {
          "x-liteai-workspace": "wrk_test_workspace",
          "x-liteai-directory": tmp.path,
        },
      })

      expect(response.status).toBe(200)
      expect(response.body).toBeDefined()

      if (!response.body) throw new Error("expected response body")
      const body = response.body
      const done = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("timed out waiting for workspace.test event"))
        }, 10_000)

        void parseSSE(body, stop.signal, (event) => {
          seen.push(event)
          const next = event as { type?: string }
          if (next.type === "server.connected") {
            GlobalBus.emit("event", {
              payload: {
                type: "workspace.test",
                properties: { ok: true },
              },
            })
            return
          }
          if (next.type !== "workspace.test") return
          clearTimeout(timeout)
          resolve()
        }).catch((error) => {
          clearTimeout(timeout)
          reject(error)
        })
      })

      await done

      expect(seen.some((event) => (event as { type?: string }).type === "server.connected")).toBe(true)
      expect(seen).toContainEqual({
        type: "workspace.test",
        properties: { ok: true },
      })
    } finally {
      stop.abort()
      // Dispose instances before await-using cleans up the temp dir,
      // so background processes (ripgrep, file watcher) stop first.
      await Instance.disposeAll()
    }
  }, 15_000)
})
