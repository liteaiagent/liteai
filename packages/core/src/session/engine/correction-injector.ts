import { Log } from "@liteai/util/log"
import type { BackgroundTaskRegistry } from "@/command/background"
import type { AgentTaskRegistry } from "@/task/registry"
import type { Message } from "../message"
import { MessageID, PartID, type SessionID } from "../schema"
import type { Checkpointer } from "./loop/checkpointer"

const log = Log.create({ service: "session.correction-injector" })

/**
 * Injects synthetic user messages for corrections, notifications, and
 * loop recovery feedback.
 *
 * Extracted from inline `injectCorrectionMessage()` and
 * `injectTaskNotifications()` helper functions in loop.ts.
 *
 * All injections persist to DB AND update the in-memory buffer so the
 * next queryLoop iteration picks them up without a DB read (FR-3).
 */
export class CorrectionInjector {
  constructor(
    private readonly sessionID: SessionID,
    private readonly checkpointer: Checkpointer,
  ) {}

  /**
   * Inject a correction message into the session.
   * Creates a synthetic user message with the correction text.
   * Updates the in-memory buffer to include the new message.
   */
  async inject(params: {
    lastUser: Message.User
    text: string
    msgsBuffer: { current: Message.WithParts[] }
  }): Promise<void> {
    const { lastUser, text, msgsBuffer } = params
    const sessionID = this.sessionID

    const correctionMsg: Message.User = {
      id: MessageID.ascending(),
      role: "user",
      sessionID,
      agent: lastUser.agent,
      model: lastUser.model,
      time: { created: Date.now() },
    }
    const persisted = await this.checkpointer.saveMessage(correctionMsg)

    const correctionPart = await this.checkpointer.savePart({
      id: PartID.ascending(),
      messageID: (persisted as Message.User).id,
      sessionID,
      type: "text",
      text,
      synthetic: true,
    } as Message.Part)

    msgsBuffer.current = [
      ...msgsBuffer.current,
      {
        info: persisted as Message.User,
        parts: [correctionPart as Message.Part],
      },
    ]

    log.info("injected correction message", {
      sessionID,
      messageID: (persisted as Message.User).id,
    })
  }

  /**
   * Inject task completion notifications.
   * Checks the background task registry for completed tasks and injects
   * notification messages for the model to see.
   *
   * Coordinator notification pattern: task results arrive as
   * `<task-notification>` XML in user messages, which the model naturally
   * responds to on the next turn.
   *
   * Called between turns (after persister.flush() → "continue") so the
   * generator sees the notification in msgsBuffer on the next iteration.
   */
  async injectNotifications(params: {
    registry: BackgroundTaskRegistry
    lastUser: Message.User
    msgsBuffer: { current: Message.WithParts[] }
  }): Promise<void> {
    const { registry, lastUser, msgsBuffer } = params
    const sessionID = this.sessionID

    const pending = registry.getUnnotifiedCompletedTasks()
    if (pending.length === 0) return

    const lines: string[] = ["<task-notification>", `The following background command(s) have completed:`, ""]

    for (const task of pending) {
      const preview = task.output.getChars(2000)
      lines.push(
        `Task ID: ${task.id}`,
        `Command: ${task.command}`,
        `Status: ${task.status}`,
        `Exit code: ${task.exitCode ?? "N/A"}`,
        "Output:",
        "```",
        preview || "(no output)",
        "```",
        "",
      )
    }

    lines.push("</task-notification>")
    const notificationText = lines.join("\n")

    // Persist as a real user message with synthetic: true text part.
    // Using Session.updateMessage + Session.updatePart ensures it survives
    // session resume and appears correctly in the conversation transcript.
    const notificationMsgData: Message.User = {
      id: MessageID.ascending(),
      role: "user",
      sessionID,
      agent: lastUser.agent,
      model: lastUser.model,
      time: { created: Date.now() },
    }
    const notificationMsg = await this.checkpointer.saveMessage(notificationMsgData)

    const notificationPart = await this.checkpointer.savePart({
      id: PartID.ascending(),
      messageID: (notificationMsg as Message.User).id,
      sessionID,
      type: "text",
      text: notificationText,
      synthetic: true,
    } as Message.Part)

    // Append to in-memory buffer so the generator sees it on the next turn
    // without a DB read (consistent with the FR-3 buffer invariant).
    msgsBuffer.current = [
      ...msgsBuffer.current,
      {
        info: notificationMsg as Message.User,
        parts: [notificationPart as Message.Part],
      },
    ]

    // Mark notified only after successful persist to avoid losing notifications
    // if persist throws (the .catch in the call site will log and absorb the error).
    for (const task of pending) {
      registry.markNotified(task.id)
    }

    log.info("injected task completion notifications", {
      sessionID,
      count: pending.length,
      taskIds: pending.map((t) => t.id),
    })
  }

