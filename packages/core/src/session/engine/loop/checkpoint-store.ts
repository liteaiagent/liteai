import { NamedError } from "@liteai/util/error"
import { ulid } from "ulid"
import z from "zod"
import type { Message } from "../../message"
import type { SessionID } from "../../schema"

// ─── Errors ──────────────────────────────────────────────────────────────────

const CheckpointNotFoundData = z.object({ checkpointID: z.string(), sessionID: z.string().optional() })
export class CheckpointNotFoundError extends NamedError.create("CheckpointNotFoundError", CheckpointNotFoundData) {}

const CheckpointStepViolationData = z.object({
  step: z.number(),
  latestStep: z.number(),
  sessionID: z.string(),
})
export class CheckpointStepViolationError extends NamedError.create(
  "CheckpointStepViolationError",
  CheckpointStepViolationData,
) {}

// ─── Types ───────────────────────────────────────────────────────────────────

/** Zod schema for CheckpointMetadata — used for Bus event contracts and API validation */
export const CheckpointMetadataSchema = z.object({
  agent: z.string(),
  model: z.object({ providerID: z.string(), modelID: z.string() }),
  trigger: z.enum(["user", "subtask", "compaction", "retry"]),
  timing: z.object({ start: z.number(), end: z.number() }),
  tokenUsage: z.object({ input: z.number(), output: z.number(), reasoning: z.number() }).optional(),
  traceSpanID: z.string().optional(),
})

export type CheckpointMetadata = z.infer<typeof CheckpointMetadataSchema>

export interface CheckpointData {
  /** Monotonically increasing checkpoint identifier (ULID) */
  id: string
  /** Reference to the prior checkpoint (linked list) */
  parentID?: string
  /** Session this checkpoint belongs to */
  sessionID: SessionID
  /** Step number (1-indexed) within the session */
  step: number
  /** Deep copy of the in-memory message buffer at this step boundary */
  messages: Message.WithParts[]
  /** Git tree hash from Snapshot.track() — references file state */
  snapshot?: string
  /** Date.now() at capture time */
  timestamp: number
  /** Per-step context snapshot */
  metadata: CheckpointMetadata
}

// ─── CheckpointStore ─────────────────────────────────────────────────────────

export interface CheckpointCaptureInput {
  step: number
  messages: Message.WithParts[]
  snapshot?: string
  metadata: CheckpointMetadata
}

/**
 * In-memory store for checkpoints, scoped to a single session's lifecycle.
 * All operations are synchronous — no database interaction.
 */
export class CheckpointStore {
  private readonly checkpoints = new Map<string, CheckpointData>()
  private readonly stepIndex = new Map<number, string>()
  private latestID: string | undefined = undefined

  constructor(public readonly sessionID: SessionID) {}

  /**
   * Capture a new checkpoint at a step boundary.
   * Deep-copies the messages array via structuredClone.
   * Validates step monotonicity — throws if step is not greater than the latest.
   */
  capture(input: CheckpointCaptureInput): CheckpointData {
    const latestCheckpoint = this.latestID ? this.checkpoints.get(this.latestID) : undefined
    if (latestCheckpoint && input.step <= latestCheckpoint.step) {
      throw new CheckpointStepViolationError({
        step: input.step,
        latestStep: latestCheckpoint.step,
        sessionID: this.sessionID,
      })
    }

    const id = ulid()
    const checkpoint: CheckpointData = {
      id,
      parentID: this.latestID,
      sessionID: this.sessionID,
      step: input.step,
      messages: structuredClone(input.messages),
      snapshot: input.snapshot,
      timestamp: Date.now(),
      metadata: input.metadata,
    }

    this.checkpoints.set(id, checkpoint)
    this.stepIndex.set(input.step, id)
    this.latestID = id

    return checkpoint
  }

  /**
   * Returns a specific checkpoint by ID, or undefined if not found.
   */
  get(checkpointID: string): CheckpointData | undefined {
    return this.checkpoints.get(checkpointID)
  }

  /**
   * Returns the checkpoint for a given step number, or undefined if not found.
   */
  getByStep(step: number): CheckpointData | undefined {
    const id = this.stepIndex.get(step)
    return id ? this.checkpoints.get(id) : undefined
  }

