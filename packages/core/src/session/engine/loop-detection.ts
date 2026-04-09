import { createHash } from "node:crypto"
import { Log } from "@/util/log"
import type { EngineEvent } from "../events"
import { ThinkingLoopDetector } from "./thinking-loop-detector"

const log = Log.create({ service: "session.loop-detection" })

// ─── Constants ──────────────────────────────────────────────────────────────

/** Tool call loop: consecutive identical calls required for detection */
const TOOL_CALL_THRESHOLD = 5

/** Content chanting: characters per chunk (gemini-cli default) */
const CONTENT_CHUNK_SIZE = 50

/** Content chanting: number of repeated chunks required for detection */
const CONTENT_THRESHOLD = 10

/** Content chanting: max average distance factor */
const CONTENT_MAX_DISTANCE_FACTOR = 5

/** Content chanting: max number of distinct periods */
const CONTENT_MAX_PERIOD_VARIETY = 3

/** Content chanting: memory cap for chunk tracking */
const CONTENT_MAX_CHUNKS = 200

// ─── Types ──────────────────────────────────────────────────────────────────

export enum LoopType {
  THINKING_LOOP = "thinking_loop",
  TOOL_CALL_LOOP = "tool_call_loop",
  CONTENT_CHANTING = "content_chanting",
}

export interface LoopDetectionResult {
  /** 0 = no loop, 1 = first detection, 2+ = repeated */
  count: number
  type?: LoopType
  detail?: string
}

const NO_LOOP: LoopDetectionResult = { count: 0 }

// ─── LoopDetectionService ───────────────────────────────────────────────────

/**
 * Unified loop detection service that consolidates all detection layers:
 *  - Thinking loop: hash-based detection of repetitive reasoning tokens
 *  - Tool call loop: consecutive identical tool calls by hash
 *  - Content chanting: sliding-window chunk hashing for output text
 *
 * Adapted from gemini-cli's `LoopDetectionService` for LiteAI's event system.
 */
export class LoopDetectionService {
  private readonly sessionID: string
  private readonly thinkingDetector = new ThinkingLoopDetector()

  // Tool call loop state
  private lastToolCallHash: string | null = null
  private consecutiveToolCalls = 0

  // Content chanting state
  private contentBuffer = ""
  private contentChunkIndex = 0
  private contentHashPositions = new Map<string, number[]>()
  private contentChunkContents = new Map<string, string>()

  // Detection state
  private detectionCount = 0
  private detectionCleared = false

  constructor(sessionID: string) {
    this.sessionID = sessionID
  }

  /**
   * Process any engine event — routes to the appropriate detector.
   * Returns a result with count > 0 if a loop is detected.
   */
  check(event: EngineEvent.Any): LoopDetectionResult {
    if (this.detectionCleared) {
      // After clearDetection(), allow one recovery turn before re-arming
      return NO_LOOP
    }

    switch (event.type) {
      case "delta": {
        if (event.part === "reasoning") {
          return this.checkThinkingLoop(event.text)
        }
        if (event.part === "text") {
          return this.checkContentChanting(event.text)
        }
        return NO_LOOP
      }

      case "call": {
        if (event.kind === "tool") {
          return this.checkToolCallLoop(event.toolName, event.input)
        }
        return NO_LOOP
      }

      default:
        return NO_LOOP
    }
  }

  /** Called at turn boundaries */
  turnStarted(): LoopDetectionResult {
    // Reset per-turn state but keep detection count
    this.thinkingDetector.reset()
    this.lastToolCallHash = null
    this.consecutiveToolCalls = 0
    this.contentBuffer = ""
    this.contentChunkIndex = 0
    this.contentHashPositions.clear()
    this.contentChunkContents.clear()

    if (this.detectionCleared) {
      this.detectionCleared = false
    }

    return NO_LOOP
  }

  /** Reset all detectors (new prompt) */
  reset(): void {
    this.thinkingDetector.reset()
    this.lastToolCallHash = null
    this.consecutiveToolCalls = 0
    this.contentBuffer = ""
    this.contentChunkIndex = 0
    this.contentHashPositions.clear()
    this.contentChunkContents.clear()
    this.detectionCount = 0
    this.detectionCleared = false
  }

  /** Clear detection flag to allow a recovery turn */
  clearDetection(): void {
    this.detectionCleared = true
  }

  /** Current detection count (for escalation strategy) */
  getDetectionCount(): number {
    return this.detectionCount
  }

  // ── Private Detection Layers ────────────────────────────────────────────

  private checkThinkingLoop(text: string): LoopDetectionResult {
    const result = this.thinkingDetector.addReasoningDelta(text)
    if (result.detected) {
      this.detectionCount++
      const detail = result.detail
      log.warn("thinking loop detected", {
        sessionID: this.sessionID,
        detail,
        chunkCount: result.chunkCount,
        detectionCount: this.detectionCount,
      })
      return {
        count: this.detectionCount,
        type: LoopType.THINKING_LOOP,
        detail,
      }
    }
    return NO_LOOP
  }

