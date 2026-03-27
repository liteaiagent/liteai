// Converter between AI SDK prompt/content format and Code Assist API format.
// Handles the critical "thought" part conversion for Gemini 2.5+ reasoning models.

import type { LanguageModelV2Content, LanguageModelV2Prompt } from "@ai-sdk/provider"
import { generateId } from "@ai-sdk/provider-utils"
import type {
  CACandidate,
  CAGenerateContentRequest,
  CAGenerateContentResponse,
  CAGenerationConfig,
  CAPart,
  CAToolConfig,
  CAToolDeclaration,
  VertexGenerateContentRequest,
} from "./types"

// ── Prompt → CA request ──────────────────────────────────────────────

interface ConvertOptions {
  model: string
  project?: string
  prompt: LanguageModelV2Prompt
  temperature?: number
  maxOutputTokens?: number
  topP?: number
  topK?: number
  stopSequences?: string[]
  tools?: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>
  toolChoice?: { type: string; toolName?: string }
  providerOptions?: Record<string, Record<string, unknown>>
  enabledCreditTypes?: string[]
}

export function toRequest(opts: ConvertOptions): CAGenerateContentRequest {
  return {
    model: opts.model,
    project: opts.project,
    user_prompt_id: generateId(),
    request: toVertexRequest(opts),
    enabled_credit_types: opts.enabledCreditTypes,
  }
}

function sessionId(opts: ConvertOptions): string | undefined {
  return opts.providerOptions?.["code-assist"]?.sessionId as string | undefined
}

function toVertexRequest(opts: ConvertOptions): VertexGenerateContentRequest {
  const result: VertexGenerateContentRequest = {
    contents: [],
    generationConfig: toGenerationConfig(opts),
    session_id: sessionId(opts),
  }

  // System instruction — V2 system messages have `content: string`
  const system = opts.prompt.filter((m) => m.role === "system")
  if (system.length > 0) {
    const parts: CAPart[] = []
    for (const msg of system) {
      parts.push({ text: msg.content })
    }
    if (parts.length > 0) {
      result.systemInstruction = { role: "user", parts }
    }
  }

  // Conversation turns
  for (const msg of opts.prompt) {
    if (msg.role === "system") continue

    if (msg.role === "user") {
      const parts: CAPart[] = []
      for (const p of msg.content) {
        if (p.type === "text") {
          parts.push({ text: p.text })
        } else if (p.type === "file") {
          if (typeof p.data === "string" && p.data.startsWith("http")) {
            parts.push({ fileData: { mimeType: p.mediaType ?? "", fileUri: p.data } })
          } else if (p.data instanceof Uint8Array) {
            const data = Buffer.from(p.data).toString("base64")
            parts.push({ inlineData: { mimeType: p.mediaType ?? "application/octet-stream", data } })
          } else if (typeof p.data === "string") {
            parts.push({ inlineData: { mimeType: p.mediaType ?? "application/octet-stream", data: p.data } })
          }
          // URL type is handled by the http check above
        }
      }
      if (parts.length > 0) result.contents.push({ role: "user", parts })
    }

    if (msg.role === "assistant") {
      const parts: CAPart[] = []
      for (const p of msg.content) {
        if (p.type === "text") {
          parts.push({ text: p.text })
        } else if (p.type === "reasoning") {
          // Convert AI SDK reasoning back to CA thought parts.
          // thoughtSignature carried via providerOptions
          const sig = p.providerOptions?.["code-assist"]?.thoughtSignature as string | undefined
          parts.push({
            text: p.text,
            thought: true,
            ...(sig ? { thoughtSignature: sig } : {}),
          })
        } else if (p.type === "tool-call") {
          // Inject synthetic thoughtSignature for function calls that follow reasoning
          const sig = p.providerOptions?.["code-assist"]?.thoughtSignature as string | undefined
          const args = typeof p.input === "string" ? JSON.parse(p.input) : (p.input ?? {})
          parts.push({
            functionCall: {
              name: p.toolName,
              args,
            },
            ...(sig ? { thought: true, thoughtSignature: sig } : {}),
          })
        } else if (p.type === "tool-result") {
          // Tool results in assistant messages — convert output to functionResponse
          const response: Record<string, unknown> = {}
          if (p.output.type === "text" || p.output.type === "error-text") {
            response.result = p.output.value
          } else if (p.output.type === "json" || p.output.type === "error-json") {
            response.result = JSON.stringify(p.output.value)
          } else if (p.output.type === "content") {
            const text = p.output.value
              .filter((c): c is { type: "text"; text: string } => c.type === "text")
              .map((c) => c.text)
              .join("\n")
            response.result = text || JSON.stringify(p.output.value)
          }
          parts.push({
            functionResponse: { name: p.toolName, response },
          })
        }
      }
      if (parts.length > 0) result.contents.push({ role: "model", parts })
    }

    if (msg.role === "tool") {
      const parts: CAPart[] = []
      for (const p of msg.content) {
        if (p.type === "tool-result") {
          const response: Record<string, unknown> = {}
          if (p.output.type === "text" || p.output.type === "error-text") {
            response.result = p.output.value
          } else if (p.output.type === "json" || p.output.type === "error-json") {
            response.result = JSON.stringify(p.output.value)
          } else if (p.output.type === "content") {
            const text = p.output.value
              .filter((c): c is { type: "text"; text: string } => c.type === "text")
              .map((c) => c.text)
              .join("\n")
            response.result = text || JSON.stringify(p.output.value)
          }
          parts.push({
            functionResponse: { name: p.toolName, response },
          })
        }
      }
      if (parts.length > 0) result.contents.push({ role: "user", parts })
    }
  }

  // Tools
  if (opts.tools && opts.tools.length > 0) {
    const decls = opts.tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: stripSchema(t.inputSchema),
    }))
    result.tools = [{ functionDeclarations: decls }] as CAToolDeclaration[]
  }

  // Tool config
  if (opts.toolChoice) {
    const fc: NonNullable<CAToolConfig["functionCallingConfig"]> = {}
    if (opts.toolChoice.type === "none") {
      fc.mode = "NONE"
    } else if (opts.toolChoice.type === "auto") {
      fc.mode = "AUTO"
    } else if (opts.toolChoice.type === "required") {
      fc.mode = "ANY"
    } else if (opts.toolChoice.type === "tool" && opts.toolChoice.toolName) {
      fc.mode = "ANY"
      fc.allowedFunctionNames = [opts.toolChoice.toolName]
    }
    result.toolConfig = { functionCallingConfig: fc }
  }

  ensureThoughtSignatures(result.contents)

  return result
}

