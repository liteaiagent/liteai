/**
 * Chat completions route — POST /v1/chat/completions
 *
 * Port of liteai/api/routes/chat_completions.py
 *
 * Supports both streaming (SSE) and non-streaming responses.
 */

import { randomUUID } from "node:crypto"
import type { GenerateContentConfig } from "@google/genai"
import { Hono } from "hono"
import { streamSSE } from "hono/streaming"
import { AuthExpiredError } from "../auth/credentials.js"
import type { ContentGenerator } from "../content-generator.js"
import { settings } from "../core/config.js"
import {
  convertMessages,
  convertTools,
  extractReasoningAndText,
  extractToolCallsFromParts,
  mapFinishReason,
} from "../core/converter.js"
import { createLogger, withRequestId } from "../core/logger.js"
import {
  DEFAULT_THINKING_BUDGET,
  isGemini2Model,
  isGemini3Model,
  MODEL_ALIASES,
  resolveModel,
} from "../core/model-config.js"
import { fireHooks, hasHooks } from "../eval-hooks.js"
import { type ChatCompletionRequest, ChatCompletionRequestSchema } from "../models/chat.js"
import { createErrorResponse } from "../models/errors.js"

const logger = createLogger("routes.chat_completions")

const chatCompletions = new Hono()

// ── Dependency: Content Generator Factory ──────────────────────────────────

let _getContentGenerator: (() => Promise<ContentGenerator>) | null = null

export function setContentGeneratorFactory(factory: () => Promise<ContentGenerator>): void {
  _getContentGenerator = factory
}

async function getGenerator(): Promise<ContentGenerator> {
  if (!_getContentGenerator) {
    throw new Error("Content generator factory not set")
  }
  return _getContentGenerator()
}

// ── Request → Gemini Config ────────────────────────────────────────────────

function buildGeminiConfig(
  request: ChatCompletionRequest,
  resolvedModel: string,
  systemInstruction: string | null,
): GenerateContentConfig {
  const config: GenerateContentConfig = {}

  if (systemInstruction) {
    config.systemInstruction = systemInstruction
  }

  // Temperature
  const temperature = request.temperature ?? settings.temperature ?? undefined
  if (temperature != null) config.temperature = temperature

  // Top P
  if (request.top_p != null) config.topP = request.top_p

  // Max tokens
  const maxTokens = request.max_completion_tokens ?? request.max_tokens ?? undefined
  if (maxTokens != null) config.maxOutputTokens = maxTokens

  // Stop sequences
  if (request.stop) {
    config.stopSequences = Array.isArray(request.stop) ? request.stop : [request.stop]
  }

  // Thinking config
  const thinkingBudget = request.thinking_budget ?? settings.thinking_budget ?? DEFAULT_THINKING_BUDGET

  if (isGemini2Model(resolvedModel)) {
    // Gemini 2.x: uses thinkingBudget
    config.thinkingConfig = {
      includeThoughts: true,
      thinkingBudget: thinkingBudget,
    }
  } else if (isGemini3Model(resolvedModel)) {
    // Gemini 3.x: uses thinkingBudget or reasoning_effort mapping
    const effortMap: Record<string, number> = {
      none: 0,
      low: 1024,
      medium: 8192,
      high: 32768,
    }
    const budget = request.reasoning_effort ? (effortMap[request.reasoning_effort] ?? thinkingBudget) : thinkingBudget
    config.thinkingConfig = {
      includeThoughts: true,
      thinkingBudget: budget,
    }
  }

  // Tools
  if (request.tools?.length) {
    convertTools(request.tools, request.tool_choice, config)
  }

  return config
}

// ── Non-Streaming Handler ──────────────────────────────────────────────────