  /**
   * Removes all checkpoints AFTER the specified one (exclusive).
   * Updates latestID to point to the specified checkpoint.
   * Throws CheckpointNotFoundError if the checkpoint does not exist.
   */
  truncateAfter(checkpointID: string): void {
    const target = this.checkpoints.get(checkpointID)
    if (!target) {
      throw new CheckpointNotFoundError({ checkpointID, sessionID: this.sessionID })
    }

    // Collect IDs first, then delete — never mutate a Map during iteration.
    // While JS spec technically defines this behavior, it's a known source of
    // subtle bugs across runtimes and JIT optimizations.
    const toRemove: { id: string; step: number }[] = []
    for (const [id, cp] of this.checkpoints) {
      if (cp.step > target.step) {
        toRemove.push({ id, step: cp.step })
      }
    }
    for (const { id, step } of toRemove) {
      this.checkpoints.delete(id)
      this.stepIndex.delete(step)
    }

    this.latestID = checkpointID
  }

  /**
   * Returns all checkpoints ordered by step (ascending).
   */
  list(): CheckpointData[] {
    return [...this.checkpoints.values()].sort((a, b) => a.step - b.step)
  }

  /**
   * Returns the most recent checkpoint, or undefined if none exist.
   */
  latest(): CheckpointData | undefined {
    return this.latestID ? this.checkpoints.get(this.latestID) : undefined
  }

  /**
   * Clears all checkpoints from the store.
   */
  clear(): void {
    this.checkpoints.clear()
    this.stepIndex.clear()
    this.latestID = undefined
  }
}

// ─── CheckpointStoreManager ─────────────────────────────────────────────────
//
// Centralized static manager for all session-scoped CheckpointStore instances.
// Replaces the duplicated `private static readonly globalStores` pattern that
// was independently maintained on SqliteCheckpointer and MemoryCheckpointer.
//
// All checkpoint lifecycle operations are pure in-memory — they have no
// dependency on the persistence backend (SQLite, Memory, etc.). The previous
// design coupled these operations to the Checkpointer interface, creating
// a false DI seam: the checkpoint stores were always in-memory regardless
// of which Checkpointer implementation was injected.

// biome-ignore lint/complexity/noStaticOnlyClass: Designed as a static namespace for checkpoint store lifecycle management
export class CheckpointStoreManager {
  private static readonly stores = new Map<SessionID, CheckpointStore>()

  /** Returns the CheckpointStore for a session, creating one if it doesn't exist */
  static getStore(sessionID: SessionID): CheckpointStore {
    let store = CheckpointStoreManager.stores.get(sessionID)
    if (!store) {
      store = new CheckpointStore(sessionID)
      CheckpointStoreManager.stores.set(sessionID, store)
    }
    return store
  }

  /** Clears the CheckpointStore for a session from memory */
  static clearSession(sessionID: SessionID): void {
    CheckpointStoreManager.stores.delete(sessionID)
  }

  /** Capture a new checkpoint at a step boundary */
  static captureCheckpoint(sessionID: SessionID, data: CheckpointCaptureInput): CheckpointData {
    return CheckpointStoreManager.getStore(sessionID).capture(data)
  }

  /** Returns a specific checkpoint by ID, or undefined if not found */
  static getCheckpoint(sessionID: SessionID, checkpointID: string): CheckpointData | undefined {
    return CheckpointStoreManager.getStore(sessionID).get(checkpointID)
  }

  /** Returns the checkpoint for a given step number, or undefined if not found */
  static getCheckpointByStep(sessionID: SessionID, step: number): CheckpointData | undefined {
    return CheckpointStoreManager.getStore(sessionID).getByStep(step)
  }

  /** Returns all checkpoints ordered by step (ascending) */
  static listCheckpoints(sessionID: SessionID): CheckpointData[] {
    return CheckpointStoreManager.getStore(sessionID).list()
  }

  /** Removes all checkpoints AFTER the specified one (exclusive) */
  static truncateCheckpointsAfter(sessionID: SessionID, checkpointID: string): void {
    CheckpointStoreManager.getStore(sessionID).truncateAfter(checkpointID)
  }
}
