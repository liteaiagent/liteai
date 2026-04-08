import { Flag } from "@/flag/flag"
import type { Agent } from "../agent/agent"
import { Config } from "../config/config"
import type { ModelID, ProviderID } from "../provider/schema"
import { ApplyPatchTool } from "./apply_patch"
import { BatchTool } from "./batch"
import { CommandStatusTool } from "./command_status"
import { EditTool } from "./edit"
import { GlobTool } from "./glob"
import { GrepTool } from "./grep"
import { InvalidTool } from "./invalid"
import { ListTool } from "./ls"
import { MultiEditTool } from "./multiedit"
import { PlanExitTool } from "./plan"
import { QuestionTool } from "./question"
import { ReadTool } from "./read"
import { RunCommandTool } from "./run_command"
import { SendCommandInputTool } from "./send_command_input"
import { SkillTool } from "./skill"
import { TaskTool } from "./task"
import { TodoWriteTool } from "./todo"
import type { Tool } from "./tool"
import { WebFetchTool } from "./webfetch"
import { WebSearchTool } from "./websearch"
import { WriteTool } from "./write"

export namespace ToolRegistry {
  async function all(): Promise<Tool.Info[]> {
    const config = await Config.get()
    const question = ["app", "cli", "desktop"].includes(Flag.LITEAI_CLIENT)

    return [
      InvalidTool,
      ...(question ? [QuestionTool] : []),
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
      PlanExitTool,
    ]
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
  ) {
    const config = await Config.get()
    const tools = await all()
    const result = await Promise.all(
      tools
        .filter((t) => !(config.disabledTools?.[t.id] === true))
        .filter((t) => {
          // use apply tool in same format as codex
          const usePatch =
            model.modelID.includes("gpt-") && !model.modelID.includes("oss") && !model.modelID.includes("gpt-4")
          if (t.id === "apply_patch") return usePatch
          if (t.id === "edit" || t.id === "write" || t.id === "multiedit") return !usePatch

          return true
        })
        .map(async (t) => {
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
