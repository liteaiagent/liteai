import { Agent } from "@/agent/agent"
import { Bus } from "@/bus"
import { Config } from "@/config/config"
import { PermissionNext } from "@/permission/next"
import { Plugin } from "@/plugin"
import type { Provider } from "@/provider/provider"
import { Question } from "@/question"
import { Snapshot } from "@/snapshot"
import { Log } from "@/util/log"
import { endToolSpan, startToolSpan } from "../../telemetry/tracing"
import type { EngineEvent } from "../events"
import { Session } from "../index"
import { Message } from "../message"
import { SessionRetry } from "../retry"
import { PartID, type SessionID } from "../schema"
import { SessionStatus } from "../status"
import { SessionCompaction } from "../tasks/compaction"
import { SessionSummary } from "../tasks/summary"

const log = Log.create({ service: "session.persister" })
const DOOM_LOOP_THRESHOLD = 3

export class EventPersister {
  private toolcalls: Record<string, Message.ToolPart> = {}
  private snapshot?: string
  public blocked = false
  public attempt = 0
  public needsCompaction = false
  public resolved?: string[]

  private currentText?: Message.TextPart
  private reasoningMap: Record<string, Message.ReasoningPart> = {}
  private allParts: Message.Part[] = []

  constructor(
    public readonly assistantMessage: Message.Assistant,
    public readonly sessionID: SessionID,
    public readonly model: Provider.Model,
    private readonly abort: AbortSignal,
  ) {}

  private upsertPart(part: Message.Part) {
    const idx = this.allParts.findIndex((p) => p.id === part.id)
    if (idx >= 0) this.allParts[idx] = part
    else this.allParts.push(part)
  }

  public getCompletedMessage(): Message.WithParts {
    return {
      info: this.assistantMessage,
      parts: [...this.allParts],
    }
  }

  public partFromToolCall(toolCallID: string) {
    return this.toolcalls[toolCallID]
  }

