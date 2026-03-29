import { beforeEach, describe, expect, test } from "bun:test"
import type { PermissionRequest, Project, Session } from "@liteai/sdk/client"
import { __updateProjectRegistry } from "@/utils/project-id"
import { autoRespondsPermission, isDirectoryAutoAccepting } from "./permission-auto-respond"

const DIRECTORY = "/tmp/project"
const PROJECT_ID = "test-project-id"

beforeEach(() => {
  __updateProjectRegistry([{ id: PROJECT_ID, worktree: DIRECTORY } as Project])
})

const session = (input: { id: string; parentID?: string }) =>
  ({
    id: input.id,
    parentID: input.parentID,
  }) as Session

const permission = (sessionID: string) =>
  ({
    sessionID,
  }) as Pick<PermissionRequest, "sessionID">

describe("autoRespondsPermission", () => {
  test("uses a parent session's directory-scoped auto-accept", () => {
    const sessions = [session({ id: "root" }), session({ id: "child", parentID: "root" })]
    const autoAccept = {
      [`${PROJECT_ID}/root`]: true,
    }

    expect(autoRespondsPermission(autoAccept, sessions, permission("child"), DIRECTORY)).toBe(true)
  })

  test("uses a parent session's legacy auto-accept key", () => {
    const sessions = [session({ id: "root" }), session({ id: "child", parentID: "root" })]

    expect(autoRespondsPermission({ root: true }, sessions, permission("child"), DIRECTORY)).toBe(true)
  })

  test("defaults to requiring approval when no lineage override exists", () => {
    const sessions = [session({ id: "root" }), session({ id: "child", parentID: "root" }), session({ id: "other" })]
    const autoAccept = {
      other: true,
    }

    expect(autoRespondsPermission(autoAccept, sessions, permission("child"), DIRECTORY)).toBe(false)
  })

  test("inherits a parent session's false override", () => {
    const sessions = [session({ id: "root" }), session({ id: "child", parentID: "root" })]
    const autoAccept = {
      [`${PROJECT_ID}/root`]: false,
    }

    expect(autoRespondsPermission(autoAccept, sessions, permission("child"), DIRECTORY)).toBe(false)
  })

  test("prefers a child override over parent override", () => {
    const sessions = [session({ id: "root" }), session({ id: "child", parentID: "root" })]
    const autoAccept = {
      [`${PROJECT_ID}/root`]: false,
      [`${PROJECT_ID}/child`]: true,
    }

    expect(autoRespondsPermission(autoAccept, sessions, permission("child"), DIRECTORY)).toBe(true)
  })

  test("falls back to directory-level auto-accept", () => {
    const sessions = [session({ id: "root" })]
    const autoAccept = {
      [`${PROJECT_ID}/*`]: true,
    }

    expect(autoRespondsPermission(autoAccept, sessions, permission("root"), DIRECTORY)).toBe(true)
  })

  test("session-level override takes precedence over directory-level", () => {
    const sessions = [session({ id: "root" })]
    const autoAccept = {
      [`${PROJECT_ID}/*`]: true,
      [`${PROJECT_ID}/root`]: false,
    }

    expect(autoRespondsPermission(autoAccept, sessions, permission("root"), DIRECTORY)).toBe(false)
  })
})

describe("isDirectoryAutoAccepting", () => {
  test("returns true when directory key is set", () => {
    const autoAccept = { [`${PROJECT_ID}/*`]: true }
    expect(isDirectoryAutoAccepting(autoAccept, DIRECTORY)).toBe(true)
  })

  test("returns false when directory key is not set", () => {
    expect(isDirectoryAutoAccepting({}, DIRECTORY)).toBe(false)
  })

  test("returns false when directory key is explicitly false", () => {
    const autoAccept = { [`${PROJECT_ID}/*`]: false }
    expect(isDirectoryAutoAccepting(autoAccept, DIRECTORY)).toBe(false)
  })
})
