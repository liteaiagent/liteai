# Implementation Review: Backward Execution & Step-Level Control

**Spec**: [spec.md](file:///d:/liteai/specs/011-backward-execution/spec.md) | **Roadmap**: [05-backward-execution.md](file:///d:/liteai/roadmap/engine-loop-decoupling/05-backward-execution.md)  
**Reviewer**: Code review against spec, plan, tasks, walkthrough, reference implementations (LangGraph, Claude Code)  
**Date**: 2026-05-05  
**Last Updated**: 2026-05-05 (all 9 issues resolved)

---

## Executive Summary

The implementation covers all 31 tasks across 7 phases. The core architecture is sound: the `StepPauseLatch` await-gate pattern, in-memory `CheckpointStore` with `structuredClone`, and the generator yield-based step-pause integration are well-designed and align with the spec's forward-only loop philosophy.

**All 9 issues identified during the review have been resolved.** The implementation passes `bun typecheck` and `bun lint:fix` cleanly.

---

## Resolution Summary

| # | Issue | Severity | Status | Fix | Files |
|---|-------|----------|--------|-----|-------|
| 1 | `truncateAfter` Map mutation during iteration | 🔴 | ✅ | Collect-then-delete pattern | [checkpoint-store.ts](file:///d:/liteai/packages/core/src/session/engine/loop/checkpoint-store.ts) |
| 2 | `NoopCheckpointer` silently discards writes | 🟠 | ✅ | Throw on write ops, empty on reads | [checkpointer.ts](file:///d:/liteai/packages/core/src/session/engine/loop/checkpointer.ts) |
| 3 | `stepBack` conflict detection inverted | 🔴 | ✅ | Compare against latest checkpoint | [step-back.ts](file:///d:/liteai/packages/core/src/session/step-back.ts) |
| 4 | Duplicate `CheckpointNotFoundError` types | 🟡 | ✅ | Deduplicated; single NamedError source | [step-back.ts](file:///d:/liteai/packages/core/src/session/step-back.ts) |
| 5 | Hardcoded `SqliteCheckpointer` in domain fns | 🟠 | ✅ | Optional DI param with lazy default | [step-back.ts](file:///d:/liteai/packages/core/src/session/step-back.ts), [index.ts](file:///d:/liteai/packages/core/src/session/index.ts) |
| 6 | `stepModeRef` guard always true | 🟡 | ✅ | Check `input.stepModeRef` instead | [loop.ts](file:///d:/liteai/packages/core/src/session/engine/loop.ts) |
| 7 | `cleanup()` silent error swallowing | 🟡 | ✅ | Static import + `log.warn` on failure | [loop.ts](file:///d:/liteai/packages/core/src/session/engine/loop.ts) |
| 8 | MessageID ordering assumption undocumented | 🟡 | ✅ | Added explicit inline comment | [step-back.ts](file:///d:/liteai/packages/core/src/session/step-back.ts) |
| 9 | String-based error matching in `forkAtCheckpoint` | 🟡 | ✅ | `NamedError` classes + `.name` checks | [index.ts](file:///d:/liteai/packages/core/src/session/index.ts), [session.ts](file:///d:/liteai/packages/core/src/server/routes/session.ts) |

---

## Changes by File

### [checkpoint-store.ts](file:///d:/liteai/packages/core/src/session/engine/loop/checkpoint-store.ts)

```diff:checkpoint-store.ts
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

export interface CheckpointMetadata {
  /** Agent name used for this step */
  agent: string
  /** Model used for this step */
  model: { providerID: string; modelID: string }
  /** What caused this step to execute */
  trigger: "user" | "subtask" | "compaction" | "retry"
  /** Wall clock start/end of the step */
  timing: { start: number; end: number }
  /** Token counts for the step (if available) */
  tokenUsage?: { input: number; output: number; reasoning: number }
  /** Reference to the OpenTelemetry span for this step */
  traceSpanID?: string
}

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

    // Remove all checkpoints with step > target.step
    for (const [id, cp] of this.checkpoints) {
      if (cp.step > target.step) {
        this.checkpoints.delete(id)
        this.stepIndex.delete(cp.step)
      }
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
===
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

export interface CheckpointMetadata {
  /** Agent name used for this step */
  agent: string
  /** Model used for this step */
  model: { providerID: string; modelID: string }
  /** What caused this step to execute */
  trigger: "user" | "subtask" | "compaction" | "retry"
  /** Wall clock start/end of the step */
  timing: { start: number; end: number }
  /** Token counts for the step (if available) */
  tokenUsage?: { input: number; output: number; reasoning: number }
  /** Reference to the OpenTelemetry span for this step */
  traceSpanID?: string
}

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
```

### [checkpointer.ts](file:///d:/liteai/packages/core/src/session/engine/loop/checkpointer.ts)

```diff:checkpointer.ts
import { Session } from "../.."
import { Message } from "../../message"
import type { MessageID, PartID, SessionID } from "../../schema"
import { type CheckpointCaptureInput, type CheckpointData, CheckpointStore } from "./checkpoint-store"
export type PersistenceOp =
  | { type: "upsert-part"; part: Message.Part }
  | {
      type: "delta-part"
      sessionID: SessionID
      messageID: MessageID
      partID: PartID
      field: string
      delta: string
    }
  | { type: "upsert-message"; message: Message.Assistant }

export interface Checkpointer {
  loadHistory(sessionID: SessionID): Promise<Message.WithParts[]>
  write(ops: PersistenceOp[]): Promise<void>
  saveMessage(msg: Message.Assistant | Message.User): Promise<Message.Assistant | Message.User>
  savePart(part: Message.Part): Promise<Message.Part>
  updateMessage(msg: Message.Assistant): Promise<void>
  deletePart(ref: { sessionID: SessionID; messageID: MessageID; partID: PartID }): Promise<void>
  dispose(): Promise<void>

  // ── Checkpoint lifecycle (Phase 5: Backward Execution) ──
  captureCheckpoint(sessionID: SessionID, data: CheckpointCaptureInput): CheckpointData
  getCheckpoint(sessionID: SessionID, checkpointID: string): CheckpointData | undefined
  getCheckpointByStep(sessionID: SessionID, step: number): CheckpointData | undefined
  listCheckpoints(sessionID: SessionID): CheckpointData[]
  truncateCheckpointsAfter(sessionID: SessionID, checkpointID: string): void
  /** Returns the CheckpointStore for a session, creating one if it doesn't exist */
  getCheckpointStore(sessionID: SessionID): CheckpointStore
  /** Clears the CheckpointStore for a session from memory */
  clearSession(sessionID: SessionID): void
}

export type SessionResult =
  | { status: "ok"; message: Message.WithParts }
  | { status: "error"; error: unknown; message?: Message.WithParts }
  | { status: "aborted" }

export class SqliteCheckpointer implements Checkpointer {
  // Use a static map to share checkpoint stores across Checkpointer instances
  // within the same process, allowing HTTP endpoints to access in-memory checkpoints.
  private static readonly globalStores = new Map<SessionID, CheckpointStore>()

  async loadHistory(sessionID: SessionID): Promise<Message.WithParts[]> {
    return Message.filterCompacted(Message.stream(sessionID))
  }

  async write(ops: PersistenceOp[]): Promise<void> {
    for (const op of ops) {
      switch (op.type) {
        case "upsert-part":
          await Session.updatePart(op.part)
          break
        case "delta-part":
          await Session.updatePartDelta(op)
          break
        case "upsert-message":
          await Session.updateMessage(op.message)
          break
      }
    }
  }

  async saveMessage(msg: Message.Assistant | Message.User) {
    return Session.updateMessage(msg) as Promise<Message.Assistant | Message.User>
  }

  async savePart(part: Message.Part) {
    return Session.updatePart(part) as Promise<Message.Part>
  }

  async updateMessage(msg: Message.Assistant): Promise<void> {
    await Session.updateMessage(msg)
  }

  async deletePart(ref: { sessionID: SessionID; messageID: MessageID; partID: PartID }): Promise<void> {
    await Session.removePart(ref)
  }

  async dispose(): Promise<void> {
    // Note: In a real system we'd only clear stores for the active session.
    // Since CheckpointStore is session-scoped, we shouldn't clear all global stores
    // on dispose (which is called per-session). We leave cleanup to session deletion.
  }

  // ── Checkpoint lifecycle ──

  clearSession(sessionID: SessionID): void {
    SqliteCheckpointer.globalStores.delete(sessionID)
  }

  getCheckpointStore(sessionID: SessionID): CheckpointStore {
    let store = SqliteCheckpointer.globalStores.get(sessionID)
    if (!store) {
      store = new CheckpointStore(sessionID)
      SqliteCheckpointer.globalStores.set(sessionID, store)
    }
    return store
  }

  captureCheckpoint(sessionID: SessionID, data: CheckpointCaptureInput): CheckpointData {
    return this.getCheckpointStore(sessionID).capture(data)
  }

  getCheckpoint(sessionID: SessionID, checkpointID: string): CheckpointData | undefined {
    return this.getCheckpointStore(sessionID).get(checkpointID)
  }

  getCheckpointByStep(sessionID: SessionID, step: number): CheckpointData | undefined {
    return this.getCheckpointStore(sessionID).getByStep(step)
  }

  listCheckpoints(sessionID: SessionID): CheckpointData[] {
    return this.getCheckpointStore(sessionID).list()
  }

  truncateCheckpointsAfter(sessionID: SessionID, checkpointID: string): void {
    this.getCheckpointStore(sessionID).truncateAfter(checkpointID)
  }
}

export class MemoryCheckpointer implements Checkpointer {
  private messages = new Map<string, Message.WithParts[]>()
  private static readonly globalStores = new Map<SessionID, CheckpointStore>()

  async loadHistory(sessionID: SessionID): Promise<Message.WithParts[]> {
    return this.messages.get(sessionID) ?? []
  }

  async write(ops: PersistenceOp[]): Promise<void> {
    for (const op of ops) {
      switch (op.type) {
        case "upsert-part":
          await this.savePart(op.part)
          break
        case "upsert-message": {
          const msgs = this.messages.get(op.message.sessionID) ?? []
          const idx = msgs.findIndex((m) => m.info.id === op.message.id)
          if (idx >= 0) msgs[idx] = { ...msgs[idx], info: op.message }
          break
        }
        case "delta-part": {
          const msgs = this.messages.get(op.sessionID) ?? []
          for (const m of msgs) {
            const part = m.parts.find((p: Message.Part) => p.id === op.partID)
            if (part && op.field in part) {
              ;(part as Record<string, unknown>)[op.field] =
                (((part as Record<string, unknown>)[op.field] as string) ?? "") + op.delta
              break
            }
          }
          break
        }
      }
    }
  }

  async saveMessage(msg: Message.Assistant | Message.User) {
    const sid = msg.sessionID
    const msgs = this.messages.get(sid) ?? []
    msgs.push({ info: msg, parts: [] })
    this.messages.set(sid, msgs)
    return msg
  }

  async savePart(part: Message.Part) {
    const msgs = this.messages.get(part.sessionID) ?? []
    const msg = msgs.find((m) => m.info.id === part.messageID)
    if (msg) {
      const idx = msg.parts.findIndex((p: Message.Part) => p.id === part.id)
      if (idx >= 0) msg.parts[idx] = part
      else msg.parts.push(part)
    }
    return part
  }

  async updateMessage(msg: Message.Assistant): Promise<void> {
    const msgs = this.messages.get(msg.sessionID) ?? []
    const idx = msgs.findIndex((m) => m.info.id === msg.id)
    if (idx >= 0) msgs[idx] = { ...msgs[idx], info: msg }
  }

  async deletePart(ref: { sessionID: SessionID; messageID: MessageID; partID: PartID }): Promise<void> {
    const msgs = this.messages.get(ref.sessionID) ?? []
    const msg = msgs.find((m) => m.info.id === ref.messageID)
    if (msg) msg.parts = msg.parts.filter((p: Message.Part) => p.id !== ref.partID)
  }

  async dispose(): Promise<void> {
    this.messages.clear()
  }

  // ── Checkpoint lifecycle ──

  clearSession(sessionID: SessionID): void {
    MemoryCheckpointer.globalStores.delete(sessionID)
  }

  getCheckpointStore(sessionID: SessionID): CheckpointStore {
    let store = MemoryCheckpointer.globalStores.get(sessionID)
    if (!store) {
      store = new CheckpointStore(sessionID)
      MemoryCheckpointer.globalStores.set(sessionID, store)
    }
    return store
  }

  captureCheckpoint(sessionID: SessionID, data: CheckpointCaptureInput): CheckpointData {
    return this.getCheckpointStore(sessionID).capture(data)
  }

  getCheckpoint(sessionID: SessionID, checkpointID: string): CheckpointData | undefined {
    return this.getCheckpointStore(sessionID).get(checkpointID)
  }

  getCheckpointByStep(sessionID: SessionID, step: number): CheckpointData | undefined {
    return this.getCheckpointStore(sessionID).getByStep(step)
  }

  listCheckpoints(sessionID: SessionID): CheckpointData[] {
    return this.getCheckpointStore(sessionID).list()
  }

  truncateCheckpointsAfter(sessionID: SessionID, checkpointID: string): void {
    this.getCheckpointStore(sessionID).truncateAfter(checkpointID)
  }
}

export class NoopCheckpointer implements Checkpointer {
  async loadHistory(): Promise<Message.WithParts[]> {
    return []
  }
  async write(): Promise<void> {}
  async saveMessage(msg: Message.Assistant | Message.User) {
    return msg
  }
  async savePart(part: Message.Part) {
    return part
  }
  async updateMessage(): Promise<void> {}
  async deletePart(): Promise<void> {}
  async dispose(): Promise<void> {}

  // ── Checkpoint lifecycle (no-ops) ──
  clearSession(_sessionID: SessionID): void {}
  getCheckpointStore(sessionID: SessionID): CheckpointStore {
    return new CheckpointStore(sessionID)
  }
  captureCheckpoint(sessionID: SessionID, data: CheckpointCaptureInput): CheckpointData {
    return this.getCheckpointStore(sessionID).capture(data)
  }
  getCheckpoint(): CheckpointData | undefined {
    return undefined
  }
  getCheckpointByStep(): CheckpointData | undefined {
    return undefined
  }
  listCheckpoints(): CheckpointData[] {
    return []
  }
  truncateCheckpointsAfter(): void {}
}
===
import { Session } from "../.."
import { Message } from "../../message"
import type { MessageID, PartID, SessionID } from "../../schema"
import { type CheckpointCaptureInput, type CheckpointData, CheckpointStore } from "./checkpoint-store"
export type PersistenceOp =
  | { type: "upsert-part"; part: Message.Part }
  | {
      type: "delta-part"
      sessionID: SessionID
      messageID: MessageID
      partID: PartID
      field: string
      delta: string
    }
  | { type: "upsert-message"; message: Message.Assistant }

export interface Checkpointer {
  loadHistory(sessionID: SessionID): Promise<Message.WithParts[]>
  write(ops: PersistenceOp[]): Promise<void>
  saveMessage(msg: Message.Assistant | Message.User): Promise<Message.Assistant | Message.User>
  savePart(part: Message.Part): Promise<Message.Part>
  updateMessage(msg: Message.Assistant): Promise<void>
  deletePart(ref: { sessionID: SessionID; messageID: MessageID; partID: PartID }): Promise<void>
  dispose(): Promise<void>

  // ── Checkpoint lifecycle (Phase 5: Backward Execution) ──
  captureCheckpoint(sessionID: SessionID, data: CheckpointCaptureInput): CheckpointData
  getCheckpoint(sessionID: SessionID, checkpointID: string): CheckpointData | undefined
  getCheckpointByStep(sessionID: SessionID, step: number): CheckpointData | undefined
  listCheckpoints(sessionID: SessionID): CheckpointData[]
  truncateCheckpointsAfter(sessionID: SessionID, checkpointID: string): void
  /** Returns the CheckpointStore for a session, creating one if it doesn't exist */
  getCheckpointStore(sessionID: SessionID): CheckpointStore
  /** Clears the CheckpointStore for a session from memory */
  clearSession(sessionID: SessionID): void
}

export type SessionResult =
  | { status: "ok"; message: Message.WithParts }
  | { status: "error"; error: unknown; message?: Message.WithParts }
  | { status: "aborted" }

export class SqliteCheckpointer implements Checkpointer {
  // Use a static map to share checkpoint stores across Checkpointer instances
  // within the same process, allowing HTTP endpoints to access in-memory checkpoints.
  private static readonly globalStores = new Map<SessionID, CheckpointStore>()

  async loadHistory(sessionID: SessionID): Promise<Message.WithParts[]> {
    return Message.filterCompacted(Message.stream(sessionID))
  }

  async write(ops: PersistenceOp[]): Promise<void> {
    for (const op of ops) {
      switch (op.type) {
        case "upsert-part":
          await Session.updatePart(op.part)
          break
        case "delta-part":
          await Session.updatePartDelta(op)
          break
        case "upsert-message":
          await Session.updateMessage(op.message)
          break
      }
    }
  }

  async saveMessage(msg: Message.Assistant | Message.User) {
    return Session.updateMessage(msg) as Promise<Message.Assistant | Message.User>
  }

  async savePart(part: Message.Part) {
    return Session.updatePart(part) as Promise<Message.Part>
  }

  async updateMessage(msg: Message.Assistant): Promise<void> {
    await Session.updateMessage(msg)
  }

  async deletePart(ref: { sessionID: SessionID; messageID: MessageID; partID: PartID }): Promise<void> {
    await Session.removePart(ref)
  }

  async dispose(): Promise<void> {
    // Note: In a real system we'd only clear stores for the active session.
    // Since CheckpointStore is session-scoped, we shouldn't clear all global stores
    // on dispose (which is called per-session). We leave cleanup to session deletion.
  }

  // ── Checkpoint lifecycle ──

  clearSession(sessionID: SessionID): void {
    SqliteCheckpointer.globalStores.delete(sessionID)
  }

  getCheckpointStore(sessionID: SessionID): CheckpointStore {
    let store = SqliteCheckpointer.globalStores.get(sessionID)
    if (!store) {
      store = new CheckpointStore(sessionID)
      SqliteCheckpointer.globalStores.set(sessionID, store)
    }
    return store
  }

  captureCheckpoint(sessionID: SessionID, data: CheckpointCaptureInput): CheckpointData {
    return this.getCheckpointStore(sessionID).capture(data)
  }

  getCheckpoint(sessionID: SessionID, checkpointID: string): CheckpointData | undefined {
    return this.getCheckpointStore(sessionID).get(checkpointID)
  }

  getCheckpointByStep(sessionID: SessionID, step: number): CheckpointData | undefined {
    return this.getCheckpointStore(sessionID).getByStep(step)
  }

  listCheckpoints(sessionID: SessionID): CheckpointData[] {
    return this.getCheckpointStore(sessionID).list()
  }

  truncateCheckpointsAfter(sessionID: SessionID, checkpointID: string): void {
    this.getCheckpointStore(sessionID).truncateAfter(checkpointID)
  }
}

export class MemoryCheckpointer implements Checkpointer {
  private messages = new Map<string, Message.WithParts[]>()
  private static readonly globalStores = new Map<SessionID, CheckpointStore>()

  async loadHistory(sessionID: SessionID): Promise<Message.WithParts[]> {
    return this.messages.get(sessionID) ?? []
  }

  async write(ops: PersistenceOp[]): Promise<void> {
    for (const op of ops) {
      switch (op.type) {
        case "upsert-part":
          await this.savePart(op.part)
          break
        case "upsert-message": {
          const msgs = this.messages.get(op.message.sessionID) ?? []
          const idx = msgs.findIndex((m) => m.info.id === op.message.id)
          if (idx >= 0) msgs[idx] = { ...msgs[idx], info: op.message }
          break
        }
        case "delta-part": {
          const msgs = this.messages.get(op.sessionID) ?? []
          for (const m of msgs) {
            const part = m.parts.find((p: Message.Part) => p.id === op.partID)
            if (part && op.field in part) {
              ;(part as Record<string, unknown>)[op.field] =
                (((part as Record<string, unknown>)[op.field] as string) ?? "") + op.delta
              break
            }
          }
          break
        }
      }
    }
  }

  async saveMessage(msg: Message.Assistant | Message.User) {
    const sid = msg.sessionID
    const msgs = this.messages.get(sid) ?? []
    msgs.push({ info: msg, parts: [] })
    this.messages.set(sid, msgs)
    return msg
  }

  async savePart(part: Message.Part) {
    const msgs = this.messages.get(part.sessionID) ?? []
    const msg = msgs.find((m) => m.info.id === part.messageID)
    if (msg) {
      const idx = msg.parts.findIndex((p: Message.Part) => p.id === part.id)
      if (idx >= 0) msg.parts[idx] = part
      else msg.parts.push(part)
    }
    return part
  }

  async updateMessage(msg: Message.Assistant): Promise<void> {
    const msgs = this.messages.get(msg.sessionID) ?? []
    const idx = msgs.findIndex((m) => m.info.id === msg.id)
    if (idx >= 0) msgs[idx] = { ...msgs[idx], info: msg }
  }

  async deletePart(ref: { sessionID: SessionID; messageID: MessageID; partID: PartID }): Promise<void> {
    const msgs = this.messages.get(ref.sessionID) ?? []
    const msg = msgs.find((m) => m.info.id === ref.messageID)
    if (msg) msg.parts = msg.parts.filter((p: Message.Part) => p.id !== ref.partID)
  }

  async dispose(): Promise<void> {
    this.messages.clear()
  }

  // ── Checkpoint lifecycle ──

  clearSession(sessionID: SessionID): void {
    MemoryCheckpointer.globalStores.delete(sessionID)
  }

  getCheckpointStore(sessionID: SessionID): CheckpointStore {
    let store = MemoryCheckpointer.globalStores.get(sessionID)
    if (!store) {
      store = new CheckpointStore(sessionID)
      MemoryCheckpointer.globalStores.set(sessionID, store)
    }
    return store
  }

  captureCheckpoint(sessionID: SessionID, data: CheckpointCaptureInput): CheckpointData {
    return this.getCheckpointStore(sessionID).capture(data)
  }

  getCheckpoint(sessionID: SessionID, checkpointID: string): CheckpointData | undefined {
    return this.getCheckpointStore(sessionID).get(checkpointID)
  }

  getCheckpointByStep(sessionID: SessionID, step: number): CheckpointData | undefined {
    return this.getCheckpointStore(sessionID).getByStep(step)
  }

  listCheckpoints(sessionID: SessionID): CheckpointData[] {
    return this.getCheckpointStore(sessionID).list()
  }

  truncateCheckpointsAfter(sessionID: SessionID, checkpointID: string): void {
    this.getCheckpointStore(sessionID).truncateAfter(checkpointID)
  }
}

export class NoopCheckpointer implements Checkpointer {
  async loadHistory(): Promise<Message.WithParts[]> {
    return []
  }
  async write(): Promise<void> {}
  async saveMessage(msg: Message.Assistant | Message.User) {
    return msg
  }
  async savePart(part: Message.Part) {
    return part
  }
  async updateMessage(): Promise<void> {}
  async deletePart(): Promise<void> {}
  async dispose(): Promise<void> {}

  // ── Checkpoint lifecycle ──
  // Design: Write operations throw (§5 fail-fast — silently discarding checkpoint
  // data is a hidden failure). Read operations return empty results (correct: no
  // data was ever stored). Cleanup operations are no-ops (nothing to clean up).

  clearSession(_sessionID: SessionID): void {
    // No-op: nothing stored, nothing to clear.
  }
  getCheckpointStore(_sessionID: SessionID): CheckpointStore {
    throw new Error(
      "NoopCheckpointer does not support checkpoint storage — use SqliteCheckpointer or MemoryCheckpointer for step-level debugging",
    )
  }
  captureCheckpoint(_sessionID: SessionID, _data: CheckpointCaptureInput): CheckpointData {
    throw new Error(
      "NoopCheckpointer does not support checkpoint capture — use SqliteCheckpointer or MemoryCheckpointer for step-level debugging",
    )
  }
  getCheckpoint(): CheckpointData | undefined {
    return undefined
  }
  getCheckpointByStep(): CheckpointData | undefined {
    return undefined
  }
  listCheckpoints(): CheckpointData[] {
    return []
  }
  truncateCheckpointsAfter(): void {
    // No-op: nothing stored, nothing to truncate.
  }
}
```

### [step-back.ts](file:///d:/liteai/packages/core/src/session/step-back.ts)

```diff:step-back.ts
import z from "zod"
import type { ModelID, ProviderID } from "@/provider/schema"
import { Database, eq } from "@/storage/db"
import { Bus } from "../bus"
import { Snapshot } from "../snapshot"
import { Session } from "."
import { SessionPrompt } from "./engine"
import { SqliteCheckpointer } from "./engine/loop/checkpointer"
import { Message } from "./message"
import { MessageID, PartID, SessionID } from "./schema"
import { MessageTable, SessionTable } from "./session.sql"

export const StepBackInput = z.object({
  sessionID: SessionID.zod,
  checkpointID: z.string(),
  guidance: z.string().optional(),
})
export type StepBackInput = z.infer<typeof StepBackInput>

export class FileConflictError extends Error {
  constructor(public conflicts: string[]) {
    super(`File conflict: Workspace files have been modified since the checkpoint: ${conflicts.join(", ")}`)
    this.name = "FileConflictError"
  }
}

export class CheckpointNotFoundError extends Error {
  constructor(public checkpointID: string) {
    super(`Checkpoint not found: ${checkpointID}`)
    this.name = "CheckpointNotFoundError"
  }
}

export async function stepBack(input: StepBackInput) {
  SessionPrompt.assertNotBusy(input.sessionID)

  // 2. Retrieve checkpoint
  const checkpointer = new SqliteCheckpointer()
  const checkpoint = checkpointer.getCheckpoint(input.sessionID, input.checkpointID)
  if (!checkpoint) {
    throw new CheckpointNotFoundError(input.checkpointID)
  }

  // Defensive guard against empty message state (should never happen)
  if (checkpoint.messages.length === 0) {
    throw new Error("Invalid checkpoint: Message state is empty")
  }

  // 3. Conflict detection
  // If snapshot is undefined (e.g. step 1), skip conflict detection and restore.
  if (checkpoint.snapshot) {
    await Snapshot.track().catch((e) => {
      throw new Error(
        `Cannot perform conflict detection: Workspace snapshot tracking failed. ${e instanceof Error ? e.message : String(e)}`,
      )
    })
    const patch = await Snapshot.patch(checkpoint.snapshot)
    if (patch.files.length > 0) {
      throw new FileConflictError(patch.files)
    }

    // 4. Restore file state
    await Snapshot.restore(checkpoint.snapshot)
  }

  // 5. Truncate messages in DB
  const msgs = await Session.messages({ sessionID: input.sessionID })
  const checkpointMessageIDs = new Set(checkpoint.messages.map((m) => m.info.id))

  // Find the first message ID that is NOT in the checkpoint
  const firstMessageToRemove = msgs.find((m) => !checkpointMessageIDs.has(m.info.id))

  if (firstMessageToRemove) {
    const removeStartID = firstMessageToRemove.info.id
    const remove = msgs.filter((m) => m.info.id >= removeStartID)

    for (const msg of remove) {
      Database.use((db) => db.delete(MessageTable).where(eq(MessageTable.id, msg.info.id)).run())
      await Bus.publish(Message.Event.Removed, { sessionID: input.sessionID, messageID: msg.info.id })
    }
  }

  // 6. Truncate checkpoints
  checkpointer.truncateCheckpointsAfter(input.sessionID, input.checkpointID)

  // 7. Detect orphaned children
  const children = Database.use((db) =>
    db.select().from(SessionTable).where(eq(SessionTable.parent_id, input.sessionID)).all(),
  )
  const orphanedChildren = children.filter((c) => c.time_created > checkpoint.timestamp).map((c) => c.id)

  // 8. Inject guidance
  if (input.guidance) {
    const messageID = MessageID.ascending()

    await Session.updateMessage({
      id: messageID,
      sessionID: input.sessionID,
      role: "user",
      agent: "unknown",
      variant: "default",
      time: { created: Date.now() },
      model: { providerID: "unknown" as ProviderID, modelID: "unknown" as ModelID },
    })

    await Session.updatePart({
      id: PartID.ascending(),
      sessionID: input.sessionID,
      messageID: messageID,
      type: "text",
      text: input.guidance,
      synthetic: true,
    })
  }

  // 9. Emit events
  const session = await Session.get(input.sessionID)
  Bus.publish(Session.Event.Updated, { info: session })

  // 10. Return result
  return {
    restored: true,
    step: checkpoint.step,
    orphanedChildren,
  }
}
===
import { NamedError } from "@liteai/util/error"
import z from "zod"
import type { ModelID, ProviderID } from "@/provider/schema"
import { Database, eq } from "@/storage/db"
import { Bus } from "../bus"
import { Snapshot } from "../snapshot"
import { Session } from "."
import { SessionPrompt } from "./engine"
import type { Checkpointer } from "./engine/loop/checkpointer"
import { CheckpointNotFoundError } from "./engine/loop/checkpoint-store"
import { Message } from "./message"
import { MessageID, PartID, SessionID } from "./schema"
import { MessageTable, SessionTable } from "./session.sql"

export const StepBackInput = z.object({
  sessionID: SessionID.zod,
  checkpointID: z.string(),
  guidance: z.string().optional(),
})
export type StepBackInput = z.infer<typeof StepBackInput>

// ─── Errors (NamedError-based for structured error handling per §5) ──────────

const FileConflictData = z.object({
  message: z.string(),
  conflicts: z.array(z.string()),
})
export class FileConflictError extends NamedError.create("FileConflictError", FileConflictData) {
  constructor(conflicts: string[]) {
    super({
      message: `File conflict: Workspace files have been modified since the checkpoint: ${conflicts.join(", ")}`,
      conflicts,
    })
  }
}

// Re-export from checkpoint-store for route handler convenience
export { CheckpointNotFoundError } from "./engine/loop/checkpoint-store"

/**
 * Perform a destructive step-back to a prior checkpoint.
 *
 * @param input - Step-back parameters (sessionID, checkpointID, optional guidance)
 * @param injectedCheckpointer - Optional Checkpointer for DI/testing.
 *   When omitted, lazily instantiates SqliteCheckpointer (production default).
 */
export async function stepBack(input: StepBackInput, injectedCheckpointer?: Checkpointer) {
  SessionPrompt.assertNotBusy(input.sessionID)

  // 2. Resolve checkpointer — lazy default avoids top-level import of concrete class
  const checkpointer = injectedCheckpointer ?? new (await import("./engine/loop/checkpointer")).SqliteCheckpointer()
  const checkpoint = checkpointer.getCheckpoint(input.sessionID, input.checkpointID)
  if (!checkpoint) {
    throw new CheckpointNotFoundError({ checkpointID: input.checkpointID, sessionID: input.sessionID })
  }

  // Defensive guard against empty message state (should never happen)
  if (checkpoint.messages.length === 0) {
    throw new Error("Invalid checkpoint: Message state is empty")
  }

  // 3. Conflict detection: detect EXTERNAL modifications only.
  // Agent-produced changes between checkpoints are expected (the agent wrote them
  // in subsequent steps — they will be undone by the restore). External modifications
  // are changes made to the working tree AFTER the last agent step (latest checkpoint).
  //
  // Algorithm:
  //   - Compare current working tree against the LATEST checkpoint's snapshot
  //   - If files differ → those were modified externally → conflict
  //   - If no diff → safe to restore to target checkpoint
  //
  // If snapshot is undefined on the target (e.g. step 1), skip restore but still
  // perform conflict detection against the latest checkpoint.
  const allCheckpoints = checkpointer.listCheckpoints(input.sessionID)
  const latestCheckpoint = allCheckpoints.length > 0 ? allCheckpoints[allCheckpoints.length - 1] : undefined

  if (latestCheckpoint?.snapshot) {
    await Snapshot.track().catch((e) => {
      throw new Error(
        `Cannot perform conflict detection: Workspace snapshot tracking failed. ${e instanceof Error ? e.message : String(e)}`,
      )
    })
    const patch = await Snapshot.patch(latestCheckpoint.snapshot)
    if (patch.files.length > 0) {
      throw new FileConflictError(patch.files)
    }
  }

  // 4. Restore file state to the TARGET checkpoint's snapshot
  if (checkpoint.snapshot) {
    await Snapshot.restore(checkpoint.snapshot)
  }

  // 5. Truncate messages in DB
  const msgs = await Session.messages({ sessionID: input.sessionID })
  const checkpointMessageIDs = new Set(checkpoint.messages.map((m) => m.info.id))

  // Find the first message ID that is NOT in the checkpoint
  const firstMessageToRemove = msgs.find((m) => !checkpointMessageIDs.has(m.info.id))

  if (firstMessageToRemove) {
    const removeStartID = firstMessageToRemove.info.id
    // MessageID.ascending() generates ULID-based IDs with lexicographic ordering.
    // This >= comparison relies on that monotonic encoding contract.
    const remove = msgs.filter((m) => m.info.id >= removeStartID)

    for (const msg of remove) {
      Database.use((db) => db.delete(MessageTable).where(eq(MessageTable.id, msg.info.id)).run())
      await Bus.publish(Message.Event.Removed, { sessionID: input.sessionID, messageID: msg.info.id })
    }
  }

  // 6. Truncate checkpoints
  checkpointer.truncateCheckpointsAfter(input.sessionID, input.checkpointID)

  // 7. Detect orphaned children
  const children = Database.use((db) =>
    db.select().from(SessionTable).where(eq(SessionTable.parent_id, input.sessionID)).all(),
  )
  const orphanedChildren = children.filter((c) => c.time_created > checkpoint.timestamp).map((c) => c.id)

  // 8. Inject guidance
  if (input.guidance) {
    const messageID = MessageID.ascending()

    await Session.updateMessage({
      id: messageID,
      sessionID: input.sessionID,
      role: "user",
      agent: "unknown",
      variant: "default",
      time: { created: Date.now() },
      model: { providerID: "unknown" as ProviderID, modelID: "unknown" as ModelID },
    })

    await Session.updatePart({
      id: PartID.ascending(),
      sessionID: input.sessionID,
      messageID: messageID,
      type: "text",
      text: input.guidance,
      synthetic: true,
    })
  }

  // 9. Emit events
  const session = await Session.get(input.sessionID)
  Bus.publish(Session.Event.Updated, { info: session })

  // 10. Return result
  return {
    restored: true,
    step: checkpoint.step,
    orphanedChildren,
  }
}
```

### [loop.ts](file:///d:/liteai/packages/core/src/session/engine/loop.ts)

```diff:loop.ts
import { Log } from "@liteai/util/log"
import { trace } from "@opentelemetry/api"
import { ulid } from "ulid"
import z from "zod"
import { Bus } from "@/bus"
import { BackgroundTaskRegistry } from "@/command/background"
import { PermissionNext } from "@/permission/next"
import { TaskTool } from "@/tool/task"
import type { Tool } from "@/tool/tool"
import { fn } from "@/util/fn"
import { Agent } from "../../agent/agent"
import { isRootAgent } from "../../agent/context"
import { Plugin } from "../../plugin"
import { Instance } from "../../project/instance"
import { Provider } from "../../provider/provider"
import { ModelID, ProviderID } from "../../provider/schema"
import { defer } from "../../util/defer"
import { Session } from ".."
import type { EngineEvent } from "../events"
import { Message } from "../message"
import { createDefaultPlanModeState, PlanModeStateRef } from "../plan-mode-state"
import { SessionRetry } from "../retry"
import { SessionRevert } from "../revert"
import { MessageID, PartID, SessionID } from "../schema"
import { SessionStatus } from "../status"
import { SessionSummary } from "../tasks/summary"
import { CompactionOrchestrator } from "./compaction-orchestrator"
import { CorrectionInjector } from "./correction-injector"
import { createUserMessage } from "./input"
import { InstructionPrompt } from "./instruction"
import { type Checkpointer, type SessionResult, SqliteCheckpointer } from "./loop/checkpointer"
import { PromiseTracker } from "./loop/promise-tracker"
import type { ResumePayload } from "./loop/step-latch"
import { SessionNotPausedError, type StepLatchHandle, StepPauseLatch } from "./loop/step-latch"
import { type LoopDetectionResult, LoopType } from "./loop-detection"
import { EventPersister } from "./persister"
import { queryLoop } from "./query"
import type { TelemetryTracker } from "./telemetry"

globalThis.AI_SDK_LOG_WARNINGS = false

const log = Log.create({ service: "session.engine" })

type SessionState = Record<
  string,
  {
    abort: AbortController
    callbacks: {
      resolve(input: Message.WithParts): void
      reject(reason?: unknown): void
    }[]
    /** Active step-pause latch — present only while the session is paused in step mode */
    stepLatch?: StepLatchHandle
    /** Mutable ref to the step mode flag — can be toggled by resume API */
    stepModeRef?: { current: boolean }
  }
>

const _state = Instance.state(
  () => {
    const data: SessionState = {}
    return data
  },
  async (current) => {
    for (const [id, item] of Object.entries(current)) {
      log.info("state cleanup aborting session", { sessionID: id })
      try {
        item.abort.abort()
      } catch {
        // Swallowed — see safeAbort() for full explanation of the Bun quirk
      }
    }
  },
)

export function state() {
  return _state()
}

export function assertNotBusy(sessionID: SessionID) {
  const match = state()[sessionID]
  if (match) throw new Session.BusyError(sessionID)
}

export const PromptInput = z.object({
  sessionID: SessionID.zod,
  messageID: MessageID.zod.optional(),
  model: z
    .object({
      providerID: ProviderID.zod,
      modelID: ModelID.zod,
    })
    .optional(),
  agent: z.string().optional(),
  noReply: z.boolean().optional(),
  format: Message.Format.optional(),
  system: z.string().optional(),
  variant: z.string().optional(),
  /** Enable step-by-step execution — loop pauses after each iteration */
  stepMode: z.boolean().optional(),
  parts: z.array(
    z.discriminatedUnion("type", [
      Message.TextPart.omit({
        messageID: true,
        sessionID: true,
      })
        .partial({
          id: true,
        })
        .meta({
          ref: "TextPartInput",
        }),
      Message.FilePart.omit({
        messageID: true,
        sessionID: true,
      })
        .partial({
          id: true,
        })
        .meta({
          ref: "FilePartInput",
        }),
      Message.AgentPart.omit({
        messageID: true,
        sessionID: true,
      })
        .partial({
          id: true,
        })
        .meta({
          ref: "AgentPartInput",
        }),
      Message.SubtaskPart.omit({
        messageID: true,
        sessionID: true,
      })
        .partial({
          id: true,
        })
        .meta({
          ref: "SubtaskPartInput",
        }),
    ]),
  ),
})
export type PromptInput = z.infer<typeof PromptInput>

export const prompt = fn(PromptInput, async (input) => {
  const session = await Session.get(input.sessionID)
  await SessionRevert.cleanup(session)

  const message = await createUserMessage(input)
  await Session.touch(input.sessionID)

  if (input.noReply === true) {
    return message
  }

  return await loop({ sessionID: input.sessionID, stepMode: input.stepMode })
})

export const runSubagent = fn(PromptInput, async (input) => {
  const session = await Session.get(input.sessionID)
  await SessionRevert.cleanup(session)

  await createUserMessage(input)
  await Session.touch(input.sessionID)

  if (input.noReply === true) {
    throw new Error("runSubagent does not support noReply — subagents must always produce a result")
  }

  const { sessionID } = input
  const abort = start(sessionID)
  if (!abort) {
    return { status: "error", error: new Error("Session busy") } as SessionResult
  }

  const registry = new BackgroundTaskRegistry()
  const tracker = new PromiseTracker()

  await using _ = defer(async () => {
    await tracker.flush().catch((e: unknown) => {
      log.error("runSubagent tracker.flush() failed during cleanup", { error: e, sessionID })
    })
    await registry.disposeAll()
    cleanup(sessionID)
  })

  const checkpointer = new SqliteCheckpointer()
  return await runSession({ sessionID, session, abort, registry, checkpointer, tracker })
})

export function start(sessionID: SessionID) {
  const s = state()
  if (s[sessionID]) {
    log.info("start: session already active, queuing", { sessionID })
    return
  }
  log.info("start", { sessionID })

  const controller = new AbortController()
  s[sessionID] = {
    abort: controller,
    callbacks: [],
  }
  return controller.signal
}

function resume(sessionID: SessionID) {
  const s = state()
  if (!s[sessionID]) return

  return s[sessionID].abort.signal
}

/**
 * Resume a session that is paused in step mode.
 * Resolves the pending step-pause latch, unblocking the loop.
 */
export function resumeStepMode(sessionID: SessionID, payload: ResumePayload) {
  const s = state()
  const match = s[sessionID]
  if (!match || !match.stepLatch) {
    throw new SessionNotPausedError({ sessionID })
  }
  match.stepLatch.resolve(payload)
  // Clear the latch reference — the loop will create a new one on next pause
  match.stepLatch = undefined
}

export function cancel(sessionID: SessionID) {
  log.info("cancel", { sessionID })
  const s = state()
  const match = s[sessionID]
  if (!match) {
    SessionStatus.set(sessionID, { type: "idle" })
    return
  }
  safeAbort(match.abort, sessionID)
}

/**
 * Safely abort an AbortController, swallowing any errors thrown by
 * abort event listeners added by providers.
 *
 * ## Bun Runtime Discovery (April 2026, Bun v1.3.x)
 *
 * When an EventTarget listener throws during `AbortController.abort()`,
 * Bun exhibits three behaviors simultaneously:
 *
 * 1. **JS-level propagation**: The error propagates through `abort()` and
 *    CAN be caught by a standard `try/catch` — so `cancel()` doesn't crash
 *    at the JS level.
 *
 * 2. **Native error reporting**: Bun's C++ EventTarget dispatcher ALSO
 *    reports the error through its internal error pipeline, printing the
 *    error to stderr independently of JS exception handling.
 *
 * 3. **Exit code 1**: Bun sets the process exit code to 1 regardless of
 *    whether JS caught the error.
 *
 * Because of (2) and (3), a simple `try/catch` around `abort()` is
 * insufficient — the process still crashes with exit code 1.
 *
 * **What doesn't work:**
 * - `try/catch` around `abort()` — catches the JS error but Bun still
 *   reports it natively and exits with code 1.
 * - Overriding `signal.dispatchEvent()` — Bun's native `abort()` bypasses
 *   the JS `dispatchEvent` method entirely, calling listeners at the C++ level.
 * - `globalThis.addEventListener("error")` — Bun reports the error at a
 *   level below the global error event.
 *
 * **What works:**
 * - `process.on("uncaughtException")` — This is the ONLY mechanism that
 *   intercepts Bun's native error pipeline. Installing a temporary handler
 *   before `abort()` prevents both the error output and the exit code 1.
 *
 * ## Why this matters
 *
 * Provider SDKs add abort listeners on the signal to do cleanup work
 * (e.g., google-code-assist's `sourceStream.destroy()`, `rl.close()`).
 * If those listeners throw — which is common during stream teardown —
 * the process crashes even though the abort itself succeeded.
 */
function safeAbort(controller: AbortController, sessionID: string) {
  const errors: unknown[] = []

  // Install a temporary uncaughtException handler to suppress Bun's
  // native error reporting during abort(). This is the ONLY mechanism
  // that prevents Bun from setting exit code 1 (see discovery above).
  const suppressHandler = (err: Error) => {
    errors.push(err)
  }
  process.on("uncaughtException", suppressHandler)

  try {
    log.info("session/loop abort: controller.abort()", { sessionID })
    controller.abort()
  } catch (e: unknown) {
    errors.push(e)
  } finally {
    process.removeListener("uncaughtException", suppressHandler)
  }

  if (errors.length > 0) {
    for (const e of errors) {
      log.info("cancel: abort listener threw (swallowed)", {
        sessionID,
        error: e instanceof Error ? e.message : String(e),
        name: e instanceof DOMException ? (e as DOMException).name : undefined,
      })
    }
  }
}

/**
 * Cleans up session state after the processor has finished flushing.
 * Called by the deferred cleanup in loop(), NOT by the cancel API.
 */
function cleanup(sessionID: SessionID) {
  log.info("cleanup", { sessionID })

  // Deregister the in-memory PlanModeStateRef for this session.
  // Safe to call even if no ref was registered (e.g., early abort before runSession).
  if (PlanModeStateRef.has(sessionID)) {
    PlanModeStateRef.for(sessionID).deregister()
  }

  const s = state()
  delete s[sessionID]
  SessionStatus.set(sessionID, { type: "idle" })

  // Clear the in-memory checkpoint store for this session to prevent leaks
  import("./loop/checkpointer")
    .then((m) => {
      new m.SqliteCheckpointer().clearSession(sessionID)
    })
    .catch(() => {})
}

export async function lastModel(sessionID: SessionID) {
  for await (const item of Message.stream(sessionID)) {
    if (item.info.role === "user" && item.info.model) {
      const m = item.info.model
      if (m.providerID === "unknown" || m.modelID === "unknown") {
        log.warn("lastModel: found stored message with unknown model identifier — skipping", {
          sessionID,
          messageID: item.info.id,
          providerID: m.providerID,
          modelID: m.modelID,
        })
        continue
      }
      return m
    }
  }
  const result = await Provider.defaultModel()
  if (!result) throw new Error("no model available: connect a provider first")
  return result
}

export const LoopInput = z.object({
  sessionID: SessionID.zod,
  resume_existing: z.boolean().optional(),
  stepMode: z.boolean().optional(),
})

// ─── runSession: The Event-Sourced Orchestrator ─────────────────────────────
//
// Consumes the queryLoop async generator and routes events to the appropriate
// handlers. All SQLite writes flow through EventPersister or direct Session.*
// calls here — the generator never writes to the database.
//
// Event routing:
//   turn-start  → persist assistant message, create EventPersister
//   stream events → persister.handleEvent()
//   turn-end    → persister.flush(), handle structured output/compaction
//   control     → trigger compaction, process subtasks, handle overflow
//   tombstone   → flush persister to clean up orphaned message

async function runSession(input: {
  sessionID: SessionID
  session: Session.Info
  abort: AbortSignal
  registry: BackgroundTaskRegistry
  checkpointer: Checkpointer
  tracker: PromiseTracker
  stepModeRef?: { current: boolean }
}) {
  const tracer = trace.getTracer("liteai")

  // Resolve the first user message text to use as the trace name/input in Langfuse
  const msgs = await Message.filterCompacted(Message.stream(input.sessionID))
  const firstUserText = msgs
    .findLast((m) => m.info.role === "user")
    ?.parts.filter((p) => p.type === "text")
    .map((p) => (p as { text: string }).text)
    .join(" ")
    .slice(0, 200)

  return tracer.startActiveSpan(
    "LiteAI", // Hardcode trace name to LiteAI to fix the "Unnamed trace" issue
    {
      attributes: {
        "langfuse.session.id": input.sessionID,
        "input.value": firstUserText || "No user input",
        "session.title": input.session.title ?? "",
        "langfuse.internal.as_root": true,
      },
    },
    async (sessionSpan) => {
      try {
        const result = await runSessionInner(input)
        return result
      } catch (e) {
        sessionSpan.recordException(e as Error)
        throw e
      } finally {
        const finalMsgs = await Message.filterCompacted(Message.stream(input.sessionID))
        const lastAssistant = finalMsgs.findLast((m) => m.info.role === "assistant")
        const outputText = lastAssistant?.parts
          .filter((p) => p.type === "text")
          .map((p) => (p as { text: string }).text)
          .join(" ")
          .slice(0, 500)

        if (outputText) {
          sessionSpan.setAttribute("output.value", outputText)
        }
        sessionSpan.end()
      }
    },
  )
}

async function runSessionInner(input: {
  sessionID: SessionID
  session: Session.Info
  abort: AbortSignal
  registry: BackgroundTaskRegistry
  checkpointer: Checkpointer
  tracker: PromiseTracker
  stepModeRef?: { current: boolean }
}) {
  const isAbortError = (e: unknown): e is DOMException => e instanceof DOMException && e.name === "AbortError"
  const { sessionID, session, abort, tracker } = input

  let persister: EventPersister | undefined
  let currentAssistantMessage: Message.Assistant | undefined
  let currentStreamResult: unknown
  let currentTurnCache: { system: string[] | string; tools: Record<string, unknown> } | undefined

  // Loop detection recovery state — persisted across turns for escalation
  let loopDetectionCount = 0
  let pendingLoopRecovery: LoopDetectionResult | undefined

  // ── PlanModeState: in-memory ref, lifecycle-bound to this session ──
  // Created once at session start with defaults. No DB read.
  const planModeStateRef = new PlanModeStateRef(createDefaultPlanModeState(session), sessionID)
  planModeStateRef.register()

  // ── Phase 2+3 services: decoupled persistence and extracted concerns ──
  const compactionOrchestrator = new CompactionOrchestrator(sessionID)
  const correctionInjector = new CorrectionInjector(sessionID)

  // Step mode: mutable ref so the resume API can toggle it externally
  const stepModeRef = input.stepModeRef ?? { current: false }

  // Store stepModeRef on SessionState so resume API can access it
  const sessionEntry = state()[sessionID]
  if (sessionEntry) {
    sessionEntry.stepModeRef = stepModeRef
  }

  // Single one-time DB read — after this the buffer is the live message view (FR-1)
  const msgsBuffer: { current: Message.WithParts[] } = {
    current: await input.checkpointer.loadHistory(sessionID),
  }

  const generator = queryLoop({
    sessionID,
    session,
    abort,
    msgsBuffer,
    planModeStateRef,
    backgroundTaskRegistry: input.registry,
    stepModeRef,
    checkpointer: input.checkpointer,
  })

  try {
    for await (const event of generator) {
      switch (event.type) {
        // ── Turn Start: persist assistant message, create persister ──
        case "turn-start": {
          currentAssistantMessage = event.assistantMessage
          tracker.track(input.checkpointer.saveMessage(currentAssistantMessage))

          // Create fresh persister for this turn
          persister = new EventPersister(currentAssistantMessage, sessionID, event.model, abort)

          // Set up instruction prompt cleanup
          // Note: InstructionPrompt.clear will be called in turn-end
          SessionStatus.set(sessionID, { type: "busy" })

          currentTurnCache = {
            system: event.streamInput.system,
            tools: event.streamInput.tools,
          }

          // Fire-and-forget summary on first turn
          const lastUser = event.streamInput.user
          if (lastUser && isRootAgent()) {
            SessionSummary.summarize({
              sessionID,
              messageID: lastUser.id,
            })
          }
          break
        }

        // ── Turn End: flush persister, handle result ──
        case "turn-end": {
          if (!persister || !currentAssistantMessage) break

          // Capture raw SDK stream result for partial token recovery on error
          currentStreamResult = event.streamResult

          // Flush the persister
          const flushResult = await persister.flush(currentStreamResult)
          currentStreamResult = undefined

          // Drain accumulated writes and persist to DB
          const flushOps = persister.drainWrites()
          if (flushOps.length > 0) {
            tracker.track(input.checkpointer.write(flushOps))
          }

          // Update in-memory buffer with this turn's completed message (FR-3, no DB read)
          msgsBuffer.current = [...msgsBuffer.current, persister.getCompletedMessage()]

          // ── Loop recovery: handle pending detection after flush ──
          if (pendingLoopRecovery) {
            const recovery = pendingLoopRecovery
            pendingLoopRecovery = undefined

            // Strip incomplete thinking parts from DB (critical for Code Assist API —
            // partial thought blocks without thoughtSignature cause 400 errors on retry)
            await stripIncompleteThinking({
              sessionID,
              message: currentAssistantMessage,
              msgsBuffer,
              checkpointer: input.checkpointer,
              tracker,
            })

            // Escalation strategy
            if (loopDetectionCount >= 3) {
              log.warn("loop escalation: max retries reached, stopping session", {
                sessionID,
                count: loopDetectionCount,
              })
              return { status: "error", error: new Error("loop escalation: max retries reached") } as SessionResult
            }

            // Inject corrective user message
            const lastUser = findLastUserFromBuffer(msgsBuffer.current)
            if (lastUser) {
              const hint =
                recovery.type === LoopType.THINKING_LOOP
                  ? "Do not over-plan. Take action immediately using the available tools."
                  : `Potential loop detected: ${recovery.detail}. Step back and rethink your approach.`

              await correctionInjector.inject({
                lastUser,
                text: `<system-correction>${hint}</system-correction>`,
                msgsBuffer,
              })
            }

            // Clean up instruction prompt and continue to next turn
            await InstructionPrompt.clear(currentAssistantMessage.id)
            break
          }

          // Handle structured output
          if (event.structuredOutput !== undefined) {
            currentAssistantMessage.structured = event.structuredOutput
            currentAssistantMessage.finish = currentAssistantMessage.finish ?? "stop"
            await input.checkpointer.updateMessage(currentAssistantMessage)
            log.info("runSession: structured output captured", { sessionID })
            // Don't call .next() — let the generator break naturally
            break
          }

          // Handle structured output error (model finished without calling tool)
          const modelFinished =
            currentAssistantMessage.finish && !["tool-calls", "unknown"].includes(currentAssistantMessage.finish)
          if (modelFinished && !currentAssistantMessage.error) {
            const lastUser = findLastUserFromBuffer(msgsBuffer.current)
            const format = lastUser?.format ?? { type: "text" }
            if (format.type === "json_schema") {
              currentAssistantMessage.error = new Message.StructuredOutputError({
                message: "Model did not produce structured output",
                retries: 0,
              }).toObject()
              await input.checkpointer.updateMessage(currentAssistantMessage)
              log.info("runSession: structured output error", { sessionID })
            }
          }

          // Process the flush result
          if (flushResult === "stop") {
            log.info("runSession: persister returned stop", {
              sessionID,
              error: currentAssistantMessage.error,
              finish: currentAssistantMessage.finish,
            })
            // Exit runSessionInner entirely — this stops the for-await loop
            // and terminates the generator. Using `return` (not `break`) because
            // `break` only exits the switch, not the for-await.
            return {
              status: "error",
              error: currentAssistantMessage?.error,
              message: persister?.getCompletedMessage(),
            } as SessionResult
          }
          if (flushResult === "compact") {
            const lastUser = findLastUserFromBuffer(msgsBuffer.current)
            if (lastUser) {
              const { markerWithParts } = await compactionOrchestrator.createMarker({
                agent: lastUser.agent,
                model: lastUser.model,
                auto: true,
                overflow: !currentAssistantMessage.finish,
              })
              // Buffer remains as-is after create() — process() will reset it via compaction-task
              // The query loop will re-scan the buffer and emit a compaction-task control event
              // for the marker, so buffer will be reset there.
              log.info("runSession: compaction marker created", { markerID: markerWithParts.info.id, sessionID })
            }
            break
          }

          // flushResult === "continue" — inject any task completion notifications
          // before the generator's next iteration picks up the buffer.
          {
            const lastUser = findLastUserFromBuffer(msgsBuffer.current)
            if (lastUser) {
              await correctionInjector
                .injectNotifications({
                  registry: input.registry,
                  lastUser,
                  msgsBuffer,
                })
                .catch((e: unknown) => {
                  // Notification injection failure must NOT crash the engine loop.
                  log.error("runSession: injectTaskNotifications failed", { error: e, sessionID })
                })
            }
          }

          // Save cache-safe params so forks can inherit them
          if (currentTurnCache && isRootAgent()) {
            const { saveCacheSafeParams } = await import("@/agent/fork")
            saveCacheSafeParams(sessionID, {
              systemPrompt: currentTurnCache.system,
              toolConfig: currentTurnCache.tools,
              forkContextMessages: msgsBuffer.current,
            })
          }

          // Clean up instruction prompt
          await InstructionPrompt.clear(currentAssistantMessage.id)
          break
        }

        // ── Control: compaction, subtask, overflow ──
        case "control": {
          switch (event.action) {
            case "subtask": {
              const { task, model, lastUser, msgs, telemetryTracker, telemetryBatchId } = event.payload
              const { subtaskAssistant, syntheticUser } = await processSubtask({
                task,
                model,
                lastUser,
                sessionID,
                session,
                abort,
                msgs,
                telemetryTracker,
                telemetryBatchId,
                checkpointer: input.checkpointer,
                tracker,
              })
              // Append subtask messages to buffer (FR-8) — no DB read
              msgsBuffer.current = [...msgsBuffer.current, subtaskAssistant, ...(syntheticUser ? [syntheticUser] : [])]
              break
            }
            case "compaction-task": {
              const { task, lastUser, msgs, telemetryTracker, telemetryBatchId } = event.payload

              const { result, summaryWithParts } = await compactionOrchestrator.process({
                messages: msgs,
                parentID: lastUser.id,
                abort,
                auto: task.auto,
                overflow: task.overflow,
                telemetryTracker,
                telemetryBatchId,
              })
              if (result === "stop") {
                return { status: "ok", message: persister?.getCompletedMessage() } as SessionResult
              }
              const markerMsg = msgs.findLast(
                (m: Message.WithParts) =>
                  m.info.role === "user" && m.parts.some((p: Message.Part) => p.type === "compaction"),
              )
              if (markerMsg && summaryWithParts) {
                msgsBuffer.current = [markerMsg, summaryWithParts]
                log.info("runSession: buffer reset after compaction-task", {
                  sessionID,
                  bufferLen: msgsBuffer.current.length,
                })
              }
              break
            }
            case "overflow": {
              const { lastUser } = event.payload
              const { markerWithParts } = await compactionOrchestrator.createMarker({
                agent: lastUser.agent,
                model: lastUser.model,
                auto: true,
              })
              msgsBuffer.current = [...msgsBuffer.current, markerWithParts]
              break
            }
            case "compact": {
              const { lastUser } = event.payload
              const { markerWithParts } = await compactionOrchestrator.createMarker({
                agent: lastUser.agent,
                model: lastUser.model,
                auto: true,
              })
              msgsBuffer.current = [...msgsBuffer.current, markerWithParts]
              break
            }
            case "loop-detected": {
              const { loopResult } = event.payload as { loopResult: LoopDetectionResult }
              loopDetectionCount = loopResult.count
              pendingLoopRecovery = loopResult
              log.warn("loop detected", {
                sessionID,
                type: loopResult.type,
                detail: loopResult.detail,
                count: loopResult.count,
              })
              break
            }
            case "plan-stop-correction": {
              const { correctionCount, correctionText } = event.payload as {
                correctionCount: number
                correctionText: string
              }
              log.warn("plan mode stop-drift: injecting correction message", {
                sessionID,
                correctionCount,
              })

              // Strip incomplete thinking parts (same cleanup as loop recovery)
              if (currentAssistantMessage) {
                await stripIncompleteThinking({
                  sessionID,
                  message: currentAssistantMessage,
                  msgsBuffer,
                  checkpointer: input.checkpointer,
                  tracker,
                })
              }

              const lastUser = findLastUserFromBuffer(msgsBuffer.current)
              if (lastUser && correctionText) {
                await correctionInjector.inject({
                  lastUser,
                  text: correctionText,
                  msgsBuffer,
                })
              }

              // Clean up instruction prompt before next turn
              if (currentAssistantMessage) {
                await InstructionPrompt.clear(currentAssistantMessage.id)
              }
              break
            }
            case "stop": {
              return { status: "ok", message: persister?.getCompletedMessage() } as SessionResult
            }
            case "continue": {
              // Normal continuation — no-op, generator resumes
              break
            }
            case "step-pause": {
              const { step, checkpoint } = event.payload as {
                step: number
                checkpoint: import("./loop/checkpoint-store").CheckpointData
              }

              // 1. Set session status to paused
              SessionStatus.set(sessionID, { type: "paused", step })

              // 2. Publish checkpoint event (fire-and-forget)
              Bus.publish(SessionStatus.Event.Checkpoint, {
                sessionID,
                checkpoint: {
                  id: checkpoint.id,
                  step: checkpoint.step,
                  timestamp: checkpoint.timestamp,
                  metadata: checkpoint.metadata,
                },
              }).catch((e: unknown) => {
                log.error("Bus.publish(session.checkpoint) failed", { error: e, sessionID })
              })

              // 3. Create a new latch and store it on SessionState
              const latch = StepPauseLatch.create()
              const sessionStateEntry = state()[sessionID]
              if (sessionStateEntry) {
                sessionStateEntry.stepLatch = latch
              }

              // 4. Wire abort signal to reject the latch (cancel during pause)
              const abortHandler = () => {
                latch.reject(new DOMException("Session aborted during pause", "AbortError"))
              }
              abort.addEventListener("abort", abortHandler, { once: true })

              try {
                // 5. Await the latch — blocks until user resumes or aborts
                const resumePayload = await latch.promise

                // 6. Handle resume payload
                if (resumePayload.guidance) {
                  // Inject guidance as a synthetic user text part (same pattern as correctionInjector)
                  const lastUser = findLastUserFromBuffer(msgsBuffer.current)
                  if (lastUser) {
                    await correctionInjector.inject({
                      lastUser,
                      text: resumePayload.guidance,
                      msgsBuffer,
                    })
                  }
                }

                if (resumePayload.disableStepMode && stepModeRef) {
                  stepModeRef.current = false
                }

                // 7. Set status back to busy
                SessionStatus.set(sessionID, { type: "busy" })
              } finally {
                abort.removeEventListener("abort", abortHandler)
              }
              break
            }
          }
          break
        }

        // ── Stream events: route to persister ──
        default: {
          // ── Pre-turn error: model resolution or other early failures ──
          // When queryLoop yields an error BEFORE turn-start, persister is undefined.
          // We must intercept here to prevent the "Impossible" guard from firing.
          if (!persister && "type" in event && event.type === "error") {
            log.error("runSession: pre-turn error (no persister)", {
              sessionID,
              error: (event as EngineEvent.BlockEvent & { type: "error" }).error,
            })
            // Exit cleanly — cleanup()/defer will emit session.idle
            return {
              status: "error",
              error: (event as EngineEvent.BlockEvent & { type: "error" }).error,
            } as SessionResult
          }

          if (persister) {
            const action = persister.handleEvent(event) // synchronous — no DB writes
            // Drain accumulated writes and persist to DB
            const ops = persister.drainWrites()
            if (ops.length > 0) {
              tracker.track(input.checkpointer.write(ops))
            }
            if (action === "stop") {
              log.info("runSession: persister signalled stop during event handling", { sessionID })
              return {
                status: "error",
                error: currentAssistantMessage?.error,
                message: persister?.getCompletedMessage(),
              } as SessionResult
            }
            if (action === "retry") {
              // Retry sleep extracted from persister — loop.ts handles the blocking wait
              const delay = SessionRetry.delay(persister.attempt)
              await SessionRetry.sleep(delay, abort).catch(() => {})
              // Don't break — let the for-await continue to process the next event
            }
          }
          break
        }
      }
    }
  } catch (e: unknown) {
    // AbortError is expected when the user cancels mid-stream.
    // Swallow it here so it doesn't propagate as an unhandled rejection.
    if (isAbortError(e)) {
      log.info("session/loop abort: caught AbortError in event loop", { sessionID })
      return { status: "aborted" } as SessionResult
    } else {
      throw e
    }
  }

  // Post-loop cleanup (fire-and-forget with catch to prevent unhandled rejection)
  if (isRootAgent()) {
    import("@/agent/fork").then((m) => m.saveCacheSafeParams(sessionID, null)).catch(() => {})

    compactionOrchestrator.prune().catch((e: unknown) => {
      if (!isAbortError(e)) {
        log.error("runSession: prune failed", { error: e, sessionID })
      }
    })
  }

  return { status: "ok", message: persister?.getCompletedMessage() } as SessionResult
}

/**
 * Helper: find the last user message from the in-memory buffer (no DB read).
 */
function findLastUserFromBuffer(msgs: Message.WithParts[]): Message.User | undefined {
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].info.role === "user") return msgs[i].info as Message.User
  }
  return undefined
}

export const loop = fn(LoopInput, async (input) => {
  const { sessionID, resume_existing } = input

  const abort = resume_existing ? resume(sessionID) : start(sessionID)
  if (!abort) {
    return new Promise<Message.WithParts>((resolve, reject) => {
      const callbacks = state()[sessionID].callbacks
      callbacks.push({ resolve, reject })
    })
  }

  // Create a fresh BackgroundTaskRegistry scoped to this session.
  // Disposed (all running tasks terminated) when the session ends via defer.
  const registry = new BackgroundTaskRegistry()

  const tracker = new PromiseTracker()

  await using _ = defer(async () => {
    // Flush all pending async writes before cleaning up session
    await tracker.flush().catch((e: unknown) => {
      log.error("loop tracker.flush() failed during cleanup", { error: e, sessionID })
    })
    await registry.disposeAll()
    cleanup(sessionID)
  })

  const session = await Session.get(sessionID)

  // Delegate to the event-sourced orchestrator
  const checkpointer = new SqliteCheckpointer()
  const stepModeRef = input.stepMode ? { current: true } : undefined
  const result = await runSession({ sessionID, session, abort, registry, checkpointer, tracker, stepModeRef })

  const queued = state()[sessionID]?.callbacks ?? []
  switch (result.status) {
    case "ok": {
      for (const q of queued) q.resolve(result.message)
      return result.message
    }
    case "error": {
      const err = result.error instanceof Error ? result.error : new Error(String(result.error))
      for (const q of queued) q.reject(err)
      const publishedError =
        err && typeof err === "object" && "name" in err && "data" in err
          ? err
          : { name: "UnknownError", data: { message: err.message } }
      // T013/T014: Publish to Bus so TUI and frontend SSE can receive it
      // Do not block loop exit on Bus publish
      // biome-ignore lint/suspicious/noExplicitAny: error is a generic union in the bus
      Bus.publish(Session.Event.Error, { sessionID, error: publishedError as any }).catch((busErr: unknown) => {
        log.error("Bus.publish(Session.Event.Error) failed", { error: busErr, sessionID })
      })
      if (result.message) return result.message
      throw err
    }
    case "aborted": {
      const abortErr = new DOMException("Session aborted", "AbortError")
      for (const q of queued) q.reject(abortErr)
      throw abortErr
    }
  }
})

// ─── Loop Recovery Helpers ──────────────────────────────────────────────────

/**
 * Strips incomplete reasoning parts from the assistant message in the database.
 *
 * When we abort streaming mid-thinking, the partial reasoning block has no end
 * timestamp and no valid `thoughtSignature` in metadata. The Code Assist API
 * requires valid signatures on all thinking parts in history — sending back a
 * partial block causes 400 errors on retry.
 *
 * This function removes reasoning parts that were never closed (no `time.end`),
 * making the message safe to include in subsequent inference calls.
 */
async function stripIncompleteThinking(input: {
  sessionID: SessionID
  message: Message.Assistant
  msgsBuffer: { current: Message.WithParts[] }
  checkpointer: Checkpointer
  tracker: PromiseTracker
}): Promise<void> {
  const { sessionID, message, msgsBuffer, checkpointer, tracker } = input

  // Read from in-memory buffer instead of DB
  const assistantMsg = msgsBuffer.current.find((m) => m.info.id === message.id && m.info.role === "assistant")
  if (!assistantMsg) return

  for (const part of assistantMsg.parts) {
    if (part.type === "reasoning" && !part.time?.end && !part.metadata?.thoughtSignature) {
      log.info("stripIncompleteThinking: removing incomplete reasoning part", {
        sessionID,
        messageID: message.id,
        partID: part.id,
      })
      // Persist deletion through checkpointer
      tracker.track(checkpointer.deletePart({ sessionID, messageID: message.id, partID: part.id }))
      // Update the in-memory buffer
      assistantMsg.parts = assistantMsg.parts.filter((p) => p.id !== part.id)
    }
  }
}

async function processSubtask(input: {
  task: Message.SubtaskPart
  model: Provider.Model
  lastUser: Message.User
  sessionID: SessionID
  session: Session.Info
  abort: AbortSignal
  msgs: Message.WithParts[]
  telemetryTracker?: TelemetryTracker
  telemetryBatchId?: string
  checkpointer: Checkpointer
  tracker: PromiseTracker
}): Promise<{ subtaskAssistant: Message.WithParts; syntheticUser?: Message.WithParts }> {
  const { task, lastUser, sessionID, session, abort, msgs, telemetryTracker, telemetryBatchId, checkpointer, tracker } =
    input
  const taskTool = await TaskTool.init()
  const taskModel = task.model
    ? await Provider.getModel(task.model.providerID, task.model.modelID).catch((e) => {
        log.warn("subtask model not available, falling back to parent model", {
          configured: `${task.model?.providerID}/${task.model?.modelID}`,
          error: e instanceof Error ? e.message : e,
        })
        return input.model
      })
    : input.model
  const assistantMessage = {
    id: MessageID.ascending(),
    role: "assistant",
    parentID: lastUser.id,
    sessionID,
    mode: task.agent,
    agent: task.agent,
    variant: lastUser.variant,
    path: {
      cwd: Instance.directory,
      root: Instance.worktree,
    },
    cost: 0,
    tokens: {
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
    modelID: taskModel.id,
    providerID: taskModel.providerID,
    time: {
      created: Date.now(),
    },
  } as Message.Assistant
  tracker.track(checkpointer.saveMessage(assistantMessage))

  let part = {
    id: PartID.ascending(),
    messageID: assistantMessage.id,
    sessionID: assistantMessage.sessionID,
    type: "tool",
    callID: ulid(),
    tool: TaskTool.id,
    state: {
      status: "running",
      input: {
        prompt: task.prompt,
        description: task.description,
        subagent_type: task.agent,
        command: task.command,
      },
      time: {
        start: Date.now(),
      },
    },
  } as Message.ToolPart
  tracker.track(checkpointer.savePart(part))
  const taskArgs = {
    prompt: task.prompt,
    description: task.description,
    subagent_type: task.agent,
    command: task.command,
  }

  await Plugin.trigger(
    "tool.execute.before",
    {
      tool: "task",
      sessionID,
      callID: part.id,
    },
    { args: taskArgs },
  )
  let executionError: Error | undefined
  const taskAgent = await Agent.get(task.agent)
  const ctx: Tool.Context = {
    agent: task.agent,
    messageID: assistantMessage.id,
    sessionID: sessionID,
    abort,
    callID: part.callID,
    extra: { bypassAgentCheck: true },
    messages: msgs,
    async metadata(val) {
      part = {
        ...part,
        type: "tool",
        state: {
          ...part.state,
          ...val,
        },
      } satisfies Message.ToolPart as Message.ToolPart
      tracker.track(checkpointer.savePart(part))
    },
    async ask(req) {
      await PermissionNext.ask({
        ...req,
        sessionID: sessionID,
        ruleset: PermissionNext.merge(taskAgent.permission, session.permission ?? []),
      })
    },
  }

  const activeSpan = trace.getActiveSpan()
  if (activeSpan) {
    activeSpan.setAttribute("input.value", JSON.stringify(taskArgs))
    activeSpan.setAttribute("ai.telemetry.metadata.langgraph_node", "task")
    activeSpan.setAttribute(
      "ai.telemetry.metadata.langgraph_step",
      String(telemetryTracker?.getStep(telemetryBatchId) ?? 1),
    )
  }

  const result = await taskTool.execute(taskArgs, ctx).catch((error) => {
    executionError = error
    log.error("subtask execution failed", { error, agent: task.agent, description: task.description })
    if (activeSpan) {
      activeSpan.setAttribute("output.value", String(error))
    }
    return undefined
  })
  if (activeSpan && result) {
    activeSpan.setAttribute("output.value", result.output ?? "")
  }
  const attachments = result?.attachments?.map((attachment) => ({
    ...attachment,
    id: PartID.ascending(),
    sessionID,
    messageID: assistantMessage.id,
  }))
  await Plugin.trigger(
    "tool.execute.after",
    {
      tool: "task",
      sessionID,
      callID: part.id,
      args: taskArgs,
    },
    result,
  )
  assistantMessage.finish = "tool-calls"
  assistantMessage.time.completed = Date.now()
  tracker.track(checkpointer.updateMessage(assistantMessage))
  if (result && part.state.status === "running") {
    part = {
      ...part,
      state: {
        status: "completed",
        input: part.state.input,
        title: result.title,
        metadata: result.metadata,
        output: result.output,
        attachments,
        time: {
          ...part.state.time,
          end: Date.now(),
        },
      },
    } satisfies Message.ToolPart as Message.ToolPart
    tracker.track(checkpointer.savePart(part))
  }
  if (!result) {
    part = {
      ...part,
      state: {
        status: "error",
        error: executionError ? `Tool execution failed: ${executionError.message}` : "Tool execution failed",
        time: {
          start: part.state.status === "running" ? part.state.time.start : Date.now(),
          end: Date.now(),
        },
        metadata: "metadata" in part.state ? part.state.metadata : undefined,
        input: part.state.input,
      },
    } satisfies Message.ToolPart as Message.ToolPart
    tracker.track(checkpointer.savePart(part))
  }

  // Build the in-memory WithParts for the subtask assistant message (FR-8)
  const subtaskAssistant: Message.WithParts = {
    info: assistantMessage,
    parts: [part as Message.Part],
  }

  if (task.command) {
    // Add synthetic user message to prevent certain reasoning models from erroring
    // If we create assistant messages w/ out user ones following mid loop thinking signatures
    // will be missing and it can cause errors for models like gemini for example
    const summaryUserMsg: Message.User = {
      id: MessageID.ascending(),
      sessionID,
      role: "user",
      time: {
        created: Date.now(),
      },
      agent: lastUser.agent,
      model: lastUser.model,
    }
    tracker.track(checkpointer.saveMessage(summaryUserMsg))
    const summaryTextPart = {
      id: PartID.ascending(),
      messageID: summaryUserMsg.id,
      sessionID,
      type: "text",
      text: "Summarize the task tool output above and continue with your task.",
      synthetic: true,
    } satisfies Message.TextPart as Message.TextPart
    tracker.track(checkpointer.savePart(summaryTextPart))
    const syntheticUser: Message.WithParts = {
      info: summaryUserMsg,
      parts: [summaryTextPart],
    }
    return { subtaskAssistant, syntheticUser }
  }

  return { subtaskAssistant }
}
===
import { Log } from "@liteai/util/log"
import { trace } from "@opentelemetry/api"
import { ulid } from "ulid"
import z from "zod"
import { Bus } from "@/bus"
import { BackgroundTaskRegistry } from "@/command/background"
import { PermissionNext } from "@/permission/next"
import { TaskTool } from "@/tool/task"
import type { Tool } from "@/tool/tool"
import { fn } from "@/util/fn"
import { Agent } from "../../agent/agent"
import { isRootAgent } from "../../agent/context"
import { Plugin } from "../../plugin"
import { Instance } from "../../project/instance"
import { Provider } from "../../provider/provider"
import { ModelID, ProviderID } from "../../provider/schema"
import { defer } from "../../util/defer"
import { Session } from ".."
import type { EngineEvent } from "../events"
import { Message } from "../message"
import { createDefaultPlanModeState, PlanModeStateRef } from "../plan-mode-state"
import { SessionRetry } from "../retry"
import { SessionRevert } from "../revert"
import { MessageID, PartID, SessionID } from "../schema"
import { SessionStatus } from "../status"
import { SessionSummary } from "../tasks/summary"
import { CompactionOrchestrator } from "./compaction-orchestrator"
import { CorrectionInjector } from "./correction-injector"
import { createUserMessage } from "./input"
import { InstructionPrompt } from "./instruction"
import { type Checkpointer, type SessionResult, SqliteCheckpointer } from "./loop/checkpointer"
import { PromiseTracker } from "./loop/promise-tracker"
import type { ResumePayload } from "./loop/step-latch"
import { SessionNotPausedError, type StepLatchHandle, StepPauseLatch } from "./loop/step-latch"
import { type LoopDetectionResult, LoopType } from "./loop-detection"
import { EventPersister } from "./persister"
import { queryLoop } from "./query"
import type { TelemetryTracker } from "./telemetry"

globalThis.AI_SDK_LOG_WARNINGS = false

const log = Log.create({ service: "session.engine" })

type SessionState = Record<
  string,
  {
    abort: AbortController
    callbacks: {
      resolve(input: Message.WithParts): void
      reject(reason?: unknown): void
    }[]
    /** Active step-pause latch — present only while the session is paused in step mode */
    stepLatch?: StepLatchHandle
    /** Mutable ref to the step mode flag — can be toggled by resume API */
    stepModeRef?: { current: boolean }
  }
>

const _state = Instance.state(
  () => {
    const data: SessionState = {}
    return data
  },
  async (current) => {
    for (const [id, item] of Object.entries(current)) {
      log.info("state cleanup aborting session", { sessionID: id })
      try {
        item.abort.abort()
      } catch {
        // Swallowed — see safeAbort() for full explanation of the Bun quirk
      }
    }
  },
)

export function state() {
  return _state()
}

export function assertNotBusy(sessionID: SessionID) {
  const match = state()[sessionID]
  if (match) throw new Session.BusyError(sessionID)
}

export const PromptInput = z.object({
  sessionID: SessionID.zod,
  messageID: MessageID.zod.optional(),
  model: z
    .object({
      providerID: ProviderID.zod,
      modelID: ModelID.zod,
    })
    .optional(),
  agent: z.string().optional(),
  noReply: z.boolean().optional(),
  format: Message.Format.optional(),
  system: z.string().optional(),
  variant: z.string().optional(),
  /** Enable step-by-step execution — loop pauses after each iteration */
  stepMode: z.boolean().optional(),
  parts: z.array(
    z.discriminatedUnion("type", [
      Message.TextPart.omit({
        messageID: true,
        sessionID: true,
      })
        .partial({
          id: true,
        })
        .meta({
          ref: "TextPartInput",
        }),
      Message.FilePart.omit({
        messageID: true,
        sessionID: true,
      })
        .partial({
          id: true,
        })
        .meta({
          ref: "FilePartInput",
        }),
      Message.AgentPart.omit({
        messageID: true,
        sessionID: true,
      })
        .partial({
          id: true,
        })
        .meta({
          ref: "AgentPartInput",
        }),
      Message.SubtaskPart.omit({
        messageID: true,
        sessionID: true,
      })
        .partial({
          id: true,
        })
        .meta({
          ref: "SubtaskPartInput",
        }),
    ]),
  ),
})
export type PromptInput = z.infer<typeof PromptInput>

export const prompt = fn(PromptInput, async (input) => {
  const session = await Session.get(input.sessionID)
  await SessionRevert.cleanup(session)

  const message = await createUserMessage(input)
  await Session.touch(input.sessionID)

  if (input.noReply === true) {
    return message
  }

  return await loop({ sessionID: input.sessionID, stepMode: input.stepMode })
})

export const runSubagent = fn(PromptInput, async (input) => {
  const session = await Session.get(input.sessionID)
  await SessionRevert.cleanup(session)

  await createUserMessage(input)
  await Session.touch(input.sessionID)

  if (input.noReply === true) {
    throw new Error("runSubagent does not support noReply — subagents must always produce a result")
  }

  const { sessionID } = input
  const abort = start(sessionID)
  if (!abort) {
    return { status: "error", error: new Error("Session busy") } as SessionResult
  }

  const registry = new BackgroundTaskRegistry()
  const tracker = new PromiseTracker()

  await using _ = defer(async () => {
    await tracker.flush().catch((e: unknown) => {
      log.error("runSubagent tracker.flush() failed during cleanup", { error: e, sessionID })
    })
    await registry.disposeAll()
    cleanup(sessionID)
  })

  const checkpointer = new SqliteCheckpointer()
  return await runSession({ sessionID, session, abort, registry, checkpointer, tracker })
})

export function start(sessionID: SessionID) {
  const s = state()
  if (s[sessionID]) {
    log.info("start: session already active, queuing", { sessionID })
    return
  }
  log.info("start", { sessionID })

  const controller = new AbortController()
  s[sessionID] = {
    abort: controller,
    callbacks: [],
  }
  return controller.signal
}

function resume(sessionID: SessionID) {
  const s = state()
  if (!s[sessionID]) return

  return s[sessionID].abort.signal
}

/**
 * Resume a session that is paused in step mode.
 * Resolves the pending step-pause latch, unblocking the loop.
 */
export function resumeStepMode(sessionID: SessionID, payload: ResumePayload) {
  const s = state()
  const match = s[sessionID]
  if (!match || !match.stepLatch) {
    throw new SessionNotPausedError({ sessionID })
  }
  match.stepLatch.resolve(payload)
  // Clear the latch reference — the loop will create a new one on next pause
  match.stepLatch = undefined
}

export function cancel(sessionID: SessionID) {
  log.info("cancel", { sessionID })
  const s = state()
  const match = s[sessionID]
  if (!match) {
    SessionStatus.set(sessionID, { type: "idle" })
    return
  }
  safeAbort(match.abort, sessionID)
}

/**
 * Safely abort an AbortController, swallowing any errors thrown by
 * abort event listeners added by providers.
 *
 * ## Bun Runtime Discovery (April 2026, Bun v1.3.x)
 *
 * When an EventTarget listener throws during `AbortController.abort()`,
 * Bun exhibits three behaviors simultaneously:
 *
 * 1. **JS-level propagation**: The error propagates through `abort()` and
 *    CAN be caught by a standard `try/catch` — so `cancel()` doesn't crash
 *    at the JS level.
 *
 * 2. **Native error reporting**: Bun's C++ EventTarget dispatcher ALSO
 *    reports the error through its internal error pipeline, printing the
 *    error to stderr independently of JS exception handling.
 *
 * 3. **Exit code 1**: Bun sets the process exit code to 1 regardless of
 *    whether JS caught the error.
 *
 * Because of (2) and (3), a simple `try/catch` around `abort()` is
 * insufficient — the process still crashes with exit code 1.
 *
 * **What doesn't work:**
 * - `try/catch` around `abort()` — catches the JS error but Bun still
 *   reports it natively and exits with code 1.
 * - Overriding `signal.dispatchEvent()` — Bun's native `abort()` bypasses
 *   the JS `dispatchEvent` method entirely, calling listeners at the C++ level.
 * - `globalThis.addEventListener("error")` — Bun reports the error at a
 *   level below the global error event.
 *
 * **What works:**
 * - `process.on("uncaughtException")` — This is the ONLY mechanism that
 *   intercepts Bun's native error pipeline. Installing a temporary handler
 *   before `abort()` prevents both the error output and the exit code 1.
 *
 * ## Why this matters
 *
 * Provider SDKs add abort listeners on the signal to do cleanup work
 * (e.g., google-code-assist's `sourceStream.destroy()`, `rl.close()`).
 * If those listeners throw — which is common during stream teardown —
 * the process crashes even though the abort itself succeeded.
 */
function safeAbort(controller: AbortController, sessionID: string) {
  const errors: unknown[] = []

  // Install a temporary uncaughtException handler to suppress Bun's
  // native error reporting during abort(). This is the ONLY mechanism
  // that prevents Bun from setting exit code 1 (see discovery above).
  const suppressHandler = (err: Error) => {
    errors.push(err)
  }
  process.on("uncaughtException", suppressHandler)

  try {
    log.info("session/loop abort: controller.abort()", { sessionID })
    controller.abort()
  } catch (e: unknown) {
    errors.push(e)
  } finally {
    process.removeListener("uncaughtException", suppressHandler)
  }

  if (errors.length > 0) {
    for (const e of errors) {
      log.info("cancel: abort listener threw (swallowed)", {
        sessionID,
        error: e instanceof Error ? e.message : String(e),
        name: e instanceof DOMException ? (e as DOMException).name : undefined,
      })
    }
  }
}

/**
 * Cleans up session state after the processor has finished flushing.
 * Called by the deferred cleanup in loop(), NOT by the cancel API.
 */
function cleanup(sessionID: SessionID) {
  log.info("cleanup", { sessionID })

  // Deregister the in-memory PlanModeStateRef for this session.
  // Safe to call even if no ref was registered (e.g., early abort before runSession).
  if (PlanModeStateRef.has(sessionID)) {
    PlanModeStateRef.for(sessionID).deregister()
  }

  const s = state()
  delete s[sessionID]
  SessionStatus.set(sessionID, { type: "idle" })

  // Clear the in-memory checkpoint store for this session to prevent leaks.
  // SqliteCheckpointer is already imported at module scope (line 31). Using the
  // static globalStores map directly — the instance is throwaway but clearSession
  // is a static-map operation.
  try {
    new SqliteCheckpointer().clearSession(sessionID)
  } catch (e) {
    log.warn("cleanup: failed to clear checkpoint store", { sessionID, error: e })
  }
}

export async function lastModel(sessionID: SessionID) {
  for await (const item of Message.stream(sessionID)) {
    if (item.info.role === "user" && item.info.model) {
      const m = item.info.model
      if (m.providerID === "unknown" || m.modelID === "unknown") {
        log.warn("lastModel: found stored message with unknown model identifier — skipping", {
          sessionID,
          messageID: item.info.id,
          providerID: m.providerID,
          modelID: m.modelID,
        })
        continue
      }
      return m
    }
  }
  const result = await Provider.defaultModel()
  if (!result) throw new Error("no model available: connect a provider first")
  return result
}

export const LoopInput = z.object({
  sessionID: SessionID.zod,
  resume_existing: z.boolean().optional(),
  stepMode: z.boolean().optional(),
})

// ─── runSession: The Event-Sourced Orchestrator ─────────────────────────────
//
// Consumes the queryLoop async generator and routes events to the appropriate
// handlers. All SQLite writes flow through EventPersister or direct Session.*
// calls here — the generator never writes to the database.
//
// Event routing:
//   turn-start  → persist assistant message, create EventPersister
//   stream events → persister.handleEvent()
//   turn-end    → persister.flush(), handle structured output/compaction
//   control     → trigger compaction, process subtasks, handle overflow
//   tombstone   → flush persister to clean up orphaned message

async function runSession(input: {
  sessionID: SessionID
  session: Session.Info
  abort: AbortSignal
  registry: BackgroundTaskRegistry
  checkpointer: Checkpointer
  tracker: PromiseTracker
  stepModeRef?: { current: boolean }
}) {
  const tracer = trace.getTracer("liteai")

  // Resolve the first user message text to use as the trace name/input in Langfuse
  const msgs = await Message.filterCompacted(Message.stream(input.sessionID))
  const firstUserText = msgs
    .findLast((m) => m.info.role === "user")
    ?.parts.filter((p) => p.type === "text")
    .map((p) => (p as { text: string }).text)
    .join(" ")
    .slice(0, 200)

  return tracer.startActiveSpan(
    "LiteAI", // Hardcode trace name to LiteAI to fix the "Unnamed trace" issue
    {
      attributes: {
        "langfuse.session.id": input.sessionID,
        "input.value": firstUserText || "No user input",
        "session.title": input.session.title ?? "",
        "langfuse.internal.as_root": true,
      },
    },
    async (sessionSpan) => {
      try {
        const result = await runSessionInner(input)
        return result
      } catch (e) {
        sessionSpan.recordException(e as Error)
        throw e
      } finally {
        const finalMsgs = await Message.filterCompacted(Message.stream(input.sessionID))
        const lastAssistant = finalMsgs.findLast((m) => m.info.role === "assistant")
        const outputText = lastAssistant?.parts
          .filter((p) => p.type === "text")
          .map((p) => (p as { text: string }).text)
          .join(" ")
          .slice(0, 500)

        if (outputText) {
          sessionSpan.setAttribute("output.value", outputText)
        }
        sessionSpan.end()
      }
    },
  )
}

async function runSessionInner(input: {
  sessionID: SessionID
  session: Session.Info
  abort: AbortSignal
  registry: BackgroundTaskRegistry
  checkpointer: Checkpointer
  tracker: PromiseTracker
  stepModeRef?: { current: boolean }
}) {
  const isAbortError = (e: unknown): e is DOMException => e instanceof DOMException && e.name === "AbortError"
  const { sessionID, session, abort, tracker } = input

  let persister: EventPersister | undefined
  let currentAssistantMessage: Message.Assistant | undefined
  let currentStreamResult: unknown
  let currentTurnCache: { system: string[] | string; tools: Record<string, unknown> } | undefined

  // Loop detection recovery state — persisted across turns for escalation
  let loopDetectionCount = 0
  let pendingLoopRecovery: LoopDetectionResult | undefined

  // ── PlanModeState: in-memory ref, lifecycle-bound to this session ──
  // Created once at session start with defaults. No DB read.
  const planModeStateRef = new PlanModeStateRef(createDefaultPlanModeState(session), sessionID)
  planModeStateRef.register()

  // ── Phase 2+3 services: decoupled persistence and extracted concerns ──
  const compactionOrchestrator = new CompactionOrchestrator(sessionID)
  const correctionInjector = new CorrectionInjector(sessionID)

  // Step mode: mutable ref so the resume API can toggle it externally
  const stepModeRef = input.stepModeRef ?? { current: false }

  // Store stepModeRef on SessionState so resume API can access it
  const sessionEntry = state()[sessionID]
  if (sessionEntry) {
    sessionEntry.stepModeRef = stepModeRef
  }

  // Single one-time DB read — after this the buffer is the live message view (FR-1)
  const msgsBuffer: { current: Message.WithParts[] } = {
    current: await input.checkpointer.loadHistory(sessionID),
  }

  const generator = queryLoop({
    sessionID,
    session,
    abort,
    msgsBuffer,
    planModeStateRef,
    backgroundTaskRegistry: input.registry,
    stepModeRef,
    checkpointer: input.checkpointer,
  })

  try {
    for await (const event of generator) {
      switch (event.type) {
        // ── Turn Start: persist assistant message, create persister ──
        case "turn-start": {
          currentAssistantMessage = event.assistantMessage
          tracker.track(input.checkpointer.saveMessage(currentAssistantMessage))

          // Create fresh persister for this turn
          persister = new EventPersister(currentAssistantMessage, sessionID, event.model, abort)

          // Set up instruction prompt cleanup
          // Note: InstructionPrompt.clear will be called in turn-end
          SessionStatus.set(sessionID, { type: "busy" })

          currentTurnCache = {
            system: event.streamInput.system,
            tools: event.streamInput.tools,
          }

          // Fire-and-forget summary on first turn
          const lastUser = event.streamInput.user
          if (lastUser && isRootAgent()) {
            SessionSummary.summarize({
              sessionID,
              messageID: lastUser.id,
            })
          }
          break
        }

        // ── Turn End: flush persister, handle result ──
        case "turn-end": {
          if (!persister || !currentAssistantMessage) break

          // Capture raw SDK stream result for partial token recovery on error
          currentStreamResult = event.streamResult

          // Flush the persister
          const flushResult = await persister.flush(currentStreamResult)
          currentStreamResult = undefined

          // Drain accumulated writes and persist to DB
          const flushOps = persister.drainWrites()
          if (flushOps.length > 0) {
            tracker.track(input.checkpointer.write(flushOps))
          }

          // Update in-memory buffer with this turn's completed message (FR-3, no DB read)
          msgsBuffer.current = [...msgsBuffer.current, persister.getCompletedMessage()]

          // ── Loop recovery: handle pending detection after flush ──
          if (pendingLoopRecovery) {
            const recovery = pendingLoopRecovery
            pendingLoopRecovery = undefined

            // Strip incomplete thinking parts from DB (critical for Code Assist API —
            // partial thought blocks without thoughtSignature cause 400 errors on retry)
            await stripIncompleteThinking({
              sessionID,
              message: currentAssistantMessage,
              msgsBuffer,
              checkpointer: input.checkpointer,
              tracker,
            })

            // Escalation strategy
            if (loopDetectionCount >= 3) {
              log.warn("loop escalation: max retries reached, stopping session", {
                sessionID,
                count: loopDetectionCount,
              })
              return { status: "error", error: new Error("loop escalation: max retries reached") } as SessionResult
            }

            // Inject corrective user message
            const lastUser = findLastUserFromBuffer(msgsBuffer.current)
            if (lastUser) {
              const hint =
                recovery.type === LoopType.THINKING_LOOP
                  ? "Do not over-plan. Take action immediately using the available tools."
                  : `Potential loop detected: ${recovery.detail}. Step back and rethink your approach.`

              await correctionInjector.inject({
                lastUser,
                text: `<system-correction>${hint}</system-correction>`,
                msgsBuffer,
              })
            }

            // Clean up instruction prompt and continue to next turn
            await InstructionPrompt.clear(currentAssistantMessage.id)
            break
          }

          // Handle structured output
          if (event.structuredOutput !== undefined) {
            currentAssistantMessage.structured = event.structuredOutput
            currentAssistantMessage.finish = currentAssistantMessage.finish ?? "stop"
            await input.checkpointer.updateMessage(currentAssistantMessage)
            log.info("runSession: structured output captured", { sessionID })
            // Don't call .next() — let the generator break naturally
            break
          }

          // Handle structured output error (model finished without calling tool)
          const modelFinished =
            currentAssistantMessage.finish && !["tool-calls", "unknown"].includes(currentAssistantMessage.finish)
          if (modelFinished && !currentAssistantMessage.error) {
            const lastUser = findLastUserFromBuffer(msgsBuffer.current)
            const format = lastUser?.format ?? { type: "text" }
            if (format.type === "json_schema") {
              currentAssistantMessage.error = new Message.StructuredOutputError({
                message: "Model did not produce structured output",
                retries: 0,
              }).toObject()
              await input.checkpointer.updateMessage(currentAssistantMessage)
              log.info("runSession: structured output error", { sessionID })
            }
          }

          // Process the flush result
          if (flushResult === "stop") {
            log.info("runSession: persister returned stop", {
              sessionID,
              error: currentAssistantMessage.error,
              finish: currentAssistantMessage.finish,
            })
            // Exit runSessionInner entirely — this stops the for-await loop
            // and terminates the generator. Using `return` (not `break`) because
            // `break` only exits the switch, not the for-await.
            return {
              status: "error",
              error: currentAssistantMessage?.error,
              message: persister?.getCompletedMessage(),
            } as SessionResult
          }
          if (flushResult === "compact") {
            const lastUser = findLastUserFromBuffer(msgsBuffer.current)
            if (lastUser) {
              const { markerWithParts } = await compactionOrchestrator.createMarker({
                agent: lastUser.agent,
                model: lastUser.model,
                auto: true,
                overflow: !currentAssistantMessage.finish,
              })
              // Buffer remains as-is after create() — process() will reset it via compaction-task
              // The query loop will re-scan the buffer and emit a compaction-task control event
              // for the marker, so buffer will be reset there.
              log.info("runSession: compaction marker created", { markerID: markerWithParts.info.id, sessionID })
            }
            break
          }

          // flushResult === "continue" — inject any task completion notifications
          // before the generator's next iteration picks up the buffer.
          {
            const lastUser = findLastUserFromBuffer(msgsBuffer.current)
            if (lastUser) {
              await correctionInjector
                .injectNotifications({
                  registry: input.registry,
                  lastUser,
                  msgsBuffer,
                })
                .catch((e: unknown) => {
                  // Notification injection failure must NOT crash the engine loop.
                  log.error("runSession: injectTaskNotifications failed", { error: e, sessionID })
                })
            }
          }

          // Save cache-safe params so forks can inherit them
          if (currentTurnCache && isRootAgent()) {
            const { saveCacheSafeParams } = await import("@/agent/fork")
            saveCacheSafeParams(sessionID, {
              systemPrompt: currentTurnCache.system,
              toolConfig: currentTurnCache.tools,
              forkContextMessages: msgsBuffer.current,
            })
          }

          // Clean up instruction prompt
          await InstructionPrompt.clear(currentAssistantMessage.id)
          break
        }

        // ── Control: compaction, subtask, overflow ──
        case "control": {
          switch (event.action) {
            case "subtask": {
              const { task, model, lastUser, msgs, telemetryTracker, telemetryBatchId } = event.payload
              const { subtaskAssistant, syntheticUser } = await processSubtask({
                task,
                model,
                lastUser,
                sessionID,
                session,
                abort,
                msgs,
                telemetryTracker,
                telemetryBatchId,
                checkpointer: input.checkpointer,
                tracker,
              })
              // Append subtask messages to buffer (FR-8) — no DB read
              msgsBuffer.current = [...msgsBuffer.current, subtaskAssistant, ...(syntheticUser ? [syntheticUser] : [])]
              break
            }
            case "compaction-task": {
              const { task, lastUser, msgs, telemetryTracker, telemetryBatchId } = event.payload

              const { result, summaryWithParts } = await compactionOrchestrator.process({
                messages: msgs,
                parentID: lastUser.id,
                abort,
                auto: task.auto,
                overflow: task.overflow,
                telemetryTracker,
                telemetryBatchId,
              })
              if (result === "stop") {
                return { status: "ok", message: persister?.getCompletedMessage() } as SessionResult
              }
              const markerMsg = msgs.findLast(
                (m: Message.WithParts) =>
                  m.info.role === "user" && m.parts.some((p: Message.Part) => p.type === "compaction"),
              )
              if (markerMsg && summaryWithParts) {
                msgsBuffer.current = [markerMsg, summaryWithParts]
                log.info("runSession: buffer reset after compaction-task", {
                  sessionID,
                  bufferLen: msgsBuffer.current.length,
                })
              }
              break
            }
            case "overflow": {
              const { lastUser } = event.payload
              const { markerWithParts } = await compactionOrchestrator.createMarker({
                agent: lastUser.agent,
                model: lastUser.model,
                auto: true,
              })
              msgsBuffer.current = [...msgsBuffer.current, markerWithParts]
              break
            }
            case "compact": {
              const { lastUser } = event.payload
              const { markerWithParts } = await compactionOrchestrator.createMarker({
                agent: lastUser.agent,
                model: lastUser.model,
                auto: true,
              })
              msgsBuffer.current = [...msgsBuffer.current, markerWithParts]
              break
            }
            case "loop-detected": {
              const { loopResult } = event.payload as { loopResult: LoopDetectionResult }
              loopDetectionCount = loopResult.count
              pendingLoopRecovery = loopResult
              log.warn("loop detected", {
                sessionID,
                type: loopResult.type,
                detail: loopResult.detail,
                count: loopResult.count,
              })
              break
            }
            case "plan-stop-correction": {
              const { correctionCount, correctionText } = event.payload as {
                correctionCount: number
                correctionText: string
              }
              log.warn("plan mode stop-drift: injecting correction message", {
                sessionID,
                correctionCount,
              })

              // Strip incomplete thinking parts (same cleanup as loop recovery)
              if (currentAssistantMessage) {
                await stripIncompleteThinking({
                  sessionID,
                  message: currentAssistantMessage,
                  msgsBuffer,
                  checkpointer: input.checkpointer,
                  tracker,
                })
              }

              const lastUser = findLastUserFromBuffer(msgsBuffer.current)
              if (lastUser && correctionText) {
                await correctionInjector.inject({
                  lastUser,
                  text: correctionText,
                  msgsBuffer,
                })
              }

              // Clean up instruction prompt before next turn
              if (currentAssistantMessage) {
                await InstructionPrompt.clear(currentAssistantMessage.id)
              }
              break
            }
            case "stop": {
              return { status: "ok", message: persister?.getCompletedMessage() } as SessionResult
            }
            case "continue": {
              // Normal continuation — no-op, generator resumes
              break
            }
            case "step-pause": {
              const { step, checkpoint } = event.payload as {
                step: number
                checkpoint: import("./loop/checkpoint-store").CheckpointData
              }

              // 1. Set session status to paused
              SessionStatus.set(sessionID, { type: "paused", step })

              // 2. Publish checkpoint event (fire-and-forget)
              Bus.publish(SessionStatus.Event.Checkpoint, {
                sessionID,
                checkpoint: {
                  id: checkpoint.id,
                  step: checkpoint.step,
                  timestamp: checkpoint.timestamp,
                  metadata: checkpoint.metadata,
                },
              }).catch((e: unknown) => {
                log.error("Bus.publish(session.checkpoint) failed", { error: e, sessionID })
              })

              // 3. Create a new latch and store it on SessionState
              const latch = StepPauseLatch.create()
              const sessionStateEntry = state()[sessionID]
              if (sessionStateEntry) {
                sessionStateEntry.stepLatch = latch
              }

              // 4. Wire abort signal to reject the latch (cancel during pause)
              const abortHandler = () => {
                latch.reject(new DOMException("Session aborted during pause", "AbortError"))
              }
              abort.addEventListener("abort", abortHandler, { once: true })

              try {
                // 5. Await the latch — blocks until user resumes or aborts
                const resumePayload = await latch.promise

                // 6. Handle resume payload
                if (resumePayload.guidance) {
                  // Inject guidance as a synthetic user text part (same pattern as correctionInjector)
                  const lastUser = findLastUserFromBuffer(msgsBuffer.current)
                  if (lastUser) {
                    await correctionInjector.inject({
                      lastUser,
                      text: resumePayload.guidance,
                      msgsBuffer,
                    })
                  }
                }

                // Only disable step mode if the caller explicitly owns a stepModeRef.
                // The local `stepModeRef` always exists (defaulted to { current: false }),
                // but `input.stepModeRef` is only set when the session was started with
                // step mode support — without this check the guard is always true.
                if (resumePayload.disableStepMode && input.stepModeRef) {
                  stepModeRef.current = false
                }

                // 7. Set status back to busy
                SessionStatus.set(sessionID, { type: "busy" })
              } finally {
                abort.removeEventListener("abort", abortHandler)
              }
              break
            }
          }
          break
        }

        // ── Stream events: route to persister ──
        default: {
          // ── Pre-turn error: model resolution or other early failures ──
          // When queryLoop yields an error BEFORE turn-start, persister is undefined.
          // We must intercept here to prevent the "Impossible" guard from firing.
          if (!persister && "type" in event && event.type === "error") {
            log.error("runSession: pre-turn error (no persister)", {
              sessionID,
              error: (event as EngineEvent.BlockEvent & { type: "error" }).error,
            })
            // Exit cleanly — cleanup()/defer will emit session.idle
            return {
              status: "error",
              error: (event as EngineEvent.BlockEvent & { type: "error" }).error,
            } as SessionResult
          }

          if (persister) {
            const action = persister.handleEvent(event) // synchronous — no DB writes
            // Drain accumulated writes and persist to DB
            const ops = persister.drainWrites()
            if (ops.length > 0) {
              tracker.track(input.checkpointer.write(ops))
            }
            if (action === "stop") {
              log.info("runSession: persister signalled stop during event handling", { sessionID })
              return {
                status: "error",
                error: currentAssistantMessage?.error,
                message: persister?.getCompletedMessage(),
              } as SessionResult
            }
            if (action === "retry") {
              // Retry sleep extracted from persister — loop.ts handles the blocking wait
              const delay = SessionRetry.delay(persister.attempt)
              await SessionRetry.sleep(delay, abort).catch(() => {})
              // Don't break — let the for-await continue to process the next event
            }
          }
          break
        }
      }
    }
  } catch (e: unknown) {
    // AbortError is expected when the user cancels mid-stream.
    // Swallow it here so it doesn't propagate as an unhandled rejection.
    if (isAbortError(e)) {
      log.info("session/loop abort: caught AbortError in event loop", { sessionID })
      return { status: "aborted" } as SessionResult
    } else {
      throw e
    }
  }

  // Post-loop cleanup (fire-and-forget with catch to prevent unhandled rejection)
  if (isRootAgent()) {
    import("@/agent/fork").then((m) => m.saveCacheSafeParams(sessionID, null)).catch(() => {})

    compactionOrchestrator.prune().catch((e: unknown) => {
      if (!isAbortError(e)) {
        log.error("runSession: prune failed", { error: e, sessionID })
      }
    })
  }

  return { status: "ok", message: persister?.getCompletedMessage() } as SessionResult
}

/**
 * Helper: find the last user message from the in-memory buffer (no DB read).
 */
function findLastUserFromBuffer(msgs: Message.WithParts[]): Message.User | undefined {
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].info.role === "user") return msgs[i].info as Message.User
  }
  return undefined
}

export const loop = fn(LoopInput, async (input) => {
  const { sessionID, resume_existing } = input

  const abort = resume_existing ? resume(sessionID) : start(sessionID)
  if (!abort) {
    return new Promise<Message.WithParts>((resolve, reject) => {
      const callbacks = state()[sessionID].callbacks
      callbacks.push({ resolve, reject })
    })
  }

  // Create a fresh BackgroundTaskRegistry scoped to this session.
  // Disposed (all running tasks terminated) when the session ends via defer.
  const registry = new BackgroundTaskRegistry()

  const tracker = new PromiseTracker()

  await using _ = defer(async () => {
    // Flush all pending async writes before cleaning up session
    await tracker.flush().catch((e: unknown) => {
      log.error("loop tracker.flush() failed during cleanup", { error: e, sessionID })
    })
    await registry.disposeAll()
    cleanup(sessionID)
  })

  const session = await Session.get(sessionID)

  // Delegate to the event-sourced orchestrator
  const checkpointer = new SqliteCheckpointer()
  const stepModeRef = input.stepMode ? { current: true } : undefined
  const result = await runSession({ sessionID, session, abort, registry, checkpointer, tracker, stepModeRef })

  const queued = state()[sessionID]?.callbacks ?? []
  switch (result.status) {
    case "ok": {
      for (const q of queued) q.resolve(result.message)
      return result.message
    }
    case "error": {
      const err = result.error instanceof Error ? result.error : new Error(String(result.error))
      for (const q of queued) q.reject(err)
      const publishedError =
        err && typeof err === "object" && "name" in err && "data" in err
          ? err
          : { name: "UnknownError", data: { message: err.message } }
      // T013/T014: Publish to Bus so TUI and frontend SSE can receive it
      // Do not block loop exit on Bus publish
      // biome-ignore lint/suspicious/noExplicitAny: error is a generic union in the bus
      Bus.publish(Session.Event.Error, { sessionID, error: publishedError as any }).catch((busErr: unknown) => {
        log.error("Bus.publish(Session.Event.Error) failed", { error: busErr, sessionID })
      })
      if (result.message) return result.message
      throw err
    }
    case "aborted": {
      const abortErr = new DOMException("Session aborted", "AbortError")
      for (const q of queued) q.reject(abortErr)
      throw abortErr
    }
  }
})

// ─── Loop Recovery Helpers ──────────────────────────────────────────────────

/**
 * Strips incomplete reasoning parts from the assistant message in the database.
 *
 * When we abort streaming mid-thinking, the partial reasoning block has no end
 * timestamp and no valid `thoughtSignature` in metadata. The Code Assist API
 * requires valid signatures on all thinking parts in history — sending back a
 * partial block causes 400 errors on retry.
 *
 * This function removes reasoning parts that were never closed (no `time.end`),
 * making the message safe to include in subsequent inference calls.
 */
async function stripIncompleteThinking(input: {
  sessionID: SessionID
  message: Message.Assistant
  msgsBuffer: { current: Message.WithParts[] }
  checkpointer: Checkpointer
  tracker: PromiseTracker
}): Promise<void> {
  const { sessionID, message, msgsBuffer, checkpointer, tracker } = input

  // Read from in-memory buffer instead of DB
  const assistantMsg = msgsBuffer.current.find((m) => m.info.id === message.id && m.info.role === "assistant")
  if (!assistantMsg) return

  for (const part of assistantMsg.parts) {
    if (part.type === "reasoning" && !part.time?.end && !part.metadata?.thoughtSignature) {
      log.info("stripIncompleteThinking: removing incomplete reasoning part", {
        sessionID,
        messageID: message.id,
        partID: part.id,
      })
      // Persist deletion through checkpointer
      tracker.track(checkpointer.deletePart({ sessionID, messageID: message.id, partID: part.id }))
      // Update the in-memory buffer
      assistantMsg.parts = assistantMsg.parts.filter((p) => p.id !== part.id)
    }
  }
}

async function processSubtask(input: {
  task: Message.SubtaskPart
  model: Provider.Model
  lastUser: Message.User
  sessionID: SessionID
  session: Session.Info
  abort: AbortSignal
  msgs: Message.WithParts[]
  telemetryTracker?: TelemetryTracker
  telemetryBatchId?: string
  checkpointer: Checkpointer
  tracker: PromiseTracker
}): Promise<{ subtaskAssistant: Message.WithParts; syntheticUser?: Message.WithParts }> {
  const { task, lastUser, sessionID, session, abort, msgs, telemetryTracker, telemetryBatchId, checkpointer, tracker } =
    input
  const taskTool = await TaskTool.init()
  const taskModel = task.model
    ? await Provider.getModel(task.model.providerID, task.model.modelID).catch((e) => {
        log.warn("subtask model not available, falling back to parent model", {
          configured: `${task.model?.providerID}/${task.model?.modelID}`,
          error: e instanceof Error ? e.message : e,
        })
        return input.model
      })
    : input.model
  const assistantMessage = {
    id: MessageID.ascending(),
    role: "assistant",
    parentID: lastUser.id,
    sessionID,
    mode: task.agent,
    agent: task.agent,
    variant: lastUser.variant,
    path: {
      cwd: Instance.directory,
      root: Instance.worktree,
    },
    cost: 0,
    tokens: {
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
    modelID: taskModel.id,
    providerID: taskModel.providerID,
    time: {
      created: Date.now(),
    },
  } as Message.Assistant
  tracker.track(checkpointer.saveMessage(assistantMessage))

  let part = {
    id: PartID.ascending(),
    messageID: assistantMessage.id,
    sessionID: assistantMessage.sessionID,
    type: "tool",
    callID: ulid(),
    tool: TaskTool.id,
    state: {
      status: "running",
      input: {
        prompt: task.prompt,
        description: task.description,
        subagent_type: task.agent,
        command: task.command,
      },
      time: {
        start: Date.now(),
      },
    },
  } as Message.ToolPart
  tracker.track(checkpointer.savePart(part))
  const taskArgs = {
    prompt: task.prompt,
    description: task.description,
    subagent_type: task.agent,
    command: task.command,
  }

  await Plugin.trigger(
    "tool.execute.before",
    {
      tool: "task",
      sessionID,
      callID: part.id,
    },
    { args: taskArgs },
  )
  let executionError: Error | undefined
  const taskAgent = await Agent.get(task.agent)
  const ctx: Tool.Context = {
    agent: task.agent,
    messageID: assistantMessage.id,
    sessionID: sessionID,
    abort,
    callID: part.callID,
    extra: { bypassAgentCheck: true },
    messages: msgs,
    async metadata(val) {
      part = {
        ...part,
        type: "tool",
        state: {
          ...part.state,
          ...val,
        },
      } satisfies Message.ToolPart as Message.ToolPart
      tracker.track(checkpointer.savePart(part))
    },
    async ask(req) {
      await PermissionNext.ask({
        ...req,
        sessionID: sessionID,
        ruleset: PermissionNext.merge(taskAgent.permission, session.permission ?? []),
      })
    },
  }

  const activeSpan = trace.getActiveSpan()
  if (activeSpan) {
    activeSpan.setAttribute("input.value", JSON.stringify(taskArgs))
    activeSpan.setAttribute("ai.telemetry.metadata.langgraph_node", "task")
    activeSpan.setAttribute(
      "ai.telemetry.metadata.langgraph_step",
      String(telemetryTracker?.getStep(telemetryBatchId) ?? 1),
    )
  }

  const result = await taskTool.execute(taskArgs, ctx).catch((error) => {
    executionError = error
    log.error("subtask execution failed", { error, agent: task.agent, description: task.description })
    if (activeSpan) {
      activeSpan.setAttribute("output.value", String(error))
    }
    return undefined
  })
  if (activeSpan && result) {
    activeSpan.setAttribute("output.value", result.output ?? "")
  }
  const attachments = result?.attachments?.map((attachment) => ({
    ...attachment,
    id: PartID.ascending(),
    sessionID,
    messageID: assistantMessage.id,
  }))
  await Plugin.trigger(
    "tool.execute.after",
    {
      tool: "task",
      sessionID,
      callID: part.id,
      args: taskArgs,
    },
    result,
  )
  assistantMessage.finish = "tool-calls"
  assistantMessage.time.completed = Date.now()
  tracker.track(checkpointer.updateMessage(assistantMessage))
  if (result && part.state.status === "running") {
    part = {
      ...part,
      state: {
        status: "completed",
        input: part.state.input,
        title: result.title,
        metadata: result.metadata,
        output: result.output,
        attachments,
        time: {
          ...part.state.time,
          end: Date.now(),
        },
      },
    } satisfies Message.ToolPart as Message.ToolPart
    tracker.track(checkpointer.savePart(part))
  }
  if (!result) {
    part = {
      ...part,
      state: {
        status: "error",
        error: executionError ? `Tool execution failed: ${executionError.message}` : "Tool execution failed",
        time: {
          start: part.state.status === "running" ? part.state.time.start : Date.now(),
          end: Date.now(),
        },
        metadata: "metadata" in part.state ? part.state.metadata : undefined,
        input: part.state.input,
      },
    } satisfies Message.ToolPart as Message.ToolPart
    tracker.track(checkpointer.savePart(part))
  }

  // Build the in-memory WithParts for the subtask assistant message (FR-8)
  const subtaskAssistant: Message.WithParts = {
    info: assistantMessage,
    parts: [part as Message.Part],
  }

  if (task.command) {
    // Add synthetic user message to prevent certain reasoning models from erroring
    // If we create assistant messages w/ out user ones following mid loop thinking signatures
    // will be missing and it can cause errors for models like gemini for example
    const summaryUserMsg: Message.User = {
      id: MessageID.ascending(),
      sessionID,
      role: "user",
      time: {
        created: Date.now(),
      },
      agent: lastUser.agent,
      model: lastUser.model,
    }
    tracker.track(checkpointer.saveMessage(summaryUserMsg))
    const summaryTextPart = {
      id: PartID.ascending(),
      messageID: summaryUserMsg.id,
      sessionID,
      type: "text",
      text: "Summarize the task tool output above and continue with your task.",
      synthetic: true,
    } satisfies Message.TextPart as Message.TextPart
    tracker.track(checkpointer.savePart(summaryTextPart))
    const syntheticUser: Message.WithParts = {
      info: summaryUserMsg,
      parts: [summaryTextPart],
    }
    return { subtaskAssistant, syntheticUser }
  }

  return { subtaskAssistant }
}
```

### [index.ts](file:///d:/liteai/packages/core/src/session/index.ts)

```diff:index.ts
import path from "node:path"
import type { LanguageModelV2Usage } from "@ai-sdk/provider"
import { Log } from "@liteai/util/log"
import { Slug } from "@liteai/util/slug"
import type { ProviderMetadata } from "ai"
import { Decimal } from "decimal.js"
import z from "zod"
import { Brand } from "@/brand"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { PermissionNext } from "@/permission/next"
import type { Provider } from "@/provider/provider"
import { ModelID, ProviderID } from "@/provider/schema"
import { Snapshot } from "@/snapshot"
import { Storage } from "@/storage/storage"
import { fn } from "@/util/fn"
import { iife } from "@/util/iife"
import { Command } from "../command"
import { Config } from "../config/config"
import { WorkspaceID } from "../control-plane/schema"
import { WorkspaceContext } from "../control-plane/workspace-context"
import { Flag } from "../flag/flag"
import { Hook } from "../hook"
import { Installation } from "../installation"
import { Plugin } from "../plugin"
import { Instance } from "../project/instance"
import { ProjectID } from "../project/schema"
import { and, Database, desc, eq, gte, isNotNull, isNull, like, NotFoundError, sql } from "../storage/db"
import { FTS } from "../storage/fts"
import { SessionPrompt } from "./engine"
import { Message } from "./message"
import { MessageID, PartID, SessionID } from "./schema"
import { MessageTable, PartTable, SessionTable } from "./session.sql"

export namespace Session {
  const log = Log.create({ service: "session" })

  const sessionAgentCounts = new Map<string, number>()

  export function incrementAgentCount(sessionID: string) {
    const current = sessionAgentCounts.get(sessionID) ?? 0
    sessionAgentCounts.set(sessionID, current + 1)
    return current + 1
  }

  export function decrementAgentCount(sessionID: string) {
    const current = sessionAgentCounts.get(sessionID) ?? 0
    if (current > 1) {
      sessionAgentCounts.set(sessionID, current - 1)
      return current - 1
    }
    sessionAgentCounts.delete(sessionID)
    return 0
  }

  export function getAgentCount(sessionID: string) {
    return sessionAgentCounts.get(sessionID) ?? 0
  }

  const parentTitlePrefix = "New session - "
  const childTitlePrefix = "Child session - "

  function createDefaultTitle(isChild = false) {
    return (isChild ? childTitlePrefix : parentTitlePrefix) + new Date().toISOString()
  }

  export function isDefaultTitle(title: string) {
    return new RegExp(
      `^(${parentTitlePrefix}|${childTitlePrefix})\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$`,
    ).test(title)
  }

  type SessionRow = typeof SessionTable.$inferSelect

  export function fromRow(row: SessionRow): Info {
    const summary =
      row.summary_additions !== null || row.summary_deletions !== null || row.summary_files !== null
        ? {
            additions: row.summary_additions ?? 0,
            deletions: row.summary_deletions ?? 0,
            files: row.summary_files ?? 0,
            diffs: row.summary_diffs ?? undefined,
          }
        : undefined
    const share = row.share_url ? { url: row.share_url } : undefined
    const revert = row.revert ?? undefined
    return {
      id: row.id,
      slug: row.slug,
      projectID: row.project_id,
      workspaceID: row.workspace_id ?? undefined,
      directory: row.directory,
      parentID: row.parent_id ?? undefined,
      title: row.title,
      description: row.description ?? undefined,
      version: row.version,
      summary,
      share,
      revert,
      permission: row.permission ?? undefined,
      time: {
        created: row.time_created,
        updated: row.time_updated,
        compacting: row.time_compacting ?? undefined,
        archived: row.time_archived ?? undefined,
      },
      sessionMode: (row.session_mode as "Normal" | "Coordinator" | "Swarm") ?? "Normal",
      toolProfile: (row.tool_profile as "Plan" | "Fast") ?? "Plan",
      forkEnabled: row.fork_enabled === 1,
      tags: row.tags ? row.tags.split(",").filter(Boolean) : undefined,
    }
  }

  export function toRow(info: Info) {
    return {
      id: info.id,
      project_id: info.projectID,
      workspace_id: info.workspaceID,
      parent_id: info.parentID,
      slug: info.slug,
      directory: info.directory,
      title: info.title,
      description: info.description ?? null,
      version: info.version,
      share_url: info.share?.url,
      summary_additions: info.summary?.additions,
      summary_deletions: info.summary?.deletions,
      summary_files: info.summary?.files,
      summary_diffs: info.summary?.diffs,
      revert: info.revert ?? null,
      permission: info.permission,
      time_created: info.time.created,
      time_updated: info.time.updated,
      time_compacting: info.time.compacting,
      time_archived: info.time.archived,
      session_mode: info.sessionMode ?? "Normal",
      tool_profile: info.toolProfile ?? "Plan",
      fork_enabled: info.forkEnabled ? 1 : 0,
      tags: info.tags?.join(",") ?? null,
    }
  }

  function getForkedTitle(title: string): string {
    const match = title.match(/^(.+) \(fork #(\d+)\)$/)
    if (match) {
      const base = match[1]
      const num = parseInt(match[2], 10)
      return `${base} (fork #${num + 1})`
    }
    return `${title} (fork #1)`
  }

  export const Info = z
    .object({
      id: SessionID.zod,
      slug: z.string(),
      projectID: ProjectID.zod,
      workspaceID: WorkspaceID.zod.optional(),
      directory: z.string(),
      parentID: SessionID.zod.optional(),
      summary: z
        .object({
          additions: z.number(),
          deletions: z.number(),
          files: z.number(),
          diffs: Snapshot.FileDiff.array().optional(),
        })
        .optional(),
      share: z
        .object({
          url: z.string(),
        })
        .optional(),
      title: z.string(),
      description: z.string().optional(),
      version: z.string(),
      time: z.object({
        created: z.number(),
        updated: z.number(),
        compacting: z.number().optional(),
        archived: z.number().optional(),
      }),
      permission: PermissionNext.Ruleset.optional(),
      revert: z
        .object({
          messageID: MessageID.zod,
          partID: PartID.zod.optional(),
          snapshot: z.string().optional(),
          diff: z.string().optional(),
        })
        .optional(),
      sessionMode: z.enum(["Normal", "Coordinator", "Swarm"]).default("Normal"),
      toolProfile: z.enum(["Plan", "Fast"]).default("Plan"),
      forkEnabled: z.boolean().default(false),
      tags: z.array(z.string()).optional(),
    })
    .meta({
      ref: "Session",
    })
  export type Info = z.output<typeof Info>

  export const Event = {
    Created: BusEvent.define(
      "session.created",
      z.object({
        info: Info,
      }),
    ),
    Updated: BusEvent.define(
      "session.updated",
      z.object({
        info: Info,
      }),
    ),
    Deleted: BusEvent.define(
      "session.deleted",
      z.object({
        info: Info,
      }),
    ),
    Diff: BusEvent.define(
      "session.diff",
      z.object({
        sessionID: SessionID.zod,
        diff: Snapshot.FileDiff.array(),
      }),
    ),
    Error: BusEvent.define(
      "session.error",
      z.object({
        sessionID: SessionID.zod.optional(),
        error: Message.Assistant.shape.error,
      }),
    ),
    PlanStateChanged: BusEvent.define(
      "plan.state_changed",
      z.object({
        sessionID: SessionID.zod,
        active: z.boolean(),
        planFilePath: z.string(),
        turnsSincePlanReminder: z.number(),
      }),
    ),
    PlanApprovalRequested: BusEvent.define(
      "plan.approval_requested",
      z.object({
        sessionID: SessionID.zod,
        planText: z.string(),
        planFilePath: z.string(),
      }),
    ),
  }

  export const create = fn(
    z
      .object({
        parentID: SessionID.zod.optional(),
        title: z.string().optional(),
        permission: Info.shape.permission,
        workspaceID: WorkspaceID.zod.optional(),
      })
      .optional(),
    async (input) => {
      return createNext({
        parentID: input?.parentID,
        directory: Instance.directory,
        title: input?.title,
        permission: input?.permission,
        workspaceID: input?.workspaceID,
      })
    },
  )

  export const fork = fn(
    z.object({
      sessionID: SessionID.zod,
      messageID: MessageID.zod.optional(),
    }),
    async (input) => {
      const original = await get(input.sessionID)
      if (!original) throw new Error("session not found")
      const title = getForkedTitle(original.title)
      const session = await createNext({
        directory: Instance.directory,
        workspaceID: original.workspaceID,
        title,
      })
      const msgs = await messages({ sessionID: input.sessionID })
      const idMap = new Map<string, MessageID>()

      for (const msg of msgs) {
        if (input.messageID && msg.info.id >= input.messageID) break
        const newID = MessageID.ascending()
        idMap.set(msg.info.id, newID)

        const parentID = msg.info.role === "assistant" && msg.info.parentID ? idMap.get(msg.info.parentID) : undefined
        const cloned = await updateMessage({
          ...msg.info,
          sessionID: session.id,
          id: newID,
          ...(parentID && { parentID }),
        })

        for (const part of msg.parts) {
          await updatePart({
            ...part,
            id: PartID.ascending(),
            messageID: cloned.id,
            sessionID: session.id,
          })
        }
      }
      return session
    },
  )

  export const forkAtCheckpoint = fn(
    z.object({
      sessionID: SessionID.zod,
      checkpointID: z.string(),
      model: z.object({ providerID: ProviderID.zod, modelID: ModelID.zod }).optional(),
      agent: z.string().optional(),
      guidance: z.string().optional(),
    }),
    async (input) => {
      // Validation
      if (input.model) {
        const { Provider } = await import("../provider/provider")
        const model = await Provider.getModel(input.model.providerID, input.model.modelID)
        if (!model)
          throw new Error(
            `ProviderModelNotFoundError: Model ${input.model.providerID}/${input.model.modelID} not found`,
          )
      }
      if (input.agent) {
        const { Agent } = await import("../agent/agent")
        const agent = await Agent.get(input.agent)
        if (!agent) throw new Error(`AgentNotFoundError: Agent ${input.agent} not found`)
      }

      // 1. Retrieve source session and checkpoint
      const source = await get(input.sessionID)
      const { SqliteCheckpointer } = await import("./engine/loop/checkpointer")
      const checkpointer = new SqliteCheckpointer()
      const checkpoint = checkpointer.getCheckpoint(input.sessionID, input.checkpointID)
      if (!checkpoint) throw new Error(`CheckpointNotFoundError: Checkpoint ${input.checkpointID} not found`)

      // 2. Create new session (no parentID to avoid confusing tree)
      const title = getForkedTitle(source.title)
      const session = await createNext({
        directory: source.directory,
        workspaceID: source.workspaceID,
        title,
      })

      // 3. Copy messages from checkpoint.messages
      const idMap = new Map<string, MessageID>()
      let lastUserMessage: Message.WithParts | undefined

      for (const msg of checkpoint.messages) {
        const newID = MessageID.ascending()
        idMap.set(msg.info.id, newID)

        const parentID = msg.info.role === "assistant" && msg.info.parentID ? idMap.get(msg.info.parentID) : undefined
        const cloned = await updateMessage({
          ...msg.info,
          sessionID: session.id,
          id: newID,
          ...(parentID && { parentID }),
        })

        for (const part of msg.parts) {
          await updatePart({
            ...part,
            id: PartID.ascending(),
            messageID: cloned.id,
            sessionID: session.id,
          })
        }

        if (cloned.role === "user") {
          lastUserMessage = { info: cloned, parts: [] }
        }
      }

      // 4. Apply model/agent overrides to the last user message
      if (lastUserMessage && (input.model || input.agent)) {
        await updateMessage({
          ...lastUserMessage.info,
          ...(input.model && { model: input.model }),
          ...(input.agent && { agent: input.agent }),
        } as Message.User)
      }

      // 5. Inject guidance message if provided
      if (input.guidance) {
        const guidanceMsgID = MessageID.ascending()
        await updateMessage({
          id: guidanceMsgID,
          sessionID: session.id,
          role: "user",
          agent: input.agent ?? (lastUserMessage?.info as Message.User)?.agent ?? "unknown",
          variant: "default",
          time: { created: Date.now() },
          model: input.model ??
            (lastUserMessage?.info as Message.User)?.model ?? {
              providerID: "unknown" as ProviderID,
              modelID: "unknown" as ModelID,
            },
        })
        await updatePart({
          id: PartID.ascending(),
          sessionID: session.id,
          messageID: guidanceMsgID,
          type: "text",
          text: input.guidance,
          synthetic: true,
        })
      }

      return session
    },
  )

  export const touch = fn(SessionID.zod, async (sessionID) => {
    const now = Date.now()
    Database.use((db) => {
      const row = db
        .update(SessionTable)
        .set({ time_updated: now })
        .where(eq(SessionTable.id, sessionID))
        .returning()
        .get()
      if (!row) throw new NotFoundError({ message: `Session not found: ${sessionID}` })
      const info = fromRow(row)
      Database.effect(() => Bus.publish(Event.Updated, { info }))
    })
  })

  export async function createNext(input: {
    id?: SessionID
    title?: string
    parentID?: SessionID
    workspaceID?: WorkspaceID
    directory: string
    permission?: PermissionNext.Ruleset
  }) {
    const result: Info = {
      id: SessionID.descending(input.id),
      slug: Slug.create(),
      version: Installation.VERSION,
      projectID: Instance.project.id,
      directory: input.directory,
      workspaceID: input.workspaceID,
      parentID: input.parentID,
      title: input.title ?? createDefaultTitle(!!input.parentID),
      permission: input.permission,
      time: {
        created: Date.now(),
        updated: Date.now(),
      },
      sessionMode: "Normal" as const,
      toolProfile: "Plan" as const,
      forkEnabled: false,
    }
    log.info("created", result)
    Database.use((db) => {
      db.insert(SessionTable).values(toRow(result)).run()
      Database.effect(() =>
        Bus.publish(Event.Created, {
          info: result,
        }),
      )
    })
    const cfg = await Config.get()
    if (!result.parentID && (Flag.LITEAI_AUTO_SHARE || cfg.share === "auto"))
      share(result.id).catch((e) => {
        log.warn("auto-share failed on session creation", { sessionID: result.id, error: e })
      })
    Bus.publish(Event.Updated, {
      info: result,
    })
    const defAgentName = await import("../agent/agent").then((m) => m.Agent.defaultAgent())
    const defAgent = await import("../agent/agent").then((m) => m.Agent.get(defAgentName))

    // Resolve a model for the hook context message: prefer agent's explicit model, fall back to default
    const hookModel =
      defAgent.model ??
      (await import("../provider/provider").then((m) => m.Provider.defaultModel()).catch(() => undefined))

    const sessionHook = await Hook.dispatch("SessionStart", {
      session_id: result.id,
      cwd: result.directory,
      hook_event_name: "SessionStart",
      source: input.parentID ? "resume" : "startup",
      model: hookModel ? `${hookModel.providerID}/${hookModel.modelID}` : "unknown",
      agent_type: defAgentName,
    })

    if (sessionHook.context) {
      if (!hookModel) {
        log.warn("SessionStart hook returned context but no model is available — skipping synthetic message", {
          sessionID: result.id,
          agent: defAgentName,
        })
      } else {
        const messageID = MessageID.ascending()
        await updateMessage({
          id: messageID,
          sessionID: result.id,
          role: "user",
          time: { created: Date.now() },
          agent: defAgentName,
          model: hookModel,
        } as import("./message").Message.User)
        await updatePart({
          id: PartID.ascending(),
          sessionID: result.id,
          messageID,
          type: "text",
          text: sessionHook.context,
          synthetic: true,
        })
      }
    }

    await Plugin.trigger("session.start", { sessionID: result.id }, {})

    const { IsolationArtifactRegistry } = await import("@/isolation/registry")
    IsolationArtifactRegistry.cleanupStaleIsolationArtifacts().catch((e) => {
      log.warn("failed to clean up stale isolation artifacts", { error: e })
    })

    return result
  }

  export function plan(input: { slug: string; time: { created: number } }) {
    const rootDir = Instance.project.vcs ? Instance.worktree : Instance.directory
    const base = path.join(rootDir, Brand.dir, "plans")
    return path.join(base, `${[input.time.created, input.slug].join("-")}.md`)
  }

  export const get = fn(SessionID.zod, async (id) => {
    const row = Database.use((db) => db.select().from(SessionTable).where(eq(SessionTable.id, id)).get())
    if (!row) throw new NotFoundError({ message: `Session not found: ${id}` })
    return fromRow(row)
  })

  export const share = fn(SessionID.zod, async (id) => {
    const cfg = await Config.get()
    if (cfg.share === "disabled") {
      throw new Error("Sharing is disabled in configuration")
    }
    const { ShareNext } = await import("@/share/share-next")
    const share = await ShareNext.create(id)
    Database.use((db) => {
      const row = db.update(SessionTable).set({ share_url: share.url }).where(eq(SessionTable.id, id)).returning().get()
      if (!row) throw new NotFoundError({ message: `Session not found: ${id}` })
      const info = fromRow(row)
      Database.effect(() => Bus.publish(Event.Updated, { info }))
    })
    return share
  })

  export const unshare = fn(SessionID.zod, async (id) => {
    // Use ShareNext to remove the share (same as share function uses ShareNext to create)
    const { ShareNext } = await import("@/share/share-next")
    await ShareNext.remove(id)
    Database.use((db) => {
      const row = db.update(SessionTable).set({ share_url: null }).where(eq(SessionTable.id, id)).returning().get()
      if (!row) throw new NotFoundError({ message: `Session not found: ${id}` })
      const info = fromRow(row)
      Database.effect(() => Bus.publish(Event.Updated, { info }))
    })
  })

  export const setTitle = fn(
    z.object({
      sessionID: SessionID.zod,
      title: z.string(),
    }),
    async (input) => {
      return Database.use((db) => {
        const row = db
          .update(SessionTable)
          .set({ title: input.title })
          .where(eq(SessionTable.id, input.sessionID))
          .returning()
          .get()
        if (!row) throw new NotFoundError({ message: `Session not found: ${input.sessionID}` })
        const info = fromRow(row)
        Database.effect(() => Bus.publish(Event.Updated, { info }))
        return info
      })
    },
  )

  export const setDescription = fn(
    z.object({
      sessionID: SessionID.zod,
      description: z.string().optional(),
    }),
    async (input) => {
      return Database.use((db) => {
        const row = db
          .update(SessionTable)
          .set({ description: input.description ?? null })
          .where(eq(SessionTable.id, input.sessionID))
          .returning()
          .get()
        if (!row) throw new NotFoundError({ message: `Session not found: ${input.sessionID}` })
        const info = fromRow(row)
        Database.effect(() => Bus.publish(Event.Updated, { info }))
        return info
      })
    },
  )

  export const setArchived = fn(
    z.object({
      sessionID: SessionID.zod,
      time: z.number().optional(),
    }),
    async (input) => {
      return Database.use((db) => {
        const row = db
          .update(SessionTable)
          .set({ time_archived: input.time })
          .where(eq(SessionTable.id, input.sessionID))
          .returning()
          .get()
        if (!row) throw new NotFoundError({ message: `Session not found: ${input.sessionID}` })
        const info = fromRow(row)
        Database.effect(() => Bus.publish(Event.Updated, { info }))
        return info
      })
    },
  )

  export const setPermission = fn(
    z.object({
      sessionID: SessionID.zod,
      permission: PermissionNext.Ruleset,
    }),
    async (input) => {
      return Database.use((db) => {
        const row = db
          .update(SessionTable)
          .set({ permission: input.permission, time_updated: Date.now() })
          .where(eq(SessionTable.id, input.sessionID))
          .returning()
          .get()
        if (!row) throw new NotFoundError({ message: `Session not found: ${input.sessionID}` })
        const info = fromRow(row)
        Database.effect(() => Bus.publish(Event.Updated, { info }))
        return info
      })
    },
  )

  export const setConfig = fn(
    z.object({
      sessionID: SessionID.zod,
      sessionMode: Info.shape.sessionMode.optional(),
      toolProfile: Info.shape.toolProfile.optional(),
      forkEnabled: Info.shape.forkEnabled.optional(),
    }),
    async (input) => {
      return Database.use((db) => {
        const updates: Record<string, unknown> = { time_updated: Date.now() }
        if (input.sessionMode !== undefined) updates.session_mode = input.sessionMode
        if (input.toolProfile !== undefined) updates.tool_profile = input.toolProfile
        if (input.forkEnabled !== undefined) updates.fork_enabled = input.forkEnabled ? 1 : 0

        const row = db.update(SessionTable).set(updates).where(eq(SessionTable.id, input.sessionID)).returning().get()
        if (!row) throw new NotFoundError({ message: `Session not found: ${input.sessionID}` })
        const info = fromRow(row)
        Database.effect(() => Bus.publish(Event.Updated, { info }))
        return info
      })
    },
  )

  export const setTags = fn(
    z.object({
      sessionID: SessionID.zod,
      tags: z.array(z.string()),
    }),
    async (input) => {
      return Database.use((db) => {
        const row = db
          .update(SessionTable)
          .set({ tags: input.tags.join(","), time_updated: Date.now() })
          .where(eq(SessionTable.id, input.sessionID))
          .returning()
          .get()
        if (!row) throw new NotFoundError({ message: `Session not found: ${input.sessionID}` })
        const info = fromRow(row)
        Database.effect(() => Bus.publish(Event.Updated, { info }))
        return info
      })
    },
  )

  export function listTags(): string[] {
    const rows = Database.use((db) =>
      db.select({ tags: SessionTable.tags }).from(SessionTable).where(isNotNull(SessionTable.tags)).all(),
    )
    const tagSet = new Set<string>()
    for (const row of rows) {
      if (row.tags) {
        for (const t of row.tags.split(",")) {
          if (t.trim()) tagSet.add(t.trim())
        }
      }
    }
    return [...tagSet].sort()
  }

  export const setRevert = fn(
    z.object({
      sessionID: SessionID.zod,
      revert: Info.shape.revert,
      summary: Info.shape.summary,
    }),
    async (input) => {
      return Database.use((db) => {
        const row = db
          .update(SessionTable)
          .set({
            revert: input.revert ?? null,
            summary_additions: input.summary?.additions,
            summary_deletions: input.summary?.deletions,
            summary_files: input.summary?.files,
            time_updated: Date.now(),
          })
          .where(eq(SessionTable.id, input.sessionID))
          .returning()
          .get()
        if (!row) throw new NotFoundError({ message: `Session not found: ${input.sessionID}` })
        const info = fromRow(row)
        Database.effect(() => Bus.publish(Event.Updated, { info }))
        return info
      })
    },
  )

  export const clearRevert = fn(SessionID.zod, async (sessionID) => {
    return Database.use((db) => {
      const row = db
        .update(SessionTable)
        .set({
          revert: null,
          time_updated: Date.now(),
        })
        .where(eq(SessionTable.id, sessionID))
        .returning()
        .get()
      if (!row) throw new NotFoundError({ message: `Session not found: ${sessionID}` })
      const info = fromRow(row)
      Database.effect(() => Bus.publish(Event.Updated, { info }))
      return info
    })
  })

  export const setSummary = fn(
    z.object({
      sessionID: SessionID.zod,
      summary: Info.shape.summary,
    }),
    async (input) => {
      return Database.use((db) => {
        const row = db
          .update(SessionTable)
          .set({
            summary_additions: input.summary?.additions,
            summary_deletions: input.summary?.deletions,
            summary_files: input.summary?.files,
            time_updated: Date.now(),
          })
          .where(eq(SessionTable.id, input.sessionID))
          .returning()
          .get()
        if (!row) throw new NotFoundError({ message: `Session not found: ${input.sessionID}` })
        const info = fromRow(row)
        Database.effect(() => Bus.publish(Event.Updated, { info }))
        return info
      })
    },
  )

  export const diff = fn(SessionID.zod, async (sessionID) => {
    try {
      return await Storage.read<Snapshot.FileDiff[]>(["session_diff", sessionID])
    } catch (e) {
      log.debug("session diff not found, returning empty", { sessionID, error: e })
      return []
    }
  })

  export const messages = fn(
    z.object({
      sessionID: SessionID.zod,
      limit: z.number().optional(),
    }),
    async (input) => {
      const result = [] as Message.WithParts[]
      for await (const msg of Message.stream(input.sessionID)) {
        if (input.limit && result.length >= input.limit) break
        result.push(msg)
      }
      result.reverse()
      return result
    },
  )

  export const history = fn(
    z.object({
      limit: z.number().optional().default(500),
    }),
    async (input) => {
      const projectID = Instance.project.id
      const rows = Database.use((db) =>
        db
          .select({
            sessionID: SessionTable.id,
            timeCreated: MessageTable.time_created,
            partData: PartTable.data,
          })
          .from(MessageTable)
          .innerJoin(SessionTable, eq(SessionTable.id, MessageTable.session_id))
          .innerJoin(PartTable, eq(PartTable.message_id, MessageTable.id))
          .where(
            and(
              eq(SessionTable.project_id, projectID),
              sql`json_extract(${MessageTable.data}, '$.role') = 'user'`,
              sql`json_extract(${PartTable.data}, '$.type') = 'text'`,
            ),
          )
          .orderBy(desc(MessageTable.time_created))
          .limit(input.limit)
          .all(),
      )

      const result: Array<{ display: string; sessionID: string; timestamp: number }> = []
      const seen = new Set<string>()

      for (const row of rows) {
        // PartData is a discriminated union — the SQL WHERE clause already
        // filters to type='text' parts, but TypeScript can't narrow from SQL.
        const partData = row.partData as { type: string; text?: string }
        const text = partData.text
        if (typeof text === "string" && text.trim().length > 0) {
          const display = text.trim()
          if (!seen.has(display)) {
            seen.add(display)
            result.push({
              display,
              sessionID: row.sessionID,
              timestamp: row.timeCreated,
            })
          }
        }
      }

      return result
    },
  )

  export function* list(input?: {
    directory?: string
    workspaceID?: WorkspaceID
    roots?: boolean
    start?: number
    search?: string
    limit?: number
    archived?: boolean
    tag?: string
  }) {
    const project = Instance.project
    const conditions = [eq(SessionTable.project_id, project.id)]

    if (WorkspaceContext.workspaceID) {
      conditions.push(eq(SessionTable.workspace_id, WorkspaceContext.workspaceID))
    }
    if (input?.directory) {
      conditions.push(eq(SessionTable.directory, input.directory))
    }
    if (input?.roots) {
      conditions.push(isNull(SessionTable.parent_id))
    }
    if (input?.start) {
      conditions.push(gte(SessionTable.time_updated, input.start))
    }
    if (input?.search) {
      conditions.push(like(SessionTable.title, `%${input.search}%`))
    }
    if (input?.tag) {
      conditions.push(like(SessionTable.tags, `%${input.tag}%`))
    }
    if (!input?.archived) {
      conditions.push(isNull(SessionTable.time_archived))
    } else {
      conditions.push(isNotNull(SessionTable.time_archived))
    }

    const limit = input?.limit ?? 100

    const rows = Database.use((db) =>
      db
        .select()
        .from(SessionTable)
        .where(and(...conditions))
        .orderBy(desc(SessionTable.time_updated))
        .limit(limit)
        .all(),
    )
    for (const row of rows) {
      yield fromRow(row)
    }
  }

  export const children = fn(SessionID.zod, async (parentID) => {
    const project = Instance.project
    const rows = Database.use((db) =>
      db
        .select()
        .from(SessionTable)
        .where(and(eq(SessionTable.project_id, project.id), eq(SessionTable.parent_id, parentID)))
        .all(),
    )
    return rows.map(fromRow)
  })

  export const remove = fn(SessionID.zod, async (sessionID) => {
    const _project = Instance.project
    try {
      const session = await get(sessionID)
      for (const child of await children(sessionID)) {
        await remove(child.id)
      }
      await unshare(sessionID).catch((e) => log.debug("unshare failed during remove", { sessionID, error: e }))
      // CASCADE delete handles messages and parts automatically
      Database.use((db) => {
        db.delete(SessionTable).where(eq(SessionTable.id, sessionID)).run()
        Database.effect(() => {
          FTS.removeSession(sessionID)
          Bus.publish(Event.Deleted, {
            info: session,
          })
        })
      })
      sessionAgentCounts.delete(sessionID)
    } catch (e) {
      log.error("remove", { error: e })
    }
  })

  export const updateMessage = fn(Message.Info, async (msg) => {
    const time_created = msg.time.created
    const { id, sessionID, ...data } = msg
    Database.use((db) => {
      db.insert(MessageTable)
        .values({
          id,
          session_id: sessionID,
          time_created,
          data,
        })
        .onConflictDoUpdate({ target: MessageTable.id, set: { data } })
        .run()
      Database.effect(() =>
        Bus.publish(Message.Event.Updated, {
          info: msg,
        }),
      )
    })
    return msg
  })

  export const removeMessage = fn(
    z.object({
      sessionID: SessionID.zod,
      messageID: MessageID.zod,
    }),
    async (input) => {
      // CASCADE delete handles parts automatically
      Database.use((db) => {
        db.delete(MessageTable)
          .where(and(eq(MessageTable.id, input.messageID), eq(MessageTable.session_id, input.sessionID)))
          .run()
        Database.effect(() =>
          Bus.publish(Message.Event.Removed, {
            sessionID: input.sessionID,
            messageID: input.messageID,
          }),
        )
      })
      return input.messageID
    },
  )

  export const removePart = fn(
    z.object({
      sessionID: SessionID.zod,
      messageID: MessageID.zod,
      partID: PartID.zod,
    }),
    async (input) => {
      Database.use((db) => {
        db.delete(PartTable)
          .where(and(eq(PartTable.id, input.partID), eq(PartTable.session_id, input.sessionID)))
          .run()
        Database.effect(() =>
          Bus.publish(Message.Event.PartRemoved, {
            sessionID: input.sessionID,
            messageID: input.messageID,
            partID: input.partID,
          }),
        )
      })
      return input.partID
    },
  )

  const UpdatePartInput = Message.Part

  export const updatePart = fn(UpdatePartInput, async (part) => {
    const { id, messageID, sessionID, ...data } = part
    const time = Date.now()
    Database.use((db) => {
      db.insert(PartTable)
        .values({
          id,
          message_id: messageID,
          session_id: sessionID,
          time_created: time,
          data,
        })
        .onConflictDoUpdate({ target: PartTable.id, set: { data } })
        .run()
      Database.effect(() =>
        Bus.publish(Message.Event.PartUpdated, {
          part: structuredClone(part),
        }),
      )
      if (part.type === "text" && part.text) {
        // Fetch role from MessageTable to index FTS
        const msgRow = db
          .select({ role: sql<string>`json_extract(data, '$.role')` })
          .from(MessageTable)
          .where(eq(MessageTable.id, messageID))
          .get()
        if (msgRow?.role) {
          Database.effect(() => {
            FTS.index({
              sessionID,
              messageID,
              role: msgRow.role,
              content: part.text,
            })
          })
        }
      }
    })
    return part
  })

  export const updatePartDelta = fn(
    z.object({
      sessionID: SessionID.zod,
      messageID: MessageID.zod,
      partID: PartID.zod,
      field: z.string(),
      delta: z.string(),
    }),
    async (input) => {
      Bus.publish(Message.Event.PartDelta, input)
    },
  )

  export const getUsage = fn(
    z.object({
      model: z.custom<Provider.Model>(),
      usage: z.custom<LanguageModelV2Usage>(),
      metadata: z.custom<ProviderMetadata>().optional(),
    }),
    (input) => {
      const safe = (value: number) => {
        if (!Number.isFinite(value)) return 0
        return value
      }
      const inputTokens = safe(input.usage.inputTokens ?? 0)
      const outputTokens = safe(input.usage.outputTokens ?? 0)
      const reasoningTokens = safe(input.usage.reasoningTokens ?? 0)

      const cacheReadInputTokens = safe(input.usage.cachedInputTokens ?? 0)
      const cacheWriteInputTokens = safe(
        (input.metadata?.anthropic?.cacheCreationInputTokens ??
          // @ts-expect-error
          input.metadata?.bedrock?.usage?.cacheWriteInputTokens ??
          // @ts-expect-error
          input.metadata?.venice?.usage?.cacheCreationInputTokens ??
          0) as number,
      )

      // OpenRouter provides inputTokens as the total count of input tokens (including cached).
      // AFAIK other providers (OpenRouter/OpenAI/Gemini etc.) do it the same way e.g. vercel/ai#8794 (comment)
      // Anthropic does it differently though - inputTokens doesn't include cached tokens.
      // It looks like LiteAI's cost calculation assumes all providers return inputTokens the same way Anthropic does (I'm guessing getUsage logic was originally implemented with anthropic), so it's causing incorrect cost calculation for OpenRouter and others.
      const excludesCachedTokens = !!(input.metadata?.anthropic || input.metadata?.bedrock)
      const adjustedInputTokens = safe(
        excludesCachedTokens ? inputTokens : inputTokens - cacheReadInputTokens - cacheWriteInputTokens,
      )

      const total = iife(() => {
        // Anthropic doesn't provide total_tokens, also ai sdk will vastly undercount if we
        // don't compute from components
        if (
          input.model.api.npm === "@ai-sdk/anthropic" ||
          input.model.api.npm === "@ai-sdk/amazon-bedrock" ||
          input.model.api.npm === "@ai-sdk/google-vertex/anthropic"
        ) {
          return adjustedInputTokens + outputTokens + cacheReadInputTokens + cacheWriteInputTokens
        }
        return input.usage.totalTokens
      })

      const tokens = {
        total,
        input: adjustedInputTokens,
        output: outputTokens,
        reasoning: reasoningTokens,
        cache: {
          write: cacheWriteInputTokens,
          read: cacheReadInputTokens,
        },
      }

      const costInfo =
        input.model.cost?.experimentalOver200K && tokens.input + tokens.cache.read > 200_000
          ? input.model.cost.experimentalOver200K
          : input.model.cost
      return {
        cost: safe(
          new Decimal(0)
            .add(new Decimal(tokens.input).mul(costInfo?.input ?? 0).div(1_000_000))
            .add(new Decimal(tokens.output).mul(costInfo?.output ?? 0).div(1_000_000))
            .add(new Decimal(tokens.cache.read).mul(costInfo?.cache?.read ?? 0).div(1_000_000))
            .add(new Decimal(tokens.cache.write).mul(costInfo?.cache?.write ?? 0).div(1_000_000))
            // TODO: update models.dev to have better pricing model, for now:
            // charge reasoning tokens at the same rate as output tokens
            .add(new Decimal(tokens.reasoning).mul(costInfo?.output ?? 0).div(1_000_000))
            .toNumber(),
        ),
        tokens,
      }
    },
  )

  export class BusyError extends Error {
    constructor(public readonly sessionID: string) {
      super(`Session ${sessionID} is busy`)
    }
  }

  export const initialize = fn(
    z.object({
      sessionID: SessionID.zod,
      modelID: ModelID.zod,
      providerID: ProviderID.zod,
      messageID: MessageID.zod,
    }),
    async (input) => {
      await SessionPrompt.command({
        sessionID: input.sessionID,
        messageID: input.messageID,
        model: `${input.providerID}/${input.modelID}`,
        command: Command.Default.INIT,
        arguments: "",
      })
    },
  )
}
export * from "./engine/persister"
export * from "./events"
export * from "./retry"
export * from "./schema"
export * from "./status"
export * from "./step-back"
===
import path from "node:path"
import type { LanguageModelV2Usage } from "@ai-sdk/provider"
import { Log } from "@liteai/util/log"
import { NamedError } from "@liteai/util/error"
import { Slug } from "@liteai/util/slug"
import type { ProviderMetadata } from "ai"
import { Decimal } from "decimal.js"
import z from "zod"
import { Brand } from "@/brand"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { PermissionNext } from "@/permission/next"
import type { Provider } from "@/provider/provider"
import { ModelID, ProviderID } from "@/provider/schema"
import { Snapshot } from "@/snapshot"
import { Storage } from "@/storage/storage"
import { fn } from "@/util/fn"
import { iife } from "@/util/iife"
import { Command } from "../command"
import { Config } from "../config/config"
import { WorkspaceID } from "../control-plane/schema"
import { WorkspaceContext } from "../control-plane/workspace-context"
import { Flag } from "../flag/flag"
import { Hook } from "../hook"
import { Installation } from "../installation"
import { Plugin } from "../plugin"
import { Instance } from "../project/instance"
import { ProjectID } from "../project/schema"
import { and, Database, desc, eq, gte, isNotNull, isNull, like, NotFoundError, sql } from "../storage/db"
import { FTS } from "../storage/fts"
import { SessionPrompt } from "./engine"
import { Message } from "./message"
import { MessageID, PartID, SessionID } from "./schema"
import { MessageTable, PartTable, SessionTable } from "./session.sql"

export namespace Session {
  const log = Log.create({ service: "session" })

  const sessionAgentCounts = new Map<string, number>()

  export function incrementAgentCount(sessionID: string) {
    const current = sessionAgentCounts.get(sessionID) ?? 0
    sessionAgentCounts.set(sessionID, current + 1)
    return current + 1
  }

  export function decrementAgentCount(sessionID: string) {
    const current = sessionAgentCounts.get(sessionID) ?? 0
    if (current > 1) {
      sessionAgentCounts.set(sessionID, current - 1)
      return current - 1
    }
    sessionAgentCounts.delete(sessionID)
    return 0
  }

  export function getAgentCount(sessionID: string) {
    return sessionAgentCounts.get(sessionID) ?? 0
  }

  const parentTitlePrefix = "New session - "
  const childTitlePrefix = "Child session - "

  function createDefaultTitle(isChild = false) {
    return (isChild ? childTitlePrefix : parentTitlePrefix) + new Date().toISOString()
  }

  export function isDefaultTitle(title: string) {
    return new RegExp(
      `^(${parentTitlePrefix}|${childTitlePrefix})\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$`,
    ).test(title)
  }

  type SessionRow = typeof SessionTable.$inferSelect

  export function fromRow(row: SessionRow): Info {
    const summary =
      row.summary_additions !== null || row.summary_deletions !== null || row.summary_files !== null
        ? {
            additions: row.summary_additions ?? 0,
            deletions: row.summary_deletions ?? 0,
            files: row.summary_files ?? 0,
            diffs: row.summary_diffs ?? undefined,
          }
        : undefined
    const share = row.share_url ? { url: row.share_url } : undefined
    const revert = row.revert ?? undefined
    return {
      id: row.id,
      slug: row.slug,
      projectID: row.project_id,
      workspaceID: row.workspace_id ?? undefined,
      directory: row.directory,
      parentID: row.parent_id ?? undefined,
      title: row.title,
      description: row.description ?? undefined,
      version: row.version,
      summary,
      share,
      revert,
      permission: row.permission ?? undefined,
      time: {
        created: row.time_created,
        updated: row.time_updated,
        compacting: row.time_compacting ?? undefined,
        archived: row.time_archived ?? undefined,
      },
      sessionMode: (row.session_mode as "Normal" | "Coordinator" | "Swarm") ?? "Normal",
      toolProfile: (row.tool_profile as "Plan" | "Fast") ?? "Plan",
      forkEnabled: row.fork_enabled === 1,
      tags: row.tags ? row.tags.split(",").filter(Boolean) : undefined,
    }
  }

  export function toRow(info: Info) {
    return {
      id: info.id,
      project_id: info.projectID,
      workspace_id: info.workspaceID,
      parent_id: info.parentID,
      slug: info.slug,
      directory: info.directory,
      title: info.title,
      description: info.description ?? null,
      version: info.version,
      share_url: info.share?.url,
      summary_additions: info.summary?.additions,
      summary_deletions: info.summary?.deletions,
      summary_files: info.summary?.files,
      summary_diffs: info.summary?.diffs,
      revert: info.revert ?? null,
      permission: info.permission,
      time_created: info.time.created,
      time_updated: info.time.updated,
      time_compacting: info.time.compacting,
      time_archived: info.time.archived,
      session_mode: info.sessionMode ?? "Normal",
      tool_profile: info.toolProfile ?? "Plan",
      fork_enabled: info.forkEnabled ? 1 : 0,
      tags: info.tags?.join(",") ?? null,
    }
  }

  function getForkedTitle(title: string): string {
    const match = title.match(/^(.+) \(fork #(\d+)\)$/)
    if (match) {
      const base = match[1]
      const num = parseInt(match[2], 10)
      return `${base} (fork #${num + 1})`
    }
    return `${title} (fork #1)`
  }

  export const Info = z
    .object({
      id: SessionID.zod,
      slug: z.string(),
      projectID: ProjectID.zod,
      workspaceID: WorkspaceID.zod.optional(),
      directory: z.string(),
      parentID: SessionID.zod.optional(),
      summary: z
        .object({
          additions: z.number(),
          deletions: z.number(),
          files: z.number(),
          diffs: Snapshot.FileDiff.array().optional(),
        })
        .optional(),
      share: z
        .object({
          url: z.string(),
        })
        .optional(),
      title: z.string(),
      description: z.string().optional(),
      version: z.string(),
      time: z.object({
        created: z.number(),
        updated: z.number(),
        compacting: z.number().optional(),
        archived: z.number().optional(),
      }),
      permission: PermissionNext.Ruleset.optional(),
      revert: z
        .object({
          messageID: MessageID.zod,
          partID: PartID.zod.optional(),
          snapshot: z.string().optional(),
          diff: z.string().optional(),
        })
        .optional(),
      sessionMode: z.enum(["Normal", "Coordinator", "Swarm"]).default("Normal"),
      toolProfile: z.enum(["Plan", "Fast"]).default("Plan"),
      forkEnabled: z.boolean().default(false),
      tags: z.array(z.string()).optional(),
    })
    .meta({
      ref: "Session",
    })
  export type Info = z.output<typeof Info>

  export const Event = {
    Created: BusEvent.define(
      "session.created",
      z.object({
        info: Info,
      }),
    ),
    Updated: BusEvent.define(
      "session.updated",
      z.object({
        info: Info,
      }),
    ),
    Deleted: BusEvent.define(
      "session.deleted",
      z.object({
        info: Info,
      }),
    ),
    Diff: BusEvent.define(
      "session.diff",
      z.object({
        sessionID: SessionID.zod,
        diff: Snapshot.FileDiff.array(),
      }),
    ),
    Error: BusEvent.define(
      "session.error",
      z.object({
        sessionID: SessionID.zod.optional(),
        error: Message.Assistant.shape.error,
      }),
    ),
    PlanStateChanged: BusEvent.define(
      "plan.state_changed",
      z.object({
        sessionID: SessionID.zod,
        active: z.boolean(),
        planFilePath: z.string(),
        turnsSincePlanReminder: z.number(),
      }),
    ),
    PlanApprovalRequested: BusEvent.define(
      "plan.approval_requested",
      z.object({
        sessionID: SessionID.zod,
        planText: z.string(),
        planFilePath: z.string(),
      }),
    ),
  }

  export const create = fn(
    z
      .object({
        parentID: SessionID.zod.optional(),
        title: z.string().optional(),
        permission: Info.shape.permission,
        workspaceID: WorkspaceID.zod.optional(),
      })
      .optional(),
    async (input) => {
      return createNext({
        parentID: input?.parentID,
        directory: Instance.directory,
        title: input?.title,
        permission: input?.permission,
        workspaceID: input?.workspaceID,
      })
    },
  )

  export const fork = fn(
    z.object({
      sessionID: SessionID.zod,
      messageID: MessageID.zod.optional(),
    }),
    async (input) => {
      const original = await get(input.sessionID)
      if (!original) throw new Error("session not found")
      const title = getForkedTitle(original.title)
      const session = await createNext({
        directory: Instance.directory,
        workspaceID: original.workspaceID,
        title,
      })
      const msgs = await messages({ sessionID: input.sessionID })
      const idMap = new Map<string, MessageID>()

      for (const msg of msgs) {
        if (input.messageID && msg.info.id >= input.messageID) break
        const newID = MessageID.ascending()
        idMap.set(msg.info.id, newID)

        const parentID = msg.info.role === "assistant" && msg.info.parentID ? idMap.get(msg.info.parentID) : undefined
        const cloned = await updateMessage({
          ...msg.info,
          sessionID: session.id,
          id: newID,
          ...(parentID && { parentID }),
        })

        for (const part of msg.parts) {
          await updatePart({
            ...part,
            id: PartID.ascending(),
            messageID: cloned.id,
            sessionID: session.id,
          })
        }
      }
      return session
    },
  )

  // ─── Fork-at-checkpoint errors (NamedError-based per §5) ──────────────────
  const ForkProviderModelNotFoundData = z.object({
    message: z.string(),
    providerID: z.string(),
    modelID: z.string(),
  })
  export class ForkProviderModelNotFoundError extends NamedError.create(
    "ForkProviderModelNotFoundError",
    ForkProviderModelNotFoundData,
  ) {}

  const ForkAgentNotFoundData = z.object({
    message: z.string(),
    agent: z.string(),
  })
  export class ForkAgentNotFoundError extends NamedError.create("ForkAgentNotFoundError", ForkAgentNotFoundData) {}

  export const forkAtCheckpoint = fn(
    z.object({
      sessionID: SessionID.zod,
      checkpointID: z.string(),
      model: z.object({ providerID: ProviderID.zod, modelID: ModelID.zod }).optional(),
      agent: z.string().optional(),
      guidance: z.string().optional(),
      /**
       * Optional injected Checkpointer for DI/testing.
       * Uses z.custom() to pass the interface through Zod validation without serialization.
       * When omitted, lazily instantiates SqliteCheckpointer (production default).
       */
      _checkpointer: z.custom<import("./engine/loop/checkpointer").Checkpointer>().optional(),
    }),
    async (input) => {
      // Validation
      if (input.model) {
        const { Provider } = await import("../provider/provider")
        const model = await Provider.getModel(input.model.providerID, input.model.modelID)
        if (!model)
          throw new ForkProviderModelNotFoundError({
            message: `Model not found: ${input.model.providerID}/${input.model.modelID}`,
            providerID: input.model.providerID,
            modelID: input.model.modelID,
          })
      }
      if (input.agent) {
        const { Agent } = await import("../agent/agent")
        const agent = await Agent.get(input.agent)
        if (!agent)
          throw new ForkAgentNotFoundError({
            message: `Agent not found: ${input.agent}`,
            agent: input.agent,
          })
      }

      // 1. Retrieve source session and checkpoint — lazy default for Checkpointer
      const source = await get(input.sessionID)
      const checkpointer = input._checkpointer ?? new (await import("./engine/loop/checkpointer")).SqliteCheckpointer()
      const checkpoint = checkpointer.getCheckpoint(input.sessionID, input.checkpointID)
      if (!checkpoint) {
        const { CheckpointNotFoundError } = await import("./engine/loop/checkpoint-store")
        throw new CheckpointNotFoundError({ checkpointID: input.checkpointID, sessionID: input.sessionID })
      }

      // 2. Create new session (no parentID to avoid confusing tree)
      const title = getForkedTitle(source.title)
      const session = await createNext({
        directory: source.directory,
        workspaceID: source.workspaceID,
        title,
      })

      // 3. Copy messages from checkpoint.messages
      const idMap = new Map<string, MessageID>()
      let lastUserMessage: Message.WithParts | undefined

      for (const msg of checkpoint.messages) {
        const newID = MessageID.ascending()
        idMap.set(msg.info.id, newID)

        const parentID = msg.info.role === "assistant" && msg.info.parentID ? idMap.get(msg.info.parentID) : undefined
        const cloned = await updateMessage({
          ...msg.info,
          sessionID: session.id,
          id: newID,
          ...(parentID && { parentID }),
        })

        for (const part of msg.parts) {
          await updatePart({
            ...part,
            id: PartID.ascending(),
            messageID: cloned.id,
            sessionID: session.id,
          })
        }

        if (cloned.role === "user") {
          lastUserMessage = { info: cloned, parts: [] }
        }
      }

      // 4. Apply model/agent overrides to the last user message
      if (lastUserMessage && (input.model || input.agent)) {
        await updateMessage({
          ...lastUserMessage.info,
          ...(input.model && { model: input.model }),
          ...(input.agent && { agent: input.agent }),
        } as Message.User)
      }

      // 5. Inject guidance message if provided
      if (input.guidance) {
        const guidanceMsgID = MessageID.ascending()
        await updateMessage({
          id: guidanceMsgID,
          sessionID: session.id,
          role: "user",
          agent: input.agent ?? (lastUserMessage?.info as Message.User)?.agent ?? "unknown",
          variant: "default",
          time: { created: Date.now() },
          model: input.model ??
            (lastUserMessage?.info as Message.User)?.model ?? {
              providerID: "unknown" as ProviderID,
              modelID: "unknown" as ModelID,
            },
        })
        await updatePart({
          id: PartID.ascending(),
          sessionID: session.id,
          messageID: guidanceMsgID,
          type: "text",
          text: input.guidance,
          synthetic: true,
        })
      }

      return session
    },
  )

  export const touch = fn(SessionID.zod, async (sessionID) => {
    const now = Date.now()
    Database.use((db) => {
      const row = db
        .update(SessionTable)
        .set({ time_updated: now })
        .where(eq(SessionTable.id, sessionID))
        .returning()
        .get()
      if (!row) throw new NotFoundError({ message: `Session not found: ${sessionID}` })
      const info = fromRow(row)
      Database.effect(() => Bus.publish(Event.Updated, { info }))
    })
  })

  export async function createNext(input: {
    id?: SessionID
    title?: string
    parentID?: SessionID
    workspaceID?: WorkspaceID
    directory: string
    permission?: PermissionNext.Ruleset
  }) {
    const result: Info = {
      id: SessionID.descending(input.id),
      slug: Slug.create(),
      version: Installation.VERSION,
      projectID: Instance.project.id,
      directory: input.directory,
      workspaceID: input.workspaceID,
      parentID: input.parentID,
      title: input.title ?? createDefaultTitle(!!input.parentID),
      permission: input.permission,
      time: {
        created: Date.now(),
        updated: Date.now(),
      },
      sessionMode: "Normal" as const,
      toolProfile: "Plan" as const,
      forkEnabled: false,
    }
    log.info("created", result)
    Database.use((db) => {
      db.insert(SessionTable).values(toRow(result)).run()
      Database.effect(() =>
        Bus.publish(Event.Created, {
          info: result,
        }),
      )
    })
    const cfg = await Config.get()
    if (!result.parentID && (Flag.LITEAI_AUTO_SHARE || cfg.share === "auto"))
      share(result.id).catch((e) => {
        log.warn("auto-share failed on session creation", { sessionID: result.id, error: e })
      })
    Bus.publish(Event.Updated, {
      info: result,
    })
    const defAgentName = await import("../agent/agent").then((m) => m.Agent.defaultAgent())
    const defAgent = await import("../agent/agent").then((m) => m.Agent.get(defAgentName))

    // Resolve a model for the hook context message: prefer agent's explicit model, fall back to default
    const hookModel =
      defAgent.model ??
      (await import("../provider/provider").then((m) => m.Provider.defaultModel()).catch(() => undefined))

    const sessionHook = await Hook.dispatch("SessionStart", {
      session_id: result.id,
      cwd: result.directory,
      hook_event_name: "SessionStart",
      source: input.parentID ? "resume" : "startup",
      model: hookModel ? `${hookModel.providerID}/${hookModel.modelID}` : "unknown",
      agent_type: defAgentName,
    })

    if (sessionHook.context) {
      if (!hookModel) {
        log.warn("SessionStart hook returned context but no model is available — skipping synthetic message", {
          sessionID: result.id,
          agent: defAgentName,
        })
      } else {
        const messageID = MessageID.ascending()
        await updateMessage({
          id: messageID,
          sessionID: result.id,
          role: "user",
          time: { created: Date.now() },
          agent: defAgentName,
          model: hookModel,
        } as import("./message").Message.User)
        await updatePart({
          id: PartID.ascending(),
          sessionID: result.id,
          messageID,
          type: "text",
          text: sessionHook.context,
          synthetic: true,
        })
      }
    }

    await Plugin.trigger("session.start", { sessionID: result.id }, {})

    const { IsolationArtifactRegistry } = await import("@/isolation/registry")
    IsolationArtifactRegistry.cleanupStaleIsolationArtifacts().catch((e) => {
      log.warn("failed to clean up stale isolation artifacts", { error: e })
    })

    return result
  }

  export function plan(input: { slug: string; time: { created: number } }) {
    const rootDir = Instance.project.vcs ? Instance.worktree : Instance.directory
    const base = path.join(rootDir, Brand.dir, "plans")
    return path.join(base, `${[input.time.created, input.slug].join("-")}.md`)
  }

  export const get = fn(SessionID.zod, async (id) => {
    const row = Database.use((db) => db.select().from(SessionTable).where(eq(SessionTable.id, id)).get())
    if (!row) throw new NotFoundError({ message: `Session not found: ${id}` })
    return fromRow(row)
  })

  export const share = fn(SessionID.zod, async (id) => {
    const cfg = await Config.get()
    if (cfg.share === "disabled") {
      throw new Error("Sharing is disabled in configuration")
    }
    const { ShareNext } = await import("@/share/share-next")
    const share = await ShareNext.create(id)
    Database.use((db) => {
      const row = db.update(SessionTable).set({ share_url: share.url }).where(eq(SessionTable.id, id)).returning().get()
      if (!row) throw new NotFoundError({ message: `Session not found: ${id}` })
      const info = fromRow(row)
      Database.effect(() => Bus.publish(Event.Updated, { info }))
    })
    return share
  })

  export const unshare = fn(SessionID.zod, async (id) => {
    // Use ShareNext to remove the share (same as share function uses ShareNext to create)
    const { ShareNext } = await import("@/share/share-next")
    await ShareNext.remove(id)
    Database.use((db) => {
      const row = db.update(SessionTable).set({ share_url: null }).where(eq(SessionTable.id, id)).returning().get()
      if (!row) throw new NotFoundError({ message: `Session not found: ${id}` })
      const info = fromRow(row)
      Database.effect(() => Bus.publish(Event.Updated, { info }))
    })
  })

  export const setTitle = fn(
    z.object({
      sessionID: SessionID.zod,
      title: z.string(),
    }),
    async (input) => {
      return Database.use((db) => {
        const row = db
          .update(SessionTable)
          .set({ title: input.title })
          .where(eq(SessionTable.id, input.sessionID))
          .returning()
          .get()
        if (!row) throw new NotFoundError({ message: `Session not found: ${input.sessionID}` })
        const info = fromRow(row)
        Database.effect(() => Bus.publish(Event.Updated, { info }))
        return info
      })
    },
  )

  export const setDescription = fn(
    z.object({
      sessionID: SessionID.zod,
      description: z.string().optional(),
    }),
    async (input) => {
      return Database.use((db) => {
        const row = db
          .update(SessionTable)
          .set({ description: input.description ?? null })
          .where(eq(SessionTable.id, input.sessionID))
          .returning()
          .get()
        if (!row) throw new NotFoundError({ message: `Session not found: ${input.sessionID}` })
        const info = fromRow(row)
        Database.effect(() => Bus.publish(Event.Updated, { info }))
        return info
      })
    },
  )

  export const setArchived = fn(
    z.object({
      sessionID: SessionID.zod,
      time: z.number().optional(),
    }),
    async (input) => {
      return Database.use((db) => {
        const row = db
          .update(SessionTable)
          .set({ time_archived: input.time })
          .where(eq(SessionTable.id, input.sessionID))
          .returning()
          .get()
        if (!row) throw new NotFoundError({ message: `Session not found: ${input.sessionID}` })
        const info = fromRow(row)
        Database.effect(() => Bus.publish(Event.Updated, { info }))
        return info
      })
    },
  )

  export const setPermission = fn(
    z.object({
      sessionID: SessionID.zod,
      permission: PermissionNext.Ruleset,
    }),
    async (input) => {
      return Database.use((db) => {
        const row = db
          .update(SessionTable)
          .set({ permission: input.permission, time_updated: Date.now() })
          .where(eq(SessionTable.id, input.sessionID))
          .returning()
          .get()
        if (!row) throw new NotFoundError({ message: `Session not found: ${input.sessionID}` })
        const info = fromRow(row)
        Database.effect(() => Bus.publish(Event.Updated, { info }))
        return info
      })
    },
  )

  export const setConfig = fn(
    z.object({
      sessionID: SessionID.zod,
      sessionMode: Info.shape.sessionMode.optional(),
      toolProfile: Info.shape.toolProfile.optional(),
      forkEnabled: Info.shape.forkEnabled.optional(),
    }),
    async (input) => {
      return Database.use((db) => {
        const updates: Record<string, unknown> = { time_updated: Date.now() }
        if (input.sessionMode !== undefined) updates.session_mode = input.sessionMode
        if (input.toolProfile !== undefined) updates.tool_profile = input.toolProfile
        if (input.forkEnabled !== undefined) updates.fork_enabled = input.forkEnabled ? 1 : 0

        const row = db.update(SessionTable).set(updates).where(eq(SessionTable.id, input.sessionID)).returning().get()
        if (!row) throw new NotFoundError({ message: `Session not found: ${input.sessionID}` })
        const info = fromRow(row)
        Database.effect(() => Bus.publish(Event.Updated, { info }))
        return info
      })
    },
  )

  export const setTags = fn(
    z.object({
      sessionID: SessionID.zod,
      tags: z.array(z.string()),
    }),
    async (input) => {
      return Database.use((db) => {
        const row = db
          .update(SessionTable)
          .set({ tags: input.tags.join(","), time_updated: Date.now() })
          .where(eq(SessionTable.id, input.sessionID))
          .returning()
          .get()
        if (!row) throw new NotFoundError({ message: `Session not found: ${input.sessionID}` })
        const info = fromRow(row)
        Database.effect(() => Bus.publish(Event.Updated, { info }))
        return info
      })
    },
  )

  export function listTags(): string[] {
    const rows = Database.use((db) =>
      db.select({ tags: SessionTable.tags }).from(SessionTable).where(isNotNull(SessionTable.tags)).all(),
    )
    const tagSet = new Set<string>()
    for (const row of rows) {
      if (row.tags) {
        for (const t of row.tags.split(",")) {
          if (t.trim()) tagSet.add(t.trim())
        }
      }
    }
    return [...tagSet].sort()
  }

  export const setRevert = fn(
    z.object({
      sessionID: SessionID.zod,
      revert: Info.shape.revert,
      summary: Info.shape.summary,
    }),
    async (input) => {
      return Database.use((db) => {
        const row = db
          .update(SessionTable)
          .set({
            revert: input.revert ?? null,
            summary_additions: input.summary?.additions,
            summary_deletions: input.summary?.deletions,
            summary_files: input.summary?.files,
            time_updated: Date.now(),
          })
          .where(eq(SessionTable.id, input.sessionID))
          .returning()
          .get()
        if (!row) throw new NotFoundError({ message: `Session not found: ${input.sessionID}` })
        const info = fromRow(row)
        Database.effect(() => Bus.publish(Event.Updated, { info }))
        return info
      })
    },
  )

  export const clearRevert = fn(SessionID.zod, async (sessionID) => {
    return Database.use((db) => {
      const row = db
        .update(SessionTable)
        .set({
          revert: null,
          time_updated: Date.now(),
        })
        .where(eq(SessionTable.id, sessionID))
        .returning()
        .get()
      if (!row) throw new NotFoundError({ message: `Session not found: ${sessionID}` })
      const info = fromRow(row)
      Database.effect(() => Bus.publish(Event.Updated, { info }))
      return info
    })
  })

  export const setSummary = fn(
    z.object({
      sessionID: SessionID.zod,
      summary: Info.shape.summary,
    }),
    async (input) => {
      return Database.use((db) => {
        const row = db
          .update(SessionTable)
          .set({
            summary_additions: input.summary?.additions,
            summary_deletions: input.summary?.deletions,
            summary_files: input.summary?.files,
            time_updated: Date.now(),
          })
          .where(eq(SessionTable.id, input.sessionID))
          .returning()
          .get()
        if (!row) throw new NotFoundError({ message: `Session not found: ${input.sessionID}` })
        const info = fromRow(row)
        Database.effect(() => Bus.publish(Event.Updated, { info }))
        return info
      })
    },
  )

  export const diff = fn(SessionID.zod, async (sessionID) => {
    try {
      return await Storage.read<Snapshot.FileDiff[]>(["session_diff", sessionID])
    } catch (e) {
      log.debug("session diff not found, returning empty", { sessionID, error: e })
      return []
    }
  })

  export const messages = fn(
    z.object({
      sessionID: SessionID.zod,
      limit: z.number().optional(),
    }),
    async (input) => {
      const result = [] as Message.WithParts[]
      for await (const msg of Message.stream(input.sessionID)) {
        if (input.limit && result.length >= input.limit) break
        result.push(msg)
      }
      result.reverse()
      return result
    },
  )

  export const history = fn(
    z.object({
      limit: z.number().optional().default(500),
    }),
    async (input) => {
      const projectID = Instance.project.id
      const rows = Database.use((db) =>
        db
          .select({
            sessionID: SessionTable.id,
            timeCreated: MessageTable.time_created,
            partData: PartTable.data,
          })
          .from(MessageTable)
          .innerJoin(SessionTable, eq(SessionTable.id, MessageTable.session_id))
          .innerJoin(PartTable, eq(PartTable.message_id, MessageTable.id))
          .where(
            and(
              eq(SessionTable.project_id, projectID),
              sql`json_extract(${MessageTable.data}, '$.role') = 'user'`,
              sql`json_extract(${PartTable.data}, '$.type') = 'text'`,
            ),
          )
          .orderBy(desc(MessageTable.time_created))
          .limit(input.limit)
          .all(),
      )

      const result: Array<{ display: string; sessionID: string; timestamp: number }> = []
      const seen = new Set<string>()

      for (const row of rows) {
        // PartData is a discriminated union — the SQL WHERE clause already
        // filters to type='text' parts, but TypeScript can't narrow from SQL.
        const partData = row.partData as { type: string; text?: string }
        const text = partData.text
        if (typeof text === "string" && text.trim().length > 0) {
          const display = text.trim()
          if (!seen.has(display)) {
            seen.add(display)
            result.push({
              display,
              sessionID: row.sessionID,
              timestamp: row.timeCreated,
            })
          }
        }
      }

      return result
    },
  )

  export function* list(input?: {
    directory?: string
    workspaceID?: WorkspaceID
    roots?: boolean
    start?: number
    search?: string
    limit?: number
    archived?: boolean
    tag?: string
  }) {
    const project = Instance.project
    const conditions = [eq(SessionTable.project_id, project.id)]

    if (WorkspaceContext.workspaceID) {
      conditions.push(eq(SessionTable.workspace_id, WorkspaceContext.workspaceID))
    }
    if (input?.directory) {
      conditions.push(eq(SessionTable.directory, input.directory))
    }
    if (input?.roots) {
      conditions.push(isNull(SessionTable.parent_id))
    }
    if (input?.start) {
      conditions.push(gte(SessionTable.time_updated, input.start))
    }
    if (input?.search) {
      conditions.push(like(SessionTable.title, `%${input.search}%`))
    }
    if (input?.tag) {
      conditions.push(like(SessionTable.tags, `%${input.tag}%`))
    }
    if (!input?.archived) {
      conditions.push(isNull(SessionTable.time_archived))
    } else {
      conditions.push(isNotNull(SessionTable.time_archived))
    }

    const limit = input?.limit ?? 100

    const rows = Database.use((db) =>
      db
        .select()
        .from(SessionTable)
        .where(and(...conditions))
        .orderBy(desc(SessionTable.time_updated))
        .limit(limit)
        .all(),
    )
    for (const row of rows) {
      yield fromRow(row)
    }
  }

  export const children = fn(SessionID.zod, async (parentID) => {
    const project = Instance.project
    const rows = Database.use((db) =>
      db
        .select()
        .from(SessionTable)
        .where(and(eq(SessionTable.project_id, project.id), eq(SessionTable.parent_id, parentID)))
        .all(),
    )
    return rows.map(fromRow)
  })

  export const remove = fn(SessionID.zod, async (sessionID) => {
    const _project = Instance.project
    try {
      const session = await get(sessionID)
      for (const child of await children(sessionID)) {
        await remove(child.id)
      }
      await unshare(sessionID).catch((e) => log.debug("unshare failed during remove", { sessionID, error: e }))
      // CASCADE delete handles messages and parts automatically
      Database.use((db) => {
        db.delete(SessionTable).where(eq(SessionTable.id, sessionID)).run()
        Database.effect(() => {
          FTS.removeSession(sessionID)
          Bus.publish(Event.Deleted, {
            info: session,
          })
        })
      })
      sessionAgentCounts.delete(sessionID)
    } catch (e) {
      log.error("remove", { error: e })
    }
  })

  export const updateMessage = fn(Message.Info, async (msg) => {
    const time_created = msg.time.created
    const { id, sessionID, ...data } = msg
    Database.use((db) => {
      db.insert(MessageTable)
        .values({
          id,
          session_id: sessionID,
          time_created,
          data,
        })
        .onConflictDoUpdate({ target: MessageTable.id, set: { data } })
        .run()
      Database.effect(() =>
        Bus.publish(Message.Event.Updated, {
          info: msg,
        }),
      )
    })
    return msg
  })

  export const removeMessage = fn(
    z.object({
      sessionID: SessionID.zod,
      messageID: MessageID.zod,
    }),
    async (input) => {
      // CASCADE delete handles parts automatically
      Database.use((db) => {
        db.delete(MessageTable)
          .where(and(eq(MessageTable.id, input.messageID), eq(MessageTable.session_id, input.sessionID)))
          .run()
        Database.effect(() =>
          Bus.publish(Message.Event.Removed, {
            sessionID: input.sessionID,
            messageID: input.messageID,
          }),
        )
      })
      return input.messageID
    },
  )

  export const removePart = fn(
    z.object({
      sessionID: SessionID.zod,
      messageID: MessageID.zod,
      partID: PartID.zod,
    }),
    async (input) => {
      Database.use((db) => {
        db.delete(PartTable)
          .where(and(eq(PartTable.id, input.partID), eq(PartTable.session_id, input.sessionID)))
          .run()
        Database.effect(() =>
          Bus.publish(Message.Event.PartRemoved, {
            sessionID: input.sessionID,
            messageID: input.messageID,
            partID: input.partID,
          }),
        )
      })
      return input.partID
    },
  )

  const UpdatePartInput = Message.Part

  export const updatePart = fn(UpdatePartInput, async (part) => {
    const { id, messageID, sessionID, ...data } = part
    const time = Date.now()
    Database.use((db) => {
      db.insert(PartTable)
        .values({
          id,
          message_id: messageID,
          session_id: sessionID,
          time_created: time,
          data,
        })
        .onConflictDoUpdate({ target: PartTable.id, set: { data } })
        .run()
      Database.effect(() =>
        Bus.publish(Message.Event.PartUpdated, {
          part: structuredClone(part),
        }),
      )
      if (part.type === "text" && part.text) {
        // Fetch role from MessageTable to index FTS
        const msgRow = db
          .select({ role: sql<string>`json_extract(data, '$.role')` })
          .from(MessageTable)
          .where(eq(MessageTable.id, messageID))
          .get()
        if (msgRow?.role) {
          Database.effect(() => {
            FTS.index({
              sessionID,
              messageID,
              role: msgRow.role,
              content: part.text,
            })
          })
        }
      }
    })
    return part
  })

  export const updatePartDelta = fn(
    z.object({
      sessionID: SessionID.zod,
      messageID: MessageID.zod,
      partID: PartID.zod,
      field: z.string(),
      delta: z.string(),
    }),
    async (input) => {
      Bus.publish(Message.Event.PartDelta, input)
    },
  )

  export const getUsage = fn(
    z.object({
      model: z.custom<Provider.Model>(),
      usage: z.custom<LanguageModelV2Usage>(),
      metadata: z.custom<ProviderMetadata>().optional(),
    }),
    (input) => {
      const safe = (value: number) => {
        if (!Number.isFinite(value)) return 0
        return value
      }
      const inputTokens = safe(input.usage.inputTokens ?? 0)
      const outputTokens = safe(input.usage.outputTokens ?? 0)
      const reasoningTokens = safe(input.usage.reasoningTokens ?? 0)

      const cacheReadInputTokens = safe(input.usage.cachedInputTokens ?? 0)
      const cacheWriteInputTokens = safe(
        (input.metadata?.anthropic?.cacheCreationInputTokens ??
          // @ts-expect-error
          input.metadata?.bedrock?.usage?.cacheWriteInputTokens ??
          // @ts-expect-error
          input.metadata?.venice?.usage?.cacheCreationInputTokens ??
          0) as number,
      )

      // OpenRouter provides inputTokens as the total count of input tokens (including cached).
      // AFAIK other providers (OpenRouter/OpenAI/Gemini etc.) do it the same way e.g. vercel/ai#8794 (comment)
      // Anthropic does it differently though - inputTokens doesn't include cached tokens.
      // It looks like LiteAI's cost calculation assumes all providers return inputTokens the same way Anthropic does (I'm guessing getUsage logic was originally implemented with anthropic), so it's causing incorrect cost calculation for OpenRouter and others.
      const excludesCachedTokens = !!(input.metadata?.anthropic || input.metadata?.bedrock)
      const adjustedInputTokens = safe(
        excludesCachedTokens ? inputTokens : inputTokens - cacheReadInputTokens - cacheWriteInputTokens,
      )

      const total = iife(() => {
        // Anthropic doesn't provide total_tokens, also ai sdk will vastly undercount if we
        // don't compute from components
        if (
          input.model.api.npm === "@ai-sdk/anthropic" ||
          input.model.api.npm === "@ai-sdk/amazon-bedrock" ||
          input.model.api.npm === "@ai-sdk/google-vertex/anthropic"
        ) {
          return adjustedInputTokens + outputTokens + cacheReadInputTokens + cacheWriteInputTokens
        }
        return input.usage.totalTokens
      })

      const tokens = {
        total,
        input: adjustedInputTokens,
        output: outputTokens,
        reasoning: reasoningTokens,
        cache: {
          write: cacheWriteInputTokens,
          read: cacheReadInputTokens,
        },
      }

      const costInfo =
        input.model.cost?.experimentalOver200K && tokens.input + tokens.cache.read > 200_000
          ? input.model.cost.experimentalOver200K
          : input.model.cost
      return {
        cost: safe(
          new Decimal(0)
            .add(new Decimal(tokens.input).mul(costInfo?.input ?? 0).div(1_000_000))
            .add(new Decimal(tokens.output).mul(costInfo?.output ?? 0).div(1_000_000))
            .add(new Decimal(tokens.cache.read).mul(costInfo?.cache?.read ?? 0).div(1_000_000))
            .add(new Decimal(tokens.cache.write).mul(costInfo?.cache?.write ?? 0).div(1_000_000))
            // TODO: update models.dev to have better pricing model, for now:
            // charge reasoning tokens at the same rate as output tokens
            .add(new Decimal(tokens.reasoning).mul(costInfo?.output ?? 0).div(1_000_000))
            .toNumber(),
        ),
        tokens,
      }
    },
  )

  export class BusyError extends Error {
    constructor(public readonly sessionID: string) {
      super(`Session ${sessionID} is busy`)
    }
  }

  export const initialize = fn(
    z.object({
      sessionID: SessionID.zod,
      modelID: ModelID.zod,
      providerID: ProviderID.zod,
      messageID: MessageID.zod,
    }),
    async (input) => {
      await SessionPrompt.command({
        sessionID: input.sessionID,
        messageID: input.messageID,
        model: `${input.providerID}/${input.modelID}`,
        command: Command.Default.INIT,
        arguments: "",
      })
    },
  )
}
export * from "./engine/persister"
export * from "./events"
export * from "./retry"
export * from "./schema"
export * from "./status"
export * from "./step-back"
```

### [session.ts (routes)](file:///d:/liteai/packages/core/src/server/routes/session.ts)

```diff:session.ts
import { Log } from "@liteai/util/log"
import { Hono } from "hono"
import { stream } from "hono/streaming"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { ModelID, ProviderID } from "@/provider/schema"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { SessionStatus } from "@/session/status"
import { SessionSummary } from "@/session/tasks/summary"
import { Snapshot } from "@/snapshot"
import { Agent } from "../../agent/agent"
import { Session } from "../../session"
import { SessionPrompt } from "../../session/engine"
import { Message } from "../../session/message"
import { SessionRevert } from "../../session/revert"
import { SessionCompaction } from "../../session/tasks/compaction"
import { ContextBreakdown } from "../../session/tasks/context-breakdown"
import { Todo } from "../../session/todo"
import { FTS } from "../../storage/fts"
import { lazy } from "../../util/lazy"
import { errors } from "../error"

const log = Log.create({ service: "server" })

export const SessionRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List sessions",
        description: "Get a list of all LiteAI sessions, sorted by most recently updated.",
        operationId: "project.session.list",
        responses: {
          200: {
            description: "List of sessions",
            content: {
              "application/json": {
                schema: resolver(Session.Info.array()),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          directory: z.string().optional().meta({ description: "Filter sessions by project directory" }),
          roots: z.coerce.boolean().optional().meta({ description: "Only return root sessions (no parentID)" }),
          start: z.coerce
            .number()
            .optional()
            .meta({ description: "Filter sessions updated on or after this timestamp (milliseconds since epoch)" }),
          search: z.string().optional().meta({ description: "Filter sessions by title (case-insensitive)" }),
          limit: z.coerce.number().optional().meta({ description: "Maximum number of sessions to return" }),
          archived: z.coerce.boolean().optional().meta({ description: "Include archived sessions (default false)" }),
          tag: z.string().optional().meta({ description: "Filter sessions by tag" }),
        }),
      ),
      async (c) => {
        const query = c.req.valid("query")
        const sessions: Session.Info[] = []
        for await (const session of Session.list({
          directory: query.directory,
          roots: query.roots,
          start: query.start,
          search: query.search,
          limit: query.limit,
          archived: query.archived,
          tag: query.tag,
        })) {
          sessions.push(session)
        }
        return c.json(sessions)
      },
    )
    .get(
      "/tags",
      describeRoute({
        summary: "Get session tags",
        description: "Retrieve all unique tags used across sessions.",
        operationId: "project.session.tags",
        responses: {
          200: {
            description: "List of tags",
            content: {
              "application/json": {
                schema: resolver(z.array(z.string())),
              },
            },
          },
          ...errors(400),
        },
      }),
      async (c) => {
        const result = Session.listTags()
        return c.json(result)
      },
    )
    .get(
      "/status",
      describeRoute({
        summary: "Get session status",
        description: "Retrieve the current status of all sessions, including active, idle, and completed states.",
        operationId: "project.session.status",
        responses: {
          200: {
            description: "Get session status",
            content: {
              "application/json": {
                schema: resolver(z.record(z.string(), SessionStatus.Info)),
              },
            },
          },
          ...errors(400),
        },
      }),
      async (c) => {
        const result = SessionStatus.list()
        return c.json(result)
      },
    )
    .get(
      "/history",
      describeRoute({
        summary: "Get session history",
        description:
          "Retrieve all historical user prompts across all sessions for the current project, deduped and sorted newest first.",
        operationId: "project.session.history",
        responses: {
          200: {
            description: "List of history entries",
            content: {
              "application/json": {
                schema: resolver(
                  z.array(
                    z.object({
                      display: z.string(),
                      sessionID: z.string(),
                      timestamp: z.number(),
                    }),
                  ),
                ),
              },
            },
          },
          ...errors(400),
        },
      }),
      async (c) => {
        const history = await Session.history({ limit: 500 })
        return c.json(history)
      },
    )
    .get(
      "/search",
      describeRoute({
        summary: "Search messages across sessions",
        description: "Full-text search across all session message content using FTS5.",
        operationId: "project.session.search",
        responses: {
          200: {
            description: "Search results",
            content: {
              "application/json": {
                schema: resolver(
                  z.array(
                    z.object({
                      sessionID: z.string(),
                      messageID: z.string(),
                      role: z.string(),
                      snippet: z.string(),
                      rank: z.number(),
                    }),
                  ),
                ),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "query",
        z.object({
          q: z.string().min(1),
          limit: z.coerce.number().int().min(1).max(200).optional(),
        }),
      ),
      async (c) => {
        const { q, limit } = c.req.valid("query")
        try {
          const results = FTS.search(q, limit ?? 50)
          return c.json(results)
        } catch (e) {
          log.warn("FTS search failed", { query: q, error: e })
          return c.json([])
        }
      },
    )
    .get(
      "/:sessionID",
      describeRoute({
        summary: "Get session",
        description: "Retrieve detailed information about a specific LiteAI session.",
        tags: ["Session"],
        operationId: "project.session.get",
        responses: {
          200: {
            description: "Get session",
            content: {
              "application/json": {
                schema: resolver(Session.Info),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: Session.get.schema,
        }),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        log.info("SEARCH", { url: c.req.url })
        const session = await Session.get(sessionID)
        return c.json(session)
      },
    )
    .get(
      "/:sessionID/children",
      describeRoute({
        summary: "Get session children",
        tags: ["Session"],
        description: "Retrieve all child sessions that were forked from the specified parent session.",
        operationId: "project.session.children",
        responses: {
          200: {
            description: "List of children",
            content: {
              "application/json": {
                schema: resolver(Session.Info.array()),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: Session.children.schema,
        }),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const session = await Session.children(sessionID)
        return c.json(session)
      },
    )
    .get(
      "/:sessionID/todo",
      describeRoute({
        summary: "Get session todos",
        description: "Retrieve the todo list associated with a specific session, showing tasks and action items.",
        operationId: "project.session.todo",
        responses: {
          200: {
            description: "Todo list",
            content: {
              "application/json": {
                schema: resolver(Todo.Info.array()),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: SessionID.zod,
        }),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const todos = await Todo.get(sessionID)
        return c.json(todos)
      },
    )
    .post(
      "/",
      describeRoute({
        summary: "Create session",
        description: "Create a new LiteAI session for interacting with AI assistants and managing conversations.",
        operationId: "project.session.create",
        responses: {
          ...errors(400),
          200: {
            description: "Successfully created session",
            content: {
              "application/json": {
                schema: resolver(Session.Info),
              },
            },
          },
        },
      }),
      validator("json", Session.create.schema.optional()),
      async (c) => {
        const body = c.req.valid("json") ?? {}
        const session = await Session.create(body)
        return c.json(session)
      },
    )
    .delete(
      "/:sessionID",
      describeRoute({
        summary: "Delete session",
        description: "Delete a session and permanently remove all associated data, including messages and history.",
        operationId: "project.session.delete",
        responses: {
          200: {
            description: "Successfully deleted session",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: Session.remove.schema,
        }),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        await Session.remove(sessionID)
        return c.json(true)
      },
    )
    .patch(
      "/:sessionID",
      describeRoute({
        summary: "Update session",
        description: "Update properties of an existing session, such as title or other metadata.",
        operationId: "project.session.update",
        responses: {
          200: {
            description: "Successfully updated session",
            content: {
              "application/json": {
                schema: resolver(Session.Info),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: SessionID.zod,
        }),
      ),
      validator(
        "json",
        z.object({
          title: z.string().optional(),
          time: z
            .object({
              archived: z.number().optional(),
            })
            .optional(),
          sessionMode: z.enum(["Normal", "Coordinator", "Swarm"]).optional(),
          toolProfile: z.enum(["Plan", "Fast"]).optional(),
          forkEnabled: z.boolean().optional(),
          tags: z.array(z.string()).optional(),
        }),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const updates = c.req.valid("json")

        let session = await Session.get(sessionID)
        if (updates.title !== undefined) {
          session = await Session.setTitle({ sessionID, title: updates.title })
        }
        if (updates.time?.archived !== undefined) {
          session = await Session.setArchived({ sessionID, time: updates.time.archived })
        }
        if (
          updates.sessionMode !== undefined ||
          updates.toolProfile !== undefined ||
          updates.forkEnabled !== undefined
        ) {
          session = await Session.setConfig({
            sessionID,
            sessionMode: updates.sessionMode,
            toolProfile: updates.toolProfile,
            forkEnabled: updates.forkEnabled,
          })
        }
        if (updates.tags !== undefined) {
          session = await Session.setTags({ sessionID, tags: updates.tags })
        }

        return c.json(session)
      },
    )
    .post(
      "/:sessionID/init",
      describeRoute({
        summary: "Initialize session",
        description:
          "Analyze the current application and create an AGENTS.md file with project-specific agent configurations.",
        operationId: "project.session.init",
        responses: {
          200: {
            description: "200",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: SessionID.zod,
        }),
      ),
      validator("json", Session.initialize.schema.omit({ sessionID: true })),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const body = c.req.valid("json")
        await Session.initialize({ ...body, sessionID })
        return c.json(true)
      },
    )
    .post(
      "/:sessionID/fork",
      describeRoute({
        summary: "Fork session",
        description: "Create a new session by forking an existing session at a specific message point.",
        operationId: "project.session.fork",
        responses: {
          200: {
            description: "200",
            content: {
              "application/json": {
                schema: resolver(Session.Info),
              },
            },
          },
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: Session.fork.schema.shape.sessionID,
        }),
      ),
      validator("json", Session.fork.schema.omit({ sessionID: true })),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const body = c.req.valid("json")
        const result = await Session.fork({ ...body, sessionID })
        return c.json(result)
      },
    )
    .post(
      "/:sessionID/abort",
      describeRoute({
        summary: "Abort session",
        description: "Abort an active session and stop any ongoing AI processing or command execution.",
        operationId: "project.session.abort",
        responses: {
          200: {
            description: "Aborted session",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: SessionID.zod,
        }),
      ),
      async (c) => {
        SessionPrompt.cancel(c.req.valid("param").sessionID)
        return c.json(true)
      },
    )
    .post(
      "/:sessionID/share",
      describeRoute({
        summary: "Share session",
        description: "Create a shareable link for a session, allowing others to view the conversation.",
        operationId: "project.session.share",
        responses: {
          200: {
            description: "Successfully shared session",
            content: {
              "application/json": {
                schema: resolver(Session.Info),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: SessionID.zod,
        }),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        await Session.share(sessionID)
        const session = await Session.get(sessionID)
        return c.json(session)
      },
    )
    .get(
      "/:sessionID/diff",
      describeRoute({
        summary: "Get message diff",
        description: "Get the file changes (diff) that resulted from a specific user message in the session.",
        operationId: "project.session.diff",
        responses: {
          200: {
            description: "Successfully retrieved diff",
            content: {
              "application/json": {
                schema: resolver(Snapshot.FileDiff.array()),
              },
            },
          },
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: SessionSummary.diff.schema.shape.sessionID,
        }),
      ),
      validator(
        "query",
        z.object({
          messageID: SessionSummary.diff.schema.shape.messageID,
        }),
      ),
      async (c) => {
        const query = c.req.valid("query")
        const params = c.req.valid("param")
        const result = await SessionSummary.diff({
          sessionID: params.sessionID,
          messageID: query.messageID,
        })
        return c.json(result)
      },
    )
    .get(
      "/:sessionID/context",
      describeRoute({
        summary: "Get context breakdown",
        description: "Get a breakdown of token usage by category for the session's context window.",
        operationId: "project.session.context",
        responses: {
          200: {
            description: "Context breakdown",
            content: {
              "application/json": {
                schema: resolver(ContextBreakdown.Info),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: SessionID.zod,
        }),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const result = await ContextBreakdown.get({ sessionID })
        return c.json(result)
      },
    )
    .delete(
      "/:sessionID/share",
      describeRoute({
        summary: "Unshare session",
        description: "Remove the shareable link for a session, making it private again.",
        operationId: "project.session.unshare",
        responses: {
          200: {
            description: "Successfully unshared session",
            content: {
              "application/json": {
                schema: resolver(Session.Info),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: Session.unshare.schema,
        }),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        await Session.unshare(sessionID)
        const session = await Session.get(sessionID)
        return c.json(session)
      },
    )
    .post(
      "/:sessionID/summarize",
      describeRoute({
        summary: "Summarize session",
        description: "Generate a concise summary of the session using AI compaction to preserve key information.",
        operationId: "project.session.summarize",
        responses: {
          200: {
            description: "Summarized session",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: SessionID.zod,
        }),
      ),
      validator(
        "json",
        z.object({
          providerID: ProviderID.zod,
          modelID: ModelID.zod,
          auto: z.boolean().optional().default(false),
        }),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const body = c.req.valid("json")
        const session = await Session.get(sessionID)
        await SessionRevert.cleanup(session)
        const msgs = await Session.messages({ sessionID })
        let currentAgent = await Agent.defaultAgent()
        for (let i = msgs.length - 1; i >= 0; i--) {
          const info = msgs[i].info
          if (info.role === "user") {
            currentAgent = info.agent || (await Agent.defaultAgent())
            break
          }
        }
        await SessionCompaction.create({
          sessionID,
          agent: currentAgent,
          model: {
            providerID: body.providerID,
            modelID: body.modelID,
          },
          auto: body.auto,
        })
        await SessionPrompt.loop({ sessionID })
        return c.json(true)
      },
    )
    .get(
      "/:sessionID/message",
      describeRoute({
        summary: "Get session messages",
        description: "Retrieve all messages in a session, including user prompts and AI responses.",
        operationId: "project.session.messages",
        responses: {
          200: {
            description: "List of messages",
            content: {
              "application/json": {
                schema: resolver(Message.WithParts.array()),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: SessionID.zod,
        }),
      ),
      validator(
        "query",
        z
          .object({
            limit: z.coerce
              .number()
              .int()
              .min(0)
              .optional()
              .meta({ description: "Maximum number of messages to return" }),
            before: z
              .string()
              .optional()
              .meta({ description: "Opaque cursor for loading older messages" })
              .refine(
                (value) => {
                  if (!value) return true
                  try {
                    Message.cursor.decode(value)
                    return true
                  } catch {
                    return false
                  }
                },
                { message: "Invalid cursor" },
              ),
          })
          .refine((value) => !value.before || value.limit !== undefined, {
            message: "before requires limit",
            path: ["before"],
          }),
      ),
      async (c) => {
        const query = c.req.valid("query")
        const sessionID = c.req.valid("param").sessionID
        if (query.limit === undefined) {
          await Session.get(sessionID)
          const messages = await Session.messages({ sessionID })
          return c.json(messages)
        }

        if (query.limit === 0) {
          await Session.get(sessionID)
          const messages = await Session.messages({ sessionID })
          return c.json(messages)
        }

        const page = await Message.page({
          sessionID,
          limit: query.limit,
          before: query.before,
        })
        if (page.cursor) {
          const url = new URL(c.req.url)
          url.searchParams.set("limit", query.limit.toString())
          url.searchParams.set("before", page.cursor)
          c.header("Access-Control-Expose-Headers", "Link, X-Next-Cursor")
          c.header("Link", `<${url.toString()}>; rel="next"`)
          c.header("X-Next-Cursor", page.cursor)
        }
        return c.json(page.items)
      },
    )
    .get(
      "/:sessionID/message/:messageID",
      describeRoute({
        summary: "Get message",
        description: "Retrieve a specific message from a session by its message ID.",
        operationId: "project.session.message",
        responses: {
          200: {
            description: "Message",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    info: Message.Info,
                    parts: Message.Part.array(),
                  }),
                ),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: SessionID.zod,
          messageID: MessageID.zod,
        }),
      ),
      async (c) => {
        const params = c.req.valid("param")
        const message = await Message.get({
          sessionID: params.sessionID,
          messageID: params.messageID,
        })
        return c.json(message)
      },
    )
    .delete(
      "/:sessionID/message/:messageID",
      describeRoute({
        summary: "Delete message",
        description:
          "Permanently delete a specific message (and all of its parts) from a session. This does not revert any file changes that may have been made while processing the message.",
        operationId: "project.session.deleteMessage",
        responses: {
          200: {
            description: "Successfully deleted message",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: SessionID.zod,
          messageID: MessageID.zod,
        }),
      ),
      async (c) => {
        const params = c.req.valid("param")
        SessionPrompt.assertNotBusy(params.sessionID)
        await Session.removeMessage({
          sessionID: params.sessionID,
          messageID: params.messageID,
        })
        return c.json(true)
      },
    )
    .delete(
      "/:sessionID/message/:messageID/part/:partID",
      describeRoute({
        description: "Delete a part from a message",
        operationId: "project.part.delete",
        responses: {
          200: {
            description: "Successfully deleted part",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: SessionID.zod,
          messageID: MessageID.zod,
          partID: PartID.zod,
        }),
      ),
      async (c) => {
        const params = c.req.valid("param")
        await Session.removePart({
          sessionID: params.sessionID,
          messageID: params.messageID,
          partID: params.partID,
        })
        return c.json(true)
      },
    )
    .patch(
      "/:sessionID/message/:messageID/part/:partID",
      describeRoute({
        description: "Update a part in a message",
        operationId: "project.part.update",
        responses: {
          200: {
            description: "Successfully updated part",
            content: {
              "application/json": {
                schema: resolver(Message.Part),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: SessionID.zod,
          messageID: MessageID.zod,
          partID: PartID.zod,
        }),
      ),
      validator("json", Message.Part),
      async (c) => {
        const params = c.req.valid("param")
        const body = c.req.valid("json")
        if (body.id !== params.partID || body.messageID !== params.messageID || body.sessionID !== params.sessionID) {
          throw new Error(
            `Part mismatch: body.id='${body.id}' vs partID='${params.partID}', body.messageID='${body.messageID}' vs messageID='${params.messageID}', body.sessionID='${body.sessionID}' vs sessionID='${params.sessionID}'`,
          )
        }
        const part = await Session.updatePart(body)
        return c.json(part)
      },
    )
    .post(
      "/:sessionID/message",
      describeRoute({
        summary: "Send message",
        description: "Create and send a new message to a session, streaming the AI response.",
        operationId: "project.session.prompt",
        responses: {
          200: {
            description: "Created message",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    info: Message.Assistant,
                    parts: Message.Part.array(),
                  }),
                ),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: SessionID.zod,
        }),
      ),
      validator("json", SessionPrompt.PromptInput.omit({ sessionID: true })),
      async (c) => {
        c.status(200)
        c.header("Content-Type", "application/json")
        return stream(c, async (stream) => {
          const sessionID = c.req.valid("param").sessionID
          const body = c.req.valid("json")
          try {
            const msg = await SessionPrompt.prompt({ ...body, sessionID })
            stream.write(JSON.stringify(msg))
          } catch (e) {
            // AbortError is expected when the client disconnects mid-stream
            if (e instanceof DOMException && e.name === "AbortError") return

            // The error is already published via Bus → session.error SSE event
            // in the engine (queryLoop/runSession). Do NOT re-throw: the stream
            // callback has resolved and Hono cannot catch it, causing an
            // unhandled promise rejection that destabilizes the client.
            log.error("prompt stream failed", { error: e, sessionID })

            // Explicitly close the stream to prevent dangling HTTP connections
            // when the prompt throws (e.g. ModelNotFoundError)
            try {
              stream.close()
            } catch {
              /* ignore */
            }
          }
        })
      },
    )
    .post(
      "/:sessionID/prompt_async",
      describeRoute({
        summary: "Send async message",
        description:
          "Create and send a new message to a session asynchronously, starting the session if needed and returning immediately.",
        operationId: "project.session.prompt_async",
        responses: {
          204: {
            description: "Prompt accepted",
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: SessionID.zod,
        }),
      ),
      validator("json", SessionPrompt.PromptInput.omit({ sessionID: true })),
      async (c) => {
        c.status(204)
        c.header("Content-Type", "application/json")
        return stream(c, async () => {
          const sessionID = c.req.valid("param").sessionID
          const body = c.req.valid("json")
          SessionPrompt.prompt({ ...body, sessionID }).catch((e) => {
            // AbortError is expected when session is cancelled
            if (e instanceof DOMException && e.name === "AbortError") return
            log.error("prompt_async failed", { error: e })
          })
        })
      },
    )
    .post(
      "/:sessionID/command",
      describeRoute({
        summary: "Send command",
        description: "Send a new command to a session for execution by the AI assistant.",
        operationId: "project.session.command",
        responses: {
          200: {
            description: "Created message",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    info: Message.Assistant,
                    parts: Message.Part.array(),
                  }),
                ),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: SessionID.zod,
        }),
      ),
      validator("json", SessionPrompt.CommandInput.omit({ sessionID: true })),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const body = c.req.valid("json")
        const msg = await SessionPrompt.command({ ...body, sessionID })
        return c.json(msg)
      },
    )
    .post(
      "/:sessionID/shell",
      describeRoute({
        summary: "Run shell command",
        description: "Execute a shell command within the session context and return the AI's response.",
        operationId: "project.session.shell",
        responses: {
          200: {
            description: "Created message",
            content: {
              "application/json": {
                schema: resolver(Message.Assistant),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: SessionID.zod,
        }),
      ),
      validator("json", SessionPrompt.ShellInput.omit({ sessionID: true })),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const body = c.req.valid("json")
        const msg = await SessionPrompt.shell({ ...body, sessionID })
        return c.json(msg)
      },
    )
    .post(
      "/:sessionID/revert",
      describeRoute({
        summary: "Revert message",
        description: "Revert a specific message in a session, undoing its effects and restoring the previous state.",
        operationId: "project.session.revert",
        responses: {
          200: {
            description: "Updated session",
            content: {
              "application/json": {
                schema: resolver(Session.Info),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: SessionID.zod,
        }),
      ),
      validator("json", SessionRevert.RevertInput.omit({ sessionID: true })),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        log.info("revert", c.req.valid("json"))
        const session = await SessionRevert.revert({
          sessionID,
          ...c.req.valid("json"),
        })
        return c.json(session)
      },
    )
    .post(
      "/:sessionID/unrevert",
      describeRoute({
        summary: "Restore reverted messages",
        description: "Restore all previously reverted messages in a session.",
        operationId: "project.session.unrevert",
        responses: {
          200: {
            description: "Updated session",
            content: {
              "application/json": {
                schema: resolver(Session.Info),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: SessionID.zod,
        }),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const session = await SessionRevert.unrevert({ sessionID })
        return c.json(session)
      },
    )
    // ── Backward Execution: Step-Level Control ──
    .post(
      "/:sessionID/resume",
      describeRoute({
        summary: "Resume a paused session",
        description: "Resume a session paused in step mode, optionally injecting user guidance or disabling step mode.",
        operationId: "project.session.resume",
        responses: {
          200: {
            description: "Session resumed",
            content: {
              "application/json": {
                schema: resolver(z.object({ resumed: z.boolean() })),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: SessionID.zod,
        }),
      ),
      validator(
        "json",
        z.object({
          guidance: z.string().optional(),
          disableStepMode: z.boolean().optional(),
        }),
      ),
      async (c) => {
        const { sessionID } = c.req.valid("param")
        const body = c.req.valid("json")
        SessionPrompt.resumeStepMode(sessionID, body)
        return c.json({ resumed: true })
      },
    )
    .post(
      "/:sessionID/step-back",
      describeRoute({
        summary: "Step back to a previous checkpoint",
        description:
          "Revert the session state and workspace files to a specific historical checkpoint. This is a destructive action that truncates newer messages.",
        operationId: "project.session.step_back",
        responses: {
          200: {
            description: "Session reverted to checkpoint",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    restored: z.boolean(),
                    step: z.number(),
                    orphanedChildren: z.array(SessionID.zod),
                  }),
                ),
              },
            },
          },
          ...errors(400, 404, 409),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: SessionID.zod,
        }),
      ),
      validator(
        "json",
        z.object({
          checkpointID: z.string(),
          guidance: z.string().optional(),
        }),
      ),
      async (c) => {
        const { sessionID } = c.req.valid("param")
        const body = c.req.valid("json")
        try {
          const { stepBack } = await import("../../session/step-back")
          const result = await stepBack({ sessionID, ...body })
          return c.json(result)
        } catch (error) {
          if (error && typeof error === "object" && "name" in error) {
            if (error.name === "CheckpointNotFoundError") {
              return c.json({ error: (error as Error).message }, 404)
            }
            if (error.name === "FileConflictError") {
              const conflicts = (error as Error & { conflicts?: string[] }).conflicts
              return c.json({ error: (error as Error).message, conflicts }, 409)
            }
          }
          throw error
        }
      },
    )
    .post(
      "/:sessionID/fork-at",
      describeRoute({
        summary: "Fork session at checkpoint",
        description:
          "Create a new independent session branching off from a specific historical checkpoint. Optionally override the model or agent.",
        operationId: "project.session.forkAt",
        responses: {
          200: {
            description: "Session forked successfully",
            content: {
              "application/json": {
                schema: resolver(Session.Info),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: SessionID.zod,
        }),
      ),
      validator(
        "json",
        z.object({
          checkpointID: z.string(),
          model: z.object({ providerID: ProviderID.zod, modelID: ModelID.zod }).optional(),
          agent: z.string().optional(),
          guidance: z.string().optional(),
          autoResume: z.boolean().optional(),
        }),
      ),
      async (c) => {
        const { sessionID } = c.req.valid("param")
        const body = c.req.valid("json")
        try {
          const newSession = await Session.forkAtCheckpoint({ sessionID, ...body })
          if (body.autoResume) {
            SessionPrompt.loop({ sessionID: newSession.id }).catch((e) =>
              console.error("auto-resume failed for forked session", e),
            )
          }
          return c.json(newSession)
        } catch (error) {
          if (error && typeof error === "object" && "message" in error) {
            const message = (error as Error).message
            if (message.includes("CheckpointNotFoundError")) {
              return c.json({ error: message }, 404)
            }
            if (message.includes("ProviderModelNotFoundError") || message.includes("AgentNotFoundError")) {
              return c.json({ error: message }, 400)
            }
          }
          throw error
        }
      },
    )
    .get(
      "/:sessionID/checkpoints",
      describeRoute({
        summary: "List checkpoints for a session",
        description: "Get all step-level checkpoints for a session, ordered by step. Messages are excluded.",
        operationId: "project.session.checkpoints",
        responses: {
          200: {
            description: "List of checkpoint summaries",
            content: {
              "application/json": {
                schema: resolver(z.array(z.any())),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: SessionID.zod,
        }),
      ),
      async (c) => {
        const { sessionID } = c.req.valid("param")
        // Access the checkpointer via the session engine's state
        // The checkpointer is instantiated per-session — use SqliteCheckpointer singleton pattern
        const { SqliteCheckpointer } = await import("../../session/engine/loop/checkpointer")
        const checkpointer = new SqliteCheckpointer()
        const checkpoints = checkpointer.listCheckpoints(sessionID)
        // Return summaries without messages (too large for list endpoint)
        const summaries = checkpoints.map(({ messages: _messages, ...rest }) => rest)
        return c.json(summaries)
      },
    )
    .get(
      "/:sessionID/checkpoints/:checkpointID",
      describeRoute({
        summary: "Get a specific checkpoint",
        description: "Get full checkpoint data including messages for a specific checkpoint.",
        operationId: "project.session.checkpoint",
        responses: {
          200: {
            description: "Full checkpoint data",
            content: {
              "application/json": {
                schema: resolver(z.any()),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: SessionID.zod,
          checkpointID: z.string(),
        }),
      ),
      async (c) => {
        const { sessionID, checkpointID } = c.req.valid("param")
        const { SqliteCheckpointer } = await import("../../session/engine/loop/checkpointer")
        const checkpointer = new SqliteCheckpointer()
        const checkpoint = checkpointer.getCheckpoint(sessionID, checkpointID)
        if (!checkpoint) {
          return c.json({ error: `Checkpoint not found: ${checkpointID}` }, 404)
        }
        return c.json(checkpoint)
      },
    ),
)
===
import { Log } from "@liteai/util/log"
import { Hono } from "hono"
import { stream } from "hono/streaming"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { ModelID, ProviderID } from "@/provider/schema"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { SessionStatus } from "@/session/status"
import { SessionSummary } from "@/session/tasks/summary"
import { Snapshot } from "@/snapshot"
import { Agent } from "../../agent/agent"
import { Session } from "../../session"
import { SessionPrompt } from "../../session/engine"
import { Message } from "../../session/message"
import { SessionRevert } from "../../session/revert"
import { SessionCompaction } from "../../session/tasks/compaction"
import { ContextBreakdown } from "../../session/tasks/context-breakdown"
import { Todo } from "../../session/todo"
import { FTS } from "../../storage/fts"
import { lazy } from "../../util/lazy"
import { errors } from "../error"

const log = Log.create({ service: "server" })

export const SessionRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List sessions",
        description: "Get a list of all LiteAI sessions, sorted by most recently updated.",
        operationId: "project.session.list",
        responses: {
          200: {
            description: "List of sessions",
            content: {
              "application/json": {
                schema: resolver(Session.Info.array()),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          directory: z.string().optional().meta({ description: "Filter sessions by project directory" }),
          roots: z.coerce.boolean().optional().meta({ description: "Only return root sessions (no parentID)" }),
          start: z.coerce
            .number()
            .optional()
            .meta({ description: "Filter sessions updated on or after this timestamp (milliseconds since epoch)" }),
          search: z.string().optional().meta({ description: "Filter sessions by title (case-insensitive)" }),
          limit: z.coerce.number().optional().meta({ description: "Maximum number of sessions to return" }),
          archived: z.coerce.boolean().optional().meta({ description: "Include archived sessions (default false)" }),
          tag: z.string().optional().meta({ description: "Filter sessions by tag" }),
        }),
      ),
      async (c) => {
        const query = c.req.valid("query")
        const sessions: Session.Info[] = []
        for await (const session of Session.list({
          directory: query.directory,
          roots: query.roots,
          start: query.start,
          search: query.search,
          limit: query.limit,
          archived: query.archived,
          tag: query.tag,
        })) {
          sessions.push(session)
        }
        return c.json(sessions)
      },
    )
    .get(
      "/tags",
      describeRoute({
        summary: "Get session tags",
        description: "Retrieve all unique tags used across sessions.",
        operationId: "project.session.tags",
        responses: {
          200: {
            description: "List of tags",
            content: {
              "application/json": {
                schema: resolver(z.array(z.string())),
              },
            },
          },
          ...errors(400),
        },
      }),
      async (c) => {
        const result = Session.listTags()
        return c.json(result)
      },
    )
    .get(
      "/status",
      describeRoute({
        summary: "Get session status",
        description: "Retrieve the current status of all sessions, including active, idle, and completed states.",
        operationId: "project.session.status",
        responses: {
          200: {
            description: "Get session status",
            content: {
              "application/json": {
                schema: resolver(z.record(z.string(), SessionStatus.Info)),
              },
            },
          },
          ...errors(400),
        },
      }),
      async (c) => {
        const result = SessionStatus.list()
        return c.json(result)
      },
    )
    .get(
      "/history",
      describeRoute({
        summary: "Get session history",
        description:
          "Retrieve all historical user prompts across all sessions for the current project, deduped and sorted newest first.",
        operationId: "project.session.history",
        responses: {
          200: {
            description: "List of history entries",
            content: {
              "application/json": {
                schema: resolver(
                  z.array(
                    z.object({
                      display: z.string(),
                      sessionID: z.string(),
                      timestamp: z.number(),
                    }),
                  ),
                ),
              },
            },
          },
          ...errors(400),
        },
      }),
      async (c) => {
        const history = await Session.history({ limit: 500 })
        return c.json(history)
      },
    )
    .get(
      "/search",
      describeRoute({
        summary: "Search messages across sessions",
        description: "Full-text search across all session message content using FTS5.",
        operationId: "project.session.search",
        responses: {
          200: {
            description: "Search results",
            content: {
              "application/json": {
                schema: resolver(
                  z.array(
                    z.object({
                      sessionID: z.string(),
                      messageID: z.string(),
                      role: z.string(),
                      snippet: z.string(),
                      rank: z.number(),
                    }),
                  ),
                ),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "query",
        z.object({
          q: z.string().min(1),
          limit: z.coerce.number().int().min(1).max(200).optional(),
        }),
      ),
      async (c) => {
        const { q, limit } = c.req.valid("query")
        try {
          const results = FTS.search(q, limit ?? 50)
          return c.json(results)
        } catch (e) {
          log.warn("FTS search failed", { query: q, error: e })
          return c.json([])
        }
      },
    )
    .get(
      "/:sessionID",
      describeRoute({
        summary: "Get session",
        description: "Retrieve detailed information about a specific LiteAI session.",
        tags: ["Session"],
        operationId: "project.session.get",
        responses: {
          200: {
            description: "Get session",
            content: {
              "application/json": {
                schema: resolver(Session.Info),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: Session.get.schema,
        }),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        log.info("SEARCH", { url: c.req.url })
        const session = await Session.get(sessionID)
        return c.json(session)
      },
    )
    .get(
      "/:sessionID/children",
      describeRoute({
        summary: "Get session children",
        tags: ["Session"],
        description: "Retrieve all child sessions that were forked from the specified parent session.",
        operationId: "project.session.children",
        responses: {
          200: {
            description: "List of children",
            content: {
              "application/json": {
                schema: resolver(Session.Info.array()),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: Session.children.schema,
        }),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const session = await Session.children(sessionID)
        return c.json(session)
      },
    )
    .get(
      "/:sessionID/todo",
      describeRoute({
        summary: "Get session todos",
        description: "Retrieve the todo list associated with a specific session, showing tasks and action items.",
        operationId: "project.session.todo",
        responses: {
          200: {
            description: "Todo list",
            content: {
              "application/json": {
                schema: resolver(Todo.Info.array()),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: SessionID.zod,
        }),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const todos = await Todo.get(sessionID)
        return c.json(todos)
      },
    )
    .post(
      "/",
      describeRoute({
        summary: "Create session",
        description: "Create a new LiteAI session for interacting with AI assistants and managing conversations.",
        operationId: "project.session.create",
        responses: {
          ...errors(400),
          200: {
            description: "Successfully created session",
            content: {
              "application/json": {
                schema: resolver(Session.Info),
              },
            },
          },
        },
      }),
      validator("json", Session.create.schema.optional()),
      async (c) => {
        const body = c.req.valid("json") ?? {}
        const session = await Session.create(body)
        return c.json(session)
      },
    )
    .delete(
      "/:sessionID",
      describeRoute({
        summary: "Delete session",
        description: "Delete a session and permanently remove all associated data, including messages and history.",
        operationId: "project.session.delete",
        responses: {
          200: {
            description: "Successfully deleted session",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: Session.remove.schema,
        }),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        await Session.remove(sessionID)
        return c.json(true)
      },
    )
    .patch(
      "/:sessionID",
      describeRoute({
        summary: "Update session",
        description: "Update properties of an existing session, such as title or other metadata.",
        operationId: "project.session.update",
        responses: {
          200: {
            description: "Successfully updated session",
            content: {
              "application/json": {
                schema: resolver(Session.Info),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: SessionID.zod,
        }),
      ),
      validator(
        "json",
        z.object({
          title: z.string().optional(),
          time: z
            .object({
              archived: z.number().optional(),
            })
            .optional(),
          sessionMode: z.enum(["Normal", "Coordinator", "Swarm"]).optional(),
          toolProfile: z.enum(["Plan", "Fast"]).optional(),
          forkEnabled: z.boolean().optional(),
          tags: z.array(z.string()).optional(),
        }),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const updates = c.req.valid("json")

        let session = await Session.get(sessionID)
        if (updates.title !== undefined) {
          session = await Session.setTitle({ sessionID, title: updates.title })
        }
        if (updates.time?.archived !== undefined) {
          session = await Session.setArchived({ sessionID, time: updates.time.archived })
        }
        if (
          updates.sessionMode !== undefined ||
          updates.toolProfile !== undefined ||
          updates.forkEnabled !== undefined
        ) {
          session = await Session.setConfig({
            sessionID,
            sessionMode: updates.sessionMode,
            toolProfile: updates.toolProfile,
            forkEnabled: updates.forkEnabled,
          })
        }
        if (updates.tags !== undefined) {
          session = await Session.setTags({ sessionID, tags: updates.tags })
        }

        return c.json(session)
      },
    )
    .post(
      "/:sessionID/init",
      describeRoute({
        summary: "Initialize session",
        description:
          "Analyze the current application and create an AGENTS.md file with project-specific agent configurations.",
        operationId: "project.session.init",
        responses: {
          200: {
            description: "200",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: SessionID.zod,
        }),
      ),
      validator("json", Session.initialize.schema.omit({ sessionID: true })),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const body = c.req.valid("json")
        await Session.initialize({ ...body, sessionID })
        return c.json(true)
      },
    )
    .post(
      "/:sessionID/fork",
      describeRoute({
        summary: "Fork session",
        description: "Create a new session by forking an existing session at a specific message point.",
        operationId: "project.session.fork",
        responses: {
          200: {
            description: "200",
            content: {
              "application/json": {
                schema: resolver(Session.Info),
              },
            },
          },
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: Session.fork.schema.shape.sessionID,
        }),
      ),
      validator("json", Session.fork.schema.omit({ sessionID: true })),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const body = c.req.valid("json")
        const result = await Session.fork({ ...body, sessionID })
        return c.json(result)
      },
    )
    .post(
      "/:sessionID/abort",
      describeRoute({
        summary: "Abort session",
        description: "Abort an active session and stop any ongoing AI processing or command execution.",
        operationId: "project.session.abort",
        responses: {
          200: {
            description: "Aborted session",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: SessionID.zod,
        }),
      ),
      async (c) => {
        SessionPrompt.cancel(c.req.valid("param").sessionID)
        return c.json(true)
      },
    )
    .post(
      "/:sessionID/share",
      describeRoute({
        summary: "Share session",
        description: "Create a shareable link for a session, allowing others to view the conversation.",
        operationId: "project.session.share",
        responses: {
          200: {
            description: "Successfully shared session",
            content: {
              "application/json": {
                schema: resolver(Session.Info),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: SessionID.zod,
        }),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        await Session.share(sessionID)
        const session = await Session.get(sessionID)
        return c.json(session)
      },
    )
    .get(
      "/:sessionID/diff",
      describeRoute({
        summary: "Get message diff",
        description: "Get the file changes (diff) that resulted from a specific user message in the session.",
        operationId: "project.session.diff",
        responses: {
          200: {
            description: "Successfully retrieved diff",
            content: {
              "application/json": {
                schema: resolver(Snapshot.FileDiff.array()),
              },
            },
          },
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: SessionSummary.diff.schema.shape.sessionID,
        }),
      ),
      validator(
        "query",
        z.object({
          messageID: SessionSummary.diff.schema.shape.messageID,
        }),
      ),
      async (c) => {
        const query = c.req.valid("query")
        const params = c.req.valid("param")
        const result = await SessionSummary.diff({
          sessionID: params.sessionID,
          messageID: query.messageID,
        })
        return c.json(result)
      },
    )
    .get(
      "/:sessionID/context",
      describeRoute({
        summary: "Get context breakdown",
        description: "Get a breakdown of token usage by category for the session's context window.",
        operationId: "project.session.context",
        responses: {
          200: {
            description: "Context breakdown",
            content: {
              "application/json": {
                schema: resolver(ContextBreakdown.Info),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: SessionID.zod,
        }),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const result = await ContextBreakdown.get({ sessionID })
        return c.json(result)
      },
    )
    .delete(
      "/:sessionID/share",
      describeRoute({
        summary: "Unshare session",
        description: "Remove the shareable link for a session, making it private again.",
        operationId: "project.session.unshare",
        responses: {
          200: {
            description: "Successfully unshared session",
            content: {
              "application/json": {
                schema: resolver(Session.Info),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: Session.unshare.schema,
        }),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        await Session.unshare(sessionID)
        const session = await Session.get(sessionID)
        return c.json(session)
      },
    )
    .post(
      "/:sessionID/summarize",
      describeRoute({
        summary: "Summarize session",
        description: "Generate a concise summary of the session using AI compaction to preserve key information.",
        operationId: "project.session.summarize",
        responses: {
          200: {
            description: "Summarized session",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: SessionID.zod,
        }),
      ),
      validator(
        "json",
        z.object({
          providerID: ProviderID.zod,
          modelID: ModelID.zod,
          auto: z.boolean().optional().default(false),
        }),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const body = c.req.valid("json")
        const session = await Session.get(sessionID)
        await SessionRevert.cleanup(session)
        const msgs = await Session.messages({ sessionID })
        let currentAgent = await Agent.defaultAgent()
        for (let i = msgs.length - 1; i >= 0; i--) {
          const info = msgs[i].info
          if (info.role === "user") {
            currentAgent = info.agent || (await Agent.defaultAgent())
            break
          }
        }
        await SessionCompaction.create({
          sessionID,
          agent: currentAgent,
          model: {
            providerID: body.providerID,
            modelID: body.modelID,
          },
          auto: body.auto,
        })
        await SessionPrompt.loop({ sessionID })
        return c.json(true)
      },
    )
    .get(
      "/:sessionID/message",
      describeRoute({
        summary: "Get session messages",
        description: "Retrieve all messages in a session, including user prompts and AI responses.",
        operationId: "project.session.messages",
        responses: {
          200: {
            description: "List of messages",
            content: {
              "application/json": {
                schema: resolver(Message.WithParts.array()),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: SessionID.zod,
        }),
      ),
      validator(
        "query",
        z
          .object({
            limit: z.coerce
              .number()
              .int()
              .min(0)
              .optional()
              .meta({ description: "Maximum number of messages to return" }),
            before: z
              .string()
              .optional()
              .meta({ description: "Opaque cursor for loading older messages" })
              .refine(
                (value) => {
                  if (!value) return true
                  try {
                    Message.cursor.decode(value)
                    return true
                  } catch {
                    return false
                  }
                },
                { message: "Invalid cursor" },
              ),
          })
          .refine((value) => !value.before || value.limit !== undefined, {
            message: "before requires limit",
            path: ["before"],
          }),
      ),
      async (c) => {
        const query = c.req.valid("query")
        const sessionID = c.req.valid("param").sessionID
        if (query.limit === undefined) {
          await Session.get(sessionID)
          const messages = await Session.messages({ sessionID })
          return c.json(messages)
        }

        if (query.limit === 0) {
          await Session.get(sessionID)
          const messages = await Session.messages({ sessionID })
          return c.json(messages)
        }

        const page = await Message.page({
          sessionID,
          limit: query.limit,
          before: query.before,
        })
        if (page.cursor) {
          const url = new URL(c.req.url)
          url.searchParams.set("limit", query.limit.toString())
          url.searchParams.set("before", page.cursor)
          c.header("Access-Control-Expose-Headers", "Link, X-Next-Cursor")
          c.header("Link", `<${url.toString()}>; rel="next"`)
          c.header("X-Next-Cursor", page.cursor)
        }
        return c.json(page.items)
      },
    )
    .get(
      "/:sessionID/message/:messageID",
      describeRoute({
        summary: "Get message",
        description: "Retrieve a specific message from a session by its message ID.",
        operationId: "project.session.message",
        responses: {
          200: {
            description: "Message",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    info: Message.Info,
                    parts: Message.Part.array(),
                  }),
                ),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: SessionID.zod,
          messageID: MessageID.zod,
        }),
      ),
      async (c) => {
        const params = c.req.valid("param")
        const message = await Message.get({
          sessionID: params.sessionID,
          messageID: params.messageID,
        })
        return c.json(message)
      },
    )
    .delete(
      "/:sessionID/message/:messageID",
      describeRoute({
        summary: "Delete message",
        description:
          "Permanently delete a specific message (and all of its parts) from a session. This does not revert any file changes that may have been made while processing the message.",
        operationId: "project.session.deleteMessage",
        responses: {
          200: {
            description: "Successfully deleted message",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: SessionID.zod,
          messageID: MessageID.zod,
        }),
      ),
      async (c) => {
        const params = c.req.valid("param")
        SessionPrompt.assertNotBusy(params.sessionID)
        await Session.removeMessage({
          sessionID: params.sessionID,
          messageID: params.messageID,
        })
        return c.json(true)
      },
    )
    .delete(
      "/:sessionID/message/:messageID/part/:partID",
      describeRoute({
        description: "Delete a part from a message",
        operationId: "project.part.delete",
        responses: {
          200: {
            description: "Successfully deleted part",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: SessionID.zod,
          messageID: MessageID.zod,
          partID: PartID.zod,
        }),
      ),
      async (c) => {
        const params = c.req.valid("param")
        await Session.removePart({
          sessionID: params.sessionID,
          messageID: params.messageID,
          partID: params.partID,
        })
        return c.json(true)
      },
    )
    .patch(
      "/:sessionID/message/:messageID/part/:partID",
      describeRoute({
        description: "Update a part in a message",
        operationId: "project.part.update",
        responses: {
          200: {
            description: "Successfully updated part",
            content: {
              "application/json": {
                schema: resolver(Message.Part),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: SessionID.zod,
          messageID: MessageID.zod,
          partID: PartID.zod,
        }),
      ),
      validator("json", Message.Part),
      async (c) => {
        const params = c.req.valid("param")
        const body = c.req.valid("json")
        if (body.id !== params.partID || body.messageID !== params.messageID || body.sessionID !== params.sessionID) {
          throw new Error(
            `Part mismatch: body.id='${body.id}' vs partID='${params.partID}', body.messageID='${body.messageID}' vs messageID='${params.messageID}', body.sessionID='${body.sessionID}' vs sessionID='${params.sessionID}'`,
          )
        }
        const part = await Session.updatePart(body)
        return c.json(part)
      },
    )
    .post(
      "/:sessionID/message",
      describeRoute({
        summary: "Send message",
        description: "Create and send a new message to a session, streaming the AI response.",
        operationId: "project.session.prompt",
        responses: {
          200: {
            description: "Created message",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    info: Message.Assistant,
                    parts: Message.Part.array(),
                  }),
                ),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: SessionID.zod,
        }),
      ),
      validator("json", SessionPrompt.PromptInput.omit({ sessionID: true })),
      async (c) => {
        c.status(200)
        c.header("Content-Type", "application/json")
        return stream(c, async (stream) => {
          const sessionID = c.req.valid("param").sessionID
          const body = c.req.valid("json")
          try {
            const msg = await SessionPrompt.prompt({ ...body, sessionID })
            stream.write(JSON.stringify(msg))
          } catch (e) {
            // AbortError is expected when the client disconnects mid-stream
            if (e instanceof DOMException && e.name === "AbortError") return

            // The error is already published via Bus → session.error SSE event
            // in the engine (queryLoop/runSession). Do NOT re-throw: the stream
            // callback has resolved and Hono cannot catch it, causing an
            // unhandled promise rejection that destabilizes the client.
            log.error("prompt stream failed", { error: e, sessionID })

            // Explicitly close the stream to prevent dangling HTTP connections
            // when the prompt throws (e.g. ModelNotFoundError)
            try {
              stream.close()
            } catch {
              /* ignore */
            }
          }
        })
      },
    )
    .post(
      "/:sessionID/prompt_async",
      describeRoute({
        summary: "Send async message",
        description:
          "Create and send a new message to a session asynchronously, starting the session if needed and returning immediately.",
        operationId: "project.session.prompt_async",
        responses: {
          204: {
            description: "Prompt accepted",
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: SessionID.zod,
        }),
      ),
      validator("json", SessionPrompt.PromptInput.omit({ sessionID: true })),
      async (c) => {
        c.status(204)
        c.header("Content-Type", "application/json")
        return stream(c, async () => {
          const sessionID = c.req.valid("param").sessionID
          const body = c.req.valid("json")
          SessionPrompt.prompt({ ...body, sessionID }).catch((e) => {
            // AbortError is expected when session is cancelled
            if (e instanceof DOMException && e.name === "AbortError") return
            log.error("prompt_async failed", { error: e })
          })
        })
      },
    )
    .post(
      "/:sessionID/command",
      describeRoute({
        summary: "Send command",
        description: "Send a new command to a session for execution by the AI assistant.",
        operationId: "project.session.command",
        responses: {
          200: {
            description: "Created message",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    info: Message.Assistant,
                    parts: Message.Part.array(),
                  }),
                ),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: SessionID.zod,
        }),
      ),
      validator("json", SessionPrompt.CommandInput.omit({ sessionID: true })),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const body = c.req.valid("json")
        const msg = await SessionPrompt.command({ ...body, sessionID })
        return c.json(msg)
      },
    )
    .post(
      "/:sessionID/shell",
      describeRoute({
        summary: "Run shell command",
        description: "Execute a shell command within the session context and return the AI's response.",
        operationId: "project.session.shell",
        responses: {
          200: {
            description: "Created message",
            content: {
              "application/json": {
                schema: resolver(Message.Assistant),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: SessionID.zod,
        }),
      ),
      validator("json", SessionPrompt.ShellInput.omit({ sessionID: true })),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const body = c.req.valid("json")
        const msg = await SessionPrompt.shell({ ...body, sessionID })
        return c.json(msg)
      },
    )
    .post(
      "/:sessionID/revert",
      describeRoute({
        summary: "Revert message",
        description: "Revert a specific message in a session, undoing its effects and restoring the previous state.",
        operationId: "project.session.revert",
        responses: {
          200: {
            description: "Updated session",
            content: {
              "application/json": {
                schema: resolver(Session.Info),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: SessionID.zod,
        }),
      ),
      validator("json", SessionRevert.RevertInput.omit({ sessionID: true })),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        log.info("revert", c.req.valid("json"))
        const session = await SessionRevert.revert({
          sessionID,
          ...c.req.valid("json"),
        })
        return c.json(session)
      },
    )
    .post(
      "/:sessionID/unrevert",
      describeRoute({
        summary: "Restore reverted messages",
        description: "Restore all previously reverted messages in a session.",
        operationId: "project.session.unrevert",
        responses: {
          200: {
            description: "Updated session",
            content: {
              "application/json": {
                schema: resolver(Session.Info),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: SessionID.zod,
        }),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const session = await SessionRevert.unrevert({ sessionID })
        return c.json(session)
      },
    )
    // ── Backward Execution: Step-Level Control ──
    .post(
      "/:sessionID/resume",
      describeRoute({
        summary: "Resume a paused session",
        description: "Resume a session paused in step mode, optionally injecting user guidance or disabling step mode.",
        operationId: "project.session.resume",
        responses: {
          200: {
            description: "Session resumed",
            content: {
              "application/json": {
                schema: resolver(z.object({ resumed: z.boolean() })),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: SessionID.zod,
        }),
      ),
      validator(
        "json",
        z.object({
          guidance: z.string().optional(),
          disableStepMode: z.boolean().optional(),
        }),
      ),
      async (c) => {
        const { sessionID } = c.req.valid("param")
        const body = c.req.valid("json")
        SessionPrompt.resumeStepMode(sessionID, body)
        return c.json({ resumed: true })
      },
    )
    .post(
      "/:sessionID/step-back",
      describeRoute({
        summary: "Step back to a previous checkpoint",
        description:
          "Revert the session state and workspace files to a specific historical checkpoint. This is a destructive action that truncates newer messages.",
        operationId: "project.session.step_back",
        responses: {
          200: {
            description: "Session reverted to checkpoint",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    restored: z.boolean(),
                    step: z.number(),
                    orphanedChildren: z.array(SessionID.zod),
                  }),
                ),
              },
            },
          },
          ...errors(400, 404, 409),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: SessionID.zod,
        }),
      ),
      validator(
        "json",
        z.object({
          checkpointID: z.string(),
          guidance: z.string().optional(),
        }),
      ),
      async (c) => {
        const { sessionID } = c.req.valid("param")
        const body = c.req.valid("json")
        try {
          const { stepBack } = await import("../../session/step-back")
          const result = await stepBack({ sessionID, ...body })
          return c.json(result)
        } catch (error) {
          if (error && typeof error === "object" && "name" in error) {
            if (error.name === "CheckpointNotFoundError") {
              return c.json({ error: (error as Error).message }, 404)
            }
            if (error.name === "FileConflictError") {
              const conflicts = (error as Error & { data?: { conflicts?: string[] } }).data?.conflicts
              return c.json({ error: (error as Error).message, conflicts }, 409)
            }
          }
          throw error
        }
      },
    )
    .post(
      "/:sessionID/fork-at",
      describeRoute({
        summary: "Fork session at checkpoint",
        description:
          "Create a new independent session branching off from a specific historical checkpoint. Optionally override the model or agent.",
        operationId: "project.session.forkAt",
        responses: {
          200: {
            description: "Session forked successfully",
            content: {
              "application/json": {
                schema: resolver(Session.Info),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: SessionID.zod,
        }),
      ),
      validator(
        "json",
        z.object({
          checkpointID: z.string(),
          model: z.object({ providerID: ProviderID.zod, modelID: ModelID.zod }).optional(),
          agent: z.string().optional(),
          guidance: z.string().optional(),
          autoResume: z.boolean().optional(),
        }),
      ),
      async (c) => {
        const { sessionID } = c.req.valid("param")
        const body = c.req.valid("json")
        try {
          const newSession = await Session.forkAtCheckpoint({ sessionID, ...body })
          if (body.autoResume) {
            SessionPrompt.loop({ sessionID: newSession.id }).catch((e) =>
              console.error("auto-resume failed for forked session", e),
            )
          }
          return c.json(newSession)
        } catch (error) {
          if (error && typeof error === "object" && "name" in error) {
            const name = (error as Error).name
            if (name === "CheckpointNotFoundError") {
              return c.json({ error: (error as Error).message }, 404)
            }
            if (name === "ForkProviderModelNotFoundError" || name === "ForkAgentNotFoundError") {
              return c.json({ error: (error as Error).message }, 400)
            }
          }
          throw error
        }
      },
    )
    .get(
      "/:sessionID/checkpoints",
      describeRoute({
        summary: "List checkpoints for a session",
        description: "Get all step-level checkpoints for a session, ordered by step. Messages are excluded.",
        operationId: "project.session.checkpoints",
        responses: {
          200: {
            description: "List of checkpoint summaries",
            content: {
              "application/json": {
                schema: resolver(z.array(z.any())),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: SessionID.zod,
        }),
      ),
      async (c) => {
        const { sessionID } = c.req.valid("param")
        // Access the checkpointer via the session engine's state
        // The checkpointer is instantiated per-session — use SqliteCheckpointer singleton pattern
        const { SqliteCheckpointer } = await import("../../session/engine/loop/checkpointer")
        const checkpointer = new SqliteCheckpointer()
        const checkpoints = checkpointer.listCheckpoints(sessionID)
        // Return summaries without messages (too large for list endpoint)
        const summaries = checkpoints.map(({ messages: _messages, ...rest }) => rest)
        return c.json(summaries)
      },
    )
    .get(
      "/:sessionID/checkpoints/:checkpointID",
      describeRoute({
        summary: "Get a specific checkpoint",
        description: "Get full checkpoint data including messages for a specific checkpoint.",
        operationId: "project.session.checkpoint",
        responses: {
          200: {
            description: "Full checkpoint data",
            content: {
              "application/json": {
                schema: resolver(z.any()),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: SessionID.zod,
          checkpointID: z.string(),
        }),
      ),
      async (c) => {
        const { sessionID, checkpointID } = c.req.valid("param")
        const { SqliteCheckpointer } = await import("../../session/engine/loop/checkpointer")
        const checkpointer = new SqliteCheckpointer()
        const checkpoint = checkpointer.getCheckpoint(sessionID, checkpointID)
        if (!checkpoint) {
          return c.json({ error: `Checkpoint not found: ${checkpointID}` }, 404)
        }
        return c.json(checkpoint)
      },
    ),
)
```

---

## Spec Compliance Matrix

| Requirement | Status | Notes |
|-------------|--------|-------|
| FR-001: Step mode | ✅ | `stepModeRef` + generator yield |
| FR-002: Intermediate state exposure | ✅ | Standard message endpoint during pause |
| FR-003: Resume from in-memory state | ✅ | `StepPauseLatch` await gate — no DB re-read |
| FR-004: Guidance injection on resume | ✅ | `correctionInjector.inject()` in step-pause handler |
| FR-005: Toggle step mode mid-session | ✅ | `disableStepMode` in `ResumePayload` + `input.stepModeRef` guard |
| FR-006: Checkpoint capture at boundaries | ✅ | Post-turn-end capture in `queryLoop` |
| FR-007: Step-back with file restore | ✅ | Conflict detection + restore decoupled correctly |
| FR-008: Re-entry from restored checkpoint | ✅ | Guidance injection + loop re-entry |
| FR-009: Fork at checkpoint | ✅ | `forkAtCheckpoint` with message cloning |
| FR-010: Parameter overrides on fork | ✅ | Model/agent validation with structured errors |
| FR-011: Queryable step context | ✅ | Metadata enrichment in checkpoint capture |
| FR-012: Checkpoint-trace association | ✅ | `traceSpanID` from OpenTelemetry |
| FR-013: Subagent scope communication | ✅ | `orphanedChildren` in step-back response |
| FR-014: External file conflict detection | ✅ | Compares against latest checkpoint, not target |
| FR-015: Step-boundary pausing | ✅ | Pause after turn-end, before next iteration |
| SC-007: Zero overhead non-step-mode | ✅ | Single boolean check: `params.stepModeRef?.current` |

---

## Architectural Observations (unchanged, for tracking)

### 🔵 OBS-1: Checkpoint Store lives on static Map

Both `SqliteCheckpointer` and `MemoryCheckpointer` use `private static readonly globalStores`. This is correct for single-process, but test code using `MemoryCheckpointer` while HTTP endpoints use `SqliteCheckpointer` will see divergent stores.

### 🔵 OBS-2: No test files were created

The plan specifies 4 test files. Given the complexity of this feature (concurrent latch, truncation, conflict detection), unit tests are recommended as follow-up.

### 🔵 OBS-3: LangGraph pattern divergence

LiteAI's `Checkpointer` uses a simpler synchronous in-memory model vs LangGraph's async config-driven `BaseCheckpointSaver`. Appropriate for current scope but may need expansion for durable checkpoints.

### 🔵 OBS-4: Claude Code pattern divergence

LiteAI uses git tree hashes for bulk file state; Claude Code uses per-file content-addressed backups. LiteAI's approach is simpler for code agents but less granular for partial restores.
