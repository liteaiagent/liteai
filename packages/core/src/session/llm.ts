import type { JSONValue } from "@ai-sdk/provider"
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
import { Auth } from "@/auth"
import { Hook } from "@/hook"
import { Installation } from "@/installation"
import { PermissionNext } from "@/permission/next"
import { Plugin } from "@/plugin"
import { Provider } from "@/provider/provider"
import { ProviderTransform } from "@/provider/transform"
import { Log } from "@/util/log"
import { SystemPrompt } from "./engine/system"
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
    const [language, provider, auth] = await Promise.all([
      Provider.getLanguage(input.model),
      Provider.getProvider(input.model.providerID),
      Auth.get(input.model.providerID),
    ]).catch((e) => {
      l.error("stream setup failed", { error: e })
      throw e
    })
    const isCodex = provider.id === "openai" && auth?.type === "oauth"

    const system: string[] = []
    system.push(
      [
        // use agent prompt otherwise provider prompt
        // For Codex sessions, skip SystemPrompt.provider() since it's sent via options.instructions
        ...(input.agent.prompt ? [input.agent.prompt] : isCodex ? [] : await SystemPrompt.provider(input.model)),
        // any custom prompt passed into this call
        ...input.system,
        // any custom prompt from last user message
        ...(input.user.system ? [input.user.system] : []),
      ]
        .filter((x) => x)
        .join("\n"),
    )

    const header = system[0]
    await Plugin.trigger(
      "experimental.chat.system.transform",
      { sessionID: input.sessionID, model: input.model },
      { system },
    )
    await Hook.dispatch("InstructionsLoaded", {
      session_id: input.sessionID,
      cwd: process.cwd(),
      hook_event_name: "InstructionsLoaded",
      system: system.join("\n"),
    })
    // rejoin to maintain 2-part structure for caching if header unchanged
    if (system.length > 2 && system[0] === header) {
      const rest = system.slice(1)
      system.length = 0
      system.push(header, rest.join("\n"))
    }

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
    if (isCodex) {
      options.instructions = await SystemPrompt.instructions()
    }

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

    const maxOutputTokens =
      isCodex || provider.id.includes("github-copilot") ? undefined : ProviderTransform.maxOutputTokens(input.model)

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
        metadata: {
          // Groups all Traces within this conversation into one Langfuse Session
          sessionId: input.sessionID,
          // Use the langfuse.observation.metadata.* prefix so these appear as
          // filterable fields in the Langfuse UI (not buried in catch-all metadata)
          "langfuse.observation.metadata.agentName": input.agent.name,
          "langfuse.observation.metadata.agentMode": input.agent.mode,
        },
      },
      headers: {
        ...(input.model.providerID !== "anthropic" ? { "User-Agent": `liteai/${Installation.VERSION}` } : undefined),
        ...input.model.headers,
        ...headers,
      },
      maxRetries: input.retries ?? 0,
      messages: [
        ...system.map(
          (x): ModelMessage => ({
            role: "system",
            content: x,
          }),
        ),
        ...input.messages,
      ],
      model: wrapLanguageModel({
        model: language,
        middleware: [
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
    const disabled = PermissionNext.disabled(Object.keys(input.tools), input.agent.permission)
    for (const tool of Object.keys(input.tools)) {
      if (disabled.has(tool)) {
        delete input.tools[tool]
      }
    }
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
