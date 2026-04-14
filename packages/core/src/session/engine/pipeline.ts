import type { Provider } from "../../provider/provider"
import { Log } from "../../util/log"
import { Token } from "../../util/token"
import { Message } from "../message"

const log = Log.create({ service: "session.pipeline" })

// ─── Constants ───────────────────────────────────────────────────────────────

/**
 * Maximum aggregate characters of completed tool outputs allowed per
 * logical "turn" (consecutive assistant→user message group).
 */
const MAX_AGGREGATE_OUTPUT_PER_TURN = 200_000

/**
 * Autocompact fires when estimated token count exceeds
 * `effectiveContext - AUTOCOMPACT_BUFFER_TOKENS`.
 */
const AUTOCOMPACT_BUFFER_TOKENS = 13_000

/**
 * Tokens reserved for model output during budget calculations.
 * Subtracted from the model's input limit to get effective context.
 */
const COMPACTION_RESERVE_TOKENS = 20_000

/**
 * Maximum consecutive autocompact failures before the circuit breaker
 * trips and stops retrying for the remainder of the session.
 */
const MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3

// Sentinel replacement for cleared tool outputs.
const TOOL_OUTPUT_CLEARED = "[Old tool result content cleared]"

// ─── Types ───────────────────────────────────────────────────────────────────

export type AutocompactState = {
  consecutiveFailures: number
}

export function createAutocompactState(): AutocompactState {
  return { consecutiveFailures: 0 }
}

// ─── Stage 1: Aggregate Tool Result Budget ───────────────────────────────────

type ToolPartRef = {
  msgIndex: number
  partIndex: number
  size: number
}

/**
 * Enforce an aggregate tool-output budget per logical turn.
 *
 * Walks backwards through the message array grouping consecutive
 * user messages (a "turn") and summing the character length of all
 * completed tool outputs in that turn. When the total exceeds
 * `MAX_AGGREGATE_OUTPUT_PER_TURN`, the largest outputs are cleared
 * and their `time.compacted` flag is set.
 *
 * **Frozen decisions**: Once a part has been seen (compacted or not),
 * the decision is never revisited. This is enforced by checking the
 * `time.compacted` field — parts already compacted stay compacted,
 * and parts that survived previous pipeline runs are not retroactively
 * cleared. This preserves prompt cache prefix stability.
 *
 * Returns a new array (no mutation of the input).
 */
export function applyToolResultBudget(messages: Message.WithParts[]): Message.WithParts[] {
  // Group messages into "turns" — a turn is a contiguous run of messages
  // ending at (or between) assistant messages.
  const turns = groupByTurn(messages)
  let mutated = false
  const result = [...messages]

  for (const turn of turns) {
    const candidates: ToolPartRef[] = []
    let totalSize = 0

    for (const msgIdx of turn) {
      const msg = result[msgIdx]
      for (let pi = 0; pi < msg.parts.length; pi++) {
        const part = msg.parts[pi]
        if (part.type !== "tool" || part.state.status !== "completed") continue
        // Already compacted — skip, don't count toward budget
        if (part.state.time.compacted) continue

        const size = part.state.output.length
        totalSize += size
        candidates.push({ msgIndex: msgIdx, partIndex: pi, size })
      }
    }

    if (totalSize <= MAX_AGGREGATE_OUTPUT_PER_TURN) continue

    // Sort candidates by size descending — clear the biggest first
    candidates.sort((a, b) => b.size - a.size)
    let remaining = totalSize

    for (const ref of candidates) {
      if (remaining <= MAX_AGGREGATE_OUTPUT_PER_TURN) break

      // Clone the message and part to avoid mutating the original
      if (!mutated) {
        for (let i = 0; i < result.length; i++) {
          result[i] = {
            info: result[i].info,
            parts: [...result[i].parts],
          }
        }
        mutated = true
      }

      const msg = result[ref.msgIndex]
      const part = msg.parts[ref.partIndex] as Message.ToolPart
      if (part.state.status !== "completed") continue

      msg.parts[ref.partIndex] = {
        ...part,
        state: {
          ...part.state,
          output: TOOL_OUTPUT_CLEARED,
          time: {
            ...part.state.time,
            compacted: Date.now(),
          },
        },
      }

      remaining -= ref.size
      log.info("budget: cleared tool output", {
        tool: part.tool,
        partID: part.id,
        originalSize: ref.size,
      })
    }
  }

  return result
}

