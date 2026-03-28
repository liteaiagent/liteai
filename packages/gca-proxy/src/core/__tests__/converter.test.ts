import { describe, expect, it } from "bun:test"
import type { GenerateContentConfig } from "@google/genai"
import {
  convertMessages,
  convertTools,
  extractReasoningAndText,
  extractToolCallsFromParts,
  mapFinishReason,
} from "../converter.js"

// ── convertMessages ────────────────────────────────────────────────────────

describe("convertMessages", () => {
  it("extracts system messages as systemInstruction", () => {
    const result = convertMessages([
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "Hello" },
    ])

    expect(result.systemInstruction).toBe("You are a helpful assistant.")
    expect(result.contents).toHaveLength(1)
    expect(result.contents[0]?.role).toBe("user")
  })

  it("joins multiple system messages", () => {
    const result = convertMessages([
      { role: "system", content: "Part 1" },
      { role: "system", content: "Part 2" },
      { role: "user", content: "Hi" },
    ])

    expect(result.systemInstruction).toBe("Part 1\n\nPart 2")
  })

  it("returns null systemInstruction when no system messages", () => {
    const result = convertMessages([{ role: "user", content: "Hello" }])

    expect(result.systemInstruction).toBeNull()
  })

  it("maps user to user and assistant to model", () => {
    const result = convertMessages([
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there" },
    ])

    expect(result.contents).toHaveLength(2)
    expect(result.contents[0]?.role).toBe("user")
    expect(result.contents[1]?.role).toBe("model")
  })

  it("merges consecutive same-role messages", () => {
    const result = convertMessages([
      { role: "user", content: "Part 1" },
      { role: "user", content: "Part 2" },
    ])

    expect(result.contents).toHaveLength(1)
    expect(result.contents[0]?.parts).toHaveLength(2)
  })

  it("converts assistant tool_calls to functionCall parts", () => {
    const result = convertMessages([
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: {
              name: "get_weather",
              arguments: '{"city": "London"}',
            },
          },
        ],
      },
    ])

    expect(result.contents).toHaveLength(1)
    expect(result.contents[0]?.role).toBe("model")
    const fc = result.contents[0]?.parts?.[0]?.functionCall
    expect(fc?.name).toBe("get_weather")
    expect(fc?.args).toEqual({ city: "London" })
  })

  it("converts tool result messages to functionResponse", () => {
    const result = convertMessages([
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "get_weather", arguments: "{}" },
          },
        ],
      },
      {
        role: "tool",
        content: '{"temp": 20}',
        tool_call_id: "call_1",
        name: "get_weather",
      },
    ])

    expect(result.contents).toHaveLength(2)
    // Tool results go as role "user" in Gemini format
    const toolContent = result.contents[1]
    expect(toolContent?.role).toBe("user")
    const fr = toolContent?.parts?.[0]?.functionResponse
    expect(fr?.name).toBe("get_weather")
    expect(fr?.response).toEqual({ temp: 20 })
  })

  it("handles multipart content (text + image)", () => {
    const result = convertMessages([
      {
        role: "user",
        content: [
          { type: "text", text: "What is this?" },
          {
            type: "image_url",
            image_url: { url: "data:image/png;base64,iVBOR" },
          },
        ],
      },
    ])

    expect(result.contents).toHaveLength(1)
    expect(result.contents[0]?.parts).toHaveLength(2)
    expect(result.contents[0]?.parts?.[0]?.text).toBe("What is this?")
    expect(result.contents[0]?.parts?.[1]?.inlineData).toBeDefined()
  })
})

// ── convertTools ───────────────────────────────────────────────────────────