async function handleInvoke(
  request: ChatCompletionRequest,
  generator: ContentGenerator,
  resolvedModel: string,
): Promise<Record<string, unknown>> {
  const { systemInstruction, contents } = convertMessages(request.messages)
  const config = buildGeminiConfig(request, resolvedModel, systemInstruction)

  const startTime = Date.now()
  const response = await generator.generateContent({
    model: resolvedModel,
    contents,
    config,
  })
  const latencyMs = Date.now() - startTime

  const candidate = response.candidates?.[0]
  const parts = candidate?.content?.parts ?? []
  const { reasoning, text } = extractReasoningAndText(parts)
  const toolCalls = extractToolCallsFromParts(parts)
  const finishReason = mapFinishReason(candidate?.finishReason as string | undefined)

  const usage = response.usageMetadata

  // Fire eval hooks
  if (hasHooks()) {
    fireHooks({
      request_id: randomUUID(),
      model: resolvedModel,
      timestamp: new Date().toISOString(),
      latency_ms: latencyMs,
      stream: false,
      response_text: text,
      reasoning_text: reasoning,
      tool_calls: toolCalls?.map((tc) => ({
        name: tc.function.name,
        args: tc.function.arguments,
      })),
      usage: usage
        ? {
            prompt_tokens: usage.promptTokenCount ?? 0,
            completion_tokens: usage.candidatesTokenCount ?? 0,
            total_tokens: usage.totalTokenCount ?? 0,
          }
        : null,
    })
  }

  return {
    id: `chatcmpl-${randomUUID().replace(/-/g, "").slice(0, 29)}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: resolvedModel,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: text || null,
          tool_calls: toolCalls,
          reasoning_content: reasoning || null,
        },
        finish_reason: toolCalls ? "tool_calls" : (finishReason ?? "stop"),
      },
    ],
    usage: usage
      ? {
          prompt_tokens: usage.promptTokenCount ?? 0,
          completion_tokens: usage.candidatesTokenCount ?? 0,
          total_tokens: usage.totalTokenCount ?? 0,
          prompt_tokens_details: usage.thoughtsTokenCount ? { reasoning_tokens: usage.thoughtsTokenCount } : null,
          completion_tokens_details: null,
        }
      : null,
  }
}

// ── Main Route ─────────────────────────────────────────────────────────────

chatCompletions.post("/chat/completions", async (c) => {
  const requestId = randomUUID().slice(0, 8)

  return withRequestId(requestId, async () => {
    // Parse and validate request
    let request: ChatCompletionRequest
    try {
      const body = await c.req.json()
      request = ChatCompletionRequestSchema.parse(body)
    } catch (err) {
      return c.json(
        createErrorResponse(
          `Invalid request: ${err instanceof Error ? err.message : String(err)}`,
          "invalid_request_error",
        ),
        400,
      )
    }

    // Resolve model
    const requestedModel = request.model || "auto"
    const resolvedModel = MODEL_ALIASES.has(requestedModel) ? resolveModel(requestedModel) : requestedModel

    logger.info(
      `Chat completion: model=${requestedModel}→${resolvedModel} stream=${request.stream} messages=${request.messages.length}`,
    )

    // Debug: incoming OpenAI request shape
    logger.debug("Incoming OpenAI request", {
      model: requestedModel,
      resolvedModel,
      stream: request.stream ?? false,
      messageCount: request.messages.length,
      tools: request.tools?.length ?? 0,
      temperature: request.temperature ?? "default",
      max_tokens: request.max_completion_tokens ?? request.max_tokens ?? "default",
      reasoning_effort: request.reasoning_effort ?? "default",
    })

    let generator: ContentGenerator
    try {
      generator = await getGenerator()
    } catch (err) {
      if (err instanceof AuthExpiredError) {
        return c.json(createErrorResponse(err.message, "authentication_error", "auth_expired"), 401)
      }
      return c.json(
        createErrorResponse(
          `Content generator error: ${err instanceof Error ? err.message : String(err)}`,
          "server_error",
        ),
        500,
      )
    }

    // ── Non-Streaming ──────────────────────────────────────────────────────

    if (!request.stream) {
      try {
        const result = await handleInvoke(request, generator, resolvedModel)
        return c.json(result)
      } catch (err) {
        logger.error(`Chat completion error: ${err}`)
        return c.json(
          createErrorResponse(`Generation error: ${err instanceof Error ? err.message : String(err)}`, "server_error"),
          500,
        )
      }
    }

    // ── Streaming ──────────────────────────────────────────────────────────

    const completionId = `chatcmpl-${randomUUID().replace(/-/g, "").slice(0, 29)}`
    const created = Math.floor(Date.now() / 1000)

    return streamSSE(c, async (stream) => {
      try {
        const { systemInstruction, contents } = convertMessages(request.messages)
        const config = buildGeminiConfig(request, resolvedModel, systemInstruction)

        // Send initial role chunk
        await stream.writeSSE({
          data: JSON.stringify({
            id: completionId,
            object: "chat.completion.chunk",
            created,
            model: resolvedModel,
            choices: [
              {
                index: 0,
                delta: { role: "assistant", content: "" },
                finish_reason: null,
              },
            ],
          }),
        })

        // Start keepalive timer — sends SSE comments every 5s to prevent
        // Bun/proxy idle timeout while the upstream model is thinking.
        const keepaliveInterval = setInterval(async () => {
          try {
            await stream.write(": keepalive\n\n")
          } catch {
            // stream already closed
            clearInterval(keepaliveInterval)
          }
        }, 5_000)

        let hasToolCalls = false
        const toolCallAccumulator: Map<number, { id: string; name: string; args: string }> = new Map()

        let sseChunkIndex = 0

        try {
          for await (const chunk of generator.generateContentStream({
            model: resolvedModel,
            contents,
            config,
          })) {
            const candidate = chunk.candidates?.[0]
            if (!candidate?.content?.parts) continue

            const parts = candidate.content.parts
            const { reasoning, text } = extractReasoningAndText(parts)

            // Emit reasoning content
            if (reasoning) {
              sseChunkIndex++
              logger.debug(`SSE chunk #${sseChunkIndex}: reasoning (${reasoning.length} chars)`)
              await stream.writeSSE({
                data: JSON.stringify({
                  id: completionId,
                  object: "chat.completion.chunk",
                  created,
                  model: resolvedModel,
                  choices: [
                    {
                      index: 0,
                      delta: { reasoning_content: reasoning },
                      finish_reason: null,
                    },
                  ],
                }),
              })
            }

            // Emit text content
            if (text) {
              sseChunkIndex++
              logger.debug(`SSE chunk #${sseChunkIndex}: content (${text.length} chars)`)
              await stream.writeSSE({
                data: JSON.stringify({
                  id: completionId,
                  object: "chat.completion.chunk",
                  created,
                  model: resolvedModel,
                  choices: [
                    {
                      index: 0,
                      delta: { content: text },
                      finish_reason: null,
                    },
                  ],
                }),
              })
            }

            // Emit tool calls
            const toolCalls = extractToolCallsFromParts(parts)
            if (toolCalls) {
              hasToolCalls = true
              for (const tc of toolCalls) {
                const idx = toolCallAccumulator.size
                toolCallAccumulator.set(idx, {
                  id: tc.id,
                  name: tc.function.name,
                  args: tc.function.arguments,
                })

                // Send tool call name chunk
                sseChunkIndex++
                logger.debug(`SSE chunk #${sseChunkIndex}: tool_call ${tc.function.name}`)
                await stream.writeSSE({
                  data: JSON.stringify({
                    id: completionId,
                    object: "chat.completion.chunk",
                    created,
                    model: resolvedModel,
                    choices: [
                      {
                        index: 0,
                        delta: {
                          tool_calls: [
                            {
                              index: idx,
                              id: tc.id,
                              type: "function",
                              function: {
                                name: tc.function.name,
                                arguments: "",
                              },
                            },
                          ],
                        },
                        finish_reason: null,
                      },
                    ],
                  }),
                })

                // Send tool call arguments chunk
                await stream.writeSSE({
                  data: JSON.stringify({
                    id: completionId,
                    object: "chat.completion.chunk",
                    created,
                    model: resolvedModel,
                    choices: [
                      {
                        index: 0,
                        delta: {
                          tool_calls: [
                            {
                              index: idx,
                              function: {
                                arguments: tc.function.arguments,
                              },
                            },
                          ],
                        },
                        finish_reason: null,
                      },
                    ],
                  }),
                })
              }
            }

            // Check for finish
            if (candidate.finishReason) {
              const finishReason = hasToolCalls
                ? "tool_calls"
                : (mapFinishReason(candidate.finishReason as string) ?? "stop")

              // Emit usage if available
              const usage = chunk.usageMetadata

              sseChunkIndex++
              logger.debug(`SSE chunk #${sseChunkIndex}: finish_reason=${finishReason}`)
              await stream.writeSSE({
                data: JSON.stringify({
                  id: completionId,
                  object: "chat.completion.chunk",
                  created,
                  model: resolvedModel,
                  choices: [
                    {
                      index: 0,
                      delta: {},
                      finish_reason: finishReason,
                    },
                  ],
                  usage: usage
                    ? {
                        prompt_tokens: usage.promptTokenCount ?? 0,
                        completion_tokens: usage.candidatesTokenCount ?? 0,
                        total_tokens: usage.totalTokenCount ?? 0,
                      }
                    : null,
                }),
              })
            }
          }
        } finally {
          clearInterval(keepaliveInterval)
        }

        // Send [DONE] marker
        logger.debug(`SSE stream complete: ${sseChunkIndex} chunks emitted`)
        await stream.writeSSE({ data: "[DONE]" })
      } catch (err) {
        logger.error(`Stream error: ${err}`)
        // Try to send error as SSE chunk
        try {
          await stream.writeSSE({
            data: JSON.stringify({
              id: completionId,
              object: "chat.completion.chunk",
              created,
              model: resolvedModel,
              choices: [
                {
                  index: 0,
                  delta: {
                    content: `\n\n[Error: ${err instanceof Error ? err.message : String(err)}]`,
                  },
                  finish_reason: "stop",
                },
              ],
            }),
          })
          await stream.writeSSE({ data: "[DONE]" })
        } catch {
          // Client disconnected
        }
      }
    })
  }) // withRequestId
})

export { chatCompletions }
