import { Agent } from "@/agent/agent"
import { Bus } from "@/bus"
import { Config } from "@/config/config"
import { PermissionNext } from "@/permission/next"
import { Plugin } from "@/plugin"
import type { Provider } from "@/provider/provider"
import { Question } from "@/question"
import { Snapshot } from "@/snapshot"
import { Log } from "@/util/log"
import { Session } from "."
import { LLM } from "./llm"
import { Message } from "./message"
import { SessionRetry } from "./retry"
import type { SessionID } from "./schema"
import { PartID } from "./schema"
import { SessionStatus } from "./status"
import { SessionCompaction } from "./tasks/compaction"
import { SessionSummary } from "./tasks/summary"

export namespace SessionProcessor {
  const DOOM_LOOP_THRESHOLD = 3
  const log = Log.create({ service: "session.processor" })

  export type Info = Awaited<ReturnType<typeof create>>
  export type Result = Awaited<ReturnType<Info["process"]>>

  export function create(input: {
    assistantMessage: Message.Assistant
    sessionID: SessionID
    model: Provider.Model
    abort: AbortSignal
  }) {
    const toolcalls: Record<string, Message.ToolPart> = {}
    let snapshot: string | undefined
    let blocked = false
    let attempt = 0
    let needsCompaction = false
    let resolved: string[] | undefined

    const result = {
      get message() {
        return input.assistantMessage
      },
      get resolvedSystem() {
        return resolved
      },
      partFromToolCall(toolCallID: string) {
        return toolcalls[toolCallID]
      },
      async process(streamInput: LLM.StreamInput) {
        log.info("process", {
          sessionID: input.sessionID,
          model: `${input.model.providerID}/${input.model.id}`,
          aborted: input.abort.aborted,
        })
        needsCompaction = false
        const shouldBreak = (await Config.get()).experimental?.continue_loop_on_deny !== true
        let currentText: Message.TextPart | undefined
        const reasoningMap: Record<string, Message.ReasoningPart> = {}
        let streamResult: LLM.StreamOutput | undefined
        while (true) {
          try {
            currentText = undefined
            for (const key of Object.keys(reasoningMap)) delete reasoningMap[key]
            const stream = await LLM.stream({
              ...streamInput,
              onSystem: (s) => {
                resolved = s
              },
            })
            streamResult = stream

            for await (const value of stream.fullStream) {
              input.abort.throwIfAborted()
              switch (value.type) {
                case "start":
                  SessionStatus.set(input.sessionID, { type: "busy" })
                  break

                case "reasoning-start": {
                  if (value.id in reasoningMap) {
                    continue
                  }
                  const reasoningPart = {
                    id: PartID.ascending(),
                    messageID: input.assistantMessage.id,
                    sessionID: input.assistantMessage.sessionID,
                    type: "reasoning" as const,
                    text: "",
                    time: {
                      start: Date.now(),
                    },
                    metadata: value.providerMetadata,
                  }
                  reasoningMap[value.id] = reasoningPart
                  await Session.updatePart(reasoningPart)
                  break
                }

                case "reasoning-delta":
                  if (value.id in reasoningMap) {
                    const part = reasoningMap[value.id]
                    part.text += value.text
                    if (value.providerMetadata) part.metadata = value.providerMetadata
                    await Session.updatePartDelta({
                      sessionID: part.sessionID,
                      messageID: part.messageID,
                      partID: part.id,
                      field: "text",
                      delta: value.text,
                    })
                  }
                  break

                case "reasoning-end":
                  if (value.id in reasoningMap) {
                    const part = reasoningMap[value.id]
                    part.text = part.text.trimEnd()
                    log.info("reasoning", {
                      chars: part.text.length,
                      sessionID: input.sessionID,
                    })

                    part.time = {
                      ...part.time,
                      end: Date.now(),
                    }
                    if (value.providerMetadata) part.metadata = value.providerMetadata
                    await Session.updatePart(part)
                    delete reasoningMap[value.id]
                  }
                  break

                case "tool-input-start": {
                  const part = await Session.updatePart({
                    id: toolcalls[value.id]?.id ?? PartID.ascending(),
                    messageID: input.assistantMessage.id,
                    sessionID: input.assistantMessage.sessionID,
                    type: "tool",
                    tool: value.toolName,
                    callID: value.id,
                    state: {
                      status: "pending",
                      input: {},
                      raw: "",
                    },
                  })
                  toolcalls[value.id] = part as Message.ToolPart
                  break
                }

                case "tool-input-delta":
                  break

                case "tool-input-end":
                  break

                case "tool-call": {
                  const match = toolcalls[value.toolCallId]
                  if (match) {
                    log.info("tool call", {
                      tool: value.toolName,
                      input: Object.keys(value.input as Record<string, unknown>).join(","),
                      sessionID: input.sessionID,
                    })
                    const part = await Session.updatePart({
                      ...match,
                      tool: value.toolName,
                      state: {
                        status: "running",
                        input: value.input,
                        time: {
                          start: Date.now(),
                        },
                      },
                      metadata: value.providerMetadata,
                    })
                    toolcalls[value.toolCallId] = part as Message.ToolPart

                    const parts = await Message.parts(input.assistantMessage.id)
                    const lastThree = parts.slice(-DOOM_LOOP_THRESHOLD)

                    if (
                      lastThree.length === DOOM_LOOP_THRESHOLD &&
                      lastThree.every(
                        (p) =>
                          p.type === "tool" &&
                          p.tool === value.toolName &&
                          p.state.status !== "pending" &&
                          JSON.stringify(p.state.input) === JSON.stringify(value.input),
                      )
                    ) {
                      const agent = await Agent.get(input.assistantMessage.agent)
                      await PermissionNext.ask({
                        permission: "doom_loop",
                        patterns: [value.toolName],
                        sessionID: input.assistantMessage.sessionID,
                        metadata: {
                          tool: value.toolName,
                          input: value.input,
                        },
                        always: [value.toolName],
                        ruleset: agent.permission,
                      })
                    }
                  }
                  break
                }
                case "tool-result": {
                  const match = toolcalls[value.toolCallId]
                  if (match && match.state.status === "running") {
                    const duration = Date.now() - match.state.time.start
                    log.info("tool result", {
                      tool: match.tool,
                      duration,
                      sessionID: input.sessionID,
                    })
                    await Session.updatePart({
                      ...match,
                      state: {
                        status: "completed",
                        input: value.input ?? match.state.input,
                        output: value.output.output,
                        metadata: value.output.metadata,
                        title: value.output.title,
                        time: {
                          start: match.state.time.start,
                          end: Date.now(),
                        },
                        attachments: value.output.attachments,
                      },
                    })

                    delete toolcalls[value.toolCallId]
                  }
                  break
                }

                case "tool-error": {
                  const match = toolcalls[value.toolCallId]
                  if (match && match.state.status === "running") {
                    log.info("tool error", {
                      tool: match.tool,
                      error: String(value.error).slice(0, 200),
                      sessionID: input.sessionID,
                    })
                    await Session.updatePart({
                      ...match,
                      state: {
                        status: "error",
                        input: value.input ?? match.state.input,
                        error: String(value.error),
                        time: {
                          start: match.state.time.start,
                          end: Date.now(),
                        },
                      },
                    })

                    if (
                      value.error instanceof PermissionNext.RejectedError ||
                      value.error instanceof Question.RejectedError
                    ) {
                      blocked = shouldBreak
                    }
                    delete toolcalls[value.toolCallId]
                  }
                  break
                }
                case "error":
                  throw value.error

                case "start-step":
                  snapshot = await Snapshot.track()
                  await Session.updatePart({
                    id: PartID.ascending(),
                    messageID: input.assistantMessage.id,
                    sessionID: input.sessionID,
                    snapshot,
                    type: "step-start",
                  })
                  break

                case "finish-step": {
                  const usage = Session.getUsage({
                    model: input.model,
                    usage: value.usage,
                    metadata: value.providerMetadata,
                  })
                  input.assistantMessage.finish = value.finishReason
                  input.assistantMessage.cost += usage.cost
                  input.assistantMessage.tokens = usage.tokens
                  await Session.updatePart({
                    id: PartID.ascending(),
                    reason: value.finishReason,
                    snapshot: await Snapshot.track(),
                    messageID: input.assistantMessage.id,
                    sessionID: input.assistantMessage.sessionID,
                    type: "step-finish",
                    tokens: usage.tokens,
                    cost: usage.cost,
                  })
                  await Session.updateMessage(input.assistantMessage)
                  if (snapshot) {
                    const patch = await Snapshot.patch(snapshot)
                    if (patch.files.length) {
                      await Session.updatePart({
                        id: PartID.ascending(),
                        messageID: input.assistantMessage.id,
                        sessionID: input.sessionID,
                        type: "patch",
                        hash: patch.hash,
                        files: patch.files,
                      })
                    }
                    snapshot = undefined
                  }
                  SessionSummary.summarize({
                    sessionID: input.sessionID,
                    messageID: input.assistantMessage.parentID,
                  })
                  if (
                    !input.assistantMessage.summary &&
                    (await SessionCompaction.isOverflow({ tokens: usage.tokens, model: input.model }))
                  ) {
                    needsCompaction = true
                  }
                  break
                }

                case "text-start":
                  currentText = {
                    id: PartID.ascending(),
                    messageID: input.assistantMessage.id,
                    sessionID: input.assistantMessage.sessionID,
                    type: "text",
                    text: "",
                    time: {
                      start: Date.now(),
                    },
                    metadata: value.providerMetadata,
                  }
                  await Session.updatePart(currentText)
                  break

                case "text-delta":
                  if (currentText) {
                    currentText.text += value.text
                    if (value.providerMetadata) currentText.metadata = value.providerMetadata
                    await Session.updatePartDelta({
                      sessionID: currentText.sessionID,
                      messageID: currentText.messageID,
                      partID: currentText.id,
                      field: "text",
                      delta: value.text,
                    })
                  }
                  break

                case "text-end":
                  if (currentText) {
                    currentText.text = currentText.text.trimEnd()
                    log.info("response", {
                      chars: currentText.text.length,
                      preview: currentText.text.slice(0, 150),
                      sessionID: input.sessionID,
                    })
                    const textOutput = await Plugin.trigger(
                      "experimental.text.complete",
                      {
                        sessionID: input.sessionID,
                        messageID: input.assistantMessage.id,
                        partID: currentText.id,
                      },
                      { text: currentText.text },
                    )
                    currentText.text = textOutput.text
                    currentText.time = {
                      start: Date.now(),
                      end: Date.now(),
                    }
                    if (value.providerMetadata) currentText.metadata = value.providerMetadata
                    await Session.updatePart(currentText)
                  }
                  currentText = undefined
                  break

                case "finish":
                  break

                default:
                  log.info("unhandled", {
                    ...value,
                  })
                  continue
              }
              if (needsCompaction) break
            }
          } catch (e: unknown) {
            log.error("process", { error: e, isAbortError: e instanceof DOMException && e.name === "AbortError" })
            const error = Message.fromError(e, { providerID: input.model.providerID })
            if (Message.ContextOverflowError.isInstance(error)) {
              needsCompaction = true
              Bus.publish(Session.Event.Error, {
                sessionID: input.sessionID,
                error,
              })
            } else {
              const retry = SessionRetry.retryable(error)
              if (retry !== undefined) {
                attempt++
                const delay = SessionRetry.delay(attempt, error.name === "APIError" ? error : undefined)
                SessionStatus.set(input.sessionID, {
                  type: "retry",
                  attempt,
                  message: retry,
                  next: Date.now() + delay,
                })
                await SessionRetry.sleep(delay, input.abort).catch(() => {})
                continue
              }
              input.assistantMessage.error = error
              Bus.publish(Session.Event.Error, {
                sessionID: input.assistantMessage.sessionID,
                error: input.assistantMessage.error,
              })
              // Note: SessionStatus idle is set by cleanup() in loop.ts
              // AFTER all flush logic below completes.
            }
          }
          if (snapshot) {
            const patch = await Snapshot.patch(snapshot)
            if (patch.files.length) {
              await Session.updatePart({
                id: PartID.ascending(),
                messageID: input.assistantMessage.id,
                sessionID: input.sessionID,
                type: "patch",
                hash: patch.hash,
                files: patch.files,
              })
            }
            snapshot = undefined
          }
          // Flush any in-flight text part that never received text-end.
          if (currentText && currentText.text) {
            currentText.text = currentText.text.trimEnd()
            currentText.time = { start: currentText.time?.start ?? Date.now(), end: Date.now() }
            await Session.updatePart(currentText)
            currentText = undefined
          }

          // Flush any in-flight reasoning parts that never received reasoning-end.
          // The reasoningMap holds the accumulated text from deltas (which are never
          // written to the DB individually), so we must persist them here before they
          // are lost.
          log.info("process flush reasoning", { keys: Object.keys(reasoningMap), sessionID: input.sessionID })
          for (const part of Object.values(reasoningMap)) {
            part.text = part.text.trimEnd()
            part.time = { ...part.time, end: Date.now() }
            log.info("process flush updatePart", { partID: part.id, textLength: part.text.length })
            await Session.updatePart(part)
          }

          const p = await Message.parts(input.assistantMessage.id)
          log.info("process flush message parts", { partCount: p.length, sessionID: input.sessionID })
          for (const part of p) {
            if (part.type === "tool" && part.state.status !== "completed" && part.state.status !== "error") {
              await Session.updatePart({
                ...part,
                state: {
                  ...part.state,
                  status: "error",
                  error: "Tool execution aborted",
                  time: {
                    start: Date.now(),
                    end: Date.now(),
                  },
                },
              })
            }
            if (part.type === "reasoning" && !part.time.end) {
              // Only update if not already flushed from reasoningMap above
              if (!Object.values(reasoningMap).some((r) => r.id === part.id)) {
                part.time = { ...part.time, end: Date.now() }
                await Session.updatePart(part)
              }
            }
          }

          // Attempt to capture partial token usage and write step-finish on abort.
          // Wrapped in try/catch so failures here never prevent Trace.record()
          // from running in loop.ts (which calls process()).
          if (input.assistantMessage.error && streamResult) {
            try {
              const usage = await Promise.race([
                streamResult.usage.catch(() => null),
                new Promise<null>((resolve) => setTimeout(() => resolve(null), 200)),
              ])
              if (usage) {
                const computed = Session.getUsage({
                  model: input.model,
                  usage,
                  metadata: undefined,
                })
                input.assistantMessage.tokens = computed.tokens
                input.assistantMessage.cost = computed.cost
              }
            } catch (e) {
              log.info("partial usage capture failed", { error: e, sessionID: input.sessionID })
            }
          }

          if (input.assistantMessage.error) {
            try {
              await Session.updatePart({
                id: PartID.ascending(),
                messageID: input.assistantMessage.id,
                sessionID: input.sessionID,
                type: "step-finish",
                reason: "error",
                snapshot: snapshot ? await Snapshot.track() : undefined,
                cost: input.assistantMessage.cost,
                tokens: input.assistantMessage.tokens,
              })
            } catch (e) {
              log.error("step-finish write failed on abort", { error: e, sessionID: input.sessionID })
            }
          }

          input.assistantMessage.time.completed = Date.now()
          await Session.updateMessage(input.assistantMessage)
          if (needsCompaction) {
            log.info("process returning: compaction needed", { sessionID: input.sessionID })
            return "compact"
          }
          if (blocked) {
            log.info("process returning: blocked by permission", { sessionID: input.sessionID })
            return "stop"
          }
          if (input.assistantMessage.error) {
            log.info("process returning: error", { sessionID: input.sessionID, error: input.assistantMessage.error })
            return "stop"
          }
          log.info("process returning: continue", { sessionID: input.sessionID })
          return "continue"
        }
      },
    }
    return result
  }
}