describe("convertTools", () => {
  it("converts OpenAI tool definitions to Gemini format", () => {
    const config: GenerateContentConfig = {}
    convertTools(
      [
        {
          type: "function",
          function: {
            name: "get_weather",
            description: "Get weather info",
            parameters: {
              type: "object",
              properties: {
                city: { type: "string" },
              },
            },
          },
        },
      ],
      null,
      config,
    )

    expect(config.tools).toHaveLength(1)
    const decls = config.tools?.[0]
    expect("functionDeclarations" in (decls as Record<string, unknown>)).toBe(true)
  })

  it("does nothing for empty tools", () => {
    const config: GenerateContentConfig = {}
    convertTools([], null, config)
    expect(config.tools).toBeUndefined()
  })

  it("strips unsupported schema keys", () => {
    const config: GenerateContentConfig = {}
    convertTools(
      [
        {
          type: "function",
          function: {
            name: "test",
            parameters: {
              type: "object",
              $schema: "http://json-schema.org/draft-07/schema",
              additionalProperties: false,
              title: "TestSchema",
              properties: {
                name: { type: "string", default: "foo" },
              },
            },
          },
        },
      ],
      null,
      config,
    )

    const decls = (
      config.tools?.[0] as {
        functionDeclarations: Array<{ parameters: Record<string, unknown> }>
      }
    ).functionDeclarations
    const params = decls[0]?.parameters as Record<string, unknown>

    // These should be stripped
    expect(params.$schema).toBeUndefined()
    expect(params.additionalProperties).toBeUndefined()
    expect(params.title).toBeUndefined()
  })

  it("converts tool_choice string to function calling config", () => {
    const config: GenerateContentConfig = {}
    convertTools(
      [
        {
          type: "function",
          function: { name: "test" },
        },
      ],
      "required",
      config,
    )

    expect(config.toolConfig?.functionCallingConfig).toBeDefined()
    expect((config.toolConfig?.functionCallingConfig as Record<string, unknown>)?.mode).toBe("ANY")
  })

  it("resolves $ref references inline", () => {
    const config: GenerateContentConfig = {}
    convertTools(
      [
        {
          type: "function",
          function: {
            name: "test",
            parameters: {
              type: "object",
              properties: {
                option: { $ref: "#/$defs/QuestionOption" },
              },
              $defs: {
                QuestionOption: {
                  type: "string",
                  enum: ["a", "b", "c"],
                },
              },
            },
          },
        },
      ],
      null,
      config,
    )

    const decls = (
      config.tools?.[0] as {
        functionDeclarations: Array<{ parameters: Record<string, unknown> }>
      }
    ).functionDeclarations
    const props = (decls[0]?.parameters as Record<string, unknown>)?.properties as Record<
      string,
      Record<string, unknown>
    >
    // $ref should be resolved inline
    expect(props.option?.type).toBe("string")
    expect(props.option?.enum).toEqual(["a", "b", "c"])
  })
})

// ── extractToolCallsFromParts ──────────────────────────────────────────────

describe("extractToolCallsFromParts", () => {
  it("returns null for empty parts", () => {
    expect(extractToolCallsFromParts([])).toBeNull()
  })

  it("returns null for null/undefined", () => {
    expect(extractToolCallsFromParts(null)).toBeNull()
    expect(extractToolCallsFromParts(undefined)).toBeNull()
  })

  it("extracts tool calls from functionCall parts", () => {
    const result = extractToolCallsFromParts([{ functionCall: { name: "get_weather", args: { city: "London" } } }])

    expect(result).toHaveLength(1)
    expect(result?.[0]?.type).toBe("function")
    expect(result?.[0]?.function.name).toBe("get_weather")
    expect(result?.[0]?.function.arguments).toBe('{"city":"London"}')
    expect(result?.[0]?.id).toMatch(/^call_/)
  })

  it("ignores non-functionCall parts", () => {
    const result = extractToolCallsFromParts([{ text: "Hello" }, { functionCall: { name: "test", args: {} } }])

    expect(result).toHaveLength(1)
  })
})

// ── extractReasoningAndText ────────────────────────────────────────────────

describe("extractReasoningAndText", () => {
  it("returns empty strings for null/undefined", () => {
    expect(extractReasoningAndText(null)).toEqual({
      reasoning: "",
      text: "",
    })
    expect(extractReasoningAndText(undefined)).toEqual({
      reasoning: "",
      text: "",
    })
  })

  it("separates thought parts from text parts", () => {
    const result = extractReasoningAndText([
      { text: "thinking...", thought: true } as Record<string, unknown>,
      { text: "Hello!" },
    ] as Array<Record<string, unknown>>)

    expect(result.reasoning).toBe("thinking...")
    expect(result.text).toBe("Hello!")
  })

  it("concatenates multiple text parts", () => {
    const result = extractReasoningAndText([{ text: "Part 1" }, { text: "Part 2" }])

    expect(result.text).toBe("Part 1Part 2")
  })
})

// ── mapFinishReason ────────────────────────────────────────────────────────

describe("mapFinishReason", () => {
  it("maps STOP to stop", () => {
    expect(mapFinishReason("STOP")).toBe("stop")
  })

  it("maps COMPLETE to stop", () => {
    expect(mapFinishReason("COMPLETE")).toBe("stop")
  })

  it("maps MAX_TOKENS to length", () => {
    expect(mapFinishReason("MAX_TOKENS")).toBe("length")
  })

  it("maps SAFETY to content_filter", () => {
    expect(mapFinishReason("SAFETY")).toBe("content_filter")
  })

  it("maps RECITATION to content_filter", () => {
    expect(mapFinishReason("RECITATION")).toBe("content_filter")
  })

  it("returns null for unknown reasons", () => {
    expect(mapFinishReason("UNKNOWN")).toBeNull()
  })

  it("returns null for null/undefined", () => {
    expect(mapFinishReason(null)).toBeNull()
    expect(mapFinishReason(undefined)).toBeNull()
  })
})
