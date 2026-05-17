import { describe, expect, test } from "bun:test"
import type { LanguageModelV2Prompt } from "@ai-sdk/provider"
import { fromCandidate, fromResponse, mapFinish, toRequest } from "../../../../src/provider/sdk/code-assist/converter"
import type { CACandidate, CAGenerateContentResponse } from "../../../../src/provider/sdk/code-assist/types"

// ── toRequest ──────────────────────────────────────────────────────────

describe("toRequest", () => {
  test("basic user message", () => {
    const prompt: LanguageModelV2Prompt = [{ role: "user", content: [{ type: "text", text: "hello" }] }]
    const req = toRequest({ model: "gemini-2.5-pro", prompt })
    expect(req.model).toBe("gemini-2.5-pro")
    expect(req.user_prompt_id).toBeDefined()
    expect(req.request.contents).toHaveLength(1)
    expect(req.request.contents[0].role).toBe("user")
    expect(req.request.contents[0].parts).toEqual([{ text: "hello" }])
  })

  test("system instruction extracted", () => {
    const prompt: LanguageModelV2Prompt = [
      { role: "system", content: "you are helpful" },
      { role: "user", content: [{ type: "text", text: "hi" }] },
    ]
    const req = toRequest({ model: "m", prompt })
    expect(req.request.systemInstruction).toBeDefined()
    expect(req.request.systemInstruction?.parts).toEqual([{ text: "you are helpful" }])
    // system messages should not appear in contents
    expect(req.request.contents.every((c) => c.parts.every((p) => p.text !== "you are helpful"))).toBe(true)
  })

  test("multiple system messages merged", () => {
    const prompt: LanguageModelV2Prompt = [
      { role: "system", content: "rule 1" },
      { role: "system", content: "rule 2" },
      { role: "user", content: [{ type: "text", text: "go" }] },
    ]
    const req = toRequest({ model: "m", prompt })
    expect(req.request.systemInstruction?.parts).toHaveLength(2)
  })

  test("assistant text and reasoning round-trip", () => {
    const prompt: LanguageModelV2Prompt = [
      { role: "user", content: [{ type: "text", text: "q" }] },
      {
        role: "assistant",
        content: [
          {
            type: "reasoning",
            text: "thinking...",
            providerOptions: { "code-assist": { thoughtSignature: "sig1" } },
          },
          { type: "text", text: "answer" },
        ],
      },
    ]
    const req = toRequest({ model: "m", prompt })
    const model = req.request.contents.find((c) => c.role === "model")
    if (!model) throw new Error("expected model")
    expect(model.parts[0]).toEqual({ text: "thinking...", thought: true, thoughtSignature: "sig1" })
    expect(model.parts[1]).toEqual({ text: "answer" })
  })

  test("assistant text and reasoning interleaving is sorted correctly", () => {
    const prompt: LanguageModelV2Prompt = [
      { role: "user", content: [{ type: "text", text: "q" }] },
      {
        role: "assistant",
        content: [
          {
            type: "reasoning",
            text: "thinking 1...",
            providerOptions: { "code-assist": { thoughtSignature: "sig1" } },
          },
          { type: "text", text: "text break" },
          {
            type: "reasoning",
            text: "thinking 2...",
            providerOptions: { "code-assist": { thoughtSignature: "sig2" } },
          },
          { type: "text", text: "final answer" },
        ],
      },
    ]
    const req = toRequest({ model: "m", prompt })
    const model = req.request.contents.find((c) => c.role === "model")
    if (!model) throw new Error("expected model")

    // Thoughts should all be pulled to the front
    expect(model.parts[0]).toEqual({ text: "thinking 1...", thought: true, thoughtSignature: "sig1" })
    expect(model.parts[1]).toEqual({ text: "thinking 2...", thought: true, thoughtSignature: "sig2" })
    // Regular text follows
    expect(model.parts[2]).toEqual({ text: "text break" })
    expect(model.parts[3]).toEqual({ text: "final answer" })
  })

  test("assistant tool-call part", () => {
    const prompt: LanguageModelV2Prompt = [
      { role: "user", content: [{ type: "text", text: "q" }] },
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "tc1",
            toolName: "search",
            input: JSON.stringify({ q: "test" }),
          },
        ],
      },
    ]
    const req = toRequest({ model: "m", prompt })
    const model = req.request.contents.find((c) => c.role === "model")
    if (!model) throw new Error("expected model")
    expect(model.parts[0].functionCall).toEqual({ name: "search", args: { q: "test" } })
  })

  test("assistant tool-call with thoughtSignature", () => {
    const prompt: LanguageModelV2Prompt = [
      { role: "user", content: [{ type: "text", text: "q" }] },
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "tc1",
            toolName: "search",
            input: { q: "test" },
            providerOptions: { "code-assist": { thoughtSignature: "sig2" } },
          },
        ],
      },
    ]
    const req = toRequest({ model: "m", prompt })
    const model = req.request.contents.find((c) => c.role === "model")
    if (!model) throw new Error("expected model")
    expect(model.parts[0].thought).toBe(true)
    expect(model.parts[0].thoughtSignature).toBe("sig2")
  })

  test("assistant multiple tool-calls receive synthetic thoughtSignature if missing", () => {
    const prompt: LanguageModelV2Prompt = [
      { role: "user", content: [{ type: "text", text: "q" }] },
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "tc1",
            toolName: "search",
            input: { q: "test1" },
          },
          {
            type: "tool-call",
            toolCallId: "tc2",
            toolName: "fetch",
            input: { url: "test2" },
          },
        ],
      },
    ]
    const req = toRequest({ model: "m", prompt })
    const model = req.request.contents.find((c) => c.role === "model")
    if (!model) throw new Error("expected model")
    expect(model.parts[0].thoughtSignature).toBe("skip_thought_signature_validator")
    expect(model.parts[1].thoughtSignature).toBe("skip_thought_signature_validator")
  })

  test("tool result in tool role → user content", () => {
    const prompt: LanguageModelV2Prompt = [
      { role: "user", content: [{ type: "text", text: "q" }] },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "tc1",
            toolName: "search",
            output: { type: "text", value: "result text" },
          },
        ],
      },
    ]
    const req = toRequest({ model: "m", prompt })
    const last = req.request.contents.at(-1)
    if (!last) throw new Error("expected last")
    expect(last.role).toBe("user")
    expect(last.parts[0].functionResponse).toEqual({ name: "search", response: { result: "result text" } })
  })

  test("tool result json output", () => {
    const prompt: LanguageModelV2Prompt = [
      { role: "user", content: [{ type: "text", text: "q" }] },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "tc1",
            toolName: "fn",
            output: { type: "json", value: { a: 1 } },
          },
        ],
      },
    ]
    const req = toRequest({ model: "m", prompt })
    const last = req.request.contents.at(-1)
    if (!last) throw new Error("expected last")
    const part = last.parts[0]
    expect(part.functionResponse?.response.result).toBe(JSON.stringify({ a: 1 }))
  })

  test("tool result content output extracts text", () => {
    const prompt: LanguageModelV2Prompt = [
      { role: "user", content: [{ type: "text", text: "q" }] },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "tc1",
            toolName: "fn",
            output: {
              type: "content",
              value: [
                { type: "text", text: "line1" },
                { type: "text", text: "line2" },
              ],
            },
          },
        ],
      },
    ]
    const req = toRequest({ model: "m", prompt })
    const last = req.request.contents.at(-1)
    if (!last) throw new Error("expected last")
    const part = last.parts[0]
    expect(part.functionResponse?.response.result).toBe("line1\nline2")
  })

  test("user file part with URL", () => {
    const prompt: LanguageModelV2Prompt = [
      {
        role: "user",
        content: [{ type: "file", mediaType: "image/png", data: "https://example.com/image.png" }],
      },
    ]
    const req = toRequest({ model: "m", prompt })
    expect(req.request.contents[0].parts[0].fileData).toEqual({
      mimeType: "image/png",
      fileUri: "https://example.com/image.png",
    })
  })

  test("user file part with base64 string", () => {
    const prompt: LanguageModelV2Prompt = [
      {
        role: "user",
        content: [{ type: "file", mediaType: "image/jpeg", data: "abc123base64" }],
      },
    ]
    const req = toRequest({ model: "m", prompt })
    expect(req.request.contents[0].parts[0].inlineData).toEqual({
      mimeType: "image/jpeg",
      data: "abc123base64",
    })
  })

  test("user file part with Uint8Array", () => {
    const prompt: LanguageModelV2Prompt = [
      {
        role: "user",
        content: [{ type: "file", mediaType: "image/png", data: new Uint8Array([1, 2, 3]) }],
      },
    ]
    const req = toRequest({ model: "m", prompt })
    const part = req.request.contents[0].parts[0]
    expect(part.inlineData).toBeDefined()
    expect(part.inlineData?.mimeType).toBe("image/png")
    // should be base64 encoded
    expect(part.inlineData?.data).toBe(Buffer.from([1, 2, 3]).toString("base64"))
  })

  test("generation config from options", () => {
    const prompt: LanguageModelV2Prompt = [{ role: "user", content: [{ type: "text", text: "hi" }] }]
    const req = toRequest({
      model: "m",
      prompt,
      temperature: 0.5,
      maxOutputTokens: 1000,
      topP: 0.9,
      topK: 40,
      stopSequences: ["END"],
    })
    const cfg = req.request.generationConfig
    if (!cfg) throw new Error("expected cfg")
    expect(cfg.temperature).toBe(0.5)
    expect(cfg.maxOutputTokens).toBe(1000)
    expect(cfg.topP).toBe(0.9)
    expect(cfg.topK).toBe(40)
    expect(cfg.stopSequences).toEqual(["END"])
    // thinking always enabled
    expect(cfg.thinkingConfig?.includeThoughts).toBe(true)
  })

  test("thinkingBudget from providerOptions", () => {
    const prompt: LanguageModelV2Prompt = [{ role: "user", content: [{ type: "text", text: "hi" }] }]
    const req = toRequest({
      model: "m",
      prompt,
      providerOptions: { "code-assist": { thinkingBudget: 2048 } },
    })
    expect(req.request.generationConfig?.thinkingConfig?.thinkingBudget).toBe(2048)
  })

  test("tools converted to functionDeclarations", () => {
    const prompt: LanguageModelV2Prompt = [{ role: "user", content: [{ type: "text", text: "hi" }] }]
    const req = toRequest({
      model: "m",
      prompt,
      tools: [{ name: "search", description: "search for stuff", inputSchema: { type: "object" } }],
    })
    expect(req.request.tools).toHaveLength(1)
    expect(req.request.tools?.[0].functionDeclarations?.[0].name).toBe("search")
  })

  test("toolChoice none", () => {
    const prompt: LanguageModelV2Prompt = [{ role: "user", content: [{ type: "text", text: "hi" }] }]
    const req = toRequest({ model: "m", prompt, toolChoice: { type: "none" } })
    expect(req.request.toolConfig?.functionCallingConfig?.mode).toBe("NONE")
  })

  test("toolChoice auto", () => {
    const prompt: LanguageModelV2Prompt = [{ role: "user", content: [{ type: "text", text: "hi" }] }]
    const req = toRequest({ model: "m", prompt, toolChoice: { type: "auto" } })
    expect(req.request.toolConfig?.functionCallingConfig?.mode).toBe("AUTO")
  })

  test("toolChoice required", () => {
    const prompt: LanguageModelV2Prompt = [{ role: "user", content: [{ type: "text", text: "hi" }] }]
    const req = toRequest({ model: "m", prompt, toolChoice: { type: "required" } })
    expect(req.request.toolConfig?.functionCallingConfig?.mode).toBe("ANY")
  })

  test("toolChoice tool with name", () => {
    const prompt: LanguageModelV2Prompt = [{ role: "user", content: [{ type: "text", text: "hi" }] }]
    const req = toRequest({ model: "m", prompt, toolChoice: { type: "tool", toolName: "search" } })
    expect(req.request.toolConfig?.functionCallingConfig?.mode).toBe("ANY")
    expect(req.request.toolConfig?.functionCallingConfig?.allowedFunctionNames).toEqual(["search"])
  })

  test("project passed through", () => {
    const prompt: LanguageModelV2Prompt = [{ role: "user", content: [{ type: "text", text: "hi" }] }]
    const req = toRequest({ model: "m", prompt, project: "my-project" })
    expect(req.project).toBe("my-project")
  })

  test("strips $schema and $ref from tool schema", () => {
    const prompt: LanguageModelV2Prompt = [{ role: "user", content: [{ type: "text", text: "hi" }] }]
    const req = toRequest({
      model: "m",
      prompt,
      tools: [
        {
          name: "t",
          inputSchema: {
            $schema: "http://json-schema.org/draft-07/schema#",
            type: "object",
            properties: {
              name: { $ref: "#/$defs/Name" },
            },
            $defs: {
              Name: { type: "string", description: "A name" },
            },
          },
        },
      ],
    })
    const decl = req.request.tools?.[0]?.functionDeclarations?.[0]
    if (!decl) throw new Error("expected decl")
    const params = decl.parameters
    if (!params) throw new Error("expected params")
    // $schema stripped
    expect(params.$schema).toBeUndefined()
    // $defs stripped
    expect(params.$defs).toBeUndefined()
    // $ref resolved inline
    const props = params.properties as Record<string, Record<string, unknown>>
    expect(props.name.type).toBe("string")
    expect(props.name.description).toBe("A name")
  })

  test("assistant tool-result with error-text output", () => {
    const prompt: LanguageModelV2Prompt = [
      { role: "user", content: [{ type: "text", text: "q" }] },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "tc1",
            toolName: "fn",
            output: { type: "error-text", value: "something went wrong" },
          },
        ],
      },
    ]
    const req = toRequest({ model: "m", prompt })
    const last = req.request.contents.at(-1)
    if (!last) throw new Error("expected last")
    const part = last.parts[0]
    expect(part.functionResponse?.response.result).toBe("something went wrong")
  })

  test("assistant tool-result with error-json output", () => {
    const prompt: LanguageModelV2Prompt = [
      { role: "user", content: [{ type: "text", text: "q" }] },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "tc1",
            toolName: "fn",
            output: { type: "error-json", value: { code: 500 } },
          },
        ],
      },
    ]
    const req = toRequest({ model: "m", prompt })
    const last = req.request.contents.at(-1)
    if (!last) throw new Error("expected last")
    const part = last.parts[0]
    expect(part.functionResponse?.response.result).toBe(JSON.stringify({ code: 500 }))
  })
})

