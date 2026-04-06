// LanguageModelV2 implementation for Google Code Assist.
// Converts AI SDK calls to CA API requests, handles streaming with thought/reasoning parts.

import type { LanguageModelV2, LanguageModelV2CallOptions, LanguageModelV2StreamPart } from "@ai-sdk/provider"
import { generateId } from "@ai-sdk/provider-utils"
import type { AuthClient } from "google-auth-library"
import { type ClientConfig, generate, stream } from "./client"
import { fromResponse, mapFinish, toRequest } from "./converter"
import type { CAGroundingChunk, CAPart } from "./types"

export interface CodeAssistModelConfig {
  provider: string
  model: string
  project?: string
  client: AuthClient
  endpoint?: string
  headers?: Record<string, string>
  /** User-Agent prefix, e.g. "GeminiCLI/1.0.0". Model name is appended automatically. */
  userAgentPrefix?: string
}

function functionTools(tools?: LanguageModelV2CallOptions["tools"]) {
  if (!tools) return undefined
  return tools
    .filter((t) => t.type === "function")
    .map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema as Record<string, unknown>,
    }))
}

export class CodeAssistLanguageModel implements LanguageModelV2 {
  readonly specificationVersion = "v2"
  readonly modelId: string
  readonly provider: string
  readonly supportedUrls = {}

  private readonly cfg: ClientConfig
  private readonly project?: string
  readonly supportsStructuredOutputs = false

  constructor(config: CodeAssistModelConfig) {
    this.modelId = config.model
    this.provider = config.provider
    this.project = config.project

    // Construct User-Agent matching gemini-cli format exactly:
    // GeminiCLI/<version>/<model> (<platform>; <arch>; <surface>)
    const prefix = config.userAgentPrefix ?? "GeminiCLI/0.36.0"
    const surface = "terminal"
    const userAgent = `${prefix}/${config.model} (${process.platform}; ${process.arch}; ${surface})`

    this.cfg = {
      client: config.client,
      endpoint: config.endpoint,
      httpOptions: {
        headers: {
          "User-Agent": userAgent,
          ...config.headers,
        },
      },
    }
  }

  async doGenerate(options: LanguageModelV2CallOptions): Promise<Awaited<ReturnType<LanguageModelV2["doGenerate"]>>> {
    const req = toRequest({
      model: this.modelId,
      project: this.project,
      prompt: options.prompt,
      temperature: options.temperature,
      maxOutputTokens: options.maxOutputTokens,
      topP: options.topP,
      topK: options.topK,
      stopSequences: options.stopSequences,
      tools: functionTools(options.tools),
      toolChoice: options.toolChoice,
      providerOptions: options.providerOptions,
    })

    const body = JSON.stringify(req)
    const res = await generate(this.cfg, req, options.abortSignal)
    const parsed = fromResponse(res)
    const hasCalls = parsed.content.some((c) => c.type === "tool-call")

    return {
      content: parsed.content,
      finishReason: hasCalls ? "tool-calls" : mapFinish(parsed.finish),
      usage: {
        inputTokens: parsed.usage.input,
        outputTokens: parsed.usage.output,
        totalTokens: parsed.usage.total,
        reasoningTokens: parsed.usage.reasoning,
      },
      providerMetadata:
        parsed.usage.reasoning !== undefined
          ? {
              "code-assist": {
                thoughtsTokenCount: parsed.usage.reasoning,
              },
            }
          : undefined,
      request: { body },
      response: {
        id: parsed.id,
        modelId: parsed.model ?? this.modelId,
        body: res,
      },
      warnings: [],
    }
  }

