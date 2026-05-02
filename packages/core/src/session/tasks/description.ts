import { Log } from "@liteai/util/log"
import { Agent } from "../../agent/agent"
import { Provider } from "../../provider/provider"
import type { ModelID, ProviderID } from "../../provider/schema"
import { iife } from "../../util/iife"
import { Session } from ".."
import type { TelemetryTracker } from "../engine/telemetry"
import { LLM } from "../llm"
import { Message } from "../message"
import type { SessionID } from "../schema"

const log = Log.create({ service: "session.prompt.description" })

export namespace SessionDescription {
  export async function create(input: {
    sessionID: SessionID
    history?: Message.WithParts[]
    providerID?: ProviderID
    modelID?: ModelID
    telemetryTracker?: TelemetryTracker
    telemetryBatchId?: string
  }) {
    const session = await Session.get(input.sessionID)
    if (session.parentID) return
    if (session.description) return

    const msgs = input.history ?? (await Session.messages({ sessionID: input.sessionID }))

    // Need at least one assistant response to generate a meaningful description
    const hasAssistant = msgs.some((m) => m.info.role === "assistant")
    if (!hasAssistant) return

    // Find the last user message to get model info
    const lastUser = msgs.findLast((m) => m.info.role === "user")?.info as Message.User | undefined
    if (!lastUser) return

    const providerID = input.providerID ?? lastUser.model.providerID
    const modelID = input.modelID ?? lastUser.model.modelID

    const agent = await Agent.get("title") // reuse title agent for small model
    if (!agent) return

    const model = await iife(async () => {
      if (agent.model) return await Provider.getModel(agent.model.providerID, agent.model.modelID)
      return (await Provider.getSmallModel(providerID)) ?? (await Provider.getModel(providerID, modelID))
    })

    // Take first few messages for context (like title generation)
    const contextMessages = msgs.slice(0, Math.min(6, msgs.length))

    const result = await LLM.stream({
      agent,
      user: lastUser,
      system: [
        "Generate a 1-2 sentence description of what this conversation is about.",
        "Focus on the user's goal and what was accomplished.",
        "Be concise and specific. Do not use quotes.",
      ],
      small: true,
      tools: {},
      model,
      abort: new AbortController().signal,
      sessionID: input.sessionID,
      telemetryTracker: input.telemetryTracker,
      telemetryBatchId: input.telemetryBatchId,
      retries: 2,
      messages: Message.toModelMessages(contextMessages, model),
    })

    const text = await result.text.catch((err) => log.error("failed to generate description", { error: err }))
    if (text) {
      const cleaned = text
        .replace(/<think>[\s\S]*?<\/think>\s*/g, "")
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .join(" ")
      if (!cleaned) return

      const description = cleaned.length > 200 ? `${cleaned.substring(0, 197)}...` : cleaned
      return Session.setDescription({ sessionID: input.sessionID, description })
    }
  }
}
