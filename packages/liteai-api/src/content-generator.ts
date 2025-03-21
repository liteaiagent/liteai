/**
 * Content generation — SDK and Code Assist wrapper.
 *
 * Aligned with gemini-cli/packages/core ContentGenerator interface:
 * Uses GenerateContentParameters as the single request type.
 */

import type {
  CountTokensParameters,
  CountTokensResponse,
  EmbedContentParameters,
  EmbedContentResponse,
  GenerateContentParameters,
  GenerateContentResponse,
  GoogleGenAI,
} from "@google/genai"
import type { CodeAssistClient } from "./auth/code-assist-client.js"
import { InvalidStreamError } from "./auth/retry.js"
import { logTelemetry, type TelemetryEntry } from "./core/telemetry.js"

// ── Content Generator Interface ────────────────────────────────────────────

/**
 * Content generation interface aligned with gemini-cli's ContentGenerator.
 *
 * Uses `GenerateContentParameters` (single object with model, contents, config)
 * instead of separate positional args.
 */
export interface ContentGenerator {
  generateContent(req: GenerateContentParameters): Promise<GenerateContentResponse>

  generateContentStream(req: GenerateContentParameters): AsyncGenerator<GenerateContentResponse>

  countTokens?(req: GenerateContentParameters): Promise<CountTokensResponse>

  /** Placeholder — gemini-cli defines this but throws NotImplemented. */
  embedContent?(req: EmbedContentParameters): Promise<EmbedContentResponse>
}

// ── SDK Content Generator ──────────────────────────────────────────────────

export class SdkContentGenerator implements ContentGenerator {
  private client: GoogleGenAI

  constructor(client: GoogleGenAI) {
    this.client = client
  }

  async generateContent(req: GenerateContentParameters): Promise<GenerateContentResponse> {
    return this.client.models.generateContent(req)
  }

  async *generateContentStream(req: GenerateContentParameters): AsyncGenerator<GenerateContentResponse> {
    const stream = await this.client.models.generateContentStream(req)
    for await (const chunk of stream) {
      yield chunk
    }
  }

  async countTokens(req: GenerateContentParameters): Promise<CountTokensResponse> {
    const countReq: CountTokensParameters = {
      model: req.model,
      contents: req.contents,
    }
    return this.client.models.countTokens(countReq)
  }

  async embedContent(req: EmbedContentParameters): Promise<EmbedContentResponse> {
    return this.client.models.embedContent(req)
  }
}

// ── Code Assist Content Generator ──────────────────────────────────────────

export class CodeAssistContentGenerator implements ContentGenerator {
  private client: CodeAssistClient

  constructor(client: CodeAssistClient) {
    this.client = client
  }

  async generateContent(req: GenerateContentParameters): Promise<GenerateContentResponse> {
    const start = Date.now()
    let error: string | undefined
    try {
      const response = await this.client.generateContent(req)
      this.emitTelemetry(req, response, Date.now() - start, false)
      return response
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
      this.emitTelemetry(req, undefined, Date.now() - start, false, error)
      throw err
    }
  }

  async *generateContentStream(req: GenerateContentParameters): AsyncGenerator<GenerateContentResponse> {
    const start = Date.now()
    let lastChunk: GenerateContentResponse | undefined
    let hasToolCall = false
    let finishReason: string | undefined
    let hasNonEmptyText = false

    try {
      for await (const chunk of this.client.generateContentStream(req)) {
        lastChunk = chunk

        // Track stream validity
        const candidate = chunk.candidates?.[0]
        if (candidate?.finishReason) {
          finishReason = candidate.finishReason as string
        }
        for (const part of candidate?.content?.parts ?? []) {
          if (part.functionCall) hasToolCall = true
          if (part.text?.trim() && !(part as Record<string, unknown>).thought) {
            hasNonEmptyText = true
          }
        }

        yield chunk
      }
      this.emitTelemetry(req, lastChunk, Date.now() - start, true)

      // Stream validation (matching gemini-cli/packages/core/src/core/geminiChat.ts)
      if (!hasToolCall) {
        if (!finishReason) {
          throw new InvalidStreamError("Model stream ended without a finish reason.", "NO_FINISH_REASON")
        }
        if (finishReason === "MALFORMED_FUNCTION_CALL") {
          throw new InvalidStreamError("Model stream ended with malformed function call.", "MALFORMED_FUNCTION_CALL")
        }
        if (!hasNonEmptyText) {
          throw new InvalidStreamError("Model stream ended with empty response text.", "NO_RESPONSE_TEXT")
        }
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      if (!(err instanceof InvalidStreamError)) {
        this.emitTelemetry(req, lastChunk, Date.now() - start, true, error)
      }
      throw err
    }
  }

  async countTokens(req: GenerateContentParameters): Promise<CountTokensResponse> {
    const countReq: CountTokensParameters = {
      model: req.model,
      contents: req.contents,
    }
    return this.client.countTokens(countReq)
  }

  private emitTelemetry(
    req: GenerateContentParameters,
    response: GenerateContentResponse | undefined,
    latencyMs: number,
    stream: boolean,
    error?: string,
  ): void {
    const usage = response?.usageMetadata
    const candidate = response?.candidates?.[0]

    const entry: TelemetryEntry = {
      timestamp: new Date().toISOString(),
      model: req.model,
      traceId: response?.responseId ?? undefined,
      latencyMs,
      tokens: usage
        ? {
            prompt: usage.promptTokenCount,
            completion: usage.candidatesTokenCount,
            total: usage.totalTokenCount,
            thinking: usage.thoughtsTokenCount,
          }
        : undefined,
      finishReason: candidate?.finishReason as string | undefined,
      stream,
      error,
    }

    logTelemetry(entry)
  }
}
