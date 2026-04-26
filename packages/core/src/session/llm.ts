import { userInfo } from "node:os"
import type { JSONValue, LanguageModelV2Middleware, LanguageModelV2StreamPart } from "@ai-sdk/provider"
import { Log } from "@liteai/util/log"
import { trace } from "@opentelemetry/api"
import {
  jsonSchema,
  type ModelMessage,
  type StreamTextResult,
  streamText,
  type Tool,
  type ToolSet,
  tool,
  wrapLanguageModel,
} from "ai"
import { mergeDeep, pipe } from "remeda"
import type { Agent } from "@/agent/agent"
import { Hook } from "@/hook"
import { Installation } from "@/installation"
import { Plugin } from "@/plugin"
import { Provider } from "@/provider/provider"
import { ProviderTransform } from "@/provider/transform"

import type { TelemetryTracker } from "./engine/telemetry"
import type { Message } from "./message"

export namespace LLM {
  const log = Log.create({ service: "session.llm" })
  export const OUTPUT_TOKEN_MAX = ProviderTransform.OUTPUT_TOKEN_MAX

  export type StreamInput = {
    user: Message.User
    sessionID: string
    model: Provider.Model
    agent: Agent.Info
    system: string[]
    abort: AbortSignal
    messages: ModelMessage[]
    small?: boolean
    tools: Record<string, Tool>
    retries?: number
    toolChoice?: "auto" | "required" | "none"
    onSystem?: (system: string[]) => void
    telemetryTracker?: TelemetryTracker
    telemetryBatchId?: string
    systemBoundary?: number
  }

  export type StreamOutput = StreamTextResult<ToolSet, unknown>

