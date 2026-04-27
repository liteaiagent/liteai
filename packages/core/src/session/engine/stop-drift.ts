import type { Message } from "../message"
import type { PlanModeStateRef } from "../plan-mode-state"
import type { SessionID } from "../schema"

/**
 * Result of a stop-drift check. When drifted is true, the engine should
 * inject a correction message and continue the loop instead of stopping.
 */
export interface StopDriftResult {
  /** Whether drift was detected and correction is needed */
  drifted: boolean
  /** The correction message to inject, if any */
  correctionText?: string
  /** Current correction count for logging */
  correctionCount?: number
}

/**
 * Detects when a model stops without calling required tools.
 *
 * After Phase 1 (toolChoice: "auto"), this ONLY checks plan mode drift.
 * General stop-drift correction (for toolChoice: "required") is removed —
 * with auto, a bare stop is normal, expected behavior matching Gemini CLI
 * and Claude Code.
 *
 * Plan mode requires the model to call `plan_exit` or `ask_user` — a bare
 * stop means the model drifted and needs correction.
 */
export class StopDriftService {
  private planStopCorrectionCount = 0
  private readonly maxPlanStopCorrections = 3

  constructor(
    // Required by constructor signature for future telemetry span context and structured logging.
    // Not yet wired but needed when StopDriftService emits its own OpenTelemetry spans.
    readonly _sessionID: SessionID,
    private readonly planModeStateRef: PlanModeStateRef,
  ) {}

  /**
   * Check if the model stopped when it shouldn't have.
   *
   * Only plan mode enforces mandatory tool calls. With toolChoice: "auto",
   * a bare stop without tool calls is normal behavior (not drift).
   */
  check(_lastAssistant: Message.Assistant): StopDriftResult {
    const planState = this.planModeStateRef.get()

    // Only plan mode enforces mandatory tool calls
    if (!planState.active) {
      return { drifted: false }
    }

    // Give up after max corrections to avoid infinite correction loops
    if (this.planStopCorrectionCount >= this.maxPlanStopCorrections) {
      return { drifted: false }
    }

    this.planStopCorrectionCount++

    return {
      drifted: true,
      correctionCount: this.planStopCorrectionCount,
      correctionText: [
        "<system-correction>",
        "STOP. You ended your turn without calling a tool.",
        "",
        "You are in PLAN MODE. Implementation is BLOCKED until you call `plan_exit` and the user approves your plan.",
        "You CANNOT start building, creating files, or implementing — approval via `plan_exit` is MANDATORY.",
        "",
        "End your turn with one of these tool calls:",
        "- `plan_exit` — if your plan is written and ready for user review",
        "- `ask_user` — if you need clarification from the user first",
        "",
        "Do NOT end your turn with just text or reasoning. Call a tool now.",
        "</system-correction>",
      ].join("\n"),
    }
  }
}
