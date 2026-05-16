/**
 * Local Message Store — client-side synthetic messages for the Message Trail pattern.
 *
 * These messages are UI-only: they are NOT sent to the backend, NOT persisted
 * in session history, and NOT visible to the AI. They exist purely as a
 * visual audit trail in the scrollable message area.
 *
 * Trail messages record user-initiated actions such as:
 * - Model changes: `/model → gemini-2.5-pro`
 * - Provider connects: `/connect → Google AI`
 * - Plan mode transitions: `/plan → Plan Mode enabled`
 * - Question answers: `Q: What database? → PostgreSQL`
 *
 * Uses the useSyncExternalStore pattern (same as SessionTabStore).
 * Snapshot is cached to maintain referential stability.
 *
 * @module state/local-messages
 */

export type LocalMessageType = "model-change" | "provider-connect" | "plan-mode" | "question-answer" | "system"

export interface LocalMessage {
  /** Unique ID (nanoid or timestamp-based). */
  readonly id: string
  /** Session this message belongs to. */
  readonly sessionID: string
  /** Millisecond timestamp for ordering with server messages. */
  readonly timestamp: number
  /** Discriminator for styling. */
  readonly type: LocalMessageType
  /** Display text (e.g., "/model → gemini-2.5-pro"). */
  readonly text: string
}

type Listener = () => void

// ── Module-level state ──────────────────────────────────────────────────

const listeners = new Set<Listener>()

/** Per-session message arrays. */
let store: Record<string, readonly LocalMessage[]> = {}

/** Cached per-session snapshots for referential stability. */
const snapshotCache = new Map<string, readonly LocalMessage[]>()

const EMPTY: readonly LocalMessage[] = Object.freeze([])

let counter = 0

function emit() {
  snapshotCache.clear()
  for (const l of listeners) {
    l()
  }
}

function generateId(): string {
  return `lm_${Date.now()}_${++counter}`
}

// ── Public API ──────────────────────────────────────────────────────────

export const LocalMessageStore = {
  subscribe(listener: Listener): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },

  /**
   * Get all local messages for a session. Returns a referentially stable
   * array (safe for useSyncExternalStore).
   */
  getSnapshot(sessionID: string): readonly LocalMessage[] {
    if (!sessionID) return EMPTY
    const cached = snapshotCache.get(sessionID)
    if (cached !== undefined) return cached
    const msgs = store[sessionID] ?? EMPTY
    snapshotCache.set(sessionID, msgs)
    return msgs
  },

  /**
   * Append a trail message to a session.
   */
  add(sessionID: string, type: LocalMessageType, text: string): LocalMessage {
    const msg: LocalMessage = {
      id: generateId(),
      sessionID,
      timestamp: Date.now(),
      type,
      text,
    }
    const prev = store[sessionID] ?? []
    store = { ...store, [sessionID]: [...prev, msg] }
    emit()
    return msg
  },

  /**
   * Remove all local messages for a session (on cleanup/unmount).
   */
  clear(sessionID: string): void {
    if (!store[sessionID]) return
    const { [sessionID]: _, ...rest } = store
    store = rest
    emit()
  },
}