/**
 * Groups message indices into "turns". A turn boundary is created
 * each time an assistant message appears. User messages between
 * assistant messages belong to the same turn.
 */
function groupByTurn(messages: Message.WithParts[]): number[][] {
  const turns: number[][] = []
  let current: number[] = []

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    if (msg.info.role === "assistant") {
      if (current.length > 0) {
        turns.push(current)
        current = []
      }
      // Assistant messages themselves are a single-element turn
      turns.push([i])
    } else {
      current.push(i)
    }
  }
  if (current.length > 0) turns.push(current)
  return turns
}

// ─── Stage 2: Snip Compact ──────────────────────────────────────────────────

/**
 * Remove "dead branches" from the message history:
 *
 * 1. Assistant messages with `AbortedError` that produced no useful
 *    content (no text parts, no completed tool calls) are stripped.
 *
 * 2. Failed retry sequences: when a `RetryPart` exists on an assistant
 *    message that also has an error set AND a subsequent successful
 *    assistant response exists, the failed message is stripped.
 *
 * This is purely in-memory filtering — no DB mutations.
 */
export function snipCompact(messages: Message.WithParts[]): Message.WithParts[] {
  return messages.filter((msg) => {
    if (msg.info.role !== "assistant") return true

    const assistant = msg.info as Message.Assistant

    // Keep messages without errors
    if (!assistant.error) return true

    // Check for aborted messages with no useful content
    if (Message.AbortedError.isInstance(assistant.error)) {
      const hasUsefulContent = msg.parts.some((part) => {
        if (part.type === "text" && part.text.trim().length > 0) return true
        if (part.type === "tool" && part.state.status === "completed") return true
        return false
      })
      if (!hasUsefulContent) {
        log.info("snip: removing aborted message with no content", {
          messageID: msg.info.id,
        })
        return false
      }
    }

    return true
  })
}

// ─── Stage 3: Proactive Autocompact Check ────────────────────────────────────

/**
 * Estimates total token usage of the message array and returns whether
 * the conversation should be auto-compacted before the next LLM call.
 *
 * The circuit breaker prevents infinite retry loops when compaction
 * itself fails (e.g., context irrecoverably too large).
 */
export function shouldAutocompact(
  messages: Message.WithParts[],
  model: Provider.Model,
  state: AutocompactState,
): boolean {
  // Circuit breaker
  if (state.consecutiveFailures >= MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES) {
    log.info("autocompact: circuit breaker tripped", {
      failures: state.consecutiveFailures,
    })
    return false
  }

  const inputLimit = model.limit.input || model.limit.context
  if (!inputLimit || inputLimit === 0) return false

  const effectiveContext = inputLimit - COMPACTION_RESERVE_TOKENS
  const threshold = effectiveContext - AUTOCOMPACT_BUFFER_TOKENS

  if (threshold <= 0) return false

  const estimated = estimateMessageTokens(messages)

  log.info("autocompact: check", {
    estimated,
    threshold,
    effectiveContext,
    inputLimit,
  })

  return estimated >= threshold
}

/**
 * Rough token estimate for the full message array.
 * Sums text-bearing content across all parts.
 */
function estimateMessageTokens(messages: Message.WithParts[]): number {
  let total = 0
  for (const msg of messages) {
    for (const part of msg.parts) {
      switch (part.type) {
        case "text":
          total += Token.estimate(part.text)
          break
        case "reasoning":
          total += Token.estimate(part.text)
          break
        case "tool":
          if (part.state.status === "completed") {
            total += Token.estimate(part.state.output)
            total += Token.estimate(JSON.stringify(part.state.input))
          } else if (part.state.status === "error") {
            total += Token.estimate(part.state.error)
          }
          break
      }
    }
    // Overhead per message (role tokens, framing)
    total += 4
  }
  return total
}

// ─── Pipeline Entrypoint ─────────────────────────────────────────────────────

/**
 * Execute the full pre-processing context pipeline on the message array.
 *
 * 1. `applyToolResultBudget` — clear oversized tool outputs per turn
 * 2. `snipCompact` — remove dead branches (aborted, no content)
 *
 * Note: `shouldAutocompact` is NOT called here — it returns a boolean
 * that the loop uses to decide whether to trigger compaction. Calling
 * it inside the pipeline would require coupling to the compaction
 * subsystem.
 */
export function executePipeline(messages: Message.WithParts[]): Message.WithParts[] {
  let result = applyToolResultBudget(messages)
  result = snipCompact(result)
  return result
}