  public async handleEvent(event: EngineEvent.Any): Promise<EngineEvent.GeneratorResultEvent["action"] | undefined> {
    const { assistantMessage, sessionID, model } = this

    // Process control events
    if (event.type === "control") {
      return event.action
    }

    try {
      this.abort.throwIfAborted()

      switch (event.type) {
        case "start": {
          if (event.kind === "session") {
            SessionStatus.set(sessionID, { type: "busy" })
          } else if (event.kind === "reasoning" && event.id) {
            if (event.id in this.reasoningMap) break
            const reasoningPart = {
              id: PartID.ascending(),
              messageID: assistantMessage.id,
              sessionID,
              type: "reasoning" as const,
              text: "",
              time: { start: Date.now() },
              metadata: event.metadata,
            }
            this.reasoningMap[event.id] = reasoningPart
            await Session.updatePart(reasoningPart)
            this.upsertPart(reasoningPart)
          } else if (event.kind === "tool" && event.id) {
            const part = await Session.updatePart({
              id: this.toolcalls[event.id]?.id ?? PartID.ascending(),
              messageID: assistantMessage.id,
              sessionID,
              type: "tool",
              tool: event.toolName,
              callID: event.id,
              state: {
                status: "pending",
                input: {},
                raw: "",
              },
            })
            this.toolcalls[event.id] = part as Message.ToolPart
            this.upsertPart(part as Message.Part)
          } else if (event.kind === "step") {
            this.snapshot = await Snapshot.track()
            const stepStartPart = await Session.updatePart({
              id: PartID.ascending(),
              messageID: assistantMessage.id,
              sessionID,
              snapshot: this.snapshot,
              type: "step-start",
            })
            this.upsertPart(stepStartPart as Message.Part)
          } else if (event.kind === "text" && event.id) {
            this.currentText = {
              id: PartID.ascending(),
              messageID: assistantMessage.id,
              sessionID,
              type: "text",
              text: "",
              time: { start: Date.now() },
              metadata: event.metadata,
            }
            await Session.updatePart(this.currentText)
            this.upsertPart(this.currentText as Message.Part)
          }
          break
        }

        case "delta": {
          if (event.part === "reasoning") {
            const m = this.reasoningMap[event.id]
            if (m) {
              m.text += event.text
              if (event.metadata) m.metadata = event.metadata
              await Session.updatePartDelta({
                sessionID: m.sessionID,
                messageID: m.messageID,
                partID: m.id,
                field: "text",
                delta: event.text,
              })
            }
          } else if (event.part === "text") {
            const t = this.currentText
            if (t) {
              t.text += event.text
              if (event.metadata) t.metadata = event.metadata
              await Session.updatePartDelta({
                sessionID: t.sessionID,
                messageID: t.messageID,
                partID: t.id,
                field: "text",
                delta: event.text,
              })
            }
          }
          break
        }

        case "end": {
          if (event.kind === "reasoning" && event.id) {
            const part = this.reasoningMap[event.id]
            if (part) {
              part.text = part.text.trimEnd()
              log.info("reasoning", { chars: part.text.length, sessionID })
              part.time = { ...part.time, end: Date.now() }
              if (event.metadata) part.metadata = event.metadata
              await Session.updatePart(part)
              this.upsertPart(part as Message.Part)
              delete this.reasoningMap[event.id]
            }
          } else if (event.kind === "text" && event.id) {
            const t = this.currentText
            if (t) {
              t.text = t.text.trimEnd()
              log.info("response", { chars: t.text.length, preview: t.text.slice(0, 150), sessionID })
              const textOutput = await Plugin.trigger(
                "experimental.text.complete",
                { sessionID, messageID: assistantMessage.id, partID: t.id },
                { text: t.text },
              )
              t.text = textOutput.text
              t.time = { start: Date.now(), end: Date.now() }
              if (event.metadata) t.metadata = event.metadata
              await Session.updatePart(t)
              this.upsertPart(t as Message.Part)
            }
            this.currentText = undefined
          } else if (event.kind === "step") {
            // biome-ignore lint/suspicious/noExplicitAny: usage type varies by provider
            const usage = Session.getUsage({ model, usage: event.usage as any, metadata: event.metadata })
            assistantMessage.finish = event.finishReason
            assistantMessage.cost += usage.cost
            assistantMessage.tokens = usage.tokens
            const stepFinishPart = await Session.updatePart({
              id: PartID.ascending(),
              reason: event.finishReason,
              snapshot: await Snapshot.track(),
              messageID: assistantMessage.id,
              sessionID,
              type: "step-finish",
              tokens: usage.tokens,
              cost: usage.cost,
            })
            this.upsertPart(stepFinishPart as Message.Part)
            await Session.updateMessage(assistantMessage)
            if (this.snapshot) {
              const patch = await Snapshot.patch(this.snapshot)
              if (patch.files.length) {
                const patchPart = await Session.updatePart({
                  id: PartID.ascending(),
                  messageID: assistantMessage.id,
                  sessionID,
                  type: "patch",
                  hash: patch.hash,
                  files: patch.files,
                })
                this.upsertPart(patchPart as Message.Part)
              }
              this.snapshot = undefined
            }
            SessionSummary.summarize({ sessionID, messageID: assistantMessage.parentID })
            if (!assistantMessage.summary && (await SessionCompaction.isOverflow({ tokens: usage.tokens, model }))) {
              this.needsCompaction = true
            }
          }
          break
        }

        case "call": {
          if (event.kind === "tool" && event.id) {
            const match = this.toolcalls[event.id]
            if (match) {
              log.info("tool call", {
                tool: event.toolName,
                // biome-ignore lint/suspicious/noExplicitAny: input is generic
                input: Object.keys(event.input as any).join(","),
                sessionID,
              })
              startToolSpan(event.toolName, JSON.stringify(event.input))
              const part = await Session.updatePart({
                ...match,
                tool: event.toolName,
                state: { status: "running", input: event.input, time: { start: Date.now() } },
                metadata: event.metadata,
              })
              this.toolcalls[event.id] = part as Message.ToolPart
              this.upsertPart(part as Message.Part)

              const lastThree = this.allParts.slice(-DOOM_LOOP_THRESHOLD)
              if (
                lastThree.length === DOOM_LOOP_THRESHOLD &&
                lastThree.every(
                  (p) =>
                    p.type === "tool" &&
                    p.tool === event.toolName &&
                    p.state.status !== "pending" &&
                    JSON.stringify(p.state.input) === JSON.stringify(event.input),
                )
              ) {
                const agentInfo = await Agent.get(assistantMessage.agent)
                await PermissionNext.ask({
                  permission: "doom_loop",
                  patterns: [event.toolName],
                  sessionID,
                  metadata: { tool: event.toolName, input: event.input },
                  always: [event.toolName],
                  ruleset: agentInfo.permission,
                })
              }
            }
          }
          break
        }

        case "result": {
          if (event.kind === "tool" && event.id) {
            const match = this.toolcalls[event.id]
            if (match && match.state.status === "running") {
              const duration = Date.now() - match.state.time.start
              log.info("tool result", { tool: match.tool, duration, sessionID })
              endToolSpan()
              const completedPart = await Session.updatePart({
                ...match,
                state: {
                  status: "completed",
                  input: event.input ?? match.state.input,
                  output: event.output,
                  metadata: event.metadata,
                  ...(event.title ? { title: event.title } : {}),
                  time: { start: match.state.time.start, end: Date.now() },
                  attachments: event.attachments,
                  // biome-ignore lint/suspicious/noExplicitAny: generic state merge
                } as any,
              })
              this.upsertPart(completedPart as Message.Part)
              // Note: do NOT delete from toolcalls — entry is still needed for doom-loop detection
            }
          }
          break
        }

        case "error": {
          if (event.kind === "tool" && event.id) {
            const match = this.toolcalls[event.id]
            if (match && match.state.status === "running") {
              log.info("tool error", { tool: match.tool, error: String(event.error).slice(0, 200), sessionID })
              endToolSpan()
              const erroredPart = await Session.updatePart({
                ...match,
                state: {
                  status: "error",
                  input: event.input ?? match.state.input,
                  error: String(event.error),
                  time: { start: match.state.time.start, end: Date.now() },
                },
              })
              this.upsertPart(erroredPart as Message.Part)
              const shouldBreak = (await Config.get()).experimental?.continue_loop_on_deny !== true
              if (
                event.error instanceof PermissionNext.RejectedError ||
                event.error instanceof Question.RejectedError
              ) {
                this.blocked = shouldBreak
              }
              // Note: do NOT delete from toolcalls — keep for doom-loop detection via allParts
            }
          } else if (event.kind === "stream") {
            throw event.error
          }
          break
        }

        case "finish": {
          break
        }
      }

      if (this.needsCompaction) return "compact"
    } catch (e: unknown) {
      log.error("process", { error: e, isAbortError: e instanceof DOMException && e.name === "AbortError" })
      const error = Message.fromError(e, { providerID: model.providerID })
      if (Message.ContextOverflowError.isInstance(error)) {
        this.needsCompaction = true
        Bus.publish(Session.Event.Error, { sessionID, error })
      } else {
        const retry = SessionRetry.retryable(error)
        if (retry !== undefined) {
          this.attempt++
          const delay = SessionRetry.delay(this.attempt, error.name === "APIError" ? error : undefined)
          SessionStatus.set(sessionID, {
            type: "retry",
            attempt: this.attempt,
            message: retry,
            next: Date.now() + delay,
          })
          await SessionRetry.sleep(delay, this.abort).catch(() => {})
          return "continue" // Retry triggered, loop will continue
        }
        assistantMessage.error = error
        Bus.publish(Session.Event.Error, { sessionID, error: assistantMessage.error })
      }
    }
  }