  /**
   * Inject agent task completion notifications.
   * Checks the agent task registry for completed (terminal) tasks that
   * haven't been notified yet, and injects notification messages for the
   * model to see.
   *
   * Agent task notifications use the same `<task-notification>` XML wrapper
   * as command notifications but with agent-specific fields (agent name,
   * structured result, usage stats).
   *
   * Called at the same turn-boundary injection site as injectNotifications().
   */
  async injectAgentTaskNotifications(params: {
    registry: AgentTaskRegistry
    parentSessionId: SessionID
    lastUser: Message.User
    msgsBuffer: { current: Message.WithParts[] }
  }): Promise<void> {
    const { registry, parentSessionId, lastUser, msgsBuffer } = params
    const sessionID = this.sessionID

    const pending = registry.getUnnotifiedCompletedTasks(parentSessionId)
    if (pending.length === 0) return

    const lines: string[] = ["<task-notification>", "The following background agent task(s) have completed:", ""]

    for (const task of pending) {
      lines.push(
        `Task ID: ${task.taskId}`,
        `Agent: ${task.agentName}`,
        `Status: ${task.status}`,
        `Description: ${task.description}`,
      )

      if (task.status === "completed" && task.result) {
        const truncated = task.result.length > 2000 ? `${task.result.slice(0, 2000)}\n... [truncated]` : task.result
        lines.push("Result:", "```", truncated, "```")
      } else if (task.status === "failed" && task.error) {
        lines.push(`Error: ${task.error}`)
      } else if (task.status === "killed") {
        if (task.result) {
          const truncated = task.result.length > 2000 ? `${task.result.slice(0, 2000)}\n... [truncated]` : task.result
          lines.push("Partial result:", "```", truncated, "```")
        }
      }

      // Usage stats
      const duration = task.completedAt ? `${Math.round((task.completedAt - task.createdAt) / 1000)}s` : "N/A"
      lines.push(
        "",
        "Usage:",
        `  Tool uses: ${task.progress.toolUseCount}`,
        `  Tokens: ${task.progress.tokenCount}`,
        `  Duration: ${duration}`,
        "",
      )
    }

    lines.push("</task-notification>")
    const notificationText = lines.join("\n")

    // Persist as a real user message with synthetic: true text part.
    const notificationMsgData: Message.User = {
      id: MessageID.ascending(),
      role: "user",
      sessionID,
      agent: lastUser.agent,
      model: lastUser.model,
      time: { created: Date.now() },
    }
    const notificationMsg = await this.checkpointer.saveMessage(notificationMsgData)

    const notificationPart = await this.checkpointer.savePart({
      id: PartID.ascending(),
      messageID: (notificationMsg as Message.User).id,
      sessionID,
      type: "text",
      text: notificationText,
      synthetic: true,
    } as Message.Part)

    // Append to in-memory buffer (FR-3 buffer invariant).
    msgsBuffer.current = [
      ...msgsBuffer.current,
      {
        info: notificationMsg as Message.User,
        parts: [notificationPart as Message.Part],
      },
    ]

    // Mark notified only after successful persist to avoid losing notifications.
    for (const task of pending) {
      registry.markNotified(task.taskId)
    }

    log.info("injected agent task completion notifications", {
      sessionID,
      parentSessionId,
      count: pending.length,
      taskIds: pending.map((t) => t.taskId),
    })
  }
}
