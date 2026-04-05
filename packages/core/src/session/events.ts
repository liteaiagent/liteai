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

  // Special event for signalling flow control
  export type GeneratorResultEvent = {
    type: "control"
    action: "continue" | "compact" | "stop"
  }

  export type Any = DeltaEvent | BlockEvent | GeneratorResultEvent
}
