import type { LoopEvent } from "./event"

/**
 * Interface for consuming events from the loop runner.
 *
 * The loop produces events via an async generator. Multiple consumers
 * can be attached in a fan-out pattern:
 * - **Checkpointer**: Persists messages/parts to storage
 * - **SSE Transport**: Streams events to connected clients
 * - **Telemetry**: Records spans and metrics
 *
 * Each consumer processes events independently. The loop runner
 * tracks consumer promises via PromiseTracker to ensure all async
 * work completes before cleanup.
 *
 * Standalone — no LiteAI-specific imports. Extractable to @liteagent/loop.
 */
export interface EventConsumer {
  /**
   * Process a single loop event.
   * May return a Promise for async operations (DB writes, network I/O)
   * or void for synchronous processing (in-memory accumulation).
   */
  handleEvent(event: LoopEvent): Promise<void> | void

  /**
   * Optional cleanup hook called when the loop completes or is aborted.
   * Implementations should flush pending writes and release resources.
   */
  dispose?(): Promise<void>
}
