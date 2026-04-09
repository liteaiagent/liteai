import { createHash } from "node:crypto"

// ─── Constants ──────────────────────────────────────────────────────────────

/** Characters per chunk — larger than gemini-cli's 50 because thinking paragraphs are wordier */
const CHUNK_SIZE = 100

/** Number of repeated chunks required to confirm a loop */
const THRESHOLD = 5

/** Max average distance factor: max distance = CHUNK_SIZE × factor */
const MAX_DISTANCE_FACTOR = 5

/** Max number of distinct periods (distances between occurrences) before we consider it noise */
const MAX_PERIOD_VARIETY = 3

/** Memory cap — truncate oldest chunks when buffer exceeds this length */
const MAX_BUFFER_LENGTH = 10_000

// ─── Types ──────────────────────────────────────────────────────────────────

export type ThinkingLoopResult = { detected: false } | { detected: true; detail: string; chunkCount: number }

export type ThinkingLoopStats = {
  bufferLength: number
  uniqueHashes: number
  totalChunks: number
  detected: boolean
}

// ─── ThinkingLoopDetector ───────────────────────────────────────────────────

/**
 * Lightweight, stateful detector that monitors reasoning-delta tokens in
 * real-time. Uses the same hash-based chunking algorithm as gemini-cli's
 * content chanting detector, adapted for thinking tokens.
 *
 * Algorithm:
 *  1. Buffer incoming reasoning-delta text
 *  2. Every CHUNK_SIZE (100) characters, extract a chunk
 *  3. Hash the chunk (SHA-256)
 *  4. Track hash → [positions] in a Map
 *  5. When a hash appears ≥ THRESHOLD (5) times within MAX_DISTANCE:
 *     → Verify actual content match (anti-collision)
 *     → Verify period consistency (≤ 3 unique periods)
 *     → Return LoopDetected
 */
export class ThinkingLoopDetector {
  private buffer = ""
  private chunkIndex = 0
  private hashPositions = new Map<string, number[]>()
  private chunkContents = new Map<string, string>()
  private loopDetected = false

  /**
   * Feed reasoning text as it streams in.
   * Call this for every `reasoning-delta` event's text content.
   */
  addReasoningDelta(text: string): ThinkingLoopResult {
    if (this.loopDetected) {
      return { detected: true, detail: "Loop previously detected", chunkCount: this.chunkIndex }
    }

    this.buffer += text

    // Extract and analyze chunks as they become available
    while (this.buffer.length >= CHUNK_SIZE) {
      const chunk = this.buffer.slice(0, CHUNK_SIZE)
      this.buffer = this.buffer.slice(CHUNK_SIZE)

      const result = this.analyzeChunk(chunk)
      if (result.detected) {
        this.loopDetected = true
        return result
      }
    }

    // Enforce memory cap on the tracking structures
    if (this.chunkIndex > MAX_BUFFER_LENGTH / CHUNK_SIZE) {
      this.truncate()
    }

    return { detected: false }
  }

  /** Reset all state for a new turn */
  reset(): void {
    this.buffer = ""
    this.chunkIndex = 0
    this.hashPositions.clear()
    this.chunkContents.clear()
    this.loopDetected = false
  }

  /** Get current buffer stats (for telemetry) */
  getStats(): ThinkingLoopStats {
    return {
      bufferLength: this.buffer.length,
      uniqueHashes: this.hashPositions.size,
      totalChunks: this.chunkIndex,
      detected: this.loopDetected,
    }
  }

  // ── Private ─────────────────────────────────────────────────────────────

  private analyzeChunk(chunk: string): ThinkingLoopResult {
    const hash = sha256(chunk)
    const position = this.chunkIndex++

    // Track positions for this hash
    const positions = this.hashPositions.get(hash)
    if (positions) {
      positions.push(position)
    } else {
      this.hashPositions.set(hash, [position])
      this.chunkContents.set(hash, chunk)
    }

    const currentPositions = this.hashPositions.get(hash)
    if (!currentPositions || currentPositions.length < THRESHOLD) {
      return { detected: false }
    }

    return this.verifyLoop(hash, currentPositions, chunk)
  }

  /**
   * Verify that a hash frequency threshold actually represents a real loop:
   *  1. Anti-collision: verify the stored content matches the current chunk
   *  2. Distance: all occurrences must be within MAX_DISTANCE of each other
   *  3. Period: the gaps between occurrences must be consistent (≤ MAX_PERIOD_VARIETY unique periods)
   */
  private verifyLoop(hash: string, positions: number[], currentChunk: string): ThinkingLoopResult {
    // Anti-collision: verify content actually matches
    const storedContent = this.chunkContents.get(hash)
    if (storedContent && storedContent !== currentChunk) {
      // Hash collision — replace stored content, reset positions for this hash
      this.chunkContents.set(hash, currentChunk)
      this.hashPositions.set(hash, [positions[positions.length - 1]])
      return { detected: false }
    }

    // Distance check: use the last THRESHOLD positions
    const recent = positions.slice(-THRESHOLD)
    const span = recent[recent.length - 1] - recent[0]
    const maxDistance = CHUNK_SIZE * MAX_DISTANCE_FACTOR
    if (span > maxDistance) {
      return { detected: false }
    }

    // Period consistency: compute gaps between consecutive occurrences
    const periods = new Set<number>()
    for (let i = 1; i < recent.length; i++) {
      periods.add(recent[i] - recent[i - 1])
    }
    if (periods.size > MAX_PERIOD_VARIETY) {
      return { detected: false }
    }

    const preview = currentChunk.slice(0, 60).replace(/\n/g, " ")
    return {
      detected: true,
      detail: `Thinking loop: chunk "${preview}…" repeated ${positions.length} times (periods: ${[...periods].join(",")})`,
      chunkCount: this.chunkIndex,
    }
  }

  /**
   * Truncate old tracking data to stay within memory budget.
   * Keeps only positions that are within the recent window.
   */
  private truncate(): void {
    const cutoff = this.chunkIndex - MAX_BUFFER_LENGTH / CHUNK_SIZE
    for (const [hash, positions] of this.hashPositions) {
      const filtered = positions.filter((p) => p >= cutoff)
      if (filtered.length === 0) {
        this.hashPositions.delete(hash)
        this.chunkContents.delete(hash)
      } else {
        this.hashPositions.set(hash, filtered)
      }
    }
  }
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex")
}
