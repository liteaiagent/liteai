import { describe, expect, it } from "bun:test"
import { GenerateContentResponse } from "@google/genai"
import {
  fromCountTokenResponse,
  fromGenerateContentResponse,
  toContents,
  toCountTokenRequest,
  toGenerateContentRequest,
  toParts,
} from "../ca-converter.js"

// ── toContents ─────────────────────────────────────────────────────────────

describe("toContents", () => {
  it("wraps a string into a Content array", () => {
    const result = toContents("Hello")
    expect(result).toHaveLength(1)
    expect(result[0]?.role).toBe("user")
    expect(result[0]?.parts?.[0]?.text).toBe("Hello")
  })

  it("passes through Content objects in an array", () => {
    const result = toContents([
      { role: "user", parts: [{ text: "Hello" }] },
      { role: "model", parts: [{ text: "Hi" }] },
    ])
    expect(result).toHaveLength(2)
    expect(result[0]?.role).toBe("user")
    expect(result[1]?.role).toBe("model")
  })

  it("handles a single Content object (non-array)", () => {
    const result = toContents({ role: "user", parts: [{ text: "Hi" }] })
    expect(result).toHaveLength(1)
    expect(result[0]?.role).toBe("user")
  })
})

// ── toParts ────────────────────────────────────────────────────────────────

describe("toParts", () => {
  it("converts string parts to text parts", () => {
    const result = toParts(["Hello", "World"])
    expect(result).toEqual([{ text: "Hello" }, { text: "World" }])
  })

  it("passes through Part objects", () => {
    const result = toParts([{ text: "Hello" }])
    expect(result).toEqual([{ text: "Hello" }])
  })

  it("strips thought flag and combines text", () => {
    const thoughtPart = { text: "existing text", thought: true } as Record<string, unknown>
    const result = toParts([thoughtPart as never])
    const p = result[0] as Record<string, unknown>
    // thought should be removed, text should include thought content
    expect(p.thought).toBeUndefined()
    expect(typeof p.text).toBe("string")
  })
})

// ── toGenerateContentRequest ───────────────────────────────────────────────

describe("toGenerateContentRequest", () => {
  it("wraps request in Code Assist envelope", () => {
    const result = toGenerateContentRequest(
      {
        model: "gemini-2.5-pro",
        contents: [{ role: "user", parts: [{ text: "Hello" }] }],
      },
      "prompt-123",
      "my-project",
      "session-456",
    )

    expect(result.model).toBe("gemini-2.5-pro")
    expect(result.project).toBe("my-project")
    expect(result.user_prompt_id).toBe("prompt-123")
    expect(result.request.contents).toHaveLength(1)
    expect(result.request.session_id).toBe("session-456")
  })

  it("passes through generation config", () => {
    const result = toGenerateContentRequest(
      {
        model: "gemini-2.5-flash",
        contents: "Hello",
        config: {
          temperature: 0.5,
          maxOutputTokens: 1000,
          thinkingConfig: { thinkingBudget: 4096 },
        },
      },
      "prompt-1",
    )

    const genConfig = result.request.generationConfig
    expect(genConfig?.temperature).toBe(0.5)
    expect(genConfig?.maxOutputTokens).toBe(1000)
    expect(genConfig?.thinkingConfig?.thinkingBudget).toBe(4096)
  })

  it("converts systemInstruction to Content", () => {
    const result = toGenerateContentRequest(
      {
        model: "gemini-2.5-pro",
        contents: "Hello",
        config: {
          systemInstruction: "You are helpful",
        },
      },
      "prompt-1",
    )

    expect(result.request.systemInstruction).toBeDefined()
    expect(result.request.systemInstruction?.parts?.[0]?.text).toBe("You are helpful")
  })
})

// ── fromGenerateContentResponse ────────────────────────────────────────────

describe("fromGenerateContentResponse", () => {
  it("converts a Code Assist response to SDK response", () => {
    const result = fromGenerateContentResponse({
      traceId: "trace-123",
      response: {
        candidates: [
          {
            content: { role: "model", parts: [{ text: "Hello!" }] },
            finishReason: "STOP" as never,
          },
        ],
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 5,
          totalTokenCount: 15,
        },
      },
    })

    expect(result).toBeInstanceOf(GenerateContentResponse)
    expect(result.responseId).toBe("trace-123")
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates?.[0]?.content?.parts?.[0]?.text).toBe("Hello!")
    expect(result.usageMetadata?.promptTokenCount).toBe(10)
  })

  it("handles empty response", () => {
    const result = fromGenerateContentResponse({})
    expect(result.candidates).toEqual([])
  })
})

// ── toCountTokenRequest / fromCountTokenResponse ───────────────────────────

describe("toCountTokenRequest", () => {
  it("wraps count token params in CA envelope", () => {
    const result = toCountTokenRequest({
      model: "gemini-2.5-pro",
      contents: [{ role: "user", parts: [{ text: "Hello" }] }],
    })

    expect(result.request.model).toBe("models/gemini-2.5-pro")
    expect(result.request.contents).toHaveLength(1)
  })
})

describe("fromCountTokenResponse", () => {
  it("extracts totalTokens", () => {
    const result = fromCountTokenResponse({ totalTokens: 42 })
    expect(result.totalTokens).toBe(42)
  })

  it("defaults to 0 when totalTokens is missing", () => {
    const result = fromCountTokenResponse({})
    expect(result.totalTokens).toBe(0)
  })
})
