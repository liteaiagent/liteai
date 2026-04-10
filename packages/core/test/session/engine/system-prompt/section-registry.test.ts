import { describe, expect, it } from "bun:test"
import { SectionRegistry } from "../../../../src/session/engine/section-registry"

describe("SectionRegistry", () => {
  it("should be defined", () => {
    expect(SectionRegistry).toBeDefined()
  })
})
