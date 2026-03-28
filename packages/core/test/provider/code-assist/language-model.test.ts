import { describe, expect, test } from "bun:test"
import type { LanguageModelV2CallOptions, LanguageModelV2StreamPart } from "@ai-sdk/provider"
import type { FetchFunction } from "@ai-sdk/provider-utils"
import { CodeAssistLanguageModel } from "../../../src/provider/sdk/code-assist/language-model"
import type { CAGenerateContentResponse } from "../../../src/provider/sdk/code-assist/types"

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } })
}

function opts(overrides: Partial<LanguageModelV2CallOptions> = {}): LanguageModelV2CallOptions {
  return {
    prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    ...overrides,
  }
}

// ── constructor ────────────────────────────────────────────────────

describe("CodeAssistLanguageModel", () => {
  test("has correct spec and metadata", () => {
    const model = new CodeAssistLanguageModel({ provider: "ca.chat", model: "gemini-2.5-pro" })
    expect(model.specificationVersion).toBe("v2")
    expect(model.modelId).toBe("gemini-2.5-pro")
    expect(model.provider).toBe("ca.chat")
    expect(model.supportsStructuredOutputs).toBe(false)
  })

  // ── doGenerate ──────────────────────────────────────────────────

  describe("doGenerate", () => {
    test("returns content, usage, and finish reason", async () => {
      const body: CAGenerateContentResponse = {
        response: {
          candidates: [{ content: { role: "model", parts: [{ text: "hello" }] }, finishReason: "STOP" }],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
        },
        traceId: "t1",
      }
      const model = new CodeAssistLanguageModel({
        provider: "ca.chat",
        model: "m",
        fetch: (async () => ok(body)) as unknown as FetchFunction,
      })
      const result = await model.doGenerate(opts())
      expect(result.content).toHaveLength(1)
      expect(result.content[0]).toEqual({ type: "text", text: "hello" })
      expect(result.finishReason).toBe("stop")
      expect(result.usage.inputTokens).toBe(10)
      expect(result.usage.outputTokens).toBe(5)
      expect(result.response?.id).toBe("t1")
      expect(result.warnings).toEqual([])
    })

    test("includes request body as string", async () => {
      const body: CAGenerateContentResponse = {
        response: { candidates: [{ content: { parts: [] }, finishReason: "STOP" }] },
      }
      const model = new CodeAssistLanguageModel({
        provider: "ca.chat",
        model: "m",
        fetch: (async () => ok(body)) as unknown as FetchFunction,
      })
      const result = await model.doGenerate(opts())
      expect(typeof result.request?.body).toBe("string")
      expect(JSON.parse(result.request?.body as string)).toBeDefined()
    })

    test("reasoning tokens in usage", async () => {
      const body: CAGenerateContentResponse = {
        response: {
          candidates: [
            { content: { parts: [{ text: "think", thought: true }, { text: "answer" }] }, finishReason: "STOP" },
          ],
          usageMetadata: {
            promptTokenCount: 10,
            candidatesTokenCount: 20,
            totalTokenCount: 40,
            thoughtsTokenCount: 10,
          },
        },
      }
      const model = new CodeAssistLanguageModel({
        provider: "ca.chat",
        model: "m",
        fetch: (async () => ok(body)) as unknown as FetchFunction,
      })
      const result = await model.doGenerate(opts())
      expect(result.usage.reasoningTokens).toBe(10)
    })

    test("passes tools through", async () => {
      let captured = ""
      const body: CAGenerateContentResponse = {
        response: { candidates: [{ content: { parts: [] }, finishReason: "STOP" }] },
      }
      const model = new CodeAssistLanguageModel({
        provider: "ca.chat",
        model: "m",
        fetch: (async (_url: string, init: RequestInit) => {
          captured = init.body as string
          return ok(body)
        }) as unknown as FetchFunction,
      })
      await model.doGenerate(
        opts({
          tools: [{ type: "function", name: "search", description: "search", inputSchema: { type: "object" } }],
        }),
      )
      const parsed = JSON.parse(captured)
      expect(parsed.request.tools[0].functionDeclarations[0].name).toBe("search")
    })
  })

  // ── doStream ────────────────────────────────────────────────────

  describe("doStream", () => {
    function sse(...chunks: CAGenerateContentResponse[]): Response {
      const body = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("")
      return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } })
    }

    async function drain(model: CodeAssistLanguageModel, options = opts()) {
      const { stream } = await model.doStream(options)
      const parts: LanguageModelV2StreamPart[] = []
      const reader = stream.getReader()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        parts.push(value)
      }
      return parts
    }

    test("emits stream-start, text events, and finish", async () => {
      const model = new CodeAssistLanguageModel({
        provider: "ca.chat",
        model: "m",
        fetch: (async () =>
          sse({
            response: {
              candidates: [{ content: { parts: [{ text: "hi" }] }, finishReason: "STOP" }],
              usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
            },
            traceId: "t",
          })) as unknown as FetchFunction,
      })
      const parts = await drain(model)
      const types = parts.map((p) => p.type)
      expect(types).toContain("stream-start")
      expect(types).toContain("text-start")
      expect(types).toContain("text-delta")
      expect(types).toContain("text-end")
      expect(types).toContain("finish")
    })

    test("emits reasoning events for thought parts", async () => {
      const model = new CodeAssistLanguageModel({
        provider: "ca.chat",
        model: "m",
        fetch: (async () =>
          sse(
            {
              response: {
                candidates: [{ content: { parts: [{ text: "thinking", thought: true }] } }],
              },
              traceId: "t",
            },
            {
              response: {
                candidates: [{ content: { parts: [{ text: "answer" }] }, finishReason: "STOP" }],
                usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
              },
            },
          )) as unknown as FetchFunction,
      })
      const parts = await drain(model)
      const types = parts.map((p) => p.type)
      expect(types).toContain("reasoning-start")
      expect(types).toContain("reasoning-delta")
      expect(types).toContain("reasoning-end")
      expect(types).toContain("text-start")
      expect(types).toContain("text-delta")
      expect(types).toContain("text-end")
    })

    test("emits tool-call events for function calls", async () => {
      const model = new CodeAssistLanguageModel({
        provider: "ca.chat",
        model: "m",
        fetch: (async () =>
          sse({
            response: {
              candidates: [
                {
                  content: {
                    parts: [{ functionCall: { name: "search", args: { q: "test" } } }],
                  },
                  finishReason: "FUNCTION_CALL",
                },
              ],
              usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
            },
            traceId: "t",
          })) as unknown as FetchFunction,
      })
      const parts = await drain(model)
      const types = parts.map((p) => p.type)
      expect(types).toContain("tool-input-start")
      expect(types).toContain("tool-input-delta")
      expect(types).toContain("tool-input-end")
      expect(types).toContain("tool-call")
      const tc = parts.find((p) => p.type === "tool-call") as unknown as Record<string, unknown>
      expect(tc.toolName).toBe("search")
      expect(JSON.parse(tc.input as string)).toEqual({ q: "test" })
    })

    test("response-metadata emitted from first chunk", async () => {
      const model = new CodeAssistLanguageModel({
        provider: "ca.chat",
        model: "m",
        fetch: (async () =>
          sse({
            response: {
              candidates: [{ content: { parts: [{ text: "x" }] }, finishReason: "STOP" }],
              usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
              modelVersion: "gemini-2.5-pro-exp-03-25",
            },
            traceId: "trace-abc",
          })) as unknown as FetchFunction,
      })
      const parts = await drain(model)
      const meta = parts.find((p) => p.type === "response-metadata") as unknown as Record<string, unknown>
      expect(meta).toBeDefined()
      expect(meta.id).toBe("trace-abc")
      expect(meta.modelId).toBe("gemini-2.5-pro-exp-03-25")
    })

    test("reasoning end carries thoughtSignature via providerMetadata", async () => {
      const model = new CodeAssistLanguageModel({
        provider: "ca.chat",
        model: "m",
        fetch: (async () =>
          sse({
            response: {
              candidates: [
                {
                  content: {
                    parts: [{ text: "think", thought: true, thoughtSignature: "sig123" }, { text: "answer" }],
                  },
                  finishReason: "STOP",
                },
              ],
              usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
            },
          })) as unknown as FetchFunction,
      })
      const parts = await drain(model)
      const end = parts.find((p) => p.type === "reasoning-end") as unknown as Record<string, unknown>
      expect(end.providerMetadata).toEqual({ "code-assist": { thoughtSignature: "sig123" } })
    })

    test("includes request body in response", async () => {
      const model = new CodeAssistLanguageModel({
        provider: "ca.chat",
        model: "m",
        fetch: (async () =>
          new Response("", {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          })) as unknown as FetchFunction,
      })
      const result = await model.doStream(opts())
      expect(typeof result.request?.body).toBe("string")
    })
  })
})
