/**
 * Tool Display Status — 6-state display model for tool call rendering.
 *
 * Maps from the core engine's 4-state ToolState (pending, running, completed, error)
 * to a richer display model that includes Confirming (permission pending) and
 * Cancelled (user-initiated abort) states. These additional states are derived
 * from the permission request flow and error message classification.
 *
 * @see data-model.md for the state transition diagram
 */

/** The 6 visual states a tool call can be in from the display layer's perspective. */
export enum ToolDisplayStatus {
  /** Tool is queued, not yet executing. Core status: pending */
  Pending = "pending",
  /** Tool is actively running. Core status: running */
  Executing = "executing",
  /** Tool completed successfully. Core status: completed */
  Success = "success",
  /** Tool is awaiting user approval (permission check). Derived from permission request. */
  Confirming = "confirming",
  /** Tool was cancelled by the user (permission denied, dismissed). Derived from error text. */
  Cancelled = "cancelled",
  /** Tool failed with a system error. Core status: error (non-cancelled). */
  Error = "error",
}

/** Status indicator icons — one per display state. */
export const STATUS_ICONS: Record<ToolDisplayStatus, string> = {
  [ToolDisplayStatus.Pending]: "○",
  [ToolDisplayStatus.Executing]: "", // Spinner component, not a static icon
  [ToolDisplayStatus.Success]: "✓",
  [ToolDisplayStatus.Confirming]: "?",
  [ToolDisplayStatus.Cancelled]: "–",
  [ToolDisplayStatus.Error]: "✗",
}

/** Canonical error icon used for persistent error messages in conversation history. */
export const ERROR_ICON = "✗"

/** Canonical warning icon used for persistent warning messages in conversation history. */
export const WARNING_ICON = "⚠"