  /**
   * Hash-based consecutive tool call detection.
   * Hashes `name:JSON(args)` and checks for TOOL_CALL_THRESHOLD consecutive identical calls.
   */
  private checkToolCallLoop(toolName: string, input: unknown): LoopDetectionResult {
    const hash = sha256(`${toolName}:${JSON.stringify(input)}`)

    if (hash === this.lastToolCallHash) {
      this.consecutiveToolCalls++
    } else {
      this.lastToolCallHash = hash
      this.consecutiveToolCalls = 1
    }

    if (this.consecutiveToolCalls >= TOOL_CALL_THRESHOLD) {
      this.detectionCount++
      const detail = `Tool "${toolName}" called ${this.consecutiveToolCalls} times consecutively with identical arguments`
      log.warn("tool call loop detected", {
        sessionID: this.sessionID,
        toolName,
        count: this.consecutiveToolCalls,
        detectionCount: this.detectionCount,
      })
      return {
        count: this.detectionCount,
        type: LoopType.TOOL_CALL_LOOP,
        detail,
      }
    }

    return NO_LOOP
  }

  /**
   * Sliding-window content chanting detection for text output.
   * Segments text into CONTENT_CHUNK_SIZE chunks, hashes each, and checks
   * for CONTENT_THRESHOLD occurrences within a bounded distance window.
   */
  private checkContentChanting(text: string): LoopDetectionResult {
    this.contentBuffer += text

    while (this.contentBuffer.length >= CONTENT_CHUNK_SIZE) {
      const chunk = this.contentBuffer.slice(0, CONTENT_CHUNK_SIZE)
      this.contentBuffer = this.contentBuffer.slice(CONTENT_CHUNK_SIZE)

      // Skip chunks that are predominantly whitespace or code-block markers
      if (this.isCodeBlockOrWhitespace(chunk)) {
        this.contentChunkIndex++
        continue
      }

      const result = this.analyzeContentChunk(chunk)
      if (result.count > 0) {
        return result
      }
    }

    // Enforce memory cap
    if (this.contentChunkIndex > CONTENT_MAX_CHUNKS) {
      this.truncateContentTracking()
    }

    return NO_LOOP
  }

  private analyzeContentChunk(chunk: string): LoopDetectionResult {
    const hash = sha256(chunk)
    const position = this.contentChunkIndex++

    const positions = this.contentHashPositions.get(hash)
    if (positions) {
      positions.push(position)
    } else {
      this.contentHashPositions.set(hash, [position])
      this.contentChunkContents.set(hash, chunk)
    }

    const currentPositions = this.contentHashPositions.get(hash)
    if (!currentPositions || currentPositions.length < CONTENT_THRESHOLD) {
      return NO_LOOP
    }

    // Anti-collision: verify content match
    const storedContent = this.contentChunkContents.get(hash)
    if (storedContent && storedContent !== chunk) {
      this.contentChunkContents.set(hash, chunk)
      this.contentHashPositions.set(hash, [position])
      return NO_LOOP
    }

    // Distance check
    const recent = currentPositions.slice(-CONTENT_THRESHOLD)
    const span = recent[recent.length - 1] - recent[0]
    const maxDistance = CONTENT_CHUNK_SIZE * CONTENT_MAX_DISTANCE_FACTOR
    if (span > maxDistance) {
      return NO_LOOP
    }

    // Period consistency
    const periods = new Set<number>()
    for (let i = 1; i < recent.length; i++) {
      periods.add(recent[i] - recent[i - 1])
    }
    if (periods.size > CONTENT_MAX_PERIOD_VARIETY) {
      return NO_LOOP
    }

    this.detectionCount++
    const preview = chunk.slice(0, 40).replace(/\n/g, " ")
    const detail = `Content chanting: chunk "${preview}…" repeated ${currentPositions.length} times`
    log.warn("content chanting detected", {
      sessionID: this.sessionID,
      detail,
      detectionCount: this.detectionCount,
    })
    return {
      count: this.detectionCount,
      type: LoopType.CONTENT_CHANTING,
      detail,
    }
  }

  /** Filter out code blocks and whitespace-only chunks to reduce false positives */
  private isCodeBlockOrWhitespace(chunk: string): boolean {
    const trimmed = chunk.trim()
    if (trimmed.length === 0) return true
    // Code block markers (```) are common in model output and would cause false positives
    if (trimmed.startsWith("```") || trimmed.endsWith("```")) return true
    return false
  }

  private truncateContentTracking(): void {
    const cutoff = this.contentChunkIndex - CONTENT_MAX_CHUNKS
    for (const [hash, positions] of this.contentHashPositions) {
      const filtered = positions.filter((p) => p >= cutoff)
      if (filtered.length === 0) {
        this.contentHashPositions.delete(hash)
        this.contentChunkContents.delete(hash)
      } else {
        this.contentHashPositions.set(hash, filtered)
      }
    }
  }
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex")
}
