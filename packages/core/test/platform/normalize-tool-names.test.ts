import { expect, test } from "bun:test"
import { normalizeToolNames } from "../../src/platform/profile"

test("normalizeToolNames", () => {
  const map = {
    Edit: "edit",
    Write: "write",
    ExitPlanMode: "plan_exit",
  }

  // Array of strings
  expect(normalizeToolNames(["Edit", "Write", "UnknownTool", "ExitPlanMode"], map)).toEqual([
    "edit",
    "write",
    "UnknownTool",
    "plan_exit",
  ])

  // Comma-separated string
  expect(normalizeToolNames("Edit, UnknownTool, ExitPlanMode", map)).toEqual(["edit", "UnknownTool", "plan_exit"])

  expect(normalizeToolNames({ Edit: true, Write: false, UnknownTool: true } as Record<string, boolean>, map)).toEqual({
    edit: true,
    write: false,
    UnknownTool: true,
  })

  // Undefined map
  expect(normalizeToolNames(["Edit"], undefined)).toEqual(["Edit"])

  // No-op for falsy
  expect(normalizeToolNames(undefined as unknown as string, map)).toBeUndefined()
  expect(normalizeToolNames(null as unknown as string, map)).toBeNull()
})

test("normalizeToolNames detects key collision after normalization (last-write-wins)", () => {
  const map = {
    Edit: "edit",
  }

  // Both "Edit" (mapped) and "edit" (passthrough) normalize to "edit".
  // Object.entries iterates in insertion order, so "Edit" → true is set first,
  // then "edit" → false overwrites it. The function should warn and apply last-write-wins.
  const result = normalizeToolNames({ Edit: true, edit: false } as Record<string, boolean>, map)
  expect(result).toEqual({ edit: false })
})
