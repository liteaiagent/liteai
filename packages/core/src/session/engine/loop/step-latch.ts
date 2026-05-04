import { NamedError } from "@liteai/util/error"
import z from "zod"

// ─── Errors ──────────────────────────────────────────────────────────────────

const StepLatchAlreadyResolvedData = z.object({ message: z.string().optional() })
export class StepLatchAlreadyResolvedError extends NamedError.create(
  "StepLatchAlreadyResolvedError",
  StepLatchAlreadyResolvedData,
) {}

const SessionNotPausedData = z.object({ sessionID: z.string() })
export class SessionNotPausedError extends NamedError.create("SessionNotPausedError", SessionNotPausedData) {}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ResumePayload {
  /** Optional user guidance text to inject before next step */
  guidance?: string
  /** If true, disables step mode and continues without pausing */
  disableStepMode?: boolean
}

export interface StepLatchHandle {
  /** Resolves when the user resumes */
  promise: Promise<ResumePayload>
  /** Called by the resume endpoint to unblock the loop */
  resolve: (payload: ResumePayload) => void
  /** Called when the session is aborted during pause */
  reject: (reason: unknown) => void
  /** Whether the latch has already been resolved or rejected */
  settled: boolean
}

// ─── StepPauseLatch ──────────────────────────────────────────────────────────

/**
 * Concurrency primitive that gates the engine loop between iterations.
 * Creates single-use Promise-based latches that block the generator
 * until the user resumes or the session is aborted.
 */
// biome-ignore lint/complexity/noStaticOnlyClass: Designed as a static factory for semantic clarity
export class StepPauseLatch {
  /**
   * Creates a new latch. The returned handle's `promise` will block
   * until `resolve()` or `reject()` is called exactly once.
   * Double-resolve throws StepLatchAlreadyResolvedError.
   */
  static create(): StepLatchHandle {
    let resolveRef: ((payload: ResumePayload) => void) | undefined
    let rejectRef: ((reason: unknown) => void) | undefined
    let settled = false

    const promise = new Promise<ResumePayload>((resolve, reject) => {
      resolveRef = resolve
      rejectRef = reject
    })

    const handle: StepLatchHandle = {
      promise,
      resolve: (payload: ResumePayload) => {
        if (settled) {
          throw new StepLatchAlreadyResolvedError({
            message: "StepPauseLatch has already been settled — cannot resolve twice",
          })
        }
        settled = true
        handle.settled = true
        resolveRef?.(payload)
      },
      reject: (reason: unknown) => {
        if (settled) {
          // Reject after settle is a no-op — abort during cleanup is expected
          return
        }
        settled = true
        handle.settled = true
        rejectRef?.(reason)
      },
      settled: false,
    }

    return handle
  }
}
