import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { Brand } from "@/brand"

import {
  applyCoordinatorToolFilter,
  getCoordinatorUserContext,
  isCoordinatorMode,
  matchSessionMode,
} from "../../src/coordinator/coordinator-mode"

describe("Coordinator Mode", () => {
  let originalEnv: Record<string, string | undefined>

  beforeEach(() => {
    originalEnv = { ...process.env }
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  describe("isCoordinatorMode", () => {
    test("respects sessionMode over flag when provided", () => {
      // Flag is true, but session is Normal
      mock.module("@/flag/flag", () => ({
        Flag: { LITEAI_COORDINATOR_MODE: true },
      }))
      expect(isCoordinatorMode("Normal")).toBe(false)

      // Flag is false, but session is Coordinator
      mock.module("@/flag/flag", () => ({
        Flag: { LITEAI_COORDINATOR_MODE: false },
      }))
      expect(isCoordinatorMode("Coordinator")).toBe(true)
    })

    test("falls back to flag when sessionMode is undefined", () => {
      mock.module("@/flag/flag", () => ({
        Flag: { LITEAI_COORDINATOR_MODE: true },
      }))
      expect(isCoordinatorMode(undefined)).toBe(true)
    })
  })

  describe("matchSessionMode", () => {
    test("syncs undefined session mode to flag", () => {
      mock.module("@/flag/flag", () => ({
        Flag: { LITEAI_COORDINATOR_MODE: true },
      }))
      const result = matchSessionMode(undefined)
      expect(result.resolvedMode).toBe("Coordinator")
      expect(result.warning).toBeUndefined()
    })

    test("returns session mode without warning if aligned with flag", () => {
      mock.module("@/flag/flag", () => ({
        Flag: { LITEAI_COORDINATOR_MODE: true },
      }))
      const result = matchSessionMode("Coordinator")
      expect(result.resolvedMode).toBe("Coordinator")
      expect(result.warning).toBeUndefined()
    })

    test("returns warning and syncs env var if drift detected (session=Coordinator, flag=false)", () => {
      mock.module("@/flag/flag", () => ({
        Flag: { LITEAI_COORDINATOR_MODE: false },
      }))
      const result = matchSessionMode("Coordinator")
      expect(result.resolvedMode).toBe("Coordinator")
      expect(result.warning).toContain("Entered coordinator mode")
      expect(process.env[`${Brand.env}COORDINATOR_MODE`]).toBe("true")
    })

    test("returns warning and syncs env var if drift detected (session=Normal, flag=true)", () => {
      mock.module("@/flag/flag", () => ({
        Flag: { LITEAI_COORDINATOR_MODE: true },
      }))
      process.env[`${Brand.env}COORDINATOR_MODE`] = "true"
      const result = matchSessionMode("Normal")
      expect(result.resolvedMode).toBe("Normal")
      expect(result.warning).toContain("Exited coordinator mode")
      expect(process.env[`${Brand.env}COORDINATOR_MODE`]).toBeUndefined()
    })
  })

  describe("applyCoordinatorToolFilter", () => {
    test("strips non-coordinator tools", () => {
      const input = {
        agent: {},
        send_message: {},
        read: {}, // Not allowed
        write: {}, // Not allowed
        team_create: {},
      }

      const filtered = applyCoordinatorToolFilter(input)
      expect(Object.keys(filtered)).toHaveLength(3)
      expect(filtered).toHaveProperty("agent")
      expect(filtered).toHaveProperty("send_message")
      expect(filtered).toHaveProperty("team_create")
      expect(filtered).not.toHaveProperty("read")
    })
  })

  describe("getCoordinatorUserContext", () => {
    test("returns empty if not coordinator mode", () => {
      const result = getCoordinatorUserContext("Normal", [])
      expect(result).toEqual({})
    })

    test("returns worker context if coordinator mode", () => {
      const result = getCoordinatorUserContext("Coordinator", [])
      expect(result.workerToolsContext).toContain("Workers spawned via the agent tool")
    })

    test("includes MCP servers if present", () => {
      const result = getCoordinatorUserContext("Coordinator", [{ name: "github" }, { name: "postgres" }])
      expect(result.workerToolsContext).toContain("github, postgres")
    })
  })
})
