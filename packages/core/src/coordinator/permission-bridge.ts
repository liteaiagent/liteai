/**
 * In-Process Permission Bridge
 *
 * Provides a dual-transport system for teammates to request permission
 * from the leader:
 *
 * **Primary path (in-process):** Teammate calls `bridge.forward()` which
 * creates a `Deferred` promise, publishes a Bus event, and blocks until
 * the leader resolves it via `bridge.resolve()`.
 *
 * **Fallback path (file-based):** If the in-process bridge is not registered,
 * the teammate writes a `SwarmPermissionRequest` to the filesystem and polls
 * for a resolution file. This supports future cross-process teammates.
 *
 * Reference: Claude Code `utils/swarm/leaderPermissionBridge.ts` +
 *            `utils/swarm/permissionSync.ts` (file fallback)
 */
import { Log } from "@liteai/util/log"
import z from "zod"
import { BusEvent } from "../bus/bus-event"
import type { PermissionResolution, SwarmPermissionRequest } from "./permission-sync"
import { pollResolution, writePermissionRequest } from "./permission-sync"
import { TEAMMATE_POLL_INTERVAL_MS } from "./teammate-types"

const logger = Log.create({ service: "coordinator.permission-bridge" })

// ─── Bus Events ──────────────────────────────────────────────────────────────

export const TeammatePermissionEvent = {
  /** Published when a teammate forwards a permission request to the leader. */
  Asked: BusEvent.define(
    "teammate.permission.asked",
    z.object({
      requestId: z.string(),
      workerId: z.string(),
      workerName: z.string(),
      workerColor: z.string().optional(),
      teamName: z.string(),
      toolName: z.string(),
      toolUseId: z.string(),
      description: z.string(),
      input: z.record(z.string(), z.unknown()),
    }),
  ),

  /** Published when the leader resolves a teammate's permission request. */
  Resolved: BusEvent.define(
    "teammate.permission.resolved",
    z.object({
      requestId: z.string(),
      decision: z.enum(["approved", "rejected"]),
      feedback: z.string().optional(),
      updatedInput: z.record(z.string(), z.unknown()).optional(),
    }),
  ),
}

// ─── Bridge Types ────────────────────────────────────────────────────────────

interface PendingPermission {
  request: SwarmPermissionRequest
  resolve: (resolution: PermissionResolution) => void
  reject: (error: Error) => void
  createdAt: number
}

export interface PermissionBridgeHandler {
  /**
   * Called when a teammate's permission request needs leader resolution.
   * The handler is responsible for presenting the request to the user
   * (or delegating to PermissionService) and calling `bridge.resolve()`.
   */
  onPermissionRequest(request: SwarmPermissionRequest): void
}

// ─── Bridge Implementation ──────────────────────────────────────────────────

/**
 * Singleton permission bridge.
 *
 * The leader registers a handler on session start. Teammates call `forward()`
 * to request permission. The bridge manages the pending request map and
 * coordinates resolution.
 */
class PermissionBridgeImpl {
  private _handler: PermissionBridgeHandler | null = null
  private readonly _pending = new Map<string, PendingPermission>()

  // ── Registration ──

  /**
   * Register the leader's permission handler.
   * Must be called before any teammate is spawned.
   */
  register(handler: PermissionBridgeHandler): void {
    if (this._handler) {
      logger.warn("overwriting existing permission bridge handler")
    }
    this._handler = handler
    logger.info("permission bridge handler registered")
  }

  /** Unregister the handler (session cleanup). */
  unregister(): void {
    this._handler = null
    // Reject all pending requests — session is ending
    for (const [id, pending] of this._pending.entries()) {
      pending.reject(new Error("Permission bridge unregistered — session ending"))
      this._pending.delete(id)
    }
    logger.info("permission bridge handler unregistered", {
      rejectedPending: this._pending.size,
    })
  }

  /** Check if the in-process bridge is active. */
  isRegistered(): boolean {
    return this._handler !== null
  }

  // ── Forward (Worker → Leader) ──

