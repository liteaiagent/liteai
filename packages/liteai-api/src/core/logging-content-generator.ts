/**
 * Logging decorator for ContentGenerator.
 *
 * Wraps any ContentGenerator to add structured debug/trace logging
 * for requests, responses, and errors throughout the generation pipeline.
 *
 * Inspired by gemini-cli/packages/core/src/core/loggingContentGenerator.ts
 */

import type { CountTokensResponse, GenerateContentParameters, GenerateContentResponse } from "@google/genai"
import type { ContentGenerator } from "../content-generator.js"
import { createLogger } from "./logger.js"

const logger = createLogger("content-generator")

/**
 * Decorator that logs request metadata at DEBUG level,
 * full payloads at TRACE level, and error details on failure.
 */
export class LoggingContentGenerator implements ContentGenerator {
  private inner: ContentGenerator

  constructor(inner: ContentGenerator) {
    this.inner = inner
  }

  async generateContent(req: GenerateContentParameters): Promise<GenerateContentResponse> {
    const meta = requestMeta(req)
    logger.debug("generateContent request", meta)
    logger.trace("generateContent full request", {
      payload: JSON.stringify(req),
    })

    const start = Date.now()
    try {
      const response = await this.inner.generateContent(req)
      const latencyMs = Date.now() - start
      logResponse("generateContent", response, latencyMs)
      return response
    } catch (err) {
      const latencyMs = Date.now() - start
      logError("generateContent", err, latencyMs)
      throw err
    }
  }

  async *generateContentStream(req: GenerateContentParameters): AsyncGenerator<GenerateContentResponse> {
    const meta = requestMeta(req)
    logger.debug("generateContentStream request", meta)
    logger.trace("generateContentStream full request", {
      payload: JSON.stringify(req),
    })

    const start = Date.now()
    let chunkCount = 0
    let lastChunk: GenerateContentResponse | undefined

    try {
      for await (const chunk of this.inner.generateContentStream(req)) {
        chunkCount++
        lastChunk = chunk
        logger.trace(`generateContentStream chunk #${chunkCount}`, {
          payload: JSON.stringify(chunk),
        })
        yield chunk
      }

      const latencyMs = Date.now() - start
      logger.debug("generateContentStream complete", {
        latencyMs,
        chunks: chunkCount,
        ...responseMeta(lastChunk),
      })
    } catch (err) {
      const latencyMs = Date.now() - start
      logError("generateContentStream", err, latencyMs)
      throw err
    }
  }

  async countTokens(req: GenerateContentParameters): Promise<CountTokensResponse> {
    if (!this.inner.countTokens) {
      throw new Error("countTokens not supported by inner generator")
    }

    logger.debug("countTokens request", {
      model: req.model,
      contentCount: req.contents ? (Array.isArray(req.contents) ? req.contents.length : 1) : 0,
    })

    const start = Date.now()
    try {
      const response = await this.inner.countTokens(req)
      const latencyMs = Date.now() - start
      logger.debug("countTokens response", {
        latencyMs,
        totalTokens: response.totalTokens,
      })
      return response
    } catch (err) {
      const latencyMs = Date.now() - start
      logError("countTokens", err, latencyMs)
      throw err
    }
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function requestMeta(req: GenerateContentParameters): Record<string, unknown> {
  const contents = req.contents
  const contentCount = contents ? (Array.isArray(contents) ? contents.length : 1) : 0

  const config = req.config
  const toolCount = config?.tools && Array.isArray(config.tools) ? config.tools.length : config?.tools ? 1 : 0

  const sysLen =
    typeof config?.systemInstruction === "string"
      ? config.systemInstruction.length
      : config?.systemInstruction
        ? JSON.stringify(config.systemInstruction).length
        : 0

  return {
    model: req.model,
    contentCount,
    toolCount,
    systemInstructionLen: sysLen,
  }
}

function responseMeta(response: GenerateContentResponse | undefined): Record<string, unknown> {
  if (!response) return {}

  const usage = response.usageMetadata
  const candidate = response.candidates?.[0]

  return {
    finishReason: candidate?.finishReason ?? "none",
    promptTokens: usage?.promptTokenCount ?? 0,
    completionTokens: usage?.candidatesTokenCount ?? 0,
    totalTokens: usage?.totalTokenCount ?? 0,
    thinkingTokens: usage?.thoughtsTokenCount ?? 0,
  }
}

function logResponse(method: string, response: GenerateContentResponse, latencyMs: number): void {
  logger.debug(`${method} response`, {
    latencyMs,
    ...responseMeta(response),
  })
  logger.trace(`${method} full response`, {
    payload: JSON.stringify(response),
  })
}

function logError(method: string, err: unknown, latencyMs: number): void {
  const message = err instanceof Error ? err.message : String(err)
  const stack = err instanceof Error ? err.stack : undefined
  logger.error(`${method} failed`, {
    latencyMs,
    error: message,
    ...(stack ? { stack } : {}),
  })
}
