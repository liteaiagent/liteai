/**
 * Converts between OpenAI and Google GenAI (Gemini) message/tool formats.
 *
 * Port of liteai/core/converter.py
 */

import type { Content, FunctionCallingConfig, FunctionDeclaration, GenerateContentConfig, Part } from "@google/genai"
import { createLogger } from "./logger.js"

const logger = createLogger("converter")

/**
 * Synthetic thought signature injected on model turns with functionCall parts.
 * Matching gemini-cli/packages/core/src/core/geminiChat.ts
 */
export const SYNTHETIC_THOUGHT_SIGNATURE = "skip_thought_signature_validator"

// ── Types ──────────────────────────────────────────────────────────────────

interface ChatMessage {
  role: string
  content: string | ContentPart[] | null
  name?: string | null
  tool_calls?: ToolCallEntry[] | null
  tool_call_id?: string | null
}

interface ContentPart {
  type: string
  text?: string
  image_url?: { url: string }
}

interface ToolCallEntry {
  id: string
  type: string
  function: { name: string; arguments: string }
}

interface ToolDefinitionInput {
  type?: string
  function: {
    name: string
    description?: string
    parameters?: Record<string, unknown>
  }
}

// ── Content → Parts ────────────────────────────────────────────────────────

function parseDataUri(dataUri: string): { mimeType: string; data: Buffer } | null {
  if (!dataUri.startsWith("data:")) return null
  try {
    const [header, b64Data] = dataUri.split(",", 2)
    if (!header || !b64Data) return null
    const mimeType = header.split(";")[0]?.replace("data:", "")
    return { mimeType, data: Buffer.from(b64Data, "base64") }
  } catch {
    logger.warn("Failed to parse data URI")
    return null
  }
}

function contentToParts(content: string | ContentPart[] | null): Part[] {
  if (content === null || content === undefined) return []
  if (typeof content === "string") return [{ text: content }]

  const parts: Part[] = []
  for (const item of content) {
    if (item.type === "text" && item.text) {
      parts.push({ text: item.text })
    } else if (item.type === "image_url" && item.image_url?.url) {
      const parsed = parseDataUri(item.image_url.url)
      if (parsed) {
        parts.push({
          inlineData: {
            mimeType: parsed.mimeType,
            data: parsed.data.toString("base64"),
          },
        })
      } else {
        logger.warn("Unsupported image_url format (not a data URI)")
      }
    }
  }
  return parts.length > 0 ? parts : [{ text: "" }]
}

// ── Messages → Gemini Contents ─────────────────────────────────────────────

export function convertMessages(messages: ChatMessage[]): {
  systemInstruction: string | null
  contents: Content[]
} {
  const systemParts: string[] = []
  const contents: Content[] = []

  for (const msg of messages) {
    if (msg.role === "system") {
      const text = typeof msg.content === "string" ? msg.content : ""
      systemParts.push(text)
      continue
    }

    if (msg.role === "tool") {
      appendToolResult(contents, msg)
      continue
    }

    if (msg.role === "assistant" && msg.tool_calls?.length) {
      appendAssistantToolCalls(contents, msg)
      continue
    }

    // Regular user or assistant message
    const geminiRole = msg.role === "user" ? "user" : "model"
    const msgParts = contentToParts(msg.content)

    if (contents.length > 0 && contents[contents.length - 1]?.role === geminiRole) {
      const last = contents.at(-1) as Content
      last.parts = [...(last.parts ?? []), ...msgParts]
    } else {
      contents.push({ role: geminiRole, parts: msgParts })
    }
  }

  const systemInstruction = systemParts.length > 0 ? systemParts.join("\n\n") : null

  // Inject thoughtSignature on model turns containing functionCall parts
  // to avoid Gemini 3.x "missing thought_signature" 400 errors.
  const processedContents = ensureThoughtSignatures(contents)

  return { systemInstruction, contents: processedContents }
}

function appendToolResult(contents: Content[], msg: ChatMessage): void {
  const contentStr = typeof msg.content === "string" ? msg.content : ""
  let responseData: Record<string, unknown>
  try {
    responseData = JSON.parse(contentStr)
  } catch {
    responseData = { result: contentStr }
  }

  const part: Part = {
    functionResponse: {
      name: msg.name || msg.tool_call_id || "unknown",
      response: responseData,
    },
  }

  // Gemini expects function responses as role "user"
  if (contents.length > 0 && contents[contents.length - 1]?.role === "user") {
    const last = contents.at(-1) as Content
    last.parts = [...(last.parts ?? []), part]
  } else {
    contents.push({ role: "user", parts: [part] })
  }
}