  // biome-ignore lint/suspicious/noExplicitAny: stream result is generic
  public async flush(streamResult?: any) {
    const { assistantMessage, sessionID, model } = this
    if (this.snapshot) {
      const patch = await Snapshot.patch(this.snapshot)
      if (patch.files.length) {
        await Session.updatePart({
          id: PartID.ascending(),
          messageID: assistantMessage.id,
          sessionID,
          type: "patch",
          hash: patch.hash,
          files: patch.files,
        })
      }
      this.snapshot = undefined
    }

    if (this.currentText?.text) {
      this.currentText.text = this.currentText.text.trimEnd()
      this.currentText.time = { start: this.currentText.time?.start ?? Date.now(), end: Date.now() }
      await Session.updatePart(this.currentText)
      this.currentText = undefined
    }

    log.info("process flush reasoning", { keys: Object.keys(this.reasoningMap), sessionID })
    for (const part of Object.values(this.reasoningMap)) {
      part.text = part.text.trimEnd()
      part.time = { ...part.time, end: Date.now() }
      log.info("process flush updatePart", { partID: part.id, textLength: part.text.length })
      await Session.updatePart(part)
    }

    const p = this.allParts
    log.info("process flush message parts", { partCount: p.length, sessionID })
    for (const part of p) {
      if (part.type === "tool" && part.state.status !== "completed" && part.state.status !== "error") {
        await Session.updatePart({
          ...part,
          state: {
            ...part.state,
            status: "error",
            error: "Tool execution aborted",
            time: { start: Date.now(), end: Date.now() },
          },
        })
      }
      if (part.type === "reasoning" && !part.time.end) {
        if (!Object.values(this.reasoningMap).some((r) => r.id === part.id)) {
          part.time = { ...part.time, end: Date.now() }
          await Session.updatePart(part)
        }
      }
    }

    if (assistantMessage.error && streamResult) {
      try {
        const usage = await Promise.race([
          streamResult.usage.catch(() => null),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 200)),
        ])
        if (usage) {
          const computed = Session.getUsage({ model, usage, metadata: undefined })
          assistantMessage.tokens = computed.tokens
          assistantMessage.cost = computed.cost
        }
      } catch (e) {
        log.info("partial usage capture failed", { error: e, sessionID })
      }
    }

    if (assistantMessage.error) {
      try {
        await Session.updatePart({
          id: PartID.ascending(),
          messageID: assistantMessage.id,
          sessionID,
          type: "step-finish",
          reason: "error",
          snapshot: this.snapshot ? await Snapshot.track() : undefined,
          cost: assistantMessage.cost,
          tokens: assistantMessage.tokens,
        })
      } catch (e) {
        log.error("step-finish write failed on abort", { error: e, sessionID })
      }
    }

    assistantMessage.time.completed = Date.now()
    await Session.updateMessage(assistantMessage)

    if (this.needsCompaction) {
      log.info("process returning: compaction needed", { sessionID })
      return "compact"
    }
    if (this.blocked) {
      log.info("process returning: blocked by permission", { sessionID })
      return "stop"
    }
    if (assistantMessage.error) {
      log.info("process returning: error", { sessionID, error: assistantMessage.error })
      return "stop"
    }
    log.info("process returning: continue", { sessionID })
    return "continue"
  }
}
