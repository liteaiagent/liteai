/**
 * Code Assist request/response converter.
 *
 * Adapted from gemini-cli/packages/core/src/code_assist/converter.ts
 * Converts between @google/genai SDK types and Code Assist API envelope format.
 */

import type {
  Candidate,
  Content,
  ContentListUnion,
  ContentUnion,
  CountTokensParameters,
  CountTokensResponse,
  GenerateContentConfig,
  GenerateContentParameters,
  GenerateContentResponsePromptFeedback,
  GenerateContentResponseUsageMetadata,
  GenerationConfigRoutingConfig,
  MediaResolution,
  ModelSelectionConfig,
  Part,
  PartUnion,
  SafetySetting,
  SpeechConfigUnion,
  ThinkingConfig,
  ToolConfig,
  ToolListUnion,
} from "@google/genai"
import { GenerateContentResponse } from "@google/genai"
import { createLogger } from "./logger.js"

const logger = createLogger("core.ca_converter")

// ── Code Assist Envelope Types ─────────────────────────────────────────────

export interface CAGenerateContentRequest {
  model: string
  project?: string
  user_prompt_id?: string
  request: VertexGenerateContentRequest
  enabled_credit_types?: string[]
}

interface VertexGenerateContentRequest {
  contents: Content[]
  systemInstruction?: Content
  cachedContent?: string
  tools?: ToolListUnion
  toolConfig?: ToolConfig
  labels?: Record<string, string>
  safetySettings?: SafetySetting[]
  generationConfig?: VertexGenerationConfig
  session_id?: string
}

interface VertexGenerationConfig {
  temperature?: number
  topP?: number
  topK?: number
  candidateCount?: number
  maxOutputTokens?: number
  stopSequences?: string[]
  responseLogprobs?: boolean
  logprobs?: number
  presencePenalty?: number
  frequencyPenalty?: number
  seed?: number
  responseMimeType?: string
  responseJsonSchema?: unknown
  responseSchema?: unknown
  routingConfig?: GenerationConfigRoutingConfig
  modelSelectionConfig?: ModelSelectionConfig
  responseModalities?: string[]
  mediaResolution?: MediaResolution
  speechConfig?: SpeechConfigUnion
  audioTimestamp?: boolean
  thinkingConfig?: ThinkingConfig
}

export interface CaGenerateContentResponse {
  response?: VertexGenerateContentResponse
  traceId?: string
}

interface VertexGenerateContentResponse {
  candidates?: Candidate[]
  automaticFunctionCallingHistory?: Content[]
  promptFeedback?: GenerateContentResponsePromptFeedback
  usageMetadata?: GenerateContentResponseUsageMetadata
  modelVersion?: string
}

export interface CaCountTokenRequest {
  request: VertexCountTokenRequest
}

interface VertexCountTokenRequest {
  model: string
  contents: Content[]
}

export interface CaCountTokenResponse {
  totalTokens?: number
}

// ── Count Tokens ───────────────────────────────────────────────────────────

export function toCountTokenRequest(req: CountTokensParameters): CaCountTokenRequest {
  return {
    request: {
      model: `models/${req.model}`,
      contents: toContents(req.contents),
    },
  }
}

export function fromCountTokenResponse(res: CaCountTokenResponse): CountTokensResponse {
  if (res.totalTokens === undefined) {
    logger.warn("Code Assist API did not return totalTokens. Defaulting to 0.")
  }
  return {
    totalTokens: res.totalTokens ?? 0,
  }
}

// ── Generate Content Request ───────────────────────────────────────────────

export function toGenerateContentRequest(
  req: GenerateContentParameters,
  userPromptId: string,
  project?: string,
  sessionId?: string,
  enabledCreditTypes?: string[],
): CAGenerateContentRequest {
  return {
    model: req.model,
    project,
    user_prompt_id: userPromptId,
    request: toVertexGenerateContentRequest(req, sessionId),
    enabled_credit_types: enabledCreditTypes,
  }
}

