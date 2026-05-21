/**
 * Display Status Mapper — Maps core 4-state ToolState to display 6-state model.
 *
 * The core engine exposes: pending, running, completed, error.
 * The display layer needs: Pending, Executing, Success, Confirming, Cancelled, Error.
 *
 * - Confirming: derived from an active permission request matching the tool's callID
 * - Cancelled: derived from error messages indicating user rejection
 *
 * @see data-model.md for the full state transition diagram
 */

import type { ToolPart } from "@liteai/sdk"
import { ToolDisplayStatus } from "../constants/tool-status"

/** Error message patterns that indicate user-initiated cancellation rather than system error. */
const CANCELLED_PATTERNS = ["rejected permission", "user dismissed", "specified a rule"] as const

/**
 * Minimal permission request shape — only the fields we need for callID matching.
 * Avoids importing the full PermissionRequest type from the SDK.
 */
interface PermissionRequestLike {
  tool?: { callID?: string }
}

/**
 * Maps a ToolPart + active permissions to the 6-state display status.
 *
 * Priority order:
 * 1. If a permission request exists for this callID → Confirming
 * 2. Core pending → Pending
 * 3. Core running → Executing
 * 4. Core completed → Success
 * 5. Core error + cancelled pattern → Cancelled
 * 6. Core error (other) → Error
 */
export function mapToolPartToDisplayStatus(
  part: ToolPart,
  permissions: readonly PermissionRequestLike[],
): ToolDisplayStatus {
  // Check for active permission request first — this takes priority
  // because a tool can be "running" in the core while awaiting approval
  const hasPermission = permissions.some((p) => p.tool?.callID === part.callID)
  if (hasPermission) return ToolDisplayStatus.Confirming

  switch (part.state.status) {
    case "pending":
      return ToolDisplayStatus.Pending

    case "running":
      return ToolDisplayStatus.Executing

    case "completed":
      return ToolDisplayStatus.Success

    case "error": {
      const error = part.state.error
      if (error) {
        const normalized = error.toLowerCase()
        if (CANCELLED_PATTERNS.some((pattern) => normalized.includes(pattern))) {
          return ToolDisplayStatus.Cancelled
        }
      }
      return ToolDisplayStatus.Error
    }
  }
}