  export async function stream(input: StreamInput) {
    const l = log
      .clone()
      .tag("providerID", input.model.providerID)
      .tag("modelID", input.model.id)
      .tag("sessionID", input.sessionID)
      .tag("small", (input.small ?? false).toString())
      .tag("agent", input.agent.name)
      .tag("mode", input.agent.mode)
    l.info("stream", {
      modelID: input.model.id,
      providerID: input.model.providerID,
    })
    const [language, provider] = await Promise.all([
      Provider.getLanguage(input.model),
      Provider.getProvider(input.model.providerID),
    ]).catch((e) => {
      l.error("stream setup failed", { error: e })
      throw e
    })

    const system: string[] = []
    if (input.agent.prompt) system.push(input.agent.prompt)

    let boundaryString: string | undefined
    if (input.systemBoundary && input.systemBoundary > 0 && input.systemBoundary <= input.system.length) {
      boundaryString = input.system[input.systemBoundary - 1]
    }

    system.push(...input.system)
    if (input.user.system) system.push(input.user.system)

    await Plugin.trigger(
      "experimental.chat.system.transform",
      { sessionID: input.sessionID, model: input.model },
      { system },
    )
    await Hook.dispatch("InstructionsLoaded", {
      session_id: input.sessionID,
      cwd: process.cwd(),
      hook_event_name: "InstructionsLoaded",
      system: system.filter(Boolean).join("\n"),
    })

    // Report resolved system prompt to caller (for telemetry span recording)
    input.onSystem?.(system)

    const variant =
      !input.small && input.model.variants && input.user.variant ? input.model.variants[input.user.variant] : {}
    const base = input.small
      ? ProviderTransform.smallOptions(input.model)
      : ProviderTransform.options({
          model: input.model,
          sessionID: input.sessionID,
          providerOptions: provider.options,
        })
    const options: Record<string, unknown> = pipe(
      base,
      mergeDeep(input.model.options),
      mergeDeep(input.agent.options),
      mergeDeep(variant),
    )

    const params = await Plugin.trigger(
      "chat.params",
      {
        sessionID: input.sessionID,
        agent: input.agent,
        model: input.model,
        provider,
        message: input.user,
      },
      {
        temperature: input.model.capabilities.temperature
          ? (input.agent.temperature ?? ProviderTransform.temperature(input.model))
          : undefined,
        topP: input.agent.topP ?? ProviderTransform.topP(input.model),
        topK: ProviderTransform.topK(input.model),
        options,
      },
    )

    const { headers } = await Plugin.trigger(
      "chat.headers",
      {
        sessionID: input.sessionID,
        agent: input.agent,
        model: input.model,
        provider,
        message: input.user,
      },
      {
        headers: {},
      },
    )

    const maxOutputTokens = provider.id.includes("github-copilot")
      ? undefined
      : ProviderTransform.maxOutputTokens(input.model)

    const tools = await resolveTools(input)

    // LiteLLM and some Anthropic proxies require the tools parameter to be present
    // when message history contains tool calls, even if no tools are being used.
    // Add a dummy tool that is never called to satisfy this validation.
    // This is enabled for:
    // 1. Providers with "litellm" in their ID or API ID (auto-detected)
    // 2. Providers with explicit "litellmProxy: true" option (opt-in for custom gateways)
    const isLiteLLMProxy =
      provider.options?.litellmProxy === true ||
      input.model.providerID.toLowerCase().includes("litellm") ||
      input.model.api.id.toLowerCase().includes("litellm")

    if (isLiteLLMProxy && Object.keys(tools).length === 0 && hasToolCalls(input.messages)) {
      tools._noop = tool({
        description:
          "Placeholder for LiteLLM/Anthropic proxy compatibility - required when message history contains tool calls but no active tools are needed",
        inputSchema: jsonSchema({ type: "object", properties: {} }),
        execute: async () => ({ output: "", title: "", metadata: {} }),
      })
    }

    return streamText({
      onError(error) {
        const err = error.error
        if (err instanceof DOMException && err.name === "AbortError") {
          l.info("stream aborted", { error: err })
          return
        }
        l.error("stream error", {
          error: err,
        })
      },
      async experimental_repairToolCall(failed) {
        const lower = failed.toolCall.toolName.toLowerCase()
        if (lower !== failed.toolCall.toolName && tools[lower]) {
          l.info("repairing tool call", {
            tool: failed.toolCall.toolName,
            repaired: lower,
          })
          return {
            ...failed.toolCall,
            toolName: lower,
          }
        }
        return {
          ...failed.toolCall,
          input: JSON.stringify({
            tool: failed.toolCall.toolName,
            error: failed.error.message,
          }),
          toolName: "invalid",
        }
      },
      temperature: params.temperature,
      topP: params.topP,
      topK: params.topK,
      providerOptions: ProviderTransform.providerOptions(input.model, params.options as Record<string, JSONValue>),
      activeTools: Object.keys(tools).filter((x) => x !== "invalid"),
      tools,
      toolChoice: input.toolChoice,
      maxOutputTokens,
      abortSignal: input.abort,
      experimental_telemetry: {
        isEnabled: true,
        functionId: input.agent.name,
        recordInputs: true,
        recordOutputs: true,
        metadata: {
          // Groups all Traces within this conversation into one Langfuse Session
          sessionId: input.sessionID,
          // Trace-level fields
          "langfuse.trace.name": "LiteAI",
          userId: userInfo().username,
          // Langfuse graph visualization metadata:
          // Langfuse's Clickhouse query extracts metadata['langgraph_node']
          // and metadata['langgraph_step'] to render the agent graph view.
          // Keys here must be bare (no 'langfuse.observation.metadata.' prefix)
          // because the AI SDK wraps them as 'ai.telemetry.metadata.<key>' and
          // Langfuse's extractMetadata() strips that prefix, leaving just '<key>'
          // in the observation metadata column.
          langgraph_node: input.agent.name,
          langgraph_step: String(input.telemetryTracker?.getStep(input.telemetryBatchId) ?? 1),
        },
      },
      headers: {
        ...(input.model.providerID !== "anthropic" ? { "User-Agent": `liteai/${Installation.VERSION}` } : undefined),
        ...input.model.headers,
        ...headers,
      },
      maxRetries: input.retries ?? 0,
      messages: [
        ...system.filter(Boolean).map((x): ModelMessage => {
          const msg: ModelMessage = {
            role: "system",
            content: x,
          }
          if (boundaryString && x === boundaryString && input.model.providerID === "anthropic") {
            ;(
              msg as ModelMessage & { experimental_providerMetadata?: Record<string, unknown> }
            ).experimental_providerMetadata = {
              anthropic: { cacheControl: { type: "ephemeral" } },
            }
          }
          return msg
        }),
        ...input.messages,
      ],
      model: wrapLanguageModel({
        model: language,
        middleware: [
          reasoningTelemetryMiddleware,
          {
            async transformParams(args) {
              if (args.type === "stream") {
                // @ts-expect-error
                args.params.prompt = ProviderTransform.message(args.params.prompt, input.model)
              }
              return args.params
            },
          },
        ],
      }),
    })
  }

  async function resolveTools(input: Pick<StreamInput, "tools" | "agent" | "user">) {
    // Tool visibility is handled by the schema layer (tools/disallowedTools in resolveAgentTools).
    // Runtime permission (ask/allow/deny) is handled by ctx.ask() against session-level rules.
    return input.tools
  }

