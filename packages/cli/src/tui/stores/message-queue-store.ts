import type { PromptInputMode } from "../types/text-input"

// ─── Types ──────────────────────────────────────────────────────────
export type QueuedMessage = {
  readonly id: string
  readonly text: string
  readonly mode: PromptInputMode
  readonly timestamp: number
}

// ─── Module-level state ─────────────────────────────────────────────
let queue: QueuedMessage[] = []
let snapshot: readonly QueuedMessage[] = Object.freeze([])
const listeners = new Set<() => void>()

function emit(): void {
  snapshot = Object.freeze([...queue])
  for (const listener of listeners) {
    listener()
  }
}

// ─── Public API ─────────────────────────────────────────────────────
export function enqueue(text: string, mode: PromptInputMode): void {
  queue.push({
    id: crypto.randomUUID(),
    text,
    mode,
    timestamp: Date.now(),
  })
  emit()
}

export function dequeueAll(): QueuedMessage[] {
  const items = [...queue]
  queue = []
  emit()
  return items
}

export function clear(): number {
  const count = queue.length
  queue = []
  emit()
  return count
}

export function peek(): QueuedMessage | undefined {
  return queue[0]
}

export function isEmpty(): boolean {
  return queue.length === 0
}

// ─── useSyncExternalStore interface ─────────────────────────────────
export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getSnapshot(): readonly QueuedMessage[] {
  return snapshot
}
