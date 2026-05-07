import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import {
  buildDynamicModel,
  buildDynamicModels,
  fetchOpenAICompatibleModels,
} from "../../src/provider/loaders/openai-compat-fetch"
import type { Provider } from "../../src/provider/provider"
import { ModelID, ProviderID } from "../../src/provider/schema"

afterEach(() => {
  mock.restore()
})

describe("fetchOpenAICompatibleModels", () => {
  test("returns model IDs from { data: [{ id }] } response shape", async () => {
    const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            { id: "llama-3.1-8b", object: "model" },
            { id: "qwen2.5-coder-7b", object: "model" },
            { id: "deepseek-coder-v2", object: "model" },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    )

    const result = await fetchOpenAICompatibleModels("http://localhost:1234/v1")

    expect(result).toEqual(["llama-3.1-8b", "qwen2.5-coder-7b", "deepseek-coder-v2"])
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    // Should hit /v1/models
    const calledUrl = (fetchSpy.mock.calls[0] as [string, ...unknown[]])[0]
    expect(calledUrl).toBe("http://localhost:1234/v1/models")
  })

  test("returns model IDs from bare array response shape", async () => {
    spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify([{ id: "model-a" }, { id: "model-b" }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    )

    const result = await fetchOpenAICompatibleModels("http://localhost:8080/v1")
    expect(result).toEqual(["model-a", "model-b"])
  })

  test("normalizes trailing slashes in base URL", async () => {
    const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [{ id: "test-model" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    )

    await fetchOpenAICompatibleModels("http://localhost:1234/v1///")
    const calledUrl = (fetchSpy.mock.calls[0] as [string, ...unknown[]])[0]
    expect(calledUrl).toBe("http://localhost:1234/v1/models")
  })

  test("appends /models only if not already present", async () => {
    const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [{ id: "test-model" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    )

    await fetchOpenAICompatibleModels("http://localhost:1234/v1/models")
    const calledUrl = (fetchSpy.mock.calls[0] as [string, ...unknown[]])[0]
    // Should NOT double up: /models/models
    expect(calledUrl).toBe("http://localhost:1234/v1/models")
  })

  test("sends Authorization header when apiKey is provided", async () => {
    const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [{ id: "model" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    )

    await fetchOpenAICompatibleModels("http://api.example.com/v1", { apiKey: "sk-test-key" })
    const opts = fetchSpy.mock.calls[0][1] as RequestInit
    expect((opts.headers as Record<string, string>).Authorization).toBe("Bearer sk-test-key")
  })

  test("sends custom headers when provided", async () => {
    const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [{ id: "model" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    )

    await fetchOpenAICompatibleModels("http://api.example.com/v1", {
      headers: { "X-Custom": "value" },
    })
    const opts = fetchSpy.mock.calls[0][1] as RequestInit
    expect((opts.headers as Record<string, string>)["X-Custom"]).toBe("value")
  })

  test("returns undefined on HTTP error status", async () => {
    spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("Not Found", { status: 404 }))

    const result = await fetchOpenAICompatibleModels("http://localhost:1234/v1")
    expect(result).toBeUndefined()
  })

  test("returns undefined on network error", async () => {
    spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("ECONNREFUSED"))

    const result = await fetchOpenAICompatibleModels("http://localhost:1234/v1")
    expect(result).toBeUndefined()
  })

  test("returns undefined on invalid JSON response", async () => {
    spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("not json", { status: 200, headers: { "Content-Type": "text/plain" } }),
    )

    const result = await fetchOpenAICompatibleModels("http://localhost:1234/v1")
    expect(result).toBeUndefined()
  })

  test("returns undefined on unexpected response shape", async () => {
    spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({ models: ["a", "b"] }), // wrong shape — no `data` or array
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    )

    const result = await fetchOpenAICompatibleModels("http://localhost:1234/v1")
    expect(result).toBeUndefined()
  })

  test("returns undefined on empty model list", async () => {
    spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "Content-Type": "application/json" } }),
    )

    const result = await fetchOpenAICompatibleModels("http://localhost:1234/v1")
    expect(result).toBeUndefined()
  })

  test("filters out items without an id field", async () => {
    spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            { id: "valid-model" },
            { object: "model" }, // no id
            { id: "" }, // empty id
            { id: "another-valid" },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    )

    const result = await fetchOpenAICompatibleModels("http://localhost:1234/v1")
    expect(result).toEqual(["valid-model", "another-valid"])
  })
})

