import { trace } from "@opentelemetry/api"
import { type Tool as AITool, asSchema, jsonSchema, type ToolCallOptions, tool } from "ai"
import z from "zod"
import type { BackgroundTaskRegistry } from "@/command/background"
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
import type { TelemetryTracker } from "./telemetry"

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
  /** Session-scoped registry for background task management. Optional — tools that need it
   * (run_command, command_status, send_command_input) gracefully handle absence. */
  backgroundTaskRegistry?: BackgroundTaskRegistry
  /** Current step number in the query loop (1-indexed). Used to set langgraph_step on
   * tool call spans so Langfuse renders tool executions as distinct graph nodes. */
  step?: number
  telemetryTracker?: TelemetryTracker
  telemetryBatchId?: string
  onInject?: (msg: Message.WithParts) => void
}) {
  const tools: Record<string, AITool> = {}

  // biome-ignore lint/suspicious/noExplicitAny: AI SDK execute() callback provides untyped args
  const context = (args: any, options: ToolCallOptions): Tool.Context => ({
    sessionID: input.session.id,
    abort: options.abortSignal ?? new AbortController().signal,
    messageID: input.processor.message.id,
    callID: options.toolCallId,
    extra: {
      model: input.model,
      bypassAgentCheck: input.bypassAgentCheck,
      backgroundTaskRegistry: input.backgroundTaskRegistry,
    },
    agent: input.agent.name,
    messages: input.messages,
    // biome-ignore lint/suspicious/noExplicitAny: metadata value is opaque provider data
    metadata: async (val: { title?: string; metadata?: any }) => {
      const match = input.processor.partFromToolCall(options.toolCallId)
      if (match && (match.state.status === "running" || match.state.status === "pending")) {
        if (val.title) (match.state as any).title = val.title
        if (val.metadata) match.metadata = val.metadata

        await Session.updatePart({
          ...match,
          state: {
            ...match.state,
            title: val.title ?? (match.state as any).title,
          },
          metadata: val.metadata ?? match.metadata,
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
    { toolProfile: input.session.toolProfile },
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
        const activeSpan = trace.getActiveSpan()
        if (activeSpan) {
          // Set I/O so Langfuse renders them in the observation detail panels
          activeSpan.setAttribute("input.value", JSON.stringify(args))
          // Override the inherited langgraph metadata so Langfuse renders this
          // tool call as a distinct node in the graph view, not collapsed into
          // the parent LLM generation step.
          activeSpan.setAttribute("ai.telemetry.metadata.langgraph_node", item.id)
          activeSpan.setAttribute(
            "ai.telemetry.metadata.langgraph_step",
            String(input.telemetryTracker?.getStep(input.telemetryBatchId) ?? 1),
          )
        }

        let result: Awaited<ReturnType<typeof item.execute>>
        try {
          const r = await item.execute(args, ctx)
          if (activeSpan) {
            activeSpan.setAttribute("output.value", r.output ?? "")
          }
          result = r
        } catch (e) {
          if (activeSpan) {
            // Record the error as the output so Langfuse shows what was
            // returned to the AI (e.g. permission denial message) instead of undefined
            activeSpan.setAttribute("output.value", String(e))
          }
          throw e
        }
        const output = {
          ...result,
          attachments: result.attachments?.map((attachment) => ({
            ...attachment,
            id: PartID.ascending(),
            sessionID: ctx.sessionID,
            messageID: input.processor.message.id,
          })),
        }

        if (result.inject && result.inject.length > 0) {
          for (const msg of result.inject) {
            await Session.updateMessage(msg.info)
            for (const part of msg.parts) {
              await Session.updatePart(part)
            }
            if (input.onInject) {
              input.onInject(msg)
            }
          }
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

  const contextModule = await import("../../agent/context")
  const agentCtx = contextModule.AgentExecutionContext.getStore()
  const mcpClients = agentCtx?.type === "subagent" ? agentCtx.mcpClients : undefined

  for (const [key, item] of Object.entries(await MCP.tools(mcpClients))) {
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

      const activeSpan = trace.getActiveSpan()
      if (activeSpan) {
        // Set I/O so Langfuse renders them in the observation detail panels
        activeSpan.setAttribute("input.value", JSON.stringify(args))
        // Override the inherited langgraph metadata so Langfuse renders this
        // tool call as a distinct node in the graph view, not collapsed into
        // the parent LLM generation step.
        activeSpan.setAttribute("ai.telemetry.metadata.langgraph_node", key)
        activeSpan.setAttribute(
          "ai.telemetry.metadata.langgraph_step",
          String(input.telemetryTracker?.getStep(input.telemetryBatchId) ?? 1),
        )
      }

      let result: {
        content: Array<{
          type: string
          text?: string
          mimeType?: string
          data?: string
          resource?: { text?: string; blob?: string; mimeType?: string; uri?: string }
        }>
        metadata?: Record<string, unknown>
      }
      try {
        const r = await execute(args, opts)
        const text = r.content
          .filter((c: { type: string }) => c.type === "text")
          .map((c: { text?: string }) => c.text ?? "")
          .join("\n")
        if (activeSpan) {
          activeSpan.setAttribute("output.value", text)
        }
        result = r
      } catch (e) {
        if (activeSpan) {
          // Record the error as the output so Langfuse shows what was
          // returned to the AI (e.g. permission denial message) instead of undefined
          activeSpan.setAttribute("output.value", String(e))
        }
        throw e
      }

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
          textParts.push(contentItem.text ?? "")
        } else if (contentItem.type === "image") {
          attachments.push({
            type: "file",
            mime: contentItem.mimeType ?? "application/octet-stream",
            url: `data:${contentItem.mimeType ?? "application/octet-stream"};base64,${contentItem.data}`,
          })
        } else if (contentItem.type === "resource") {
          const { resource } = contentItem
          if (resource) {
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
      }

      const truncated = await Truncate.output(textParts.join("\n\n"), {}, input.agent)
      const metadata = {
        ...(result.metadata ?? {}),
        truncated: truncated.truncated,
        ...(truncated.truncated && { outputPath: truncated.outputPath }),
      }

      const formattedOutput = truncated.content

      return {
        title: key,
        metadata,
        output: formattedOutput || "*(empty return)*",
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
