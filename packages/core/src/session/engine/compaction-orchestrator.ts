import type { Provider } from "../../provider/provider"
import type { ModelID, ProviderID } from "../../provider/schema"
import type { Message } from "../message"
import type { MessageID, SessionID } from "../schema"
import { SessionCompaction } from "../tasks/compaction"
import type { TelemetryTracker } from "./telemetry"

/**
 * Centralizes overflow detection, marker creation, and compaction task
 * processing. Currently this logic is scattered across query.ts, loop.ts,
 * and persister.ts — this class gives it a single home.
 *
 * Pattern source: Gemini CLI's ChatCompressionService — separate class
 * with clear interface for context window management.
 */
export class CompactionOrchestrator {
  constructor(private readonly sessionID: SessionID) {}

  /**
   * Check if the context window is overflowing.
   * Called from query.ts after each turn to decide if compaction is needed.
   */
  async isOverflow(tokens: Message.Assistant["tokens"], model: Provider.Model): Promise<boolean> {
    return SessionCompaction.isOverflow({ tokens, model })
  }

  /**
   * Create a compaction marker.
   * Called from loop.ts when overflow is detected or persister signals "compact".
   */
  async createMarker(params: {
    agent: string
    model: { providerID: ProviderID; modelID: ModelID }
    auto: boolean
    overflow?: boolean
  }) {
    return SessionCompaction.create({
      sessionID: this.sessionID,
      ...params,
    })
  }

  /**
   * Process a compaction task (execute the actual compaction).
   * Called from loop.ts when the generator yields a compaction-task control event.
   */
  async process(params: {
    messages: Message.WithParts[]
    parentID: MessageID
    abort: AbortSignal
    auto: boolean
    overflow?: boolean
    telemetryTracker?: TelemetryTracker
    telemetryBatchId?: string
  }) {
    return SessionCompaction.process({
      sessionID: this.sessionID,
      ...params,
    })
  }

  /**
   * Prune old compaction artifacts.
   * Called from loop.ts after the session loop completes.
   */
  async prune() {
    return SessionCompaction.prune({ sessionID: this.sessionID })
  }
}