// The GCA API requires the first function call in every model turn within the
// active agentic loop to carry a `thoughtSignature`. Without one the API
// returns a 400 error. This mirrors `ensureActiveLoopHasThoughtSignatures`
// from gemini-cli's GeminiChat.
const SYNTHETIC_THOUGHT_SIGNATURE = "skip_thought_signature_validator"

function ensureThoughtSignatures(contents: Array<{ role: string; parts: CAPart[] }>) {
  // Find the start of the active loop: the last user turn with a text part
  // (i.e. not a pure function-response turn).
  let start = -1
  for (let i = contents.length - 1; i >= 0; i--) {
    if (contents[i].role === "user" && contents[i].parts.some((p) => p.text)) {
      start = i
      break
    }
  }
  if (start === -1) return

  // For every model turn from the active loop onward, ensure the first
  // functionCall part has a thoughtSignature.
  for (let i = start; i < contents.length; i++) {
    const turn = contents[i]
    if (turn.role !== "model") continue
    for (let j = 0; j < turn.parts.length; j++) {
      if (turn.parts[j].functionCall) {
        if (!turn.parts[j].thoughtSignature) {
          turn.parts[j] = { ...turn.parts[j], thoughtSignature: SYNTHETIC_THOUGHT_SIGNATURE }
        }
        break // only the first functionCall needs it
      }
    }
  }
}

function toGenerationConfig(opts: ConvertOptions): CAGenerationConfig {
  const cfg: CAGenerationConfig = {}

  if (opts.temperature !== undefined) cfg.temperature = opts.temperature
  if (opts.maxOutputTokens !== undefined) cfg.maxOutputTokens = opts.maxOutputTokens
  if (opts.topP !== undefined) cfg.topP = opts.topP
  if (opts.topK !== undefined) cfg.topK = opts.topK
  if (opts.stopSequences?.length) cfg.stopSequences = opts.stopSequences

  // Always enable thinking — matches gemini-cli behavior.
  // Without this, the API may route requests differently or apply different quota.
  // Cap at 8192 by default to prevent run-away thinking loops (matches DEFAULT_THINKING_MODE).
  const budget = opts.providerOptions?.["code-assist"]?.thinkingBudget as number | undefined
  cfg.thinkingConfig = { includeThoughts: true, thinkingBudget: budget ?? 8192 }

  return cfg
}

// ── CA response → AI SDK content ─────────────────────────────────────

export interface ParsedResponse {
  content: LanguageModelV2Content[]
  finish: string
  usage: {
    input?: number
    output?: number
    total?: number
    reasoning?: number
  }
  id?: string
  model?: string
}

