import { afterEach, describe, expect, test } from "bun:test"
import { Server } from "../../src/server/server"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

afterEach(async () => {
  await resetDatabase()
})

describe("UI Simulation", () => {
  test("creates a project and fetches files using true project ID (like the updated UI does)", async () => {
    await using tmp = await tmpdir()
    const app = Server.Default()

    // 1. Create a new project with the directory
    const initRes = await app.request(`/project?directory=${encodeURIComponent(tmp.path)}`, {
      method: "POST",
    })
    expect([200, 201]).toContain(initRes.status)
    const project = await initRes.json()

    // 2. Updated UI behavior: navigate using the actual generated `project.id`
    const uiProjectID = project.id

    // 3. GET the project using its true ID exactly like the UI does
    const getRes = await app.request(`/project/${uiProjectID}`, {
      method: "GET",
    })
    expect(getRes.status).toBe(200)

    // 4. Try to list files using the true ID perfectly like the UI does
    const listRes = await app.request(`/project/${uiProjectID}/find/file?query=&type=directory&limit=50`, {
      method: "GET",
    })

    expect(listRes.status).toBe(200)
  })
})
