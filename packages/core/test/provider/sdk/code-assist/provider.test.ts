import { describe, expect, test } from "bun:test"
import type { AuthClient } from "google-auth-library"
import { createCodeAssist } from "../../../../src/provider/sdk/code-assist/provider"

/** Minimal mock AuthClient for provider factory tests. */
const mockClient: AuthClient = {
  request: async () => ({ data: {} }),
} as unknown as AuthClient

describe("createCodeAssist", () => {
  test("returns callable provider", () => {
    const provider = createCodeAssist({ client: mockClient })
    const model = provider("gemini-2.5-pro")
    expect(model.modelId).toBe("gemini-2.5-pro")
    expect(model.provider).toBe("google-code-assist.chat")
    expect(model.specificationVersion).toBe("v2")
  })

  test("languageModel method returns same as direct call", () => {
    const provider = createCodeAssist({ client: mockClient })
    const a = provider("m")
    const b = provider.languageModel("m")
    expect(a.modelId).toBe(b.modelId)
    expect(a.provider).toBe(b.provider)
  })

  test("chat method returns same as direct call", () => {
    const provider = createCodeAssist({ client: mockClient })
    const a = provider("m")
    const b = provider.chat("m")
    expect(a.modelId).toBe(b.modelId)
  })

  test("custom name", () => {
    const provider = createCodeAssist({ name: "my-ca", client: mockClient })
    const model = provider("m")
    expect(model.provider).toBe("my-ca.chat")
  })

  test("custom settings propagated", () => {
    const provider = createCodeAssist({
      project: "my-project",
      baseURL: "https://custom.example.com",
      apiKey: "key123",
      headers: { "X-Custom": "header" },
      client: mockClient,
    })
    const model = provider("m")
    expect(model.modelId).toBe("m")
    expect(model.specificationVersion).toBe("v2")
  })

  test("default name is google-code-assist", () => {
    const provider = createCodeAssist({ client: mockClient })
    const model = provider("m")
    expect(model.provider).toBe("google-code-assist.chat")
  })

  test("throws without client", () => {
    const provider = createCodeAssist()
    expect(() => provider("m")).toThrow("authenticated")
  })
})
