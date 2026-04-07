import { expect, test } from "bun:test"
import path from "node:path"
import { Env } from "../../src/env"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider/provider"
import { tmpdir } from "../fixture/fixture"

test("model variants are generated for reasoning models", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, ".liteai", "settings.json"),
        JSON.stringify({ $schema: "https://liteai.com/config.json" }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    init: async () => {
      Env.set("ANTHROPIC_API_KEY", "test-api-key")
    },
    fn: async () => {
      const providers = await Provider.list()
      // Claude sonnet 4 has reasoning capability
      const model = providers.anthropic.models["claude-sonnet-4-20250514"]
      expect(model.capabilities.reasoning).toBe(true)
      expect(model.variants).toBeDefined()
      expect(Object.keys(model.variants ?? {}).length).toBeGreaterThan(0)
    },
  })
})

test("model variants can be disabled via config", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, ".liteai", "settings.json"),
        JSON.stringify({
          $schema: "https://liteai.com/config.json",
          provider: {
            anthropic: {
              models: {
                "claude-sonnet-4-20250514": {
                  variants: {
                    high: { disabled: true },
                  },
                },
              },
            },
          },
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    init: async () => {
      Env.set("ANTHROPIC_API_KEY", "test-api-key")
    },
    fn: async () => {
      const providers = await Provider.list()
      const model = providers.anthropic.models["claude-sonnet-4-20250514"]
      expect(model.variants).toBeDefined()
      expect(model.variants?.high).toBeUndefined()
      // max variant should still exist
      expect(model.variants?.max).toBeDefined()
    },
  })
})

test("model variants can be customized via config", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, ".liteai", "settings.json"),
        JSON.stringify({
          $schema: "https://liteai.com/config.json",
          provider: {
            anthropic: {
              models: {
                "claude-sonnet-4-20250514": {
                  variants: {
                    high: {
                      thinking: {
                        type: "enabled",
                        budgetTokens: 20000,
                      },
                    },
                  },
                },
              },
            },
          },
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    init: async () => {
      Env.set("ANTHROPIC_API_KEY", "test-api-key")
    },
    fn: async () => {
      const providers = await Provider.list()
      const model = providers.anthropic.models["claude-sonnet-4-20250514"]
      expect(model.variants?.high).toBeDefined()
      expect(model.variants?.high.thinking.budgetTokens).toBe(20000)
    },
  })
})

test("disabled key is stripped from variant config", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, ".liteai", "settings.json"),
        JSON.stringify({
          $schema: "https://liteai.com/config.json",
          provider: {
            anthropic: {
              models: {
                "claude-sonnet-4-20250514": {
                  variants: {
                    max: {
                      disabled: false,
                      customField: "test",
                    },
                  },
                },
              },
            },
          },
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    init: async () => {
      Env.set("ANTHROPIC_API_KEY", "test-api-key")
    },
    fn: async () => {
      const providers = await Provider.list()
      const model = providers.anthropic.models["claude-sonnet-4-20250514"]
      expect(model.variants?.max).toBeDefined()
      expect(model.variants?.max.disabled).toBeUndefined()
      expect(model.variants?.max.customField).toBe("test")
    },
  })
})

test("all variants can be disabled via config", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, ".liteai", "settings.json"),
        JSON.stringify({
          $schema: "https://liteai.com/config.json",
          provider: {
            anthropic: {
              models: {
                "claude-sonnet-4-20250514": {
                  variants: {
                    high: { disabled: true },
                    max: { disabled: true },
                  },
                },
              },
            },
          },
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    init: async () => {
      Env.set("ANTHROPIC_API_KEY", "test-api-key")
    },
    fn: async () => {
      const providers = await Provider.list()
      const model = providers.anthropic.models["claude-sonnet-4-20250514"]
      expect(model.variants).toBeDefined()
      expect(Object.keys(model.variants ?? {}).length).toBe(0)
    },
  })
})

test("variant config merges with generated variants", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, ".liteai", "settings.json"),
        JSON.stringify({
          $schema: "https://liteai.com/config.json",
          provider: {
            anthropic: {
              models: {
                "claude-sonnet-4-20250514": {
                  variants: {
                    high: {
                      extraOption: "custom-value",
                    },
                  },
                },
              },
            },
          },
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    init: async () => {
      Env.set("ANTHROPIC_API_KEY", "test-api-key")
    },
    fn: async () => {
      const providers = await Provider.list()
      const model = providers.anthropic.models["claude-sonnet-4-20250514"]
      expect(model.variants?.high).toBeDefined()
      // Should have both the generated thinking config and the custom option
      expect(model.variants?.high.thinking).toBeDefined()
      expect(model.variants?.high.extraOption).toBe("custom-value")
    },
  })
})

test("variants filtered in second pass for database models", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, ".liteai", "settings.json"),
        JSON.stringify({
          $schema: "https://liteai.com/config.json",
          provider: {
            openai: {
              models: {
                "gpt-5": {
                  variants: {
                    high: { disabled: true },
                  },
                },
              },
            },
          },
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    init: async () => {
      Env.set("OPENAI_API_KEY", "test-api-key")
    },
    fn: async () => {
      const providers = await Provider.list()
      const model = providers.openai.models["gpt-5"]
      expect(model.variants).toBeDefined()
      expect(model.variants?.high).toBeUndefined()
      // Other variants should still exist
      expect(model.variants?.medium).toBeDefined()
    },
  })
})