function appendAssistantToolCalls(contents: Content[], msg: ChatMessage): void {
  const parts: Part[] = []

  // Include any text content first
  if (msg.content) {
    const text = typeof msg.content === "string" ? msg.content : ""
    if (text) parts.push({ text })
  }

  // Convert each tool call to a FunctionCall part
  for (const tc of msg.tool_calls ?? []) {
    let args: Record<string, unknown> = {}
    try {
      args = JSON.parse(tc.function.arguments || "{}")
    } catch {
      // ignore
    }
    parts.push({
      functionCall: { name: tc.function.name, args },
    })
  }

  contents.push({ role: "model", parts })
}

/**
 * Ensure model turns with functionCall parts have a thoughtSignature.
 * Matching gemini-cli/packages/core/src/core/geminiChat.ts
 * `ensureActiveLoopHasThoughtSignatures()`.
 *
 * Gemini 3.x models require `thoughtSignature` on the first functionCall
 * part of each model turn within the active loop (last user text → end).
 * Without this, the API returns a 400 error.
 */
function ensureThoughtSignatures(contents: Content[]): Content[] {
  // Find the start of the active loop (last user turn with text)
  let activeLoopStart = -1
  for (let i = contents.length - 1; i >= 0; i--) {
    const c = contents[i]
    if (c?.role === "user" && c.parts?.some((p) => p.text)) {
      activeLoopStart = i
      break
    }
  }
  if (activeLoopStart === -1) return contents

  const result = contents.slice() // shallow copy
  for (let i = activeLoopStart; i < result.length; i++) {
    const content = result[i]
    if (content?.role !== "model" || !content.parts) continue

    for (let j = 0; j < content.parts.length; j++) {
      const part = content.parts[j]
      if (part?.functionCall) {
        if (!(part as Record<string, unknown>).thoughtSignature) {
          const newParts = content.parts.slice()
          newParts[j] = {
            ...part,
            thoughtSignature: SYNTHETIC_THOUGHT_SIGNATURE,
          } as Part
          result[i] = { ...content, parts: newParts }
        }
        break // Only consider the first functionCall per model turn
      }
    }
  }
  return result
}

// ── Tools → Gemini Config ──────────────────────────────────────────────────

const UNSUPPORTED_SCHEMA_KEYS = new Set([
  "$schema",
  "additionalProperties",
  "$id",
  "$ref",
  "$comment",
  "definitions",
  "$defs",
  "defs", // SDK-native variant (without $)
  "ref", // SDK-native variant (without $)
  "title",
  "default",
  "examples",
  "const",
  "if",
  "then",
  "else",
  "allOf",
  "oneOf",
  "not",
])

/**
 * Resolve `$ref` / `ref` references by inlining from `$defs` / `defs` / `definitions`.
 *
 * The Code Assist API rejects `Schema.ref` alongside other fields.
 * This replaces every ref node with the actual definition content.
 */
function resolveRefs(schema: Record<string, unknown>): Record<string, unknown> {
  const defs: Record<string, Record<string, unknown>> = {}
  for (const defsKey of ["$defs", "defs", "definitions"]) {
    const val = schema[defsKey]
    if (val && typeof val === "object" && !Array.isArray(val)) {
      Object.assign(defs, val)
    }
  }
  if (Object.keys(defs).length === 0) return schema

  function inline(node: unknown): unknown {
    if (typeof node !== "object" || node === null) return node
    if (Array.isArray(node)) return node.map(inline)

    const obj = node as Record<string, unknown>
    for (const refKey of ["$ref", "ref"]) {
      const refVal = obj[refKey]
      if (typeof refVal === "string") {
        const name = refVal.split("/").pop() ?? ""
        if (name in defs) {
          const resolved = { ...defs[name] }
          // Preserve any description that sat alongside the ref
          if ("description" in obj && refKey !== "description") {
            resolved.description = obj.description
          }
          return inline(resolved)
        }
      }
    }
    return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, inline(v)]))
  }

  return inline(schema) as Record<string, unknown>
}

function sanitizeSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(schema)) {
    if (UNSUPPORTED_SCHEMA_KEYS.has(key)) continue
    if (key === "properties" && typeof value === "object" && value !== null) {
      const props = value as Record<string, unknown>
      cleaned[key] = Object.fromEntries(
        Object.entries(props).map(([propName, propSchema]) => [
          propName,
          typeof propSchema === "object" && propSchema !== null
            ? sanitizeSchema(propSchema as Record<string, unknown>)
            : propSchema,
        ]),
      )
    } else if (key === "items" && typeof value === "object" && value !== null) {
      cleaned[key] = sanitizeSchema(value as Record<string, unknown>)
    } else if (key === "anyOf" && Array.isArray(value)) {
      cleaned[key] = value.map((v) =>
        typeof v === "object" && v !== null ? sanitizeSchema(v as Record<string, unknown>) : v,
      )
    } else {
      cleaned[key] = value
    }
  }
  return cleaned
}

export function convertTools(
  tools: ToolDefinitionInput[] | null | undefined,
  toolChoice: string | Record<string, unknown> | null | undefined,
  config: GenerateContentConfig,
): void {
  if (!tools?.length) return

  const fnDecls: FunctionDeclaration[] = []
  for (const toolDef of tools) {
    const fn = toolDef.function
    const fdKwargs: FunctionDeclaration = { name: fn.name }
    if (fn.description) fdKwargs.description = fn.description
    if (fn.parameters) {
      fdKwargs.parameters = sanitizeSchema(resolveRefs(fn.parameters)) as FunctionDeclaration["parameters"]
    }
    fnDecls.push(fdKwargs)
  }

  if (fnDecls.length > 0) {
    config.tools = [{ functionDeclarations: fnDecls }]
  }

  // Convert tool_choice → Gemini ToolConfig
  if (toolChoice != null) {
    const fcConfig = convertToolChoice(toolChoice, fnDecls)
    if (fcConfig) {
      config.toolConfig = { functionCallingConfig: fcConfig }
    }
  }
}

function convertToolChoice(
  toolChoice: string | Record<string, unknown>,
  _fnDecls: FunctionDeclaration[],
): FunctionCallingConfig | null {
  if (typeof toolChoice === "string") {
    const mapping: Record<string, string> = {
      auto: "AUTO",
      none: "NONE",
      required: "ANY",
    }
    const mode = mapping[toolChoice]
    if (mode) return { mode } as FunctionCallingConfig
    return null
  }

  if (typeof toolChoice === "object" && toolChoice !== null) {
    const fn = toolChoice.function as Record<string, unknown> | undefined
    const fnName = fn?.name as string | undefined
    if (fnName) {
      return {
        mode: "ANY",
        allowedFunctionNames: [fnName],
      } as FunctionCallingConfig
    }
  }

  return null
}

// ── Gemini Response → OpenAI Format ────────────────────────────────────────

export function extractToolCallsFromParts(parts: Part[] | null | undefined): Array<{
  id: string
  type: string
  function: { name: string; arguments: string }
}> | null {
  if (!parts) return null

  const toolCalls: Array<{
    id: string
    type: string
    function: { name: string; arguments: string }
  }> = []

  for (const part of parts) {
    if (part.functionCall) {
      toolCalls.push({
        id: `call_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`,
        type: "function",
        function: {
          name: part.functionCall.name ?? "",
          arguments: JSON.stringify(part.functionCall.args ?? {}),
        },
      })
    }
  }

  return toolCalls.length > 0 ? toolCalls : null
}

export function extractReasoningAndText(parts: Part[] | null | undefined): {
  reasoning: string
  text: string
} {
  if (!parts) return { reasoning: "", text: "" }

  const reasoningPieces: string[] = []
  const textPieces: string[] = []

  for (const p of parts) {
    if (!p.text) continue
    if ((p as Record<string, unknown>).thought) {
      reasoningPieces.push(p.text)
    } else {
      textPieces.push(p.text)
    }
  }

  return {
    reasoning: reasoningPieces.join(""),
    text: textPieces.join(""),
  }
}

export function mapFinishReason(geminiReason: string | null | undefined): string | null {
  const mapping: Record<string, string> = {
    STOP: "stop",
    COMPLETE: "stop",
    MAX_TOKENS: "length",
    SAFETY: "content_filter",
    RECITATION: "content_filter",
    BLOCKED_REASON_UNSPECIFIED: "content_filter",
  }
  return mapping[geminiReason ?? ""] ?? null
}
