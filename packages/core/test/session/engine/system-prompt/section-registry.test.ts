import { describe, expect, it } from "bun:test"
import {
  DuplicateSectionError,
  InvalidVolatileReasonError,
  type ParsedSection,
  SectionRegistry,
  UnknownSectionError,
} from "../../../../src/session/engine/section-registry"

describe("SectionRegistry", () => {
  // Clear registry before tests to avoid global state bleed. Map.clear() or clearAll() if we implement a fully isolated testing hook, but since entries is static and private, the class needs to expose clearAll to actually clear keys.
  // Actually, wait, clearAll() only clears 'cached' field, it doesn't remove entries!
  // Oh, wait, the spec says "clearAll(): iterate all static entries and delete their cached field". Not delete from the Map.
  // So to prevent state bleed with "DuplicateSectionError", tests must use different names.

  // Wait, I will use dynamically generated names to avoid duplication across tests since entries persists.
  let testId = 0
  const getDummySection = (scope: "static" | "volatile"): ParsedSection => {
    testId++
    return {
      name: `test-${scope}-${testId}`,
      scope,
      providers: "all",
      content: "content",
      order: testId,
    }
  }

  it("should resolve a static section and hit cache on second call", async () => {
    const dummySection = getDummySection("static")
    let callCount = 0
    SectionRegistry.register(dummySection, async () => {
      callCount++
      return "computed-static"
    })

    const result1 = await SectionRegistry.resolve(dummySection.name)
    expect(result1).toBe("computed-static")
    expect(callCount).toBe(1)

    const result2 = await SectionRegistry.resolve(dummySection.name)
    expect(result2).toBe("computed-static")
    expect(callCount).toBe(1) // Cache hit!
  })

  it("should always recompute volatile sections", async () => {
    const dummyVolatile = getDummySection("volatile")
    let callCount = 0
    SectionRegistry.DANGEROUS_uncachedSystemPromptSection(
      dummyVolatile,
      async () => {
        callCount++
        return `computed-volatile-${callCount}`
      },
      "because volatile",
    )

    const result1 = await SectionRegistry.resolve(dummyVolatile.name)
    expect(result1).toBe("computed-volatile-1")
    expect(callCount).toBe(1)

    const result2 = await SectionRegistry.resolve(dummyVolatile.name)
    expect(result2).toBe("computed-volatile-2")
    expect(callCount).toBe(2) // No cache hit!
  })

  it("should reset cache on clearAll()", async () => {
    const dummySection = getDummySection("static")
    let callCount = 0
    SectionRegistry.register(dummySection, async () => {
      callCount++
      return "computed-static"
    })

    await SectionRegistry.resolve(dummySection.name)
    expect(callCount).toBe(1)

    SectionRegistry.clearAll() // Clears the cached field!

    await SectionRegistry.resolve(dummySection.name)
    expect(callCount).toBe(2) // Cache cleared, recomputed
  })

  it("should throw DuplicateSectionError on re-registration", () => {
    const dummySection = getDummySection("static")
    SectionRegistry.register(dummySection, async () => "content")
    expect(() => {
      SectionRegistry.register(dummySection, async () => "content2")
    }).toThrow(DuplicateSectionError)
  })

  it("should throw InvalidVolatileReasonError on empty reason", () => {
    const dummyVolatile = getDummySection("volatile")
    expect(() => {
      SectionRegistry.DANGEROUS_uncachedSystemPromptSection(dummyVolatile, async () => "v", "")
    }).toThrow(InvalidVolatileReasonError)

    const dummyVolatile2 = getDummySection("volatile")
    expect(() => {
      SectionRegistry.DANGEROUS_uncachedSystemPromptSection(dummyVolatile2, async () => "v", "   ")
    }).toThrow(InvalidVolatileReasonError)
  })

  it("should throw UnknownSectionError on unknown name", async () => {
    expect(SectionRegistry.resolve("missing-xyz")).rejects.toThrow(UnknownSectionError)
  })

  it("should list all sections correctly", () => {
    const prevCount = SectionRegistry.all().length
    const dummySection = getDummySection("static")
    SectionRegistry.register(dummySection, async () => "content")
    expect(SectionRegistry.all().length).toBe(prevCount + 1)
  })
})
