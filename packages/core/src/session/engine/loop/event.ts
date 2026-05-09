// ─── @liteagent/loop — Core Event Types ─────────────────────────────────────
//
// Standalone type taxonomy for the forward-only loop runner.
// Zero imports from LiteAI internals — these types are designed for
// mechanical extraction to the @liteagent/loop package.
//
// LiteAI maps EngineEvent ↔ LoopEvent at the orchestrator boundary.
// External consumers (non-LiteAI) use these types directly.

/**
 * Minimal message representation for the loop boundary.
 * Deliberately simpler than LiteAI's Message.WithParts — carries only
 * the content needed for loop state management, not UI rendering.
 */
export interface LoopMessage {
  role: "assistant" | "user" | "system"
  content: LoopContent[]
}

/**
 * Content blocks within a LoopMessage.
 * Maps 1:1 to the Anthropic/OpenAI content block model.
 */
export type LoopContent =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "tool-call"; id: string; name: string; args: unknown }
  | { type: "tool-result"; id: string; name: string; result: unknown }

/**
 * Why the model stopped generating.
 * Superset of common provider finish reasons, normalized to a single enum.
 */
export type LoopFinishReason = "stop" | "tool-calls" | "length" | "error" | "abort" | "unknown"

/**
 * Token usage for a single step (LLM call).
 * Mirrors the common provider usage shape without provider-specific fields.
 */
export interface LoopUsage {
  inputTokens: number
  outputTokens: number
  reasoningTokens?: number
}

/**
 * Events emitted by the forward-only loop runner.
 *
 * Design constraints:
 * - Each event represents a single, atomic state change during execution
 * - Events are ordered: turn-start → deltas/calls/results → step-end → turn-end
 * - Error events can appear at any point and terminate the current turn
 * - No control flow events (compaction, subtask delegation) — those are
 *   LiteAI-specific orchestrator concerns, not loop concerns
 */
export type LoopEvent =
  | { type: "turn-start"; message: LoopMessage }
  | { type: "text-delta"; delta: string }
  | { type: "reasoning-delta"; delta: string }
  | { type: "tool-call"; id: string; name: string; args: unknown }
  | { type: "tool-result"; id: string; name: string; result: unknown }
  | { type: "tool-error"; id: string; name: string; error: unknown }
  | { type: "step-end"; finishReason: LoopFinishReason; usage?: LoopUsage }
  | { type: "turn-end"; finishReason: LoopFinishReason }
  | { type: "error"; error: unknown }

/**
 * Typed result of a complete loop execution.
 *
 * - `ok`: Loop completed successfully — message contains the final assistant response
 * - `error`: Loop failed — error describes what went wrong, message may contain
 *   partial work if the failure occurred mid-turn
 * - `aborted`: Loop was cancelled externally (user abort, timeout)
 */
export type LoopResult =
  | { status: "ok"; message: LoopMessage }
  | { status: "error"; error: unknown; message?: LoopMessage }
  | { status: "aborted" }
