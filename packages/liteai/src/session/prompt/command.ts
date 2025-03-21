import { NamedError } from "@liteai/util/error"
import { $ } from "bun"
import z from "zod"
import { Agent } from "../../agent/agent"
import { Bus } from "../../bus"
import { Command } from "../../command"
import { ConfigMarkdown } from "../../config/markdown"
import { Plugin } from "../../plugin"
import { Provider } from "../../provider/provider"
import { Session } from ".."
import { Message } from "../message"
import { MessageID, SessionID } from "../schema"
import { lastModel, prompt } from "./loop"
import { resolvePromptParts } from "./message"

const bashRegex = /!`([^`]+)`/g
// Match [Image N] as single token, quoted strings, or non-space sequences
const argsRegex = /(?:\[Image\s+\d+\]|"[^"]*"|'[^']*'|[^\s"']+)/gi
const placeholderRegex = /\$(\d+)/g
const quoteTrimRegex = /^["']|["']$/g

export const CommandInput = z.object({
  messageID: MessageID.zod.optional(),
  sessionID: SessionID.zod,
  agent: z.string().optional(),
  model: z.string().optional(),
  arguments: z.string(),
  command: z.string(),
  variant: z.string().optional(),
  parts: z
    .array(
      z.discriminatedUnion("type", [
        Message.FilePart.omit({
          messageID: true,
          sessionID: true,
        }).partial({
          id: true,
        }),
      ]),
    )
    .optional(),
})
export type CommandInput = z.infer<typeof CommandInput>

/**
 * Regular expression to match @ file references in text
 * Matches @ followed by file paths, excluding commas, periods at end of sentences, and backticks
 * Does not match when preceded by word characters or backticks (to avoid email addresses and quoted references)
 */

export async function command(input: CommandInput) {
  const log = (await import("../../util/log")).Log.create({ service: "session.prompt.command" })
  log.info("command", input)
  const cmd = await Command.get(input.command)
  const agentName = cmd.agent ?? input.agent ?? (await Agent.defaultAgent())

  const raw = input.arguments.match(argsRegex) ?? []
  const args = raw.map((arg) => arg.replace(quoteTrimRegex, ""))

  // Set plugin arguments for the /plugin command getter
  if (input.command === Command.Default.PLUGIN) {
    Command.Default._pluginArgs = input.arguments
  }
  const templateCommand = await cmd.template
  Command.Default._pluginArgs = undefined

  const placeholders = templateCommand.match(placeholderRegex) ?? []
  let last = 0
  for (const item of placeholders) {
    const value = Number(item.slice(1))
    if (value > last) last = value
  }

  // Let the final placeholder swallow any extra arguments so prompts read naturally
  const withArgs = templateCommand.replaceAll(placeholderRegex, (_, index) => {
    const position = Number(index)
    const argIndex = position - 1
    if (argIndex >= args.length) return ""
    if (position === last) return args.slice(argIndex).join(" ")
    return args[argIndex]
  })
  const usesArgumentsPlaceholder = templateCommand.includes("$ARGUMENTS")
  let template = withArgs.replaceAll("$ARGUMENTS", input.arguments)

  // If command doesn't explicitly handle arguments (no $N or $ARGUMENTS placeholders)
  // but user provided arguments, append them to the template
  if (placeholders.length === 0 && !usesArgumentsPlaceholder && input.arguments.trim()) {
    template = `${template}\n\n${input.arguments}`
  }

  const shellCmds = ConfigMarkdown.shell(template)
  if (shellCmds.length > 0) {
    const results = await Promise.all(
      shellCmds.map(async ([, cmd]) => {
        try {
          return await $`${{ raw: cmd }}`.quiet().nothrow().text()
        } catch (error) {
          return `Error executing command: ${error instanceof Error ? error.message : String(error)}`
        }
      }),
    )
    let index = 0
    template = template.replace(bashRegex, () => results[index++])
  }
  template = template.trim()

  const taskModel = await (async () => {
    if (cmd.model) {
      return Provider.parseModel(cmd.model)
    }
    if (cmd.agent) {
      const cmdAgent = await Agent.get(cmd.agent)
      if (cmdAgent?.model) {
        return cmdAgent.model
      }
    }
    if (input.model) return Provider.parseModel(input.model)
    return await lastModel(input.sessionID)
  })()

  try {
    await Provider.getModel(taskModel.providerID, taskModel.modelID)
  } catch (e) {
    log.error("command model lookup failed", { error: e })
    if (Provider.ModelNotFoundError.isInstance(e)) {
      const { providerID, modelID, suggestions } = e.data
      const hint = suggestions?.length ? ` Did you mean: ${suggestions.join(", ")}?` : ""
      Bus.publish(Session.Event.Error, {
        sessionID: input.sessionID,
        error: new NamedError.Unknown({ message: `Model not found: ${providerID}/${modelID}.${hint}` }).toObject(),
      })
    }
    throw e
  }
  const agent = await Agent.get(agentName)
  if (!agent) {
    const available = await Agent.list().then((agents) => agents.filter((a) => !a.hidden).map((a) => a.name))
    const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
    const error = new NamedError.Unknown({ message: `Agent not found: "${agentName}".${hint}` })
    Bus.publish(Session.Event.Error, {
      sessionID: input.sessionID,
      error: error.toObject(),
    })
    throw error
  }

  const templateParts = await resolvePromptParts(template)
  const isSubtask = (agent.mode !== "primary" && cmd.subtask !== false) || cmd.subtask === true
  const parts = isSubtask
    ? [
        {
          type: "subtask" as const,
          agent: agent.name,
          description: cmd.description ?? "",
          command: input.command,
          model: {
            providerID: taskModel.providerID,
            modelID: taskModel.modelID,
          },
          // TODO: how can we make task tool accept a more complex input?
          prompt: templateParts.find((y) => y.type === "text")?.text ?? "",
        },
      ]
    : (() => {
        if (cmd.source === "skill") {
          const text = templateParts.find((y) => y.type === "text")
          if (text && text.type === "text") {
            text.metadata = {
              ...text.metadata,
              command: input.command,
              arguments: input.arguments,
              description: cmd.description,
            }
          }
        }
        return [...templateParts, ...(input.parts ?? [])]
      })()

  const userAgent = isSubtask ? (input.agent ?? (await Agent.defaultAgent())) : agentName
  const userModel = isSubtask
    ? input.model
      ? Provider.parseModel(input.model)
      : await lastModel(input.sessionID)
    : taskModel

  await Plugin.trigger(
    "command.execute.before",
    {
      command: input.command,
      sessionID: input.sessionID,
      arguments: input.arguments,
    },
    { parts },
  )

  const result = (await prompt({
    sessionID: input.sessionID,
    messageID: input.messageID,
    model: userModel,
    agent: userAgent,
    parts,
    variant: input.variant,
  })) as Message.WithParts

  Bus.publish(Command.Event.Executed, {
    name: input.command,
    sessionID: input.sessionID,
    arguments: input.arguments,
    messageID: result.info.id,
  })

  return result
}
