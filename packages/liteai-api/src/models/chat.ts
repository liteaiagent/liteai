/**
 * Zod schemas for OpenAI-compatible chat completion request/response.
 *
 * Port of liteai/models/chat.py
 */

import { z } from "zod"

// ── Request Schemas ────────────────────────────────────────────────────────

export const ContentPartSchema = z.union([
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({
    type: z.literal("image_url"),
    image_url: z.object({ url: z.string() }),
  }),
])

export const ChatMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: z
    .union([z.string(), z.array(ContentPartSchema)])
    .nullable()
    .default(null),
  name: z.string().nullable().optional(),
  tool_calls: z
    .array(
      z.object({
        id: z.string(),
        type: z.string().default("function"),
        function: z.object({
          name: z.string(),
          arguments: z.string(),
        }),
      }),
    )
    .nullable()
    .optional(),
  tool_call_id: z.string().nullable().optional(),
})

export const FunctionDefinitionSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  parameters: z.record(z.unknown()).optional(),
})

export const ToolDefinitionSchema = z.object({
  type: z.string().default("function"),
  function: FunctionDefinitionSchema,
})

export const ChatCompletionRequestSchema = z.object({
  model: z.string().default("auto"),
  messages: z.array(ChatMessageSchema),
  temperature: z.number().nullable().optional(),
  top_p: z.number().nullable().optional(),
  max_tokens: z.number().nullable().optional(),
  max_completion_tokens: z.number().nullable().optional(),
  stream: z.boolean().default(false),
  stop: z
    .union([z.string(), z.array(z.string())])
    .nullable()
    .optional(),
  tools: z.array(ToolDefinitionSchema).nullable().optional(),
  tool_choice: z
    .union([z.string(), z.record(z.unknown())])
    .nullable()
    .optional(),
  frequency_penalty: z.number().nullable().optional(),
  presence_penalty: z.number().nullable().optional(),
  n: z.number().nullable().optional(),
  // LiteAI extensions
  thinking_budget: z.number().nullable().optional(),
  reasoning_effort: z.enum(["none", "low", "medium", "high"]).nullable().optional(),
})

// ── Response Schemas ───────────────────────────────────────────────────────

export const ToolCallSchema = z.object({
  id: z.string(),
  type: z.string().default("function"),
  function: z.object({
    name: z.string(),
    arguments: z.string(),
  }),
})

export const ChoiceMessageSchema = z.object({
  role: z.literal("assistant"),
  content: z.string().nullable(),
  tool_calls: z.array(ToolCallSchema).nullable().optional(),
  reasoning_content: z.string().nullable().optional(),
})

export const UsageSchema = z.object({
  prompt_tokens: z.number(),
  completion_tokens: z.number(),
  total_tokens: z.number(),
  prompt_tokens_details: z.record(z.number()).nullable().optional(),
  completion_tokens_details: z.record(z.number()).nullable().optional(),
})

export const ChoiceSchema = z.object({
  index: z.number().default(0),
  message: ChoiceMessageSchema,
  finish_reason: z.string().nullable(),
})

export const ChatCompletionResponseSchema = z.object({
  id: z.string(),
  object: z.literal("chat.completion"),
  created: z.number(),
  model: z.string(),
  choices: z.array(ChoiceSchema),
  usage: UsageSchema.nullable().optional(),
  system_fingerprint: z.string().nullable().optional(),
})

// ── Streaming Schemas ──────────────────────────────────────────────────────

export const DeltaMessageSchema = z.object({
  role: z.string().nullable().optional(),
  content: z.string().nullable().optional(),
  tool_calls: z
    .array(
      z.object({
        index: z.number(),
        id: z.string().nullable().optional(),
        type: z.string().nullable().optional(),
        function: z
          .object({
            name: z.string().nullable().optional(),
            arguments: z.string().nullable().optional(),
          })
          .nullable()
          .optional(),
      }),
    )
    .nullable()
    .optional(),
  reasoning_content: z.string().nullable().optional(),
})

export const StreamChoiceSchema = z.object({
  index: z.number().default(0),
  delta: DeltaMessageSchema,
  finish_reason: z.string().nullable(),
})

export const ChatCompletionChunkSchema = z.object({
  id: z.string(),
  object: z.literal("chat.completion.chunk"),
  created: z.number(),
  model: z.string(),
  choices: z.array(StreamChoiceSchema),
  usage: UsageSchema.nullable().optional(),
  system_fingerprint: z.string().nullable().optional(),
})

// ── Models ─────────────────────────────────────────────────────────────────

export const ModelObjectSchema = z.object({
  id: z.string(),
  object: z.literal("model").default("model"),
  created: z.number().default(0),
  owned_by: z.string().default("google"),
})

export const ModelListResponseSchema = z.object({
  object: z.literal("list").default("list"),
  data: z.array(ModelObjectSchema),
})

// ── Type Exports ───────────────────────────────────────────────────────────

export type ChatMessage = z.infer<typeof ChatMessageSchema>
export type ContentPart = z.infer<typeof ContentPartSchema>
export type ChatCompletionRequest = z.infer<typeof ChatCompletionRequestSchema>
export type ChatCompletionResponse = z.infer<typeof ChatCompletionResponseSchema>
export type ChatCompletionChunk = z.infer<typeof ChatCompletionChunkSchema>
export type ToolDefinition = z.infer<typeof ToolDefinitionSchema>
export type ToolCall = z.infer<typeof ToolCallSchema>
export type DeltaMessage = z.infer<typeof DeltaMessageSchema>
export type Usage = z.infer<typeof UsageSchema>
export type ModelObject = z.infer<typeof ModelObjectSchema>
export type ModelListResponse = z.infer<typeof ModelListResponseSchema>
