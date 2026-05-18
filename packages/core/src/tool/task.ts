import { Log } from "@liteai/util/log"
import z from "zod"
import { PermissionNext } from "@/permission/next"
import { defer } from "@/util/defer"
import { iife } from "@/util/iife"
import { Agent } from "../agent/agent"
import { ForkAgentConfig, isForkSubagentEnabled } from "../agent/fork"
import DESCRIPTION from "../bundled/prompts/tools/task.txt"
import { isCoordinatorMode } from "../coordinator/coordinator-mode"
import { Provider } from "../provider/provider"
import { ModelID, ProviderID } from "../provider/schema"
import { Session } from "../session"
import { SessionPrompt } from "../session/engine"
import { MessageID, SessionID } from "../session/schema"
import { Tool } from "./tool"

const parameters = z.object({
  description: z.string().describe("A short (3-5 words) description of the task"),
  prompt: z.string().describe("The task for the agent to perform"),
  subagent_type: z.string().describe("The type of specialized agent to use for this task").optional(),
  task_id: z
    .string()
    .describe(
      "This should only be set if you mean to resume a previous task (you can pass a prior task_id and the task will continue the same subagent session as before instead of creating a fresh one)",
    )
    .optional(),
  command: z.string().describe("The command that triggered this task").optional(),
})

export const TaskTool = Tool.define("task", async (ctx) => {
  const log = Log.create({ service: "agent.task" })
  const agents = await Agent.list().then((x) => x.filter((a) => a.mode !== "primary"))

  // Filter agents by permissions if agent provided
  const caller = ctx?.agent
  const accessibleAgents = caller
    ? agents.filter((a) => PermissionNext.evaluate("task", a.name, caller.permission).action !== "deny")
    : agents

  const description = DESCRIPTION.replace(
    "{agents}",
    accessibleAgents
      .map((a) => `- ${a.name}: ${a.description ?? "This subagent should only be called manually by the user."}`)
      .join("\n"),
  )
  return {
    description,
    parameters,
    async execute(params: z.infer<typeof parameters>, ctx) {
      const parentSession = await Session.get(ctx.sessionID)
      const forkEnabled = isForkSubagentEnabled({
        isCoordinator: isCoordinatorMode(parentSession.sessionMode),
        isNonInteractive: parentSession.toolProfile === "Fast",
      })

      const defaultAgentName = await Agent.defaultAgent()
      const effectiveType = params.subagent_type ?? (forkEnabled ? ForkAgentConfig.agentType : defaultAgentName)

      const agent = await Agent.get(effectiveType)
      if (!agent) throw new Error(`Unknown agent type: ${effectiveType} is not a valid agent type`)

      let parent: { modelID: ModelID; providerID: ProviderID } | undefined
      const parentAssistant = ctx.messages.findLast((m) => m.info.id === ctx.messageID)
      if (parentAssistant && parentAssistant.info.role === "assistant") {
        parent = {
          modelID: parentAssistant.info.modelID,
          providerID: parentAssistant.info.providerID,
        }
      } else if (ctx.extra?.model && typeof ctx.extra.model === "object") {
        const m = ctx.extra.model as { api?: { id?: unknown }; id?: unknown; providerID?: unknown }
        const modelIdStr = m.api?.id || m.id
        if (typeof modelIdStr !== "string" || !modelIdStr || typeof m.providerID !== "string" || !m.providerID) {
          throw new Error("Could not determine parent model for subagent: invalid ctx.extra.model")
        }
        parent = {
          modelID: ModelID.make(modelIdStr),
          providerID: ProviderID.make(m.providerID),
        }
      } else {
        throw new Error("Could not determine parent model for subagent")
      }
      const model = await (async () => {
        if (!agent.model) return parent
        const valid = await Provider.getModel(agent.model.providerID, agent.model.modelID).catch(() => undefined)
        if (valid) return agent.model
        log.warn("agent model not available, falling back to parent model", {
          agent: agent.name,
          configured: `${agent.model.providerID}/${agent.model.modelID}`,
          fallback: `${parent.providerID}/${parent.modelID}`,
        })
        return parent
      })()

      const session = await iife(async () => {
        if (params.task_id) {
          const found = await Session.get(SessionID.make(params.task_id)).catch(() => {})
          if (found) return found
        }

        return await Session.create({
          parentID: ctx.sessionID,
          title: `${params.description} (@${agent.name} subagent)`,
        })
      })

      ctx.metadata({
        title: params.description,
        metadata: {
          sessionId: session.id,
          model,
        },
      })

      // Skip permission check when user explicitly invoked via @ or command subtask
      if (!ctx.extra?.bypassAgentCheck) {
        await ctx.ask({
          permission: "task",
          patterns: [effectiveType],
          always: ["*"],
          metadata: {
            description: params.description,
            subagent_type: effectiveType,
          },
        })
      }

      const messageID = MessageID.ascending()

      function cancel() {
        SessionPrompt.cancel(session.id)
      }
      ctx.abort.addEventListener("abort", cancel)
      using _ = defer(() => ctx.abort.removeEventListener("abort", cancel))
      const promptParts = await SessionPrompt.resolvePromptParts(params.prompt)

      const result = await SessionPrompt.runSubagent({
        messageID,
        sessionID: session.id,
        model: {
          modelID: model.modelID,
          providerID: model.providerID,
        },
        agent: agent.name,
        parts: promptParts,
      })

      if (result.status === "error") {
        const errorMsg = result.error instanceof Error ? result.error.message : String(result.error)
        return {
          title: params.description,
          metadata: {
            sessionId: session.id,
            model,
          },
          output: [
            `task_id: ${session.id} (for resuming to continue this task if needed)`,
            "",
            "<task_result_error>",
            `Subagent execution failed: ${errorMsg}`,
            "</task_result_error>",
          ].join("\n"),
        }
      }

      if (result.status === "aborted") {
        return {
          title: params.description,
          metadata: {
            sessionId: session.id,
            model,
          },
          output: [
            `task_id: ${session.id} (for resuming to continue this task if needed)`,
            "",
            "<task_result_aborted>",
            "Subagent execution was aborted.",
            "</task_result_aborted>",
          ].join("\n"),
        }
      }

      const completedMessage = result.message
      const textPart =
        (completedMessage?.parts.findLast((x: { type?: string }) => x.type === "text") as { text?: string })?.text ?? ""
      const yieldTurnPart = completedMessage?.parts.findLast(
        (x: { type?: string; tool?: string }) => x.type === "tool" && x.tool === "yield_turn",
      ) as { args?: { summary?: string } } | undefined

      const taskResultContent = yieldTurnPart?.args?.summary ? `[Yield] ${yieldTurnPart.args.summary}` : textPart

      const output = [
        `task_id: ${session.id} (for resuming to continue this task if needed)`,
        "",
        "<task_result>",
        taskResultContent,
        "</task_result>",
      ].join("\n")

      return {
        title: params.description,
        metadata: {
          sessionId: session.id,
          model,
        },
        output,
      }
    },
  }
})
