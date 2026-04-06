import { type Tool as AITool, asSchema, jsonSchema, type ToolCallOptions, tool } from "ai"
import { trace } from "@opentelemetry/api"
import z from "zod"

const tracer = trace.getTracer("liteai")
import { PermissionNext } from "@/permission/next"
import type { Tool } from "@/tool/tool"
import { Truncate } from "@/tool/truncation"
import type { Agent } from "../../agent/agent"
import { Hook } from "../../hook"
import { MCP } from "../../mcp"
import { Plugin } from "../../plugin"
import { Instance } from "../../project/instance"
import type { Provider } from "../../provider/provider"
import { ModelID } from "../../provider/schema"
import { ProviderTransform } from "../../provider/transform"
import { ToolRegistry } from "../../tool/registry"
import { Session } from ".."
import type { Message } from "../message"
import type { SessionProcessor } from "../processor"
import { PartID } from "../schema"

export const STRUCTURED_OUTPUT_DESCRIPTION = `Use this tool to return your final response in the requested structured format.

IMPORTANT:
- You MUST call this tool exactly once at the end of your response
- The input must be valid JSON matching the required schema
- Complete all necessary research and tool calls BEFORE calling this tool
- This tool provides your final answer - no further actions are taken after calling it`

export const STRUCTURED_OUTPUT_SYSTEM_PROMPT = `IMPORTANT: The user has requested structured output. You MUST use the StructuredOutput tool to provide your final response. Do NOT respond with plain text - you MUST call the StructuredOutput tool with your answer formatted according to the schema.`