  async doStream(options: LanguageModelV2CallOptions): Promise<Awaited<ReturnType<LanguageModelV2["doStream"]>>> {
    const req = toRequest({
      model: this.modelId,
      project: this.project,
      prompt: options.prompt,
      temperature: options.temperature,
      maxOutputTokens: options.maxOutputTokens,
      topP: options.topP,
      topK: options.topK,
      stopSequences: options.stopSequences,
      tools: functionTools(options.tools),
      toolChoice: options.toolChoice,
      providerOptions: options.providerOptions,
    })

    const body = JSON.stringify(req)
    const iter = stream(this.cfg, req, options.abortSignal)

    const source = new ReadableStream<LanguageModelV2StreamPart>({
      async start(ctrl) {
        ctrl.enqueue({ type: "stream-start", warnings: [] })

        let reasoning = false
        let text = false
        let first = true
        let hasCalls = false
        let finish: string = "unknown"
        const usage = { input: 0, output: 0, total: 0, reasoning: 0 }
        const sources: CAGroundingChunk[] = []

        try {
          for await (const chunk of iter) {
            if (first && chunk.traceId) {
              ctrl.enqueue({
                type: "response-metadata",
                id: chunk.traceId,
                modelId: chunk.response?.modelVersion,
              })
              first = false
            }

            const candidate = chunk.response?.candidates?.[0]

            // Update usage
            const meta = chunk.response?.usageMetadata
            if (meta) {
              if (meta.promptTokenCount) usage.input = meta.promptTokenCount
              if (meta.candidatesTokenCount) usage.output = meta.candidatesTokenCount
              if (meta.totalTokenCount) usage.total = meta.totalTokenCount
              if (meta.thoughtsTokenCount) usage.reasoning = meta.thoughtsTokenCount
            }

            if (candidate?.finishReason) finish = candidate.finishReason

            // Collect grounding metadata (arrives in the last chunk)
            const chunks = candidate?.groundingMetadata?.groundingChunks
            if (chunks && chunks.length > 0) {
              sources.length = 0
              sources.push(...chunks)
            }

            if (!candidate?.content?.parts) continue

            for (const part of candidate.content.parts) {
              // ── Thought parts → reasoning events ──
              if (part.thought && part.text !== undefined) {
                if (!reasoning) {
                  ctrl.enqueue({ type: "reasoning-start", id: "reasoning-0" })
                  reasoning = true
                }
                ctrl.enqueue({
                  type: "reasoning-delta",
                  id: "reasoning-0",
                  delta: part.text,
                })
                continue
              }

              // ── Function call ──
              if (part.functionCall) {
                // End reasoning before tool calls
                if (reasoning) {
                  const sig = findLastSignature(candidate.content.parts, part)
                  ctrl.enqueue({
                    type: "reasoning-end",
                    id: "reasoning-0",
                    providerMetadata: sig ? { "code-assist": { thoughtSignature: sig } } : undefined,
                  })
                  reasoning = false
                }

                const id = generateId()
                const name = part.functionCall.name
                const args = JSON.stringify(part.functionCall.args ?? {})

                ctrl.enqueue({ type: "tool-input-start", id, toolName: name })
                ctrl.enqueue({ type: "tool-input-delta", id, delta: args })
                ctrl.enqueue({ type: "tool-input-end", id })
                ctrl.enqueue({
                  type: "tool-call",
                  toolCallId: id,
                  toolName: name,
                  input: args,
                  providerMetadata: part.thoughtSignature
                    ? { "code-assist": { thoughtSignature: part.thoughtSignature } }
                    : undefined,
                })
                hasCalls = true
                continue
              }

              // ── Regular text ──
              if (part.text !== undefined) {
                // End reasoning before text
                if (reasoning) {
                  const sig = findLastSignature(candidate.content.parts, part)
                  ctrl.enqueue({
                    type: "reasoning-end",
                    id: "reasoning-0",
                    providerMetadata: sig ? { "code-assist": { thoughtSignature: sig } } : undefined,
                  })
                  reasoning = false
                }

                if (!text) {
                  ctrl.enqueue({ type: "text-start", id: "txt-0" })
                  text = true
                }
                ctrl.enqueue({ type: "text-delta", id: "txt-0", delta: part.text })
              }
            }
          }
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") {
            // Expected: User aborted the request. Skip flush logic.
            return
          }
          ctrl.error(error)
          return
        }

        // Flush
        if (reasoning) {
          ctrl.enqueue({ type: "reasoning-end", id: "reasoning-0" })
        }
        if (text) {
          ctrl.enqueue({ type: "text-end", id: "txt-0" })
        }

        // Emit grounding sources from the last chunk's candidate
        if (sources.length > 0) {
          for (const chunk of sources) {
            if (chunk.web?.uri) {
              ctrl.enqueue({
                type: "source",
                sourceType: "url",
                id: generateId(),
                url: chunk.web.uri,
                title: chunk.web.title ?? "Web",
              })
            }
          }
        }

        ctrl.enqueue({
          type: "finish",
          finishReason: hasCalls ? "tool-calls" : mapFinish(finish),
          usage: {
            inputTokens: usage.input || undefined,
            outputTokens: usage.output || undefined,
            totalTokens: usage.total || undefined,
            reasoningTokens: usage.reasoning || undefined,
          },
          providerMetadata:
            usage.reasoning !== undefined
              ? {
                  "code-assist": {
                    thoughtsTokenCount: usage.reasoning,
                  },
                }
              : undefined,
        })
        ctrl.close()
      },
    })

    return {
      stream: source,
      request: { body },
      response: { headers: {} },
    }
  }
}

// Find the thoughtSignature from the last thought part before the current part
function findLastSignature(parts: CAPart[], current: CAPart): string | undefined {
  let sig: string | undefined
  for (const p of parts) {
    if (p === current) break
    if (p.thought && p.thoughtSignature) sig = p.thoughtSignature
  }
  return sig
}