test("custom model with variants enabled and disabled", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, ".liteai", "settings.json"),
        JSON.stringify({
          $schema: "https://liteai.com/config.json",
          provider: {
            "custom-reasoning": {
              name: "Custom Reasoning Provider",
              npm: "@ai-sdk/openai-compatible",
              env: [],
              models: {
                "reasoning-model": {
                  name: "Reasoning Model",
                  tool_call: true,
                  reasoning: true,
                  limit: { context: 128000, output: 16000 },
                  variants: {
                    low: { reasoningEffort: "low" },
                    medium: { reasoningEffort: "medium" },
                    high: { reasoningEffort: "high", disabled: true },
                    custom: { reasoningEffort: "custom", budgetTokens: 5000 },
                  },
                },
              },
              options: { apiKey: "test-key" },
            },
          },
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const providers = await Provider.list()
      const model = providers["custom-reasoning"].models["reasoning-model"]
      expect(model.variants).toBeDefined()
      // Enabled variants should exist
      expect(model.variants?.low).toBeDefined()
      expect(model.variants?.low.reasoningEffort).toBe("low")
      expect(model.variants?.medium).toBeDefined()
      expect(model.variants?.medium.reasoningEffort).toBe("medium")
      expect(model.variants?.custom).toBeDefined()
      expect(model.variants?.custom.reasoningEffort).toBe("custom")
      expect(model.variants?.custom.budgetTokens).toBe(5000)
      // Disabled variant should not exist
      expect(model.variants?.high).toBeUndefined()
      // disabled key should be stripped from all variants
      expect(model.variants?.low.disabled).toBeUndefined()
      expect(model.variants?.medium.disabled).toBeUndefined()
      expect(model.variants?.custom.disabled).toBeUndefined()
    },
  })
})

test("Google Vertex: retains baseURL for custom proxy", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, ".liteai", "settings.json"),
        JSON.stringify({
          $schema: "https://liteai.com/config.json",
          provider: {
            "vertex-proxy": {
              name: "Vertex Proxy",
              npm: "@ai-sdk/google-vertex",
              api: "https://my-proxy.com/v1",
              env: ["GOOGLE_APPLICATION_CREDENTIALS"],
              models: {
                "gemini-pro": {
                  name: "Gemini Pro",
                  tool_call: true,
                },
              },
              options: {
                project: "test-project",
                location: "us-central1",
                baseURL: "https://my-proxy.com/v1",
              },
            },
          },
        }),
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    init: async () => {
      Env.set("GOOGLE_APPLICATION_CREDENTIALS", "test-creds")
    },
    fn: async () => {
      const providers = await Provider.list()
      expect(providers["vertex-proxy"]).toBeDefined()
      expect(providers["vertex-proxy"].options.baseURL).toBe("https://my-proxy.com/v1")
    },
  })
})

test("Google Vertex: supports OpenAI compatible models", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, ".liteai", "settings.json"),
        JSON.stringify({
          $schema: "https://liteai.com/config.json",
          provider: {
            "vertex-openai": {
              name: "Vertex OpenAI",
              npm: "@ai-sdk/google-vertex",
              env: ["GOOGLE_APPLICATION_CREDENTIALS"],
              models: {
                "gpt-4": {
                  name: "GPT-4",
                  provider: {
                    npm: "@ai-sdk/openai-compatible",
                    api: "https://api.openai.com/v1",
                  },
                },
              },
              options: {
                project: "test-project",
                location: "us-central1",
              },
            },
          },
        }),
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    init: async () => {
      Env.set("GOOGLE_APPLICATION_CREDENTIALS", "test-creds")
    },
    fn: async () => {
      const providers = await Provider.list()
      const model = providers["vertex-openai"].models["gpt-4"]

      expect(model).toBeDefined()
      expect(model.api.npm).toBe("@ai-sdk/openai-compatible")
    },
  })
})

test("cloudflare-ai-gateway loads with env variables", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, ".liteai", "settings.json"),
        JSON.stringify({ $schema: "https://liteai.com/config.json" }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    init: async () => {
      Env.set("CLOUDFLARE_ACCOUNT_ID", "test-account")
      Env.set("CLOUDFLARE_GATEWAY_ID", "test-gateway")
      Env.set("CLOUDFLARE_API_TOKEN", "test-token")
    },
    fn: async () => {
      const providers = await Provider.list()
      expect(providers["cloudflare-ai-gateway"]).toBeDefined()
    },
  })
})

test("cloudflare-ai-gateway forwards config metadata options", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, ".liteai", "settings.json"),
        JSON.stringify({
          $schema: "https://liteai.com/config.json",
          provider: {
            "cloudflare-ai-gateway": {
              options: {
                metadata: { invoked_by: "test", project: "liteai" },
              },
            },
          },
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    init: async () => {
      Env.set("CLOUDFLARE_ACCOUNT_ID", "test-account")
      Env.set("CLOUDFLARE_GATEWAY_ID", "test-gateway")
      Env.set("CLOUDFLARE_API_TOKEN", "test-token")
    },
    fn: async () => {
      const providers = await Provider.list()
      expect(providers["cloudflare-ai-gateway"]).toBeDefined()
      expect(providers["cloudflare-ai-gateway"].options.metadata).toEqual({
        invoked_by: "test",
        project: "liteai",
      })
    },
  })
})