function toVertexGenerateContentRequest(
  req: GenerateContentParameters,
  sessionId?: string,
): VertexGenerateContentRequest {
  return {
    contents: toContents(req.contents),
    systemInstruction: maybeToContent(req.config?.systemInstruction),
    cachedContent: req.config?.cachedContent,
    tools: req.config?.tools,
    toolConfig: req.config?.toolConfig,
    labels: req.config?.labels,
    safetySettings: req.config?.safetySettings,
    generationConfig: toVertexGenerationConfig(req.config),
    session_id: sessionId,
  }
}

// ── Generate Content Response ──────────────────────────────────────────────

export function fromGenerateContentResponse(res: CaGenerateContentResponse): GenerateContentResponse {
  const out = new GenerateContentResponse()
  out.responseId = res.traceId
  const inres = res.response
  if (!inres) {
    out.candidates = []
    return out
  }
  out.candidates = inres.candidates ?? []
  out.automaticFunctionCallingHistory = inres.automaticFunctionCallingHistory
  out.promptFeedback = inres.promptFeedback
  out.usageMetadata = inres.usageMetadata
  out.modelVersion = inres.modelVersion
  return out
}

// ── Content/Part Conversion ────────────────────────────────────────────────

export function toContents(contents: ContentListUnion): Content[] {
  if (Array.isArray(contents)) {
    return contents.map(toContent)
  }
  return [toContent(contents)]
}

function maybeToContent(content?: ContentUnion): Content | undefined {
  if (!content) {
    return undefined
  }
  return toContent(content)
}

function isPart(c: ContentUnion): c is PartUnion {
  return typeof c === "object" && c !== null && !Array.isArray(c) && !("parts" in c) && !("role" in c)
}

function toContent(content: ContentUnion): Content {
  if (Array.isArray(content)) {
    return {
      role: "user",
      parts: toParts(content),
    }
  }
  if (typeof content === "string") {
    return {
      role: "user",
      parts: [{ text: content }],
    }
  }
  if (!isPart(content)) {
    // It's a Content — process parts to handle thought filtering
    return {
      ...content,
      parts: content.parts ? toParts(content.parts.filter((p) => p != null)) : [],
    }
  }
  // It's a Part
  return {
    role: "user",
    parts: [toPart(content)],
  }
}

export function toParts(parts: PartUnion[]): Part[] {
  return parts.map(toPart)
}

function toPart(part: PartUnion): Part {
  if (typeof part === "string") {
    return { text: part }
  }

  // Handle thought parts for CountToken API compatibility.
  // The CountToken API expects parts to have certain required "oneof" fields,
  // but thought parts don't conform to this schema and cause API failures.
  if ("thought" in part && part.thought) {
    const thoughtText = `[Thought: ${part.thought}]`

    const newPart = { ...part }
    delete (newPart as Record<string, unknown>).thought

    const hasApiContent =
      "functionCall" in newPart || "functionResponse" in newPart || "inlineData" in newPart || "fileData" in newPart

    if (hasApiContent) {
      // Non-text part. Just strip the thought.
      return newPart
    }

    // Text part — combine existing text with the thought.
    const text = (newPart as { text?: unknown }).text
    const existingText = text ? String(text) : ""
    const combinedText = existingText ? `${existingText}\n${thoughtText}` : thoughtText

    return {
      ...newPart,
      text: combinedText,
    }
  }

  return part
}

// ── Generation Config ──────────────────────────────────────────────────────

function toVertexGenerationConfig(config?: GenerateContentConfig): VertexGenerationConfig | undefined {
  if (!config) {
    return undefined
  }
  return {
    temperature: config.temperature,
    topP: config.topP,
    topK: config.topK,
    candidateCount: config.candidateCount,
    maxOutputTokens: config.maxOutputTokens,
    stopSequences: config.stopSequences,
    responseLogprobs: config.responseLogprobs,
    logprobs: config.logprobs,
    presencePenalty: config.presencePenalty,
    frequencyPenalty: config.frequencyPenalty,
    seed: config.seed,
    responseMimeType: config.responseMimeType,
    responseSchema: config.responseSchema,
    responseJsonSchema: config.responseJsonSchema,
    routingConfig: config.routingConfig,
    modelSelectionConfig: config.modelSelectionConfig,
    responseModalities: config.responseModalities,
    mediaResolution: config.mediaResolution,
    speechConfig: config.speechConfig,
    audioTimestamp: config.audioTimestamp,
    thinkingConfig: config.thinkingConfig,
  }
}
