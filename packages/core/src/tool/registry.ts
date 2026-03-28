import { Flag } from "@/flag/flag"
import type { Agent } from "../agent/agent"
import { Config } from "../config/config"
import { type ModelID, ProviderID } from "../provider/schema"
import { ApplyPatchTool } from "./apply_patch"
import { BatchTool } from "./batch"
import { CodeSearchTool } from "./codesearch"
import { EditTool } from "./edit"
import { GlobTool } from "./glob"
import { GrepTool } from "./grep"
import { InvalidTool } from "./invalid"
import { LspTool } from "./lsp"
import { PlanExitTool } from "./plan"
import { QuestionTool } from "./question"
import { ReadTool } from "./read"
import { RunCommandTool } from "./run_command"
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
    const question = ["app", "cli", "desktop"].includes(Flag.LITEAI_CLIENT) || Flag.LITEAI_ENABLE_QUESTION_TOOL

    return [
      InvalidTool,
      ...(question ? [QuestionTool] : []),
      RunCommandTool,
      ReadTool,
      GlobTool,
      GrepTool,
      EditTool,
      WriteTool,
      TaskTool,
      WebFetchTool,
      TodoWriteTool,
      // TodoReadTool,
      WebSearchTool,
      CodeSearchTool,
      SkillTool,
      ApplyPatchTool,
      LspTool,
      ...(config.experimental?.batch_tool === true ? [BatchTool] : []),
      ...(Flag.LITEAI_EXPERIMENTAL_PLAN_MODE && Flag.LITEAI_CLIENT === "cli" ? [PlanExitTool] : []),
    ]
  }

  export async function ids() {
    return all().then((x) => x.map((t) => t.id))
  }

  export async function tools(
    model: {
      providerID: ProviderID
      modelID: ModelID
    },
    agent?: Agent.Info,
  ) {
    const tools = await all()
    const result = await Promise.all(
      tools
        .filter((t) => {
          // use apply tool in same format as codex
          const usePatch =
            model.modelID.includes("gpt-") && !model.modelID.includes("oss") && !model.modelID.includes("gpt-4")
          if (t.id === "apply_patch") return usePatch
          if (t.id === "edit" || t.id === "write") return !usePatch

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