// ── fromResponse / fromCandidate ────────────────────────────────────

describe("fromResponse", () => {
  test("basic text response", () => {
    const res: CAGenerateContentResponse = {
      response: {
        candidates: [{ content: { role: "model", parts: [{ text: "hello" }] }, finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
      },
      traceId: "trace-1",
    }
    const parsed = fromResponse(res)
    expect(parsed.content).toHaveLength(1)
    expect(parsed.content[0]).toEqual({ type: "text", text: "hello" })
    expect(parsed.finish).toBe("STOP")
    expect(parsed.usage.input).toBe(10)
    expect(parsed.usage.output).toBe(5)
    expect(parsed.usage.total).toBe(15)
    expect(parsed.id).toBe("trace-1")
  })

  test("thought parts become reasoning content", () => {
    const res: CAGenerateContentResponse = {
      response: {
        candidates: [
          {
            content: {
              role: "model",
              parts: [{ text: "thinking...", thought: true, thoughtSignature: "sig1" }, { text: "answer" }],
            },
            finishReason: "STOP",
          },
        ],
      },
    }
    const parsed = fromResponse(res)
    expect(parsed.content[0]).toEqual({
      type: "reasoning",
      text: "thinking...",
      providerMetadata: { "code-assist": { thoughtSignature: "sig1" } },
    })
    expect(parsed.content[1]).toEqual({ type: "text", text: "answer" })
  })

  test("thought without signature omits providerMetadata", () => {
    const res: CAGenerateContentResponse = {
      response: {
        candidates: [
          {
            content: {
              role: "model",
              parts: [{ text: "thinking...", thought: true }],
            },
            finishReason: "STOP",
          },
        ],
      },
    }
    const parsed = fromResponse(res)
    expect(parsed.content[0]).toEqual({
      type: "reasoning",
      text: "thinking...",
      providerMetadata: undefined,
    })
  })

  test("function call response", () => {
    const res: CAGenerateContentResponse = {
      response: {
        candidates: [
          {
            content: {
              role: "model",
              parts: [{ functionCall: { name: "search", args: { q: "test" } } }],
            },
            finishReason: "FUNCTION_CALL",
          },
        ],
      },
    }
    const parsed = fromResponse(res)
    expect(parsed.content[0].type).toBe("tool-call")
    const tc = parsed.content[0] as { type: "tool-call"; toolName: string; input: string; toolCallId: string }
    expect(tc.toolName).toBe("search")
    expect(JSON.parse(tc.input)).toEqual({ q: "test" })
    expect(tc.toolCallId).toBeDefined()
  })

  test("function call with thoughtSignature", () => {
    const res: CAGenerateContentResponse = {
      response: {
        candidates: [
          {
            content: {
              role: "model",
              parts: [{ functionCall: { name: "fn", args: {} }, thoughtSignature: "sig" }],
            },
            finishReason: "FUNCTION_CALL",
          },
        ],
      },
    }
    const parsed = fromResponse(res)
    const tc = parsed.content[0] as { providerMetadata?: Record<string, unknown> }
    expect(tc.providerMetadata).toEqual({ "code-assist": { thoughtSignature: "sig" } })
  })

  test("modelVersion", () => {
    const res: CAGenerateContentResponse = {
      response: {
        candidates: [{ content: { parts: [] }, finishReason: "STOP" }],
        modelVersion: "gemini-2.5-pro-exp-03-25",
      },
    }
    const parsed = fromResponse(res)
    expect(parsed.model).toBe("gemini-2.5-pro-exp-03-25")
  })

  test("empty candidates", () => {
    const res: CAGenerateContentResponse = { response: { candidates: [] } }
    const parsed = fromResponse(res)
    expect(parsed.content).toEqual([])
    expect(parsed.finish).toBe("unknown")
  })

  test("missing response", () => {
    const res: CAGenerateContentResponse = {}
    const parsed = fromResponse(res)
    expect(parsed.content).toEqual([])
    expect(parsed.finish).toBe("unknown")
  })

  test("usage with thoughtsTokenCount", () => {
    const res: CAGenerateContentResponse = {
      response: {
        candidates: [{ content: { parts: [] }, finishReason: "STOP" }],
        usageMetadata: {
          promptTokenCount: 100,
          candidatesTokenCount: 50,
          totalTokenCount: 200,
          thoughtsTokenCount: 50,
        },
      },
    }
    const parsed = fromResponse(res)
    expect(parsed.usage.reasoning).toBe(50)
  })
})

describe("fromCandidate", () => {
  test("undefined candidate returns empty", () => {
    expect(fromCandidate(undefined)).toEqual([])
  })

  test("candidate without parts returns empty", () => {
    expect(fromCandidate({ content: { parts: undefined } } as CACandidate)).toEqual([])
  })

  test("candidate without content returns empty", () => {
    expect(fromCandidate({} as CACandidate)).toEqual([])
  })
})

// ── mapFinish ───────────────────────────────────────────────────────────

describe("mapFinish", () => {
  test("STOP → stop", () => expect(mapFinish("STOP")).toBe("stop"))
  test("MAX_TOKENS → length", () => expect(mapFinish("MAX_TOKENS")).toBe("length"))
  test("TOOL_CALL → tool-calls", () => expect(mapFinish("TOOL_CALL")).toBe("tool-calls"))
  test("FUNCTION_CALL → tool-calls", () => expect(mapFinish("FUNCTION_CALL")).toBe("tool-calls"))
  test("SAFETY → content-filter", () => expect(mapFinish("SAFETY")).toBe("content-filter"))
  test("BLOCKLIST → content-filter", () => expect(mapFinish("BLOCKLIST")).toBe("content-filter"))
  test("PROHIBITED_CONTENT → content-filter", () => expect(mapFinish("PROHIBITED_CONTENT")).toBe("content-filter"))
  test("SPII → content-filter", () => expect(mapFinish("SPII")).toBe("content-filter"))
  test("MALFORMED_FUNCTION_CALL → content-filter", () =>
    expect(mapFinish("MALFORMED_FUNCTION_CALL")).toBe("content-filter"))
  test("RECITATION → other", () => expect(mapFinish("RECITATION")).toBe("other"))
  test("unknown string → other", () => expect(mapFinish("WHATEVER")).toBe("other"))
  test("undefined → unknown", () => expect(mapFinish(undefined)).toBe("unknown"))
})
