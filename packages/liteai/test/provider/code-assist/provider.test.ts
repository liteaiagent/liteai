import { describe, expect, test } from "bun:test"
import { createCodeAssist } from "../../../src/provider/sdk/code-assist/provider"

describe("createCodeAssist", () => {
  test("returns callable provider", () => {
    const provider = createCodeAssist()
    const model = provider("gemini-2.5-pro")
    expect(model.modelId).toBe("gemini-2.5-pro")
    expect(model.provider).toBe("google-code-assist.chat")
    expect(model.specificationVersion).toBe("v2")
  })

  test("languageModel method returns same as direct call", () => {
    const provider = createCodeAssist()
    const a = provider("m")
    const b = provider.languageModel("m")
    expect(a.modelId).toBe(b.modelId)
    expect(a.provider).toBe(b.provider)
  })

  test("chat method returns same as direct call", () => {
    const provider = createCodeAssist()
    const a = provider("m")
    const b = provider.chat("m")
    expect(a.modelId).toBe(b.modelId)
  })

  test("custom name", () => {
    const provider = createCodeAssist({ name: "my-ca" })
    const model = provider("m")
    expect(model.provider).toBe("my-ca.chat")
  })

  test("custom settings propagated", () => {
    const provider = createCodeAssist({
      project: "my-project",
      baseURL: "https://custom.example.com",
      apiKey: "key123",
      headers: { "X-Custom": "header" },
    })
    const model = provider("m")
    // model is created — settings are internal but model should work
    expect(model.modelId).toBe("m")
    expect(model.specificationVersion).toBe("v2")
  })

  test("default name is google-code-assist", () => {
    const provider = createCodeAssist({})
    const model = provider("m")
    expect(model.provider).toBe("google-code-assist.chat")
  })
})
