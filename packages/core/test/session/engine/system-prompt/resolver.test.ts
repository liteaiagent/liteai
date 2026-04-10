import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import type { Provider } from "../../../../src/provider/provider"
import { SectionRegistry } from "../../../../src/session/engine/section-registry"
import { SystemPrompt } from "../../../../src/session/engine/system"

describe("System Prompt Resolver", () => {
  const originalEnvironment = SystemPrompt.environment

  beforeEach(() => {
    // Mock environment to avoid context issues during isolated tests
    SystemPrompt.environment = async () => ["mocked-env"]
  })

  afterEach(() => {
    SystemPrompt.environment = originalEnvironment
  })

  it("should load system.md and resolve sections", async () => {
    const dummyGeminiModel = {
      api: { id: "gemini-2-flash" },
      providerID: "google",
    } as unknown as Provider.Model

    const result = await SystemPrompt.resolveSystemPromptSections(dummyGeminiModel)

    expect(result.parts).toBeInstanceOf(Array)
    expect(result.parts.length).toBeGreaterThan(0)
    expect(result.boundary).toBeGreaterThan(0)
    expect(result.boundary).toBeLessThanOrEqual(result.parts.length)

    // Check that caching occurred in registry
    const entries = SectionRegistry.all()
    expect(entries.length).toBeGreaterThan(0)
    expect(entries[0].cached).toBeDefined()
  })

  it("should filter out sections that don't match the tag", async () => {
    const defaultModel = {
      api: { id: "some-unknown-model" },
      providerID: "unknown",
    } as unknown as Provider.Model

    const result = await SystemPrompt.resolveSystemPromptSections(defaultModel)

    // Parts array should be smaller than total entries since it excludes specific providers
    const allEntriesCount = SectionRegistry.all().length
    expect(result.parts.length).toBeLessThan(allEntriesCount)
  })

  it("should implement boundary marker correctly between static and volatile", async () => {
    const originalEnvironment = SystemPrompt.environment

    try {
      const dummyModel1 = { api: { id: "gemini-test" }, providerID: "google" } as unknown as Provider.Model
      const dummyModel2 = { api: { id: "gemini-test" }, providerID: "google" } as unknown as Provider.Model

      SystemPrompt.environment = async () => ["mock-env-1"]
      const result1 = await SystemPrompt.resolveSystemPromptSections(dummyModel1)

      SystemPrompt.environment = async () => ["mock-env-2"]
      const result2 = await SystemPrompt.resolveSystemPromptSections(dummyModel2)

      const staticParts1 = result1.parts.slice(0, result1.boundary)
      const staticParts2 = result2.parts.slice(0, result2.boundary)

      const volatileParts1 = result1.parts.slice(result1.boundary)
      const volatileParts2 = result2.parts.slice(result2.boundary)

      expect(staticParts1).toEqual(staticParts2)
      expect(volatileParts1).not.toEqual(volatileParts2)
      expect(volatileParts1[0]).toContain("mock-env-1")
      expect(volatileParts2[0]).toContain("mock-env-2")

      expect(result1.boundary).toBe(staticParts1.length)
      expect(result2.boundary).toBe(staticParts2.length)
    } finally {
      SystemPrompt.environment = originalEnvironment
    }
  })
})
