import fs from "node:fs/promises"
import path from "node:path"
import type { Agent } from "../../agent/agent"
import { Bundled } from "../../bundled"
import { Filesystem } from "../../util/filesystem"
import { Session } from ".."
import type { Message } from "../message"
import { PartID } from "../schema"

export async function insertPlanReminder(input: {
  messages: Message.WithParts[]
  agent: Agent.Info
  session: Session.Info
}) {
  const userMessage = input.messages.findLast((msg) => msg.info.role === "user")
  if (!userMessage) return input.messages
  const assistantMessage = input.messages.findLast((msg) => msg.info.role === "assistant")

  // Switching from plan mode to build mode
  if (input.agent.name !== "plan" && assistantMessage?.info.agent === "plan") {
    const plan = Session.plan(input.session)
    const exists = await Filesystem.exists(plan)
    if (exists) {
      const buildSwitch = await Bundled.miscPrompt("build-switch")
      const part = await Session.updatePart({
        id: PartID.ascending(),
        messageID: userMessage.info.id,
        sessionID: userMessage.info.sessionID,
        type: "text",
        text: `${buildSwitch}\n\nA plan file exists at ${plan}. You should execute on the plan defined within it`,
        synthetic: true,
      })
      userMessage.parts.push(part)
    }
    return input.messages
  }

  // Entering plan mode
  if (input.agent.name === "plan" && assistantMessage?.info.agent !== "plan") {
    const plan = Session.plan(input.session)
    const exists = await Filesystem.exists(plan)
    if (!exists) await fs.mkdir(path.dirname(plan), { recursive: true })
    const reminderTemplate = await Bundled.miscPrompt("plan-reminder")
    const infoText = exists
      ? `A plan file already exists at ${plan}. You can read it and make incremental edits using the edit tool.`
      : `No plan file exists yet. You should create your plan at ${plan} using the write tool.`
    const reminderText = reminderTemplate.replace("{{PLAN_INFO}}", infoText)
    const part = await Session.updatePart({
      id: PartID.ascending(),
      messageID: userMessage.info.id,
      sessionID: userMessage.info.sessionID,
      type: "text",
      text: reminderText,
      synthetic: true,
    })
    userMessage.parts.push(part)
    return input.messages
  }
  return input.messages
}