export function fromResponse(res: CAGenerateContentResponse): ParsedResponse {
  const candidate = res.response?.candidates?.[0]
  const content = fromCandidate(candidate)
  const meta = res.response?.usageMetadata

  return {
    content,
    finish: candidate?.finishReason ?? "unknown",
    usage: {
      input: meta?.promptTokenCount,
      output: meta?.candidatesTokenCount,
      total: meta?.totalTokenCount,
      reasoning: meta?.thoughtsTokenCount,
    },
    id: res.traceId,
    model: res.response?.modelVersion,
  }
}

export function fromCandidate(candidate?: CACandidate): LanguageModelV2Content[] {
  const content: LanguageModelV2Content[] = []
  if (!candidate?.content?.parts) return content

  for (const part of candidate.content.parts) {
    // Thought parts → reasoning content
    if (part.thought && part.text) {
      content.push({
        type: "reasoning",
        text: part.text,
        providerMetadata: part.thoughtSignature
          ? { "code-assist": { thoughtSignature: part.thoughtSignature } }
          : undefined,
      })
      continue
    }

    // Function call (may have thought annotation for reasoning-driven tool calls)
    if (part.functionCall) {
      content.push({
        type: "tool-call",
        toolCallId: generateId(),
        toolName: part.functionCall.name,
        input: JSON.stringify(part.functionCall.args ?? {}),
        providerMetadata: part.thoughtSignature
          ? { "code-assist": { thoughtSignature: part.thoughtSignature } }
          : undefined,
      })
      continue
    }

    // Regular text
    if (part.text !== undefined) {
      content.push({ type: "text", text: part.text })
    }
  }

  // Grounding metadata → source content items
  const chunks = candidate.groundingMetadata?.groundingChunks
  if (chunks) {
    for (const chunk of chunks) {
      if (chunk.web?.uri) {
        content.push({
          type: "source",
          sourceType: "url",
          id: generateId(),
          url: chunk.web.uri,
          title: chunk.web.title ?? "Web",
        })
      }
    }
  }

  return content
}

// ── Finish reason mapping ────────────────────────────────────────────

export function mapFinish(
  reason?: string,
): "stop" | "length" | "tool-calls" | "content-filter" | "error" | "other" | "unknown" {
  if (!reason) return "unknown"
  switch (reason) {
    case "STOP":
      return "stop"
    case "MAX_TOKENS":
      return "length"
    case "TOOL_CALL":
    case "FUNCTION_CALL":
      return "tool-calls"
    case "SAFETY":
    case "BLOCKLIST":
    case "PROHIBITED_CONTENT":
    case "SPII":
    case "MALFORMED_FUNCTION_CALL":
      return "content-filter"
    case "RECITATION":
      return "other"
    default:
      return "other"
  }
}

// ── Schema cleanup ───────────────────────────────────────────────────

/** Recursively strip `$schema` and resolve `$ref` pointers — CA API rejects them. */
function stripSchema(schema?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!schema) return schema
  // Collect $defs / definitions for $ref resolution
  const defs = (schema.$defs ?? schema.definitions ?? {}) as Record<string, unknown>
  return resolve(schema, defs)
}

function resolve(node: Record<string, unknown>, defs: Record<string, unknown>): Record<string, unknown> {
  // If this node has a $ref, replace it with the resolved definition
  if (typeof node.$ref === "string") {
    const ref = node.$ref as string
    // Parse "#/$defs/Name" or "#/definitions/Name"
    const match = ref.match(/^#\/(?:\$defs|definitions)\/(.+)$/)
    if (match && defs[match[1]]) {
      const resolved = resolve({ ...(defs[match[1]] as Record<string, unknown>) }, defs)
      // Preserve description/default from the referencing node
      if (node.description) resolved.description = node.description
      if (node.default !== undefined) resolved.default = node.default
      return resolved
    }
    // Unknown ref — strip it and return remaining fields
    const { $ref, ...rest } = node
    return resolve(rest as Record<string, unknown>, defs)
  }

  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(node)) {
    // Strip $schema, $defs, definitions, ref (bare ref from zod .meta({ ref }))
    if (key === "$schema" || key === "$defs" || key === "definitions" || key === "ref") continue
    if (value && typeof value === "object" && !Array.isArray(value)) {
      result[key] = resolve(value as Record<string, unknown>, defs)
    } else if (Array.isArray(value)) {
      result[key] = value.map((item) =>
        item && typeof item === "object" && !Array.isArray(item)
          ? resolve(item as Record<string, unknown>, defs)
          : item,
      )
    } else {
      result[key] = value
    }
  }
  return result
}
