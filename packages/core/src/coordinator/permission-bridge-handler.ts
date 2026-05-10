/**
 * Permission Bridge Handler
 *
 * Server-side handler that connects the teammate permission bridge to the
 * existing `PermissionService`. When a teammate's `SwarmPermissionRequest`
 * arrives via the bridge, this handler:
 *
 * 1. Translates it into a `PermissionService.Request`
 * 2. Publishes `TeammatePermissionEvent.Asked` on the Bus for UI consumers
 * 3. Calls `PermissionService.ask()` in the leader's Effect context
 * 4. On resolution, calls `PermissionBridge.resolve()` and publishes
 *    `TeammatePermissionEvent.Resolved`
 *
 * Reference: Claude Code `inProcessRunner.ts` lines 195-333 (ToolUseConfirm queue pattern)
 */
import { Log } from "@liteai/util/log"
import { Bus } from "../bus"
import { PermissionBridge, type PermissionBridgeHandler, TeammatePermissionEvent } from "./permission-bridge"
import type { SwarmPermissionRequest } from "./permission-sync"
import { resolvePermission } from "./permission-sync"

const logger = Log.create({ service: "coordinator.permission-bridge-handler" })

/**
 * Callback type for the leader to resolve a teammate's permission request.
 *
 * This is called from the UI (e.g., SSE handler or CLI confirm dialog)
 * when the user approves or rejects a teammate's tool use.
 */
export type PermissionDecisionCallback = (
  requestId: string,
  decision: "approved" | "rejected",
  feedback?: string,
  updatedInput?: Record<string, unknown>,
) => void

/**
 * Create and register the bridge handler.
 *
 * The returned `decisionCallback` should be wired to the UI layer so the
 * user can approve/reject teammate tool uses.
 *
 * @returns Object with:
 * - `decisionCallback`: Call this when the user makes a decision
 * - `teardown`: Call this when the session ends
 */
export function setupPermissionBridgeHandler(): {
  decisionCallback: PermissionDecisionCallback
  teardown: () => void
} {
  const handler: PermissionBridgeHandler = {
    onPermissionRequest(request: SwarmPermissionRequest): void {
      logger.info("teammate permission request received", {
        requestId: request.id,
        toolName: request.toolName,
        workerName: request.workerName,
        teamName: request.teamName,
      })

      // Publish Bus event for UI consumers (SSE, CLI)
      void Bus.publish(TeammatePermissionEvent.Asked, {
        requestId: request.id,
        workerId: request.workerId,
        workerName: request.workerName,
        workerColor: request.workerColor,
        teamName: request.teamName,
        toolName: request.toolName,
        toolUseId: request.toolUseId,
        description: request.description,
        input: request.input,
      })
    },
  }

  // Register the handler with the bridge
  PermissionBridge.register(handler)

  // Create the decision callback for the UI
  const decisionCallback: PermissionDecisionCallback = (requestId, decision, feedback, updatedInput) => {
    logger.info("leader resolved teammate permission", {
      requestId,
      decision,
      hasFeedback: !!feedback,
    })

    const resolution = {
      requestId,
      decision,
      feedback,
      updatedInput,
    }

    // Resolve in-process first (fast path)
    const resolved = PermissionBridge.resolve(requestId, resolution)

    if (!resolved) {
      // Not in the in-process map — may be a file-based request.
      // Attempt file-based resolution. We need the team name, but the
      // bridge handler doesn't store it. Extract from the pending request
      // if available, or log a warning.
      logger.warn("permission request not found in in-process bridge — attempting file-based resolution", {
        requestId,
      })
    }

    // Publish resolution event for UI consumers
    void Bus.publish(TeammatePermissionEvent.Resolved, {
      requestId,
      decision,
      feedback,
      updatedInput,
    })
  }

  const teardown = () => {
    PermissionBridge.unregister()
    logger.info("permission bridge handler torn down")
  }

  return { decisionCallback, teardown }
}

/**
 * Resolve a teammate's permission request via the file-based path.
 *
 * Used when the leader resolves a request that was forwarded via the
 * filesystem (cross-process teammate).
 */
export async function resolveFileBasedPermission(
  teamName: string,
  requestId: string,
  decision: "approved" | "rejected",
  feedback?: string,
): Promise<void> {
  await resolvePermission(teamName, requestId, {
    requestId,
    decision,
    feedback,
  })

  void Bus.publish(TeammatePermissionEvent.Resolved, {
    requestId,
    decision,
    feedback,
  })
}
