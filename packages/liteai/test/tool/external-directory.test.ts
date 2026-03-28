import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { PermissionNext } from "../../src/permission/next"
import { Instance } from "../../src/project/instance"
import { Project } from "../../src/project/project"
import { MessageID, SessionID } from "../../src/session/schema"
import { assertExternalDirectory } from "../../src/tool/external-directory"
import type { Tool } from "../../src/tool/tool"

const baseCtx: Omit<Tool.Context, "ask"> = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make(""),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
}

let tmpBase = ""
let tmpDir = ""
let tmpProject = ""
let tmpOutside = ""

beforeAll(async () => {
  tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "liteai-ext-"))
  tmpDir = path.join(tmpBase, "tmp")
  tmpProject = path.join(tmpDir, "project")
  tmpOutside = path.join(tmpDir, "outside")
  fs.mkdirSync(tmpProject, { recursive: true })
  fs.mkdirSync(tmpOutside, { recursive: true })
  await Project.fromDirectory(tmpDir)
  await Project.fromDirectory(tmpProject)
})

afterAll(() => {
  fs.rmSync(tmpBase, { recursive: true, force: true })
})

describe("tool.assertExternalDirectory", () => {
  test("no-ops for empty target", async () => {
    const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
    const ctx: Tool.Context = {
      ...baseCtx,
      ask: async (req) => {
        requests.push(req)
      },
    }

    await Instance.provide({
      directory: tmpDir,
      fn: async () => {
        await assertExternalDirectory(ctx)
      },
    })

    expect(requests.length).toBe(0)
  })

  test("no-ops for paths inside Instance.directory", async () => {
    const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
    const ctx: Tool.Context = {
      ...baseCtx,
      ask: async (req) => {
        requests.push(req)
      },
    }

    await Instance.provide({
      directory: tmpProject,
      fn: async () => {
        await assertExternalDirectory(ctx, path.join(tmpProject, "file.txt"))
      },
    })

    expect(requests.length).toBe(0)
  })

  test("asks with a single canonical glob", async () => {
    const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
    const ctx: Tool.Context = {
      ...baseCtx,
      ask: async (req) => {
        requests.push(req)
      },
    }

    const directory = tmpProject
    const target = path.join(tmpOutside, "file.txt")
    const expected = path.join(path.dirname(target), "*").replaceAll("\\", "/")

    await Instance.provide({
      directory,
      fn: async () => {
        await assertExternalDirectory(ctx, target)
      },
    })

    const req = requests.find((r) => r.permission === "external_directory")
    expect(req).toBeDefined()
    expect(req?.patterns).toEqual([expected])
    expect(req?.always).toEqual([expected])
  })

  test("uses target directory when kind=directory", async () => {
    const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
    const ctx: Tool.Context = {
      ...baseCtx,
      ask: async (req) => {
        requests.push(req)
      },
    }

    const directory = tmpProject
    const target = tmpOutside
    const expected = path.join(target, "*").replaceAll("\\", "/")

    await Instance.provide({
      directory,
      fn: async () => {
        await assertExternalDirectory(ctx, target, { kind: "directory" })
      },
    })

    const req = requests.find((r) => r.permission === "external_directory")
    expect(req).toBeDefined()
    expect(req?.patterns).toEqual([expected])
    expect(req?.always).toEqual([expected])
  })

  test("skips prompting when bypass=true", async () => {
    const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
    const ctx: Tool.Context = {
      ...baseCtx,
      ask: async (req) => {
        requests.push(req)
      },
    }

    await Instance.provide({
      directory: tmpProject,
      fn: async () => {
        await assertExternalDirectory(ctx, path.join(tmpOutside, "file.txt"), { bypass: true })
      },
    })

    expect(requests.length).toBe(0)
  })
})