/** @internal Exported for testing */
export async function resolveTools(input: {
  agent: Agent.Info
  model: Provider.Model
  session: Session.Info
  processor: SessionProcessor.Info
  bypassAgentCheck: boolean
  messages: Message.WithParts[]
}) {
  const tools: Record<string, AITool> = {}

  // biome-ignore lint/suspicious/noExplicitAny: AI SDK execute() callback provides untyped args
  const context = (args: any, options: ToolCallOptions): Tool.Context => ({
    sessionID: input.session.id,
    abort: options.abortSignal ?? new AbortController().signal,
    messageID: input.processor.message.id,
    callID: options.toolCallId,
    extra: { model: input.model, bypassAgentCheck: input.bypassAgentCheck },
    agent: input.agent.name,
    messages: input.messages,
    // biome-ignore lint/suspicious/noExplicitAny: metadata value is opaque provider data
    metadata: async (val: { title?: string; metadata?: any }) => {
      const match = input.processor.partFromToolCall(options.toolCallId)
      if (match && match.state.status === "running") {
        await Session.updatePart({
          ...match,
          state: {
            title: val.title,
            metadata: val.metadata,
            status: "running",
            input: args,
            time: {
              start: Date.now(),
            },
          },
        })
      }
    },
    async ask(req) {
      await PermissionNext.ask({
        ...req,
        sessionID: input.session.id,
        tool: { messageID: input.processor.message.id, callID: options.toolCallId },
        ruleset: PermissionNext.merge(input.agent.permission, input.session.permission ?? []),
      })
    },
  })

  for (const item of await ToolRegistry.tools(
    { modelID: ModelID.make(input.model.api.id), providerID: input.model.providerID },
    input.agent,
  )) {
    const schema = ProviderTransform.schema(input.model, z.toJSONSchema(item.parameters))
    tools[item.id] = tool({
      // biome-ignore lint/suspicious/noExplicitAny: AI SDK tool() id requires specific branded type
      id: item.id as any,
      description: item.description,
      // biome-ignore lint/suspicious/noExplicitAny: AI SDK jsonSchema() accepts opaque schema objects
      inputSchema: jsonSchema(schema as any),
      async execute(args, options) {
        const ctx = context(args, options)
        const pre = await Hook.dispatch("PreToolUse", {
          session_id: ctx.sessionID,
          cwd: Instance.directory,
          hook_event_name: "PreToolUse",
          tool_name: item.id,
          tool_input: args,
        })
        if (!pre.proceed) {
          return {
            title: "Blocked by hook",
            output: pre.feedback ?? "Action blocked by PreToolUse hook",
            metadata: { blocked: true },
          }
        }
        await Plugin.trigger(
          "tool.execute.before",
          {
            tool: item.id,
            sessionID: ctx.sessionID,
            callID: ctx.callID,
          },
          {
            args,
          },
        )
        const result = await tracer.startActiveSpan(item.id, async (toolSpan) => {
          // Set I/O so Langfuse renders them in the observation detail panels
          toolSpan.setAttribute("input.value", JSON.stringify(args))
          try {
            const r = await item.execute(args, ctx)
            toolSpan.setAttribute("output.value", r.output ?? "")
            return r
          } finally {
            toolSpan.end()
          }
        })
        const output = {
          ...result,
          attachments: result.attachments?.map((attachment) => ({
            ...attachment,
            id: PartID.ascending(),
            sessionID: ctx.sessionID,
            messageID: input.processor.message.id,
          })),
        }
        await Plugin.trigger(
          "tool.execute.after",
          {
            tool: item.id,
            sessionID: ctx.sessionID,
            callID: ctx.callID,
            args,
          },
          output,
        )
        await Hook.dispatch("PostToolUse", {
          session_id: ctx.sessionID,
          cwd: Instance.directory,
          hook_event_name: "PostToolUse",
          tool_name: item.id,
          tool_input: args,
          tool_output: output.output,
        })
        return output
      },
    })
  }

  for (const [key, item] of Object.entries(await MCP.tools())) {
    const execute = item.execute
    if (!execute) continue

    const transformed = ProviderTransform.schema(input.model, asSchema(item.inputSchema).jsonSchema)
    item.inputSchema = jsonSchema(transformed)
    // Wrap execute to add plugin hooks and format output
    item.execute = async (args, opts) => {
      const ctx = context(args, opts)

      const pre = await Hook.dispatch("PreToolUse", {
        session_id: ctx.sessionID,
        cwd: Instance.directory,
        hook_event_name: "PreToolUse",
        tool_name: key,
        tool_input: args as Record<string, unknown>,
      })
      if (!pre.proceed) {
        return {
          title: "Blocked by hook",
          output: pre.feedback ?? "Action blocked by PreToolUse hook",
          metadata: { blocked: true },
          content: [{ type: "text" as const, text: pre.feedback ?? "Blocked" }],
        }
      }
      await Plugin.trigger(
        "tool.execute.before",
        {
          tool: key,
          sessionID: ctx.sessionID,
          callID: opts.toolCallId,
        },
        {
          args,
        },
      )

      await ctx.ask({
        permission: key,
        metadata: {},
        patterns: ["*"],
        always: ["*"],
      })

      const result = await tracer.startActiveSpan(key, async (toolSpan) => {
        // Set I/O so Langfuse renders them in the observation detail panels
        toolSpan.setAttribute("input.value", JSON.stringify(args))
        try {
          const r = await execute(args, opts)
          const text = r.content
            .filter((c: { type: string }) => c.type === "text")
            .map((c: { text?: string }) => c.text ?? "")
            .join("\n")
          toolSpan.setAttribute("output.value", text)
          return r
        } finally {
          toolSpan.end()
        }
      })

      await Plugin.trigger(
        "tool.execute.after",
        {
          tool: key,
          sessionID: ctx.sessionID,
          callID: opts.toolCallId,
          args,
        },
        result,
      )
      await Hook.dispatch("PostToolUse", {
        session_id: ctx.sessionID,
        cwd: Instance.directory,
        hook_event_name: "PostToolUse",
        tool_name: key,
        tool_input: args as Record<string, unknown>,
      })

      const textParts: string[] = []
      const attachments: Omit<Message.FilePart, "id" | "sessionID" | "messageID">[] = []

      for (const contentItem of result.content) {
        if (contentItem.type === "text") {
          textParts.push(contentItem.text)
        } else if (contentItem.type === "image") {
          attachments.push({
            type: "file",
            mime: contentItem.mimeType,
            url: `data:${contentItem.mimeType};base64,${contentItem.data}`,
          })
        } else if (contentItem.type === "resource") {
          const { resource } = contentItem
          if (resource.text) {
            textParts.push(resource.text)
          }
          if (resource.blob) {
            attachments.push({
              type: "file",
              mime: resource.mimeType ?? "application/octet-stream",
              url: `data:${resource.mimeType ?? "application/octet-stream"};base64,${resource.blob}`,
              filename: resource.uri,
            })
          }
        }
      }

      const truncated = await Truncate.output(textParts.join("\n\n"), {}, input.agent)
      const metadata = {
        ...(result.metadata ?? {}),
        truncated: truncated.truncated,
        ...(truncated.truncated && { outputPath: truncated.outputPath }),
      }

      return {
        title: "",
        metadata,
        output: truncated.content,
        attachments: attachments.map((attachment) => ({
          ...attachment,
          id: PartID.ascending(),
          sessionID: ctx.sessionID,
          messageID: input.processor.message.id,
        })),
        content: result.content, // directly return content to preserve ordering when outputting to model
      }
    }
    tools[key] = item
  }

  return tools
}

/** @internal Exported for testing */
export function createStructuredOutputTool(input: {
  schema: Record<string, unknown>
  onSuccess: (output: unknown) => void
}): AITool {
  // Remove $schema property if present (not needed for tool input)
  const { $schema, ...toolSchema } = input.schema

  return tool({
    // biome-ignore lint/suspicious/noExplicitAny: AI SDK tool() id requires specific branded type
    id: "StructuredOutput" as any,
    description: STRUCTURED_OUTPUT_DESCRIPTION,
    // biome-ignore lint/suspicious/noExplicitAny: AI SDK jsonSchema() accepts opaque schema objects
    inputSchema: jsonSchema(toolSchema as any),
    async execute(args) {
      // AI SDK validates args against inputSchema before calling execute()
      input.onSuccess(args)
      return {
        output: "Structured output captured successfully.",
        title: "Structured Output",
        metadata: { valid: true },
      }
    },
    toModelOutput(result) {
      return {
        type: "text",
        value: result.output,
      }
    },
  })
}