describe("buildDynamicModel", () => {
  const providerID = ProviderID.make("lmstudio")
  const npm = "@ai-sdk/openai-compatible"
  const baseUrl = "http://127.0.0.1:1234/v1"

  test("returns a Provider.Model with correct defaults", () => {
    const model = buildDynamicModel("llama-3.1-8b", providerID, npm, baseUrl)

    expect(model.id).toBe(ModelID.make("llama-3.1-8b"))
    expect(model.providerID).toBe(providerID)
    expect(model.name).toBe("llama-3.1-8b")
    expect(model.family).toBe("")
    expect(model.status).toBe("active")
    expect(model.release_date).toBe("")
  })

  test("sets cost to 0 for all fields", () => {
    const model = buildDynamicModel("test-model", providerID, npm, baseUrl)

    expect(model.cost.input).toBe(0)
    expect(model.cost.output).toBe(0)
    expect(model.cost.cache.read).toBe(0)
    expect(model.cost.cache.write).toBe(0)
  })

  test("sets sensible capability defaults", () => {
    const model = buildDynamicModel("test-model", providerID, npm, baseUrl)

    expect(model.capabilities.temperature).toBe(true)
    expect(model.capabilities.toolcall).toBe(true)
    expect(model.capabilities.reasoning).toBe(false)
    expect(model.capabilities.attachment).toBe(false)
    expect(model.capabilities.input.text).toBe(true)
    expect(model.capabilities.output.text).toBe(true)
    expect(model.capabilities.interleaved).toBe(false)
  })

  test("sets default context/output limits", () => {
    const model = buildDynamicModel("test-model", providerID, npm, baseUrl)

    expect(model.limit.context).toBe(128000)
    expect(model.limit.output).toBe(8192)
  })

  test("sets correct API fields", () => {
    const model = buildDynamicModel("my-model-id", providerID, npm, baseUrl)

    expect(model.api.id).toBe("my-model-id")
    expect(model.api.npm).toBe(npm)
    expect(model.api.url).toBe(baseUrl)
  })

  test("produces independent capability objects per model", () => {
    const model1 = buildDynamicModel("model-1", providerID, npm, baseUrl)
    const model2 = buildDynamicModel("model-2", providerID, npm, baseUrl)

    // Mutating one should not affect the other
    model1.capabilities.reasoning = true
    expect(model2.capabilities.reasoning).toBe(false)
  })

  test("enriches capabilities from models.dev when database is provided and model matches", () => {
    const database: Record<string, Provider.Info> = {
      deepseek: {
        id: ProviderID.make("deepseek"),
        name: "DeepSeek",
        source: "env",
        env: ["DEEPSEEK_API_KEY"],
        options: {},
        models: {
          "deepseek-chat": {
            id: ModelID.make("deepseek-chat"),
            providerID: ProviderID.make("deepseek"),
            name: "Deepseek-Chat",
            family: "deepseek",
            status: "active",
            headers: {},
            options: {},
            api: { id: "deepseek-chat", npm: "@ai-sdk/deepseek", url: "https://api.deepseek.com/v1" },
            capabilities: {
              temperature: true,
              reasoning: false,
              attachment: false,
              toolcall: true,
              input: { text: true, audio: false, image: false, video: false, pdf: false },
              output: { text: true, audio: false, image: false, video: false, pdf: false },
              interleaved: false,
            },
            limit: { context: 128000, output: 8192 },
            cost: { input: 0.29, output: 0.43, cache: { read: 0.07, write: 0 } },
            release_date: "2024-11-29",
            variants: {},
          },
        },
      },
    }

    const model = buildDynamicModel("deepseek-chat", providerID, npm, baseUrl, database)

    // Should use models.dev values
    expect(model.name).toBe("Deepseek-Chat")
    expect(model.family).toBe("deepseek")
    expect(model.release_date).toBe("2024-11-29")
    expect(model.cost.input).toBe(0.29)
    expect(model.cost.output).toBe(0.43)
    expect(model.cost.cache.read).toBe(0.07)
    expect(model.limit.context).toBe(128000)
    expect(model.capabilities.toolcall).toBe(true)

    // But providerID and api should be overridden to point to the dynamic provider
    expect(model.providerID).toBe(providerID)
    expect(model.api.npm).toBe(npm)
    expect(model.api.url).toBe(baseUrl)
  })

  test("uses defaults when model is not found in database", () => {
    const database: Record<string, Provider.Info> = {
      deepseek: {
        id: ProviderID.make("deepseek"),
        name: "DeepSeek",
        source: "env",
        env: ["DEEPSEEK_API_KEY"],
        options: {},
        models: {},
      },
    }

    const model = buildDynamicModel("unknown-model-xyz", providerID, npm, baseUrl, database)

    // Should use hardcoded defaults
    expect(model.name).toBe("unknown-model-xyz")
    expect(model.family).toBe("")
    expect(model.release_date).toBe("")
    expect(model.cost.input).toBe(0)
    expect(model.cost.output).toBe(0)
    expect(model.limit.context).toBe(128000)
    expect(model.limit.output).toBe(8192)
  })

  test("enriches reasoning models correctly from database", () => {
    const database: Record<string, Provider.Info> = {
      deepseek: {
        id: ProviderID.make("deepseek"),
        name: "DeepSeek",
        source: "env",
        env: [],
        options: {},
        models: {
          "deepseek-reasoner": {
            id: ModelID.make("deepseek-reasoner"),
            providerID: ProviderID.make("deepseek"),
            name: "Deepseek-Reasoner",
            family: "deepseek-thinking",
            status: "active",
            headers: {},
            options: {},
            api: { id: "deepseek-reasoner", npm: "@ai-sdk/deepseek", url: "https://api.deepseek.com/v1" },
            capabilities: {
              temperature: true,
              reasoning: true,
              attachment: false,
              toolcall: true,
              input: { text: true, audio: false, image: false, video: false, pdf: false },
              output: { text: true, audio: false, image: false, video: false, pdf: false },
              interleaved: false,
            },
            limit: { context: 128000, output: 128000 },
            cost: { input: 0.29, output: 0.43, cache: { read: 0, write: 0 } },
            release_date: "2025-01-20",
            variants: {},
          },
        },
      },
    }

    const model = buildDynamicModel("deepseek-reasoner", providerID, npm, baseUrl, database)

    expect(model.capabilities.reasoning).toBe(true)
    expect(model.family).toBe("deepseek-thinking")
    expect(model.limit.output).toBe(128000)
  })

  test("uses defaults when no database is provided", () => {
    const model = buildDynamicModel("deepseek-chat", providerID, npm, baseUrl)

    // Without database, should use hardcoded defaults even for known model names
    expect(model.name).toBe("deepseek-chat")
    expect(model.family).toBe("")
    expect(model.cost.input).toBe(0)
  })
})