  // Check if messages contain any tool-call content
  // Used to determine if a dummy tool should be added for LiteLLM proxy compatibility
  export function hasToolCalls(messages: ModelMessage[]): boolean {
    for (const msg of messages) {
      if (!Array.isArray(msg.content)) continue
      for (const part of msg.content) {
        if (part.type === "tool-call" || part.type === "tool-result") return true
      }
    }
    return false
  }
}

// ─── Reasoning Telemetry Middleware ────────────────────────────────────────────
//
// Captures reasoning/thinking text emitted by any provider and patches the
// OTel span so Langfuse can render it as a ThinkingBlock.
//
// How it works:
// 1. wrapStream intercepts the provider's ReadableStream
// 2. A TransformStream passes all parts through unchanged while accumulating
//    reasoning-delta and text-delta chunks
// 3. On stream completion (flush), if reasoning was present, it sets the
//    `langfuse.observation.output` span attribute with a ChatML-format message
//    that includes a `thinking` array.
//
// Why `langfuse.observation.output` instead of `ai.response.text`?
//   The AI SDK's internal telemetry wraps OUTSIDE this middleware. When the
//   stream completes, the AI SDK's own flush overwrites `ai.response.text`
//   after our flush runs. `langfuse.observation.output` has HIGHEST priority
//   in Langfuse's ingestion processor (checked before all framework-specific
//   extractors) and the AI SDK never touches it.
//
// Why the `thinking` array format?
//   Langfuse's ChatMlMessageSchema directly supports:
//     thinking: z.array(ThinkingContentPartSchema).optional()
//   where ThinkingContentPartSchema = { type: "thinking", content: string }
//   This is rendered by the ThinkingBlock component in the trace UI.
//
// This runs once at the middleware layer so ALL providers benefit automatically.

const reasoningTelemetryMiddleware: LanguageModelV2Middleware = {
  wrapStream: async ({ doStream, params }) => {
    // Capture the active OTel span while we're still inside the
    // ai.streamText.doStream span context. By the time the stream
    // flushes, the async context may have unwound.
    const span = trace.getActiveSpan()

    const { stream, ...rest } = await doStream()

    // If no span, skip the transform overhead entirely
    if (!span) {
      return { stream, ...rest }
    }

    const reasoningChunks: string[] = []
    const textChunks: string[] = []
    const toolCalls: Array<{ type: string; toolCallId: string; toolName: string; input: string }> = []

    const transform = new TransformStream<LanguageModelV2StreamPart, LanguageModelV2StreamPart>({
      transform(chunk, controller) {
        if (chunk.type === "reasoning-delta") {
          reasoningChunks.push(chunk.delta)
        }
        if (chunk.type === "text-delta") {
          textChunks.push(chunk.delta)
        }
        if (chunk.type === "tool-call") {
          toolCalls.push({
            type: chunk.type,
            toolCallId: chunk.toolCallId,
            toolName: chunk.toolName,
            input: chunk.input,
          })
        }

        // Always pass through unchanged — we never alter the stream content
        controller.enqueue(chunk)
      },
      flush() {
        if (reasoningChunks.length === 0) return

        const reasoningText = reasoningChunks.join("")
        const responseText = textChunks.join("")

        // Build a ChatML-format output that Langfuse's schema directly supports.
        // The `thinking` array is defined in BaseChatMlMessageSchema and rendered
        // by the ThinkingBlock component.
        const output: Record<string, unknown> = {
          role: "assistant",
          thinking: [{ type: "thinking" as const, content: reasoningText }],
        }

        if (responseText) {
          output.content = responseText
        }

        if (toolCalls.length > 0) {
          // Map to Langfuse's ToolCallSchema format: { id, name, arguments (string) }
          // The AI SDK uses { toolCallId, toolName, input (string) } which doesn't
          // match ToolCallSchema and would cause the entire ChatMlMessageSchema to
          // fail validation, putting everything (including thinking) into the json
          // bucket where ThinkingBlock can't find it.
          output.tool_calls = toolCalls.map((tc) => ({
            id: tc.toolCallId,
            name: tc.toolName,
            arguments: tc.input, // already a JSON string from the stream
            type: tc.type,
          }))
        }

        // Setting langfuse.observation.output triggers an early return in
        // Langfuse's extractInputOutput (line 1482), which skips reading
        // ai.prompt.messages. So we must also set langfuse.observation.input
        // to preserve the prompt messages in the trace.
        //
        // Output must be a plain object (not wrapped in array) — when wrapped,
        // the fallback path sets json=[...] and message.json.tool_calls is
        // undefined because json is an array, not an object.
        span.setAttribute("langfuse.observation.input", JSON.stringify(params.prompt))
        span.setAttribute("langfuse.observation.output", JSON.stringify(output))
      },
    })

    return {
      stream: stream.pipeThrough(transform),
      ...rest,
    }
  },
}
