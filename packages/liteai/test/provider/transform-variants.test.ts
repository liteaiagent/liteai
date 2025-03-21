import { describe, expect, test } from "bun:test"
import type { Provider } from "../../src/provider/provider"
import { ProviderTransform } from "../../src/provider/transform"

describe("ProviderTransform.variants", () => {
  const createMockModel = (overrides: Record<string, unknown> = {}) =>
    ({
      id: "test/test-model",
      providerID: "test",
      api: {
        id: "test-model",
        url: "https://api.test.com",
        npm: "@ai-sdk/openai",
      },
      name: "Test Model",
      capabilities: {
        temperature: true,
        reasoning: true,
        attachment: true,
        toolcall: true,
        input: { text: true, audio: false, image: true, video: false, pdf: false },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
        interleaved: false,
      },
      cost: {
        input: 0.001,
        output: 0.002,
        cache: { read: 0.0001, write: 0.0002 },
      },
      limit: {
        context: 200_000,
        output: 64_000,
      },
      status: "active",
      options: {},
      headers: {},
      release_date: "2024-01-01",
      ...overrides,
    }) as Provider.Model

  test("returns empty object when model has no reasoning capabilities", () => {
    const model = createMockModel({
      capabilities: { reasoning: false },
    })
    const result = ProviderTransform.variants(model)
    expect(result).toEqual({})
  })

  test("deepseek returns empty object", () => {
    const model = createMockModel({
      id: "deepseek/deepseek-chat",
      providerID: "deepseek",
      api: {
        id: "deepseek-chat",
        url: "https://api.deepseek.com",
        npm: "@ai-sdk/openai-compatible",
      },
    })
    const result = ProviderTransform.variants(model)
    expect(result).toEqual({})
  })

  test("minimax returns empty object", () => {
    const model = createMockModel({
      id: "minimax/minimax-model",
      providerID: "minimax",
      api: {
        id: "minimax-model",
        url: "https://api.minimax.com",
        npm: "@ai-sdk/openai-compatible",
      },
    })
    const result = ProviderTransform.variants(model)
    expect(result).toEqual({})
  })

  test("glm returns empty object", () => {
    const model = createMockModel({
      id: "glm/glm-4",
      providerID: "glm",
      api: {
        id: "glm-4",
        url: "https://api.glm.com",
        npm: "@ai-sdk/openai-compatible",
      },
    })
    const result = ProviderTransform.variants(model)
    expect(result).toEqual({})
  })

  test("mistral returns empty object", () => {
    const model = createMockModel({
      id: "mistral/mistral-large",
      providerID: "mistral",
      api: {
        id: "mistral-large-latest",
        url: "https://api.mistral.com",
        npm: "@ai-sdk/mistral",
      },
    })
    const result = ProviderTransform.variants(model)
    expect(result).toEqual({})
  })

  describe("@openrouter/ai-sdk-provider", () => {
    test("returns empty object for non-qualifying models", () => {
      const model = createMockModel({
        id: "openrouter/test-model",
        providerID: "openrouter",
        api: {
          id: "test-model",
          url: "https://openrouter.ai",
          npm: "@openrouter/ai-sdk-provider",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(result).toEqual({})
    })

    test("gpt models return OPENAI_EFFORTS with reasoning", () => {
      const model = createMockModel({
        id: "openrouter/gpt-4",
        providerID: "openrouter",
        api: {
          id: "gpt-4",
          url: "https://openrouter.ai",
          npm: "@openrouter/ai-sdk-provider",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["none", "minimal", "low", "medium", "high", "xhigh"])
      expect(result.low).toEqual({ reasoning: { effort: "low" } })
      expect(result.high).toEqual({ reasoning: { effort: "high" } })
    })

    test("gemini-3 returns OPENAI_EFFORTS with reasoning", () => {
      const model = createMockModel({
        id: "openrouter/gemini-3-5-pro",
        providerID: "openrouter",
        api: {
          id: "gemini-3-5-pro",
          url: "https://openrouter.ai",
          npm: "@openrouter/ai-sdk-provider",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["none", "minimal", "low", "medium", "high", "xhigh"])
    })

    test("grok-4 returns empty object", () => {
      const model = createMockModel({
        id: "openrouter/grok-4",
        providerID: "openrouter",
        api: {
          id: "grok-4",
          url: "https://openrouter.ai",
          npm: "@openrouter/ai-sdk-provider",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(result).toEqual({})
    })

    test("grok-3-mini returns low and high with reasoning", () => {
      const model = createMockModel({
        id: "openrouter/grok-3-mini",
        providerID: "openrouter",
        api: {
          id: "grok-3-mini",
          url: "https://openrouter.ai",
          npm: "@openrouter/ai-sdk-provider",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "high"])
      expect(result.low).toEqual({ reasoning: { effort: "low" } })
      expect(result.high).toEqual({ reasoning: { effort: "high" } })
    })
  })

  describe("@ai-sdk/gateway", () => {
    test("anthropic sonnet 4.6 models return adaptive thinking options", () => {
      const model = createMockModel({
        id: "anthropic/claude-sonnet-4-6",
        providerID: "gateway",
        api: {
          id: "anthropic/claude-sonnet-4-6",
          url: "https://gateway.ai",
          npm: "@ai-sdk/gateway",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "medium", "high", "max"])
      expect(result.medium).toEqual({
        thinking: {
          type: "adaptive",
        },
        effort: "medium",
      })
    })

    test("anthropic sonnet 4.6 dot-format models return adaptive thinking options", () => {
      const model = createMockModel({
        id: "anthropic/claude-sonnet-4-6",
        providerID: "gateway",
        api: {
          id: "anthropic/claude-sonnet-4.6",
          url: "https://gateway.ai",
          npm: "@ai-sdk/gateway",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "medium", "high", "max"])
      expect(result.medium).toEqual({
        thinking: {
          type: "adaptive",
        },
        effort: "medium",
      })
    })

    test("anthropic opus 4.6 dot-format models return adaptive thinking options", () => {
      const model = createMockModel({
        id: "anthropic/claude-opus-4-6",
        providerID: "gateway",
        api: {
          id: "anthropic/claude-opus-4.6",
          url: "https://gateway.ai",
          npm: "@ai-sdk/gateway",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "medium", "high", "max"])
      expect(result.high).toEqual({
        thinking: {
          type: "adaptive",
        },
        effort: "high",
      })
    })

    test("anthropic models return anthropic thinking options", () => {
      const model = createMockModel({
        id: "anthropic/claude-sonnet-4",
        providerID: "gateway",
        api: {
          id: "anthropic/claude-sonnet-4",
          url: "https://gateway.ai",
          npm: "@ai-sdk/gateway",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["high", "max"])
      expect(result.high).toEqual({
        thinking: {
          type: "enabled",
          budgetTokens: 16000,
        },
      })
      expect(result.max).toEqual({
        thinking: {
          type: "enabled",
          budgetTokens: 31999,
        },
      })
    })

    test("returns OPENAI_EFFORTS with reasoningEffort", () => {
      const model = createMockModel({
        id: "gateway/gateway-model",
        providerID: "gateway",
        api: {
          id: "gateway-model",
          url: "https://gateway.ai",
          npm: "@ai-sdk/gateway",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["none", "minimal", "low", "medium", "high", "xhigh"])
      expect(result.low).toEqual({ reasoningEffort: "low" })
      expect(result.high).toEqual({ reasoningEffort: "high" })
    })
  })

  describe("@ai-sdk/github-copilot", () => {
    test("standard models return low, medium, high", () => {
      const model = createMockModel({
        id: "gpt-4.5",
        providerID: "github-copilot",
        api: {
          id: "gpt-4.5",
          url: "https://api.githubcopilot.com",
          npm: "@ai-sdk/github-copilot",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "medium", "high"])
      expect(result.low).toEqual({
        reasoningEffort: "low",
        reasoningSummary: "auto",
        include: ["reasoning.encrypted_content"],
      })
    })

    test("gpt-5.1-codex-max includes xhigh", () => {
      const model = createMockModel({
        id: "gpt-5.1-codex-max",
        providerID: "github-copilot",
        api: {
          id: "gpt-5.1-codex-max",
          url: "https://api.githubcopilot.com",
          npm: "@ai-sdk/github-copilot",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "medium", "high", "xhigh"])
    })

    test("gpt-5.1-codex-mini does not include xhigh", () => {
      const model = createMockModel({
        id: "gpt-5.1-codex-mini",
        providerID: "github-copilot",
        api: {
          id: "gpt-5.1-codex-mini",
          url: "https://api.githubcopilot.com",
          npm: "@ai-sdk/github-copilot",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "medium", "high"])
    })

    test("gpt-5.1-codex does not include xhigh", () => {
      const model = createMockModel({
        id: "gpt-5.1-codex",
        providerID: "github-copilot",
        api: {
          id: "gpt-5.1-codex",
          url: "https://api.githubcopilot.com",
          npm: "@ai-sdk/github-copilot",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "medium", "high"])
    })

    test("gpt-5.2 includes xhigh", () => {
      const model = createMockModel({
        id: "gpt-5.2",
        providerID: "github-copilot",
        api: {
          id: "gpt-5.2",
          url: "https://api.githubcopilot.com",
          npm: "@ai-sdk/github-copilot",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "medium", "high", "xhigh"])
      expect(result.xhigh).toEqual({
        reasoningEffort: "xhigh",
        reasoningSummary: "auto",
        include: ["reasoning.encrypted_content"],
      })
    })

    test("gpt-5.2-codex includes xhigh", () => {
      const model = createMockModel({
        id: "gpt-5.2-codex",
        providerID: "github-copilot",
        api: {
          id: "gpt-5.2-codex",
          url: "https://api.githubcopilot.com",
          npm: "@ai-sdk/github-copilot",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "medium", "high", "xhigh"])
    })

    test("gpt-5.3-codex includes xhigh", () => {
      const model = createMockModel({
        id: "gpt-5.3-codex",
        providerID: "github-copilot",
        api: {
          id: "gpt-5.3-codex",
          url: "https://api.githubcopilot.com",
          npm: "@ai-sdk/github-copilot",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "medium", "high", "xhigh"])
    })

    test("gpt-5.4 includes xhigh", () => {
      const model = createMockModel({
        id: "gpt-5.4",
        release_date: "2026-03-05",
        providerID: "github-copilot",
        api: {
          id: "gpt-5.4",
          url: "https://api.githubcopilot.com",
          npm: "@ai-sdk/github-copilot",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "medium", "high", "xhigh"])
    })
  })

  describe("@ai-sdk/cerebras", () => {
    test("returns WIDELY_SUPPORTED_EFFORTS with reasoningEffort", () => {
      const model = createMockModel({
        id: "cerebras/llama-4",
        providerID: "cerebras",
        api: {
          id: "llama-4-sc",
          url: "https://api.cerebras.ai",
          npm: "@ai-sdk/cerebras",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "medium", "high"])
      expect(result.low).toEqual({ reasoningEffort: "low" })
      expect(result.high).toEqual({ reasoningEffort: "high" })
    })
  })

  describe("@ai-sdk/togetherai", () => {
    test("returns WIDELY_SUPPORTED_EFFORTS with reasoningEffort", () => {
      const model = createMockModel({
        id: "togetherai/llama-4",
        providerID: "togetherai",
        api: {
          id: "llama-4-sc",
          url: "https://api.togetherai.com",
          npm: "@ai-sdk/togetherai",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "medium", "high"])
      expect(result.low).toEqual({ reasoningEffort: "low" })
      expect(result.high).toEqual({ reasoningEffort: "high" })
    })
  })

  describe("@ai-sdk/xai", () => {
    test("grok-3 returns empty object", () => {
      const model = createMockModel({
        id: "xai/grok-3",
        providerID: "xai",
        api: {
          id: "grok-3",
          url: "https://api.x.ai",
          npm: "@ai-sdk/xai",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(result).toEqual({})
    })

    test("grok-3-mini returns low and high with reasoningEffort", () => {
      const model = createMockModel({
        id: "xai/grok-3-mini",
        providerID: "xai",
        api: {
          id: "grok-3-mini",
          url: "https://api.x.ai",
          npm: "@ai-sdk/xai",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "high"])
      expect(result.low).toEqual({ reasoningEffort: "low" })
      expect(result.high).toEqual({ reasoningEffort: "high" })
    })
  })

  describe("@ai-sdk/deepinfra", () => {
    test("returns WIDELY_SUPPORTED_EFFORTS with reasoningEffort", () => {
      const model = createMockModel({
        id: "deepinfra/llama-4",
        providerID: "deepinfra",
        api: {
          id: "llama-4-sc",
          url: "https://api.deepinfra.com",
          npm: "@ai-sdk/deepinfra",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "medium", "high"])
      expect(result.low).toEqual({ reasoningEffort: "low" })
      expect(result.high).toEqual({ reasoningEffort: "high" })
    })
  })

  describe("@ai-sdk/openai-compatible", () => {
    test("returns WIDELY_SUPPORTED_EFFORTS with reasoningEffort", () => {
      const model = createMockModel({
        id: "custom-provider/custom-model",
        providerID: "custom-provider",
        api: {
          id: "custom-model",
          url: "https://api.custom.com",
          npm: "@ai-sdk/openai-compatible",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "medium", "high"])
      expect(result.low).toEqual({ reasoningEffort: "low" })
      expect(result.high).toEqual({ reasoningEffort: "high" })
    })
  })

  describe("@ai-sdk/azure", () => {
    test("o1-mini returns empty object", () => {
      const model = createMockModel({
        id: "o1-mini",
        providerID: "azure",
        api: {
          id: "o1-mini",
          url: "https://azure.com",
          npm: "@ai-sdk/azure",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(result).toEqual({})
    })

    test("standard azure models return custom efforts with reasoningSummary", () => {
      const model = createMockModel({
        id: "o1",
        providerID: "azure",
        api: {
          id: "o1",
          url: "https://azure.com",
          npm: "@ai-sdk/azure",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "medium", "high"])
      expect(result.low).toEqual({
        reasoningEffort: "low",
        reasoningSummary: "auto",
        include: ["reasoning.encrypted_content"],
      })
    })

    test("gpt-5 adds minimal effort", () => {
      const model = createMockModel({
        id: "gpt-5",
        providerID: "azure",
        api: {
          id: "gpt-5",
          url: "https://azure.com",
          npm: "@ai-sdk/azure",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["minimal", "low", "medium", "high"])
    })
  })

  describe("@ai-sdk/openai", () => {
    test("gpt-5-pro returns empty object", () => {
      const model = createMockModel({
        id: "gpt-5-pro",
        providerID: "openai",
        api: {
          id: "gpt-5-pro",
          url: "https://api.openai.com",
          npm: "@ai-sdk/openai",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(result).toEqual({})
    })

    test("standard openai models return custom efforts with reasoningSummary", () => {
      const model = createMockModel({
        id: "gpt-5",
        providerID: "openai",
        api: {
          id: "gpt-5",
          url: "https://api.openai.com",
          npm: "@ai-sdk/openai",
        },
        release_date: "2024-06-01",
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["minimal", "low", "medium", "high"])
      expect(result.low).toEqual({
        reasoningEffort: "low",
        reasoningSummary: "auto",
        include: ["reasoning.encrypted_content"],
      })
    })

    test("models after 2025-11-13 include 'none' effort", () => {
      const model = createMockModel({
        id: "gpt-5-nano",
        providerID: "openai",
        api: {
          id: "gpt-5-nano",
          url: "https://api.openai.com",
          npm: "@ai-sdk/openai",
        },
        release_date: "2025-11-14",
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["none", "minimal", "low", "medium", "high"])
    })

    test("models after 2025-12-04 include 'xhigh' effort", () => {
      const model = createMockModel({
        id: "openai/gpt-5-chat",
        providerID: "openai",
        api: {
          id: "gpt-5-chat",
          url: "https://api.openai.com",
          npm: "@ai-sdk/openai",
        },
        release_date: "2025-12-05",
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["none", "minimal", "low", "medium", "high", "xhigh"])
    })
  })

  describe("@ai-sdk/anthropic", () => {
    test("sonnet 4.6 returns adaptive thinking options", () => {
      const model = createMockModel({
        id: "anthropic/claude-sonnet-4-6",
        providerID: "anthropic",
        api: {
          id: "claude-sonnet-4-6",
          url: "https://api.anthropic.com",
          npm: "@ai-sdk/anthropic",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "medium", "high", "max"])
      expect(result.high).toEqual({
        thinking: {
          type: "adaptive",
        },
        effort: "high",
      })
    })

    test("returns high and max with thinking config", () => {
      const model = createMockModel({
        id: "anthropic/claude-4",
        providerID: "anthropic",
        api: {
          id: "claude-4",
          url: "https://api.anthropic.com",
          npm: "@ai-sdk/anthropic",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["high", "max"])
      expect(result.high).toEqual({
        thinking: {
          type: "enabled",
          budgetTokens: 16000,
        },
      })
      expect(result.max).toEqual({
        thinking: {
          type: "enabled",
          budgetTokens: 31999,
        },
      })
    })
  })

  describe("@ai-sdk/amazon-bedrock", () => {
    test("anthropic sonnet 4.6 returns adaptive reasoning options", () => {
      const model = createMockModel({
        id: "bedrock/anthropic-claude-sonnet-4-6",
        providerID: "bedrock",
        api: {
          id: "anthropic.claude-sonnet-4-6",
          url: "https://bedrock.amazonaws.com",
          npm: "@ai-sdk/amazon-bedrock",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "medium", "high", "max"])
      expect(result.max).toEqual({
        reasoningConfig: {
          type: "adaptive",
          maxReasoningEffort: "max",
        },
      })
    })

    test("returns WIDELY_SUPPORTED_EFFORTS with reasoningConfig", () => {
      const model = createMockModel({
        id: "bedrock/llama-4",
        providerID: "bedrock",
        api: {
          id: "llama-4-sc",
          url: "https://bedrock.amazonaws.com",
          npm: "@ai-sdk/amazon-bedrock",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "medium", "high"])
      expect(result.low).toEqual({
        reasoningConfig: {
          type: "enabled",
          maxReasoningEffort: "low",
        },
      })
    })
  })

  describe("@ai-sdk/google", () => {
    test("gemini-2.5 returns high and max with thinkingConfig and thinkingBudget", () => {
      const model = createMockModel({
        id: "google/gemini-2.5-pro",
        providerID: "google",
        api: {
          id: "gemini-2.5-pro",
          url: "https://generativelanguage.googleapis.com",
          npm: "@ai-sdk/google",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["high", "max"])
      expect(result.high).toEqual({
        thinkingConfig: {
          includeThoughts: true,
          thinkingBudget: 16000,
        },
      })
      expect(result.max).toEqual({
        thinkingConfig: {
          includeThoughts: true,
          thinkingBudget: 24576,
        },
      })
    })

    test("other gemini models return low and high with thinkingLevel", () => {
      const model = createMockModel({
        id: "google/gemini-2.0-pro",
        providerID: "google",
        api: {
          id: "gemini-2.0-pro",
          url: "https://generativelanguage.googleapis.com",
          npm: "@ai-sdk/google",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "high"])
      expect(result.low).toEqual({
        thinkingConfig: {
          includeThoughts: true,
          thinkingLevel: "low",
        },
      })
      expect(result.high).toEqual({
        thinkingConfig: {
          includeThoughts: true,
          thinkingLevel: "high",
        },
      })
    })
  })

  describe("@ai-sdk/google-vertex", () => {
    test("gemini-2.5 returns high and max with thinkingConfig and thinkingBudget", () => {
      const model = createMockModel({
        id: "google-vertex/gemini-2.5-pro",
        providerID: "google-vertex",
        api: {
          id: "gemini-2.5-pro",
          url: "https://vertexai.googleapis.com",
          npm: "@ai-sdk/google-vertex",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["high", "max"])
    })

    test("other vertex models return low and high with thinkingLevel", () => {
      const model = createMockModel({
        id: "google-vertex/gemini-2.0-pro",
        providerID: "google-vertex",
        api: {
          id: "gemini-2.0-pro",
          url: "https://vertexai.googleapis.com",
          npm: "@ai-sdk/google-vertex",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "high"])
    })
  })

  describe("@ai-sdk/cohere", () => {
    test("returns empty object", () => {
      const model = createMockModel({
        id: "cohere/command-r",
        providerID: "cohere",
        api: {
          id: "command-r",
          url: "https://api.cohere.com",
          npm: "@ai-sdk/cohere",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(result).toEqual({})
    })
  })

  describe("@ai-sdk/groq", () => {
    test("returns none and WIDELY_SUPPORTED_EFFORTS with thinkingLevel", () => {
      const model = createMockModel({
        id: "groq/llama-4",
        providerID: "groq",
        api: {
          id: "llama-4-sc",
          url: "https://api.groq.com",
          npm: "@ai-sdk/groq",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["none", "low", "medium", "high"])
      expect(result.none).toEqual({
        reasoningEffort: "none",
      })
      expect(result.low).toEqual({
        reasoningEffort: "low",
      })
    })
  })

  describe("@ai-sdk/perplexity", () => {
    test("returns empty object", () => {
      const model = createMockModel({
        id: "perplexity/sonar-plus",
        providerID: "perplexity",
        api: {
          id: "sonar-plus",
          url: "https://api.perplexity.ai",
          npm: "@ai-sdk/perplexity",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(result).toEqual({})
    })
  })

  describe("@jerome-benoit/sap-ai-provider-v2", () => {
    test("anthropic models return thinking variants", () => {
      const model = createMockModel({
        id: "sap-ai-core/anthropic--claude-sonnet-4",
        providerID: "sap-ai-core",
        api: {
          id: "anthropic--claude-sonnet-4",
          url: "https://api.ai.sap",
          npm: "@jerome-benoit/sap-ai-provider-v2",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["high", "max"])
      expect(result.high).toEqual({
        thinking: {
          type: "enabled",
          budgetTokens: 16000,
        },
      })
      expect(result.max).toEqual({
        thinking: {
          type: "enabled",
          budgetTokens: 31999,
        },
      })
    })

    test("anthropic 4.6 models return adaptive thinking variants", () => {
      const model = createMockModel({
        id: "sap-ai-core/anthropic--claude-sonnet-4-6",
        providerID: "sap-ai-core",
        api: {
          id: "anthropic--claude-sonnet-4-6",
          url: "https://api.ai.sap",
          npm: "@jerome-benoit/sap-ai-provider-v2",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "medium", "high", "max"])
      expect(result.low).toEqual({
        thinking: {
          type: "adaptive",
        },
        effort: "low",
      })
      expect(result.max).toEqual({
        thinking: {
          type: "adaptive",
        },
        effort: "max",
      })
    })

    test("gemini 2.5 models return thinkingConfig variants", () => {
      const model = createMockModel({
        id: "sap-ai-core/gcp--gemini-2.5-pro",
        providerID: "sap-ai-core",
        api: {
          id: "gcp--gemini-2.5-pro",
          url: "https://api.ai.sap",
          npm: "@jerome-benoit/sap-ai-provider-v2",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["high", "max"])
      expect(result.high).toEqual({
        thinkingConfig: {
          includeThoughts: true,
          thinkingBudget: 16000,
        },
      })
      expect(result.max).toEqual({
        thinkingConfig: {
          includeThoughts: true,
          thinkingBudget: 24576,
        },
      })
    })

    test("gpt models return reasoningEffort variants", () => {
      const model = createMockModel({
        id: "sap-ai-core/azure-openai--gpt-4o",
        providerID: "sap-ai-core",
        api: {
          id: "azure-openai--gpt-4o",
          url: "https://api.ai.sap",
          npm: "@jerome-benoit/sap-ai-provider-v2",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "medium", "high"])
      expect(result.low).toEqual({ reasoningEffort: "low" })
      expect(result.high).toEqual({ reasoningEffort: "high" })
    })

    test("o-series models return reasoningEffort variants", () => {
      const model = createMockModel({
        id: "sap-ai-core/azure-openai--o3-mini",
        providerID: "sap-ai-core",
        api: {
          id: "azure-openai--o3-mini",
          url: "https://api.ai.sap",
          npm: "@jerome-benoit/sap-ai-provider-v2",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "medium", "high"])
      expect(result.low).toEqual({ reasoningEffort: "low" })
      expect(result.high).toEqual({ reasoningEffort: "high" })
    })

    test("sonar models return empty object", () => {
      const model = createMockModel({
        id: "sap-ai-core/perplexity--sonar-pro",
        providerID: "sap-ai-core",
        api: {
          id: "perplexity--sonar-pro",
          url: "https://api.ai.sap",
          npm: "@jerome-benoit/sap-ai-provider-v2",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(result).toEqual({})
    })

    test("mistral models return empty object", () => {
      const model = createMockModel({
        id: "sap-ai-core/mistral--mistral-large",
        providerID: "sap-ai-core",
        api: {
          id: "mistral--mistral-large",
          url: "https://api.ai.sap",
          npm: "@jerome-benoit/sap-ai-provider-v2",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(result).toEqual({})
    })
  })
})
