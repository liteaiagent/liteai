import { Log } from "@liteai/util/log"
import { trace } from "@opentelemetry/api"
import { Flag } from "@/flag/flag"
import type { Agent } from "../agent/agent"
import { Config } from "../config/config"
import type { ModelID, ProviderID } from "../provider/schema"
import { ApplyPatchTool } from "./apply_patch"
import { AskUserTool } from "./ask_user"
import { BatchTool } from "./batch"
import { CommandStatusTool } from "./command_status"
import { EditTool } from "./edit"
import { GlobTool } from "./glob"
import { GrepTool } from "./grep"
import { InvalidTool } from "./invalid"
import { ListTool } from "./ls"
import { MultiEditTool } from "./multiedit"
import { PlanEnterTool, PlanExitTool } from "./plan"
import { ReadTool } from "./read"
import { RunCommandTool } from "./run_command"
import { SendCommandInputTool } from "./send_command_input"
import { SendMessageTool } from "./send_message"
import { SkillTool } from "./skill"
import { TaskTool } from "./task"
import { TodoWriteTool } from "./todo"
import type { Tool } from "./tool"
import { WebFetchTool } from "./webfetch"
import { WebSearchTool } from "./websearch"
import { WriteTool } from "./write"
import { YieldTurnTool } from "./yield_turn"

export namespace ToolRegistry {
  const tracer = trace.getTracer("liteai")

  async function all(): Promise<Tool.Info[]> {
    const config = await Config.get()
    const question = ["app", "cli", "desktop"].includes(Flag.LITEAI_CLIENT)

    const result: Tool.Info[] = [
      InvalidTool,
      ...(question ? [AskUserTool] : []),
      YieldTurnTool,
      RunCommandTool,
      CommandStatusTool,
      SendCommandInputTool,
      ReadTool,
      ListTool,
      GlobTool,
      GrepTool,
      EditTool,
      MultiEditTool,
      WriteTool,
      SendMessageTool,
      TaskTool,
      WebFetchTool,
      TodoWriteTool,
      // Intentionally disabled. The agent remembers the current state of its tasks through its
      // previous TodoWriteTool outputs in the chat history. Enabling a read tool wastes tokens
      // and can cause the agent to get stuck in "idle read" loops when it should be taking action.
      // TodoReadTool,
      WebSearchTool,
      //CodeSearchTool,
      SkillTool,
      ApplyPatchTool,
      //LspTool,
      ...(config.experimental?.batch_tool === true ? [BatchTool] : []),
      PlanEnterTool,
      PlanExitTool,
    ]

    const { AgentMemory } = await import("../agent/memory")
    if (await AgentMemory.isAutoMemoryEnabled()) {
      const { ReadMemoryTool, WriteMemoryTool, EditMemoryTool } = await import("./memory")
      result.push(ReadMemoryTool, WriteMemoryTool, EditMemoryTool)
    }

    return result
  }

  export async function ids() {
    const config = await Config.get()
    return all().then((x) =>
      x.map((t) => ({
        id: t.id,
        native: true,
        enabled: !(config.disabledTools?.[t.id] === true),
      })),
    )
  }

  export async function tools(
    model: {
      providerID: ProviderID
      modelID: ModelID
    },
    agent?: Agent.Info,
    options?: {
      /** When "Fast", plan_enter and plan_exit tools are excluded from the pool. */
      toolProfile?: "Plan" | "Fast"
    },
  ) {
    const config = await Config.get()
    const tools = await all()
    let availableTools = tools
      .filter((t) => !(config.disabledTools?.[t.id] === true))
      .filter((t) => {
        // use apply tool in same format as codex
        const usePatch =
          model.modelID.includes("gpt-") && !model.modelID.includes("oss") && !model.modelID.includes("gpt-4")
        if (t.id === "apply_patch") return usePatch
        if (t.id === "edit" || t.id === "write" || t.id === "multiedit") return !usePatch

        return true
      })

    // ── Tool Profile filtering: exclude plan tools when "Fast" ──
    if (options?.toolProfile === "Fast") {
      const planToolIds = new Set(["plan_enter", "plan_exit"])
      const beforeCount = availableTools.length
      availableTools = availableTools.filter((t) => !planToolIds.has(t.id))
      const excluded = beforeCount - availableTools.length
      if (excluded > 0) {
        tracer.startActiveSpan("tool.registry.toolProfile.fast", (span) => {
          span.setAttribute("excludedCount", excluded)
          span.setAttribute("toolProfile", "Fast")
          span.end()
        })
      }
    }

    if (agent?.tools) {
      let allowedNames: Set<string> | null = null
      if (typeof agent.tools === "string" && agent.tools !== "*") {
        allowedNames = new Set([agent.tools])
      } else if (Array.isArray(agent.tools) && !agent.tools.includes("*")) {
        allowedNames = new Set(agent.tools)
      } else if (typeof agent.tools === "object" && !Array.isArray(agent.tools)) {
        allowedNames = new Set(Object.keys(agent.tools).filter(k => (agent.tools as Record<string, boolean>)[k] === true))
      }

      if (allowedNames) {
        availableTools = availableTools.filter((t) => allowedNames!.has(t.id))
      }
    }

    if (agent?.disallowedTools && agent.disallowedTools.length > 0) {
      const availableToolIds = new Set(availableTools.map((t) => t.id))
      for (const disallowed of agent.disallowedTools) {
        if (!availableToolIds.has(disallowed)) {
          tracer.startActiveSpan("tool.registry.disallowed.not_found", (span) => {
            span.setAttribute("agent", agent.name)
            span.setAttribute("tool", disallowed)
            span.addEvent("Disallowed tool not found in tool pool")
            span.end()
          })
          Log.create({ service: "agent" }).warn(
            `[ToolRegistry] Agent '${agent.name}' disallows tool '${disallowed}' which is not in the pool.`,
            { agent: agent.name, tool: disallowed },
          )
        }
      }

      const originalCount = availableTools.length
      availableTools = availableTools.filter((t) => !agent.disallowedTools?.includes(t.id))
      const removedCount = originalCount - availableTools.length

      if (removedCount > 0) {
        tracer.startActiveSpan("tool.registry.filtered", (span) => {
          span.setAttribute("agent", agent.name)
          span.setAttribute("removedCount", removedCount)
          span.end()
        })
      }
    }

    const result = await Promise.all(
      availableTools.map(async (t) => {
        const tool = await t.init({ agent })
        return {
          id: t.id,
          ...tool,
        }
      }),
    )
    return result
  }
}