  /**
   * Forward a permission request to the leader.
   *
   * **Primary path:** If a handler is registered, creates a Deferred promise
   * and notifies the handler via callback.
   *
   * **Fallback path:** If no handler is registered, writes the request to the
   * filesystem and polls for a resolution file.
   *
   * @returns Resolution from the leader
   * @throws Error if the request times out or the bridge is torn down
   */
  async forward(request: SwarmPermissionRequest, abort?: AbortSignal): Promise<PermissionResolution> {
    if (this._handler) {
      return this._forwardInProcess(request, abort)
    }
    return this._forwardViaFile(request, abort)
  }

  /**
   * In-process path: create a promise and delegate to the handler.
   */
  private async _forwardInProcess(request: SwarmPermissionRequest, abort?: AbortSignal): Promise<PermissionResolution> {
    return new Promise<PermissionResolution>((resolve, reject) => {
      // Store the pending entry BEFORE notifying the handler (avoid race)
      this._pending.set(request.id, {
        request,
        resolve,
        reject,
        createdAt: Date.now(),
      })

      // If aborted while waiting, reject and clean up
      if (abort) {
        const onAbort = () => {
          const pending = this._pending.get(request.id)
          if (pending) {
            this._pending.delete(request.id)
            reject(new Error("Permission request aborted"))
          }
        }
        abort.addEventListener("abort", onAbort, { once: true })
      }

      logger.info("forwarding permission request (in-process)", {
        requestId: request.id,
        toolName: request.toolName,
        workerName: request.workerName,
      })

      // Notify the handler (guarded by the outer `if (this._handler)` in _forwardInProcess caller)
      this._handler?.onPermissionRequest(request)
    })
  }

  /**
   * File-based fallback: write to pending directory and poll for resolution.
   */
  private async _forwardViaFile(request: SwarmPermissionRequest, abort?: AbortSignal): Promise<PermissionResolution> {
    logger.info("forwarding permission request (file-based fallback)", {
      requestId: request.id,
      toolName: request.toolName,
      workerName: request.workerName,
    })

    // Write to pending directory
    await writePermissionRequest(request)

    // Poll for resolution
    const maxWaitMs = 5 * 60 * 1000 // 5 minute timeout
    const startTime = Date.now()

    while (!abort?.aborted) {
      const resolution = await pollResolution(request.teamName, request.id)
      if (resolution) {
        logger.info("received file-based permission resolution", {
          requestId: request.id,
          decision: resolution.decision,
        })
        return resolution
      }

      if (Date.now() - startTime > maxWaitMs) {
        throw new Error(
          `Permission request ${request.id} timed out after ${maxWaitMs / 1000}s waiting for leader resolution`,
        )
      }

      // Wait before next poll
      await new Promise<void>((r) => {
        const timer = setTimeout(r, TEAMMATE_POLL_INTERVAL_MS)
        if (abort) {
          abort.addEventListener(
            "abort",
            () => {
              clearTimeout(timer)
              r()
            },
            { once: true },
          )
        }
      })
    }

    throw new Error("Permission request aborted")
  }

  // ── Resolve (Leader → Worker) ──

  /**
   * Resolve a pending in-process permission request.
   *
   * Called by the `permission-bridge-handler` after the leader (or user) has
   * made a decision.
   *
   * @returns `true` if the request was found and resolved, `false` if not pending
   */
  resolve(requestId: string, resolution: PermissionResolution): boolean {
    const pending = this._pending.get(requestId)
    if (!pending) {
      logger.warn("attempted to resolve non-pending permission request", { requestId })
      return false
    }

    this._pending.delete(requestId)
    pending.resolve(resolution)

    logger.info("resolved permission request", {
      requestId,
      decision: resolution.decision,
      feedback: resolution.feedback,
    })

    return true
  }

  // ── Inspection ──

  /** Get all currently pending permission request IDs. */
  getPendingIds(): string[] {
    return Array.from(this._pending.keys())
  }

  /** Get a pending request by ID (for UI display). */
  getPending(requestId: string): SwarmPermissionRequest | undefined {
    return this._pending.get(requestId)?.request
  }

  /** Number of pending requests. */
  get pendingCount(): number {
    return this._pending.size
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

/**
 * Module-level singleton bridge instance.
 *
 * Accessed by:
 * - Leader: `PermissionBridge.register()` / `PermissionBridge.resolve()`
 * - Teammate: `PermissionBridge.forward()`
 * - UI: `PermissionBridge.getPendingIds()` / `PermissionBridge.getPending()`
 */
export const PermissionBridge = new PermissionBridgeImpl()
