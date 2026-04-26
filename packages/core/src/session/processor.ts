import { Log } from "@liteai/util/log"
import type { Provider } from "@/provider/provider"
import { EventPersister } from "./engine/persister"
import type { EngineEvent } from "./events"
import { LLM } from "./llm"
import type { Message } from "./message"
import type { SessionID } from "./schema"

export namespace SessionProcessor {
  const log = Log.create({ service: "session.processor" })

  export type Info = Awaited<ReturnType<typeof create>>
  export type Result = Awaited<ReturnType<Info["process"]>>

  export async function* streamGenerator(
    streamInput: LLM.StreamInput,
    onSystem?: (s: string[]) => void,
    onStreamResult?: (res: LLM.StreamOutput) => void,
  ): AsyncGenerator<EngineEvent.Any, void, unknown> {
    try {
      const stream = await LLM.stream({
        ...streamInput,
        onSystem,
      })
      // Mute dangling promises to prevent UnhandledPromiseRejections on abort
      stream.text?.catch(() => {})
      stream.usage?.catch(() => {})
      stream.finishReason?.catch(() => {})
      stream.warnings?.catch(() => {})
      stream.steps?.catch(() => {})

      onStreamResult?.(stream)
      yield { type: "start", kind: "session" }
      for await (const value of stream.fullStream) {
        streamInput.abort.throwIfAborted()
        switch (value.type) {
          case "start":
            yield { type: "start", kind: "session" }
            break
          case "reasoning-start":
            yield { type: "start", kind: "reasoning", id: value.id, metadata: value.providerMetadata }
            break
          case "reasoning-delta":
            yield { type: "delta", part: "reasoning", id: value.id, text: value.text, metadata: value.providerMetadata }
            break
          case "reasoning-end":
            yield { type: "end", kind: "reasoning", id: value.id, metadata: value.providerMetadata }
            break
          case "tool-input-start":
            yield { type: "start", kind: "tool", id: value.id, toolName: value.toolName }
            break
          case "tool-input-delta":
            yield { type: "delta", part: "tool", id: value.id, toolName: "", text: value.delta }
            break
          case "tool-call":
            yield {
              type: "call",
              kind: "tool",
              id: value.toolCallId,
              toolName: value.toolName,
              input: value.input,
              metadata: value.providerMetadata,
            }
            break
          case "tool-result":
            yield {
              type: "result",
              kind: "tool",
              id: value.toolCallId,
              toolName: value.toolName,
              input: value.input,
              output: value.output.output,
              attachments: value.output.attachments,
              metadata: value.output.metadata,
              title: value.output.title,
            }
            break
          case "tool-error":
            yield {
              type: "error",
              kind: "tool",
              id: value.toolCallId,
              toolName: value.toolName,
              input: value.input,
              error: value.error,
            }
            break
          case "start-step":
            yield { type: "start", kind: "step" }
            break
          case "finish-step":
            yield {
              type: "end",
              kind: "step",
              finishReason: value.finishReason,
              usage: value.usage,
              metadata: value.providerMetadata,
            }
            break
          case "text-start":
            yield { type: "start", kind: "text", id: value.id, metadata: value.providerMetadata }
            break
          case "text-delta":
            yield { type: "delta", part: "text", id: value.id, text: value.text, metadata: value.providerMetadata }
            break
          case "text-end":
            yield { type: "end", kind: "text", id: value.id, metadata: value.providerMetadata }
            break
          case "finish":
            yield { type: "finish" }
            break
          case "error":
            throw value.error
        }
      }
    } catch (e: unknown) {
      yield {
        type: "error",
        kind: "stream",
        error: e,
        isAbortError: e instanceof DOMException && e.name === "AbortError",
      }
    }
  }

  export function create(input: {
    assistantMessage: Message.Assistant
    sessionID: SessionID
    model: Provider.Model
    abort: AbortSignal
  }) {
    let resolved: string[] | undefined
    let persister: EventPersister | undefined

    return {
      get message() {
        return input.assistantMessage
      },
      get resolvedSystem() {
        return resolved
      },
      partFromToolCall(toolCallID: string) {
        return persister?.partFromToolCall(toolCallID)
      },
      async process(streamInput: LLM.StreamInput) {
        log.info("process", {
          sessionID: input.sessionID,
          model: `${input.model.providerID}/${input.model.id}`,
          aborted: input.abort.aborted,
        })
        while (true) {
          persister = new EventPersister(input.assistantMessage, input.sessionID, input.model, input.abort)
          let currentStreamResult: LLM.StreamOutput | undefined
          const generator = streamGenerator(
            streamInput,
            (s) => {
              resolved = s
            },
            (r) => {
              currentStreamResult = r
            },
          )

          for await (const event of generator) {
            const action = await persister.handleEvent(event)
            if (action) {
              if (action === "continue") {
                break // Break out of for await, but while (true) will restart
              }
              await persister.flush(currentStreamResult)
              return action
            }
          }
          if (
            persister.attempt > 0 &&
            persister.needsCompaction === false &&
            !persister.blocked &&
            !input.assistantMessage.error
          ) {
            // Usually if it didn't return early, but attempt was bumped, wait, no.
            // If attempt was bumped, handleEvent returns "continue" early.
          }
          const finalAction = await persister.flush(currentStreamResult)
          if (finalAction && finalAction !== "continue") return finalAction
          if (!finalAction) return "continue" // safe fallback
        }
      },
    }
  }
}
