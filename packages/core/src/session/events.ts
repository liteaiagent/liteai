import type { Tool as AITool } from "ai"
import type { Provider } from "../provider/provider"
import type { StreamingToolExecutor } from "./engine/streaming-tool-executor"
import type { LLM } from "./llm"
import type { Message } from "./message"

// biome-ignore lint/suspicious/noExplicitAny: Generic event system payload
type EventPayload = any

export namespace EngineEvent {
  export type DeltaEvent =
    | { type: "delta"; part: "reasoning"; id: string; text: string; metadata?: EventPayload }
    | { type: "delta"; part: "text"; id: string; text: string; metadata?: EventPayload }
    | { type: "delta"; part: "tool"; id: string; toolName: string; text: string }

  export type BlockEvent =
    | { type: "start"; kind: "session" }
    | { type: "start"; kind: "reasoning"; id: string; metadata?: EventPayload }
    | { type: "end"; kind: "reasoning"; id: string; metadata?: EventPayload }
    | { type: "start"; kind: "text"; id: string; metadata?: EventPayload }
    | { type: "end"; kind: "text"; id: string; text?: string; metadata?: EventPayload }
    | { type: "start"; kind: "tool"; id: string; toolName: string }
    | { type: "end"; kind: "tool"; id: string; toolName: string }
    | { type: "call"; kind: "tool"; id: string; toolName: string; input: EventPayload; metadata?: EventPayload }
    | {
        type: "result"
        kind: "tool"
        id: string
        toolName: string
        input: EventPayload
        output: EventPayload
        attachments?: EventPayload[]
        metadata?: EventPayload
        title?: string
      }
    | { type: "error"; kind: "tool"; id: string; toolName: string; input: EventPayload; error: EventPayload }
    | { type: "start"; kind: "step" }
    | { type: "end"; kind: "step"; finishReason: string; usage: unknown; metadata?: EventPayload }
    | { type: "error"; kind: "stream"; error: unknown; isAbortError: boolean }
    | { type: "finish" }

  // Special event for signalling flow control from queryLoop
  export type GeneratorResultEvent = {
    type: "control"
    action: "continue" | "compact" | "stop" | "subtask" | "compaction-task" | "overflow"
    // biome-ignore lint/suspicious/noExplicitAny: payload varies by action
    payload?: any
  }

  /**
   * Signals the start of a new LLM turn. The orchestrator should:
   * 1. Persist the assistant message to the database
   * 2. Instantiate an EventPersister for the turn
   * 3. Resume the generator to begin streaming
   */
  export type TurnStartEvent = {
    type: "turn-start"
    /** In-memory assistant message (not yet persisted) */
    assistantMessage: Message.Assistant
    /** Fully resolved stream input for LLM.stream() */
    streamInput: LLM.StreamInput
    /** Resolved tools for the turn */
    tools: Record<string, AITool>
    /** Model used for this turn */
    model: Provider.Model
    /** Whether this is the last allowed step for the agent */
    isLastStep: boolean
    /** The output format requested (text or json_schema) */
    format: Message.OutputFormat
    /** Streaming tool executor for this turn — provides concurrency tracking and abort propagation */
    toolExecutor: StreamingToolExecutor
  }

  /**
   * Signals that the current LLM turn has finished streaming.
   * The orchestrator should flush the persister and act on the result.
   */
  export type TurnEndEvent = {
    type: "turn-end"
    /** Captured structured output, if any */
    structuredOutput?: unknown
    /** Raw SDK stream result — passed to persister.flush() for partial token recovery on error */
    streamResult?: unknown
  }

  /**
   * Signals that a partial/orphaned message should be cleaned up
   * due to a streaming fallback or unrecoverable error.
   */
  export type TombstoneEvent = {
    type: "tombstone"
    /** The ID of the orphaned assistant message */
    messageID: string
    /** Why the message was tombstoned */
    reason: string
  }

  /** All event types that can flow through the queryLoop generator */
  export type Any = DeltaEvent | BlockEvent | GeneratorResultEvent | TurnStartEvent | TurnEndEvent | TombstoneEvent
}