describe("buildDynamicModels", () => {
  const providerID = ProviderID.make("lmstudio")
  const npm = "@ai-sdk/openai-compatible"
  const baseUrl = "http://127.0.0.1:1234/v1"

  test("builds a record keyed by model ID", () => {
    const ids = ["model-a", "model-b", "model-c"]
    const models = buildDynamicModels(ids, providerID, npm, baseUrl)

    expect(Object.keys(models)).toEqual(["model-a", "model-b", "model-c"])
    expect(models["model-a"].id).toBe(ModelID.make("model-a"))
    expect(models["model-b"].id).toBe(ModelID.make("model-b"))
    expect(models["model-c"].id).toBe(ModelID.make("model-c"))
  })

  test("returns empty record for empty array", () => {
    const models = buildDynamicModels([], providerID, npm, baseUrl)
    expect(Object.keys(models)).toHaveLength(0)
  })

  test("all models share the same providerID", () => {
    const models = buildDynamicModels(["a", "b"], providerID, npm, baseUrl)
    expect(models.a.providerID).toBe(providerID)
    expect(models.b.providerID).toBe(providerID)
  })

  test("passes database through for enrichment", () => {
    const database: Record<string, Provider.Info> = {
      deepseek: {
        id: ProviderID.make("deepseek"),
        name: "DeepSeek",
        source: "env",
        env: [],
        options: {},
        models: {
          "deepseek-chat": {
            id: ModelID.make("deepseek-chat"),
            providerID: ProviderID.make("deepseek"),
            name: "Deepseek-Chat",
            family: "deepseek",
            status: "active",
            headers: {},
            options: {},
            api: { id: "deepseek-chat", npm: "@ai-sdk/deepseek", url: "https://api.deepseek.com/v1" },
            capabilities: {
              temperature: true,
              reasoning: false,
              attachment: false,
              toolcall: true,
              input: { text: true, audio: false, image: false, video: false, pdf: false },
              output: { text: true, audio: false, image: false, video: false, pdf: false },
              interleaved: false,
            },
            limit: { context: 128000, output: 8192 },
            cost: { input: 0.29, output: 0.43, cache: { read: 0, write: 0 } },
            release_date: "2024-11-29",
            variants: {},
          },
        },
      },
    }

    const models = buildDynamicModels(["deepseek-chat", "unknown-model"], providerID, npm, baseUrl, database)

    // Known model should be enriched
    expect(models["deepseek-chat"].name).toBe("Deepseek-Chat")
    expect(models["deepseek-chat"].cost.input).toBe(0.29)

    // Unknown model should use defaults
    expect(models["unknown-model"].name).toBe("unknown-model")
    expect(models["unknown-model"].cost.input).toBe(0)
  })
})
