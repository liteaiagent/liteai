import { afterEach, describe, expect, spyOn, test } from "bun:test"
import path from "node:path"
import { GlobalBus } from "../../src/bus/global"
import { InstanceBootstrap } from "../../src/project/bootstrap"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Snapshot } from "../../src/snapshot"
import { Filesystem } from "../../src/util/filesystem"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

afterEach(async () => {
  await resetDatabase()
})

describe("project.initGit endpoint", () => {
  test(
    "initializes git and reloads immediately",
    async () => {
      await using tmp = await tmpdir()
      const app = Server.Default()
      const seen: { directory?: string; payload: unknown }[] = []
      const fn = (evt: { directory?: string; payload: unknown }) => {
        seen.push(evt)
      }
      const reload = Instance.reload
      const reloadSpy = spyOn(Instance, "reload").mockImplementation((input) => reload(input))
      GlobalBus.on("event", fn)

      try {
        const init = await app.request("/project/git/init", {
          method: "POST",
          headers: {
            "x-liteai-directory": tmp.path,
          },
        })
        const body = await init.json()
        expect(init.status).toBe(200)
        expect(body).toMatchObject({
          vcs: "git",
          worktree: tmp.path,
        })
        expect(body.id).toBeString()
        expect(reloadSpy).toHaveBeenCalledTimes(1)
        expect(reloadSpy.mock.calls[0]?.[0]?.init).toBe(InstanceBootstrap)
        expect(
          seen.some(
            (evt) =>
              evt.directory === tmp.path && (evt.payload as { type?: string })?.type === "server.instance.disposed",
          ),
        ).toBe(true)
        expect(await Filesystem.exists(path.join(tmp.path, ".git", "liteai"))).toBe(false)

        const current = await app.request(`/project/${body.id}`, {})
        expect(current.status).toBe(200)
        expect(await current.json()).toMatchObject({
          vcs: "git",
          worktree: tmp.path,
        })

        await Instance.provide({
          directory: tmp.path,
          fn: async () => {
            expect(await Snapshot.track()).toBeTruthy()
          },
        })
      } finally {
        reloadSpy.mockRestore()
        GlobalBus.off("event", fn)
      }
    },
    { timeout: 30_000 },
  )

  test("does not reload when the project is already git", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = Server.Default()
    const seen: { directory?: string; payload: unknown }[] = []
    const fn = (evt: { directory?: string; payload: unknown }) => {
      seen.push(evt)
    }
    const reload = Instance.reload
    const reloadSpy = spyOn(Instance, "reload").mockImplementation((input) => reload(input))
    GlobalBus.on("event", fn)

    try {
      const init = await app.request("/project/git/init", {
        method: "POST",
        headers: {
          "x-liteai-directory": tmp.path,
        },
      })
      expect(init.status).toBe(200)
      const body = await init.json()
      expect(body).toMatchObject({
        vcs: "git",
        worktree: tmp.path,
      })
      expect(
        seen.filter(
          (evt) =>
            evt.directory === tmp.path && (evt.payload as { type?: string })?.type === "server.instance.disposed",
        ).length,
      ).toBe(0)
      expect(reloadSpy).toHaveBeenCalledTimes(0)

      const current = await app.request(`/project/${body.id}`, {})
      expect(current.status).toBe(200)
      expect(await current.json()).toMatchObject({
        vcs: "git",
        worktree: tmp.path,
      })
    } finally {
      reloadSpy.mockRestore()
      GlobalBus.off("event", fn)
    }
  })
})
