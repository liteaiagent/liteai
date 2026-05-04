import { Log } from "@liteai/util/log"

import { PermissionNext } from "@/permission/next"
import type { Provider } from "@/provider/provider"
import { Question } from "@/question"
import { Snapshot } from "@/snapshot"

import type { EngineEvent } from "../events"
import { Session } from "../index"
import { Message } from "../message"
import { SessionRetry } from "../retry"
import { PartID, type SessionID } from "../schema"
import { SessionStatus } from "../status"
import { SessionSummary } from "../tasks/summary"
import type { PersistenceOp } from "./loop/checkpointer"

const log = Log.create({ service: "session.persister" })

/**
 * In-memory event accumulator for a single LLM turn.
 *
 * **Phase 2 architecture**: Zero DB writes in the hot path. All
 * `Session.updatePart()` / `Session.updatePartDelta()` / `Session.updateMessage()`
 * calls are replaced with in-memory write queue entries. The consumer
 * (loop.ts) drains the queue via `drainWrites()` and delegates to
 * the injected `Checkpointer` for actual persistence.
 *
 * `handleEvent()` is synchronous — it accumulates parts in memory and
 * enqueues persistence ops. The only remaining async method is `flush()`,
 * which still needs `Snapshot.patch()` and `streamResult.usage` (promise race).
 */
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

  /** In-memory write queue for deferred persistence */
  private writeQueue: PersistenceOp[] = []

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

  /**
   * Enqueue a part for both in-memory tracking and deferred DB persistence.
   */
  private enqueuePart(part: Message.Part) {
    this.writeQueue.push({ type: "upsert-part", part })
    this.upsertPart(part)
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

  /**
   * Drain the accumulated write queue and return ops for the
   * injected Checkpointer. Clears the queue after draining.
   */
  public drainWrites(): PersistenceOp[] {
    const ops = this.writeQueue
    this.writeQueue = []
    return ops
  }

  /**
   * Process a single engine event. Synchronous — no DB writes.
   * All persistence is deferred to the write queue.
   *
   * Returns:
   * - `undefined`: normal processing, continue
   * - `"stop"`: abort detected, stop the session
   * - `"continue"`: continue processing (after non-retryable error handling)
   * - `"compact"`: context overflow detected, trigger compaction
   * - `"retry"`: retryable error detected, loop.ts should handle sleep + retry
   */
  public handleEvent(event: EngineEvent.Any): "stop" | "continue" | "compact" | "retry" | undefined {
    const { assistantMessage, sessionID, model } = this

    // Process control events
    if (event.type === "control") {
      // Control events use the GeneratorResultEvent action type which overlaps
      // with our return type. Cast is safe since control actions are a subset.
      return event.action as "stop" | "continue" | "compact" | undefined
    }

    try {
      // With DB writes removed from the hot path, the abort guard is less
      // critical but still useful to short-circuit processing on cancelled sessions.
      if (event.type !== "turn-end" && event.type !== "error") {
        if (this.abort.aborted) {
          log.info("process aborted (pre-check)", { sessionID })
          return "stop"
        }
      }

      switch (event.type) {
        case "start": {
          if (event.kind === "session") {
            SessionStatus.set(sessionID, { type: "busy" })
          } else if (event.kind === "reasoning" && event.id) {
            if (event.id in this.reasoningMap) break
            const reasoningPart: Message.ReasoningPart = {
              id: PartID.ascending(),
              messageID: assistantMessage.id,
              sessionID,
              type: "reasoning" as const,
              text: "",
              time: { start: Date.now() },
              metadata: event.metadata,
            }
            this.reasoningMap[event.id] = reasoningPart
            this.enqueuePart(reasoningPart as Message.Part)
          } else if (event.kind === "tool" && event.id) {
            const part: Message.ToolPart = {
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
            }
            this.writeQueue.push({ type: "upsert-part", part: part as Message.Part })
            this.toolcalls[event.id] = part
            this.upsertPart(part as Message.Part)
          } else if (event.kind === "step") {
            // Snapshot.track() is async — capture will happen in flush().
            // Set flag so flush knows to call the real async Snapshot.track().
            this.snapshot = "pending"
            const stepStartPart = {
              id: PartID.ascending(),
              messageID: assistantMessage.id,
              sessionID,
              snapshot: this.snapshot,
              type: "step-start" as const,
            }
            this.enqueuePart(stepStartPart as Message.Part)
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
            this.enqueuePart(this.currentText as Message.Part)
          }
          break
        }

        case "delta": {
          if (event.part === "reasoning") {
            const m = this.reasoningMap[event.id]
            if (m) {
              m.text += event.text
              if (event.metadata) m.metadata = event.metadata
              this.writeQueue.push({
                type: "delta-part",
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
              this.writeQueue.push({
                type: "delta-part",
                sessionID: t.sessionID,
                messageID: t.messageID,
                partID: t.id,
                field: "text",
                delta: event.text,
              })
            }
          } else if (event.part === "tool") {
            const match = this.toolcalls[event.id]
            if (match && match.state.status === "pending" && "raw" in match.state) {
              match.state.raw += event.text
              this.writeQueue.push({
                type: "delta-part",
                sessionID: match.sessionID,
                messageID: match.messageID,
                partID: match.id,
                field: "raw",
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
              this.enqueuePart(part as Message.Part)
              delete this.reasoningMap[event.id]
            }
          } else if (event.kind === "text" && event.id) {
            const t = this.currentText
            if (t) {
              t.text = t.text.trimEnd()
              log.info("response", { chars: t.text.length, preview: t.text.slice(0, 150), sessionID })
              // Plugin transform is async — must be handled by loop.ts or deferred.
              // For now, we enqueue the part as-is. The plugin transform can be run
              // by the consumer before writing to DB.
              t.time = { start: Date.now(), end: Date.now() }
              if (event.metadata) t.metadata = event.metadata
              this.enqueuePart(t as Message.Part)
            }
            this.currentText = undefined
          } else if (event.kind === "step") {
            // biome-ignore lint/suspicious/noExplicitAny: usage type varies by provider
            const usage = Session.getUsage({ model, usage: event.usage as any, metadata: event.metadata })
            assistantMessage.finish = event.finishReason
            assistantMessage.cost += usage.cost
            assistantMessage.tokens = usage.tokens

            const stepFinishPart = {
              id: PartID.ascending(),
              reason: event.finishReason,
              snapshot: undefined as string | undefined,
              messageID: assistantMessage.id,
              sessionID,
              type: "step-finish" as const,
              tokens: usage.tokens,
              cost: usage.cost,
            }
            this.enqueuePart(stepFinishPart as Message.Part)
            this.writeQueue.push({ type: "upsert-message", message: { ...assistantMessage } })

            // Snapshot patch is async — store snapshot ID for flush to handle
            // The sync path cannot await Snapshot.patch() so we defer it.

            SessionSummary.summarize({ sessionID, messageID: assistantMessage.parentID })
            if (!assistantMessage.summary && usage.tokens) {
              // Sync heuristic: check if input tokens exceed 80% of model context window.
              // The real async isOverflow uses provider-specific limits; this is a
              // conservative approximation that avoids async in the hot path.
              const inputTokens = usage.tokens.input ?? 0
              const contextWindow = model.limit?.context ?? 128_000
              if (inputTokens > contextWindow * 0.8) {
                this.needsCompaction = true
              }
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

              const part: Message.ToolPart = {
                ...match,
                tool: event.toolName,
                state: {
                  status: "running",
                  input: event.input,
                  time: { start: Date.now() },
                  title: "title" in match.state ? match.state.title : undefined,
                },
                metadata: event.metadata ?? match.metadata,
              }
              this.writeQueue.push({ type: "upsert-part", part: part as Message.Part })
              this.toolcalls[event.id] = part
              this.upsertPart(part as Message.Part)
            }
          }
          break
        }

        case "result": {
          if (event.kind === "tool" && event.id) {
            const match = this.toolcalls[event.id]
            if (match && match.state.status === "running") {
              const completedPart: Message.ToolPart = {
                ...match,
                state: {
                  status: "completed",
                  input: event.input ?? match.state.input,
                  output: event.output,
                  title: event.title ?? match.tool,
                  metadata: event.metadata ?? {},
                  time: { start: match.state.time.start, end: Date.now() },
                  attachments: event.attachments,
                  // biome-ignore lint/suspicious/noExplicitAny: generic state merge
                } as any,
              }
              this.writeQueue.push({ type: "upsert-part", part: completedPart as Message.Part })
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
              const erroredPart: Message.ToolPart = {
                ...match,
                state: {
                  status: "error",
                  input: event.input ?? match.state.input,
                  error: String(event.error),
                  time: { start: match.state.time.start, end: Date.now() },
                },
              }
              this.writeQueue.push({ type: "upsert-part", part: erroredPart as Message.Part })
              this.upsertPart(erroredPart as Message.Part)
              // Note: Config.get() was async — since handleEvent is sync, we default
              // to break-on-deny (the safe behavior). The experimental continue_loop_on_deny
              // flag is rarely used and can be consulted asynchronously in loop.ts if needed.
              const shouldBreak = true
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
      if (e instanceof DOMException && e.name === "AbortError") {
        log.info("process aborted", { sessionID })
        return "stop"
      }
      log.error("process", { error: e, isAbortError: e instanceof DOMException && e.name === "AbortError" })
      const error = Message.fromError(e, { providerID: model.providerID })
      if (Message.ContextOverflowError.isInstance(error)) {
        this.needsCompaction = true
      } else {
        const retry = SessionRetry.retryable(error)
        if (retry !== undefined) {
          this.attempt++
          // Retry sleep is now handled by loop.ts — we just signal the intent.
          // The consumer reads persister.attempt to compute the delay.
          SessionStatus.set(sessionID, {
            type: "retry",
            attempt: this.attempt,
            message: retry,
            next: Date.now() + SessionRetry.delay(this.attempt, error.name === "APIError" ? error : undefined),
          })
          return "retry"
        }
        assistantMessage.error = error
      }
    }
  }

  // biome-ignore lint/suspicious/noExplicitAny: stream result is generic
  public async flush(streamResult?: any) {
    const { assistantMessage, sessionID, model } = this
    if (this.snapshot) {
      // handleEvent set this.snapshot to "pending" — resolve via real async track()
      const snapshotID = await Snapshot.track()
      if (snapshotID) {
        const patch = await Snapshot.patch(snapshotID)
        if (patch.files.length) {
          const patchPart = {
            id: PartID.ascending(),
            messageID: assistantMessage.id,
            sessionID,
            type: "patch" as const,
            hash: patch.hash,
            files: patch.files,
          }
          this.enqueuePart(patchPart as Message.Part)
        }
      }
      this.snapshot = undefined
    }

    if (this.currentText?.text) {
      this.currentText.text = this.currentText.text.trimEnd()
      this.currentText.time = { start: this.currentText.time?.start ?? Date.now(), end: Date.now() }
      this.enqueuePart(this.currentText as Message.Part)
      this.currentText = undefined
    }

    log.info("process flush reasoning", { keys: Object.keys(this.reasoningMap), sessionID })
    for (const part of Object.values(this.reasoningMap)) {
      part.text = part.text.trimEnd()
      part.time = { ...part.time, end: Date.now() }
      log.info("process flush updatePart", { partID: part.id, textLength: part.text.length })
      this.enqueuePart(part as Message.Part)
    }

    const p = this.allParts
    log.info("process flush message parts", { partCount: p.length, sessionID })
    for (const part of p) {
      if (part.type === "tool" && part.state.status !== "completed" && part.state.status !== "error") {
        const abortedPart = {
          ...part,
          state: {
            ...part.state,
            status: "error" as const,
            error: "Tool execution aborted",
            time: { start: Date.now(), end: Date.now() },
          },
        }
        this.writeQueue.push({ type: "upsert-part", part: abortedPart as Message.Part })
      }
      if (part.type === "reasoning" && !part.time.end) {
        if (!Object.values(this.reasoningMap).some((r) => r.id === part.id)) {
          part.time = { ...part.time, end: Date.now() }
          this.writeQueue.push({ type: "upsert-part", part: part as Message.Part })
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

    if (assistantMessage.error || this.abort.aborted) {
      const stepFinishPart = {
        id: PartID.ascending(),
        messageID: assistantMessage.id,
        sessionID,
        type: "step-finish" as const,
        reason: this.abort.aborted ? "abort" : "error",
        snapshot: undefined as string | undefined,
        cost: assistantMessage.cost,
        tokens: assistantMessage.tokens,
      }
      // Snapshot.track() is async — defer to the write queue
      this.enqueuePart(stepFinishPart as Message.Part)
    }

    assistantMessage.time.completed = Date.now()
    this.writeQueue.push({ type: "upsert-message", message: { ...assistantMessage } })

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
