import { Bus } from "@/bus/index"
import type { TranscriptMessage } from "@/session/transcript"
import { Log } from "@/util/log"
import type { AppState } from "./context"
import { AgentExecutionContext, runWithAgentContext } from "./context"
import { AgentEvent } from "./events"

const logger = Log.create({ service: "agent:lifecycle" })

export class ProgressTracker {
  currentActivity: string = "Starting..."

  updateActivity(toolName: string) {
    this.currentActivity = this.createActivityDescriptionResolver(toolName)
  }

  private createActivityDescriptionResolver(toolName: string): string {
    const map: Record<string, string> = {
      edit_file: "Editing file...",
      execute_command: "Running command...",
      read_file: "Reading file...",
      search: "Searching...",
      shell: "Executing shell command...",
    }
    return map[toolName] ?? `Using ${toolName}...`
  }
}

export interface UsageMetrics {
  totalTokens: number
  toolCalls: number
  duration: number
  worktreeInfo?: unknown
}

export interface TerminalNotification {
  agentId: string
  status: "completed" | "failed" | "killed"
  description: string
  usage: UsageMetrics
  error?: Error
  partialResult?: string
}

export function enqueueAgentNotification(sessionId: string, notification: TerminalNotification) {
  Bus.publish(AgentEvent.TerminalNotification, {
    agentId: notification.agentId,
    status: notification.status,
    description: notification.description,
    usage: notification.usage,
    error: notification.error?.message,
    partialResult: notification.partialResult,
  })
  logger.info("terminal notification enqueued", {
    sessionId,
    agentId: notification.agentId,
    status: notification.status,
  })
}

export function extractPartialResult(messages: TranscriptMessage[]): string | undefined {
  if (!messages || messages.length === 0) return undefined

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role === "assistant" && typeof msg.content === "string") {
      let text = msg.content
      if (text.length > 2000) {
        text = text.substring(0, 2000)
      }
      return text
    }
  }
  return undefined
}

export async function classifyHandoffIfNeeded(
  result: string,
  sessionId: string,
  permissionMode: string,
  transcript?: TranscriptMessage[],
): Promise<string> {
  const VALID_CLASSIFIER_MODES = ["off", "shadow", "enforce"] as const
  type ClassifierMode = (typeof VALID_CLASSIFIER_MODES)[number]
  const rawMode = process.env.LITEAI_CLASSIFIER_MODE ?? "enforce"
  let mode: ClassifierMode
  if (VALID_CLASSIFIER_MODES.includes(rawMode as ClassifierMode)) {
    mode = rawMode as ClassifierMode
  } else {
    logger.warn("invalid LITEAI_CLASSIFIER_MODE, falling back to 'enforce'", {
      configuredValue: rawMode,
      allowedValues: VALID_CLASSIFIER_MODES,
    })
    mode = "enforce"
  }
  if (mode === "off" || permissionMode !== "auto") return result

  try {
    let finalTranscript = transcript
    if (!finalTranscript) {
      const { Message } = await import("@/session/message")
      const messages: TranscriptMessage[] = []
      for await (const msg of Message.stream(sessionId as import("@/session/schema").SessionID)) {
        let contentStr = ""
        for (const part of msg.parts) {
          if (part.type === "text" && typeof part.text === "string") {
            contentStr += `${part.text}\n`
          }
        }
        messages.push({
          isSidechain: true,
          uuid: msg.info.id,
          role: msg.info.role,
          content: contentStr.trim(),
          timestamp: msg.info.time.created,
        })
      }
      finalTranscript = messages.reverse()
    }

    const { classifyYoloAction } = await import("@/permission/classifier")
    const classification = await classifyYoloAction(finalTranscript)

    if (mode === "shadow") {
      // Shadow mode: log the decision for accuracy observation, but never block
      logger.info("classifier shadow result", {
        sessionId,
        decision: classification.decision,
        reason: classification.reason,
      })
      return result
    }

    // mode === "enforce"
    if (classification.decision === "DANGEROUS") {
      const reason = classification.reason ?? "unspecified policy violation"
      return `SECURITY WARNING: This sub-agent performed actions that may violate security policy. Reason: ${reason}. Review the sub-agent's actions carefully before acting on its output.\n\n${result}`
    }
    return result
  } catch (err) {
    logger.error("Failed to classify agent handoff", { error: err, sessionId })
    return `Note: The safety classifier was unavailable when reviewing this sub-agent's work. Please carefully verify the sub-agent's actions and output before acting on them.\n\n${result}`
  }
}

// ─── Agent Summarization ──────────────────────────────────────────────────────

const SUMMARY_INTERVAL_MS = 30_000
/** Minimum transcript messages before attempting a summary. */
const MIN_TRANSCRIPT_LENGTH = 3
/** Maximum characters for the summary description. */
const MAX_SUMMARY_LENGTH = 50
/** Maximum recent messages to include in the summarization prompt. */
const MAX_CONTEXT_MESSAGES = 20

/**
 * Build a prompt that asks a lightweight model for a 3–5 word present-tense
 * activity description. Includes the previous summary to force novelty.
 *
 */
export function buildSummarizationPrompt(
  transcriptSnapshot: TranscriptMessage[],
  previousSummary: string | null,
): string {
  const prevLine = previousSummary ? `\nPrevious: "${previousSummary}" — say something NEW.\n` : ""

  // Build a condensed view of recent transcript for context
  const contextLines = transcriptSnapshot
    .map((m) => {
      const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content)
      // Truncate individual messages to keep the prompt small
      const truncated = content.length > 200 ? `${content.substring(0, 200)}…` : content
      return `[${m.role}] ${truncated}`
    })
    .join("\n")

  return `Based on the following recent conversation transcript, describe the agent's most recent action in 3-5 words using present tense (-ing). Name the file or function, not the branch. Do not use tools.
${prevLine}
Good: "Reading runAgent.ts"
Good: "Fixing null check in validate.ts"
Good: "Running auth module tests"
Good: "Adding retry logic to fetchUser"

Bad (past tense): "Analyzed the branch diff"
Bad (too vague): "Investigating the issue"
Bad (too long): "Reviewing full branch diff and AgentTool.tsx integration"

<recent_transcript>
${contextLines}
</recent_transcript>`
}

/**
 * Dependencies injected into the summarization loop. Decoupled from ALS
 * so the loop is testable and survives `setTimeout` boundaries.
 */
export interface SummarizationDeps {
  /** Returns a snapshot of the agent's accumulated transcript messages. */
  getTranscript: () => TranscriptMessage[]
  /** Root store passthrough — bypasses the sub-agent's no-op setAppState. */
  setAppStateForTasks: (updater: (state: AppState) => AppState) => void
}

/** Optional overrides for summarization behaviour — primarily for testing. */
export interface SummarizationOptions {
  /** Override the interval between summarization ticks (default: 30 000 ms). */
  intervalMs?: number
}

/**
 * Periodically forks the agent's transcript to produce a 3–5 word activity
 * description that is pushed to the parent session's AppState for UI display.
 *
 * Uses a **restart-after-completion loop** (not `setInterval`) so the next
 * timer starts only after the previous summary call resolves — this prevents
 * summary calls from overlapping.
 *
 * @param options.intervalMs — Override the default 30 s interval (useful in
 *        tests to trigger ticks immediately).
 * @returns A cleanup function that stops the summarization loop and aborts
 *          any in-flight LLM call.
 */
export function startAgentSummarization(
  sessionId: string,
  agentId: string,
  deps: SummarizationDeps,
  options?: SummarizationOptions,
): () => void {
  const effectiveIntervalMs = options?.intervalMs ?? SUMMARY_INTERVAL_MS
  let stopped = false
  let pendingTimeout: ReturnType<typeof setTimeout> | undefined
  let summaryAbortController: AbortController | null = null
  let previousSummary: string | null = null

  async function runSummary(): Promise<void> {
    if (stopped) return

    logger.debug("summarization tick fired", { sessionId, agentId })

    try {
      const transcript = deps.getTranscript()
      if (transcript.length < MIN_TRANSCRIPT_LENGTH) {
        logger.debug("skipping summarization — not enough messages", {
          agentId,
          messageCount: transcript.length,
        })
        return
      }

      // Fork: take last N messages as a read-only snapshot (shallow copy)
      const snapshot = transcript.slice(-MAX_CONTEXT_MESSAGES)

      // Resolve a small/fast model for cheap summarization
      const { Provider } = await import("@/provider/provider")
      const defaultRef = await Provider.defaultModel()
      if (!defaultRef) {
        logger.debug("no default model configured — skipping summarization", { agentId })
        return
      }

      const smallModel = await Provider.getSmallModel(defaultRef.providerID)
      if (!smallModel) {
        logger.debug("no small model available — skipping summarization", {
          agentId,
          providerID: defaultRef.providerID,
        })
        return
      }

      const language = await Provider.getLanguage(smallModel)

      summaryAbortController = new AbortController()

      const { generateText } = await import("ai")
      const result = await generateText({
        model: language,
        prompt: buildSummarizationPrompt(snapshot, previousSummary),
        maxOutputTokens: 30,
        temperature: 0,
        abortSignal: summaryAbortController.signal,
      })

      if (stopped) return

      const description = result.text.trim().substring(0, MAX_SUMMARY_LENGTH)
      if (description) {
        previousSummary = description
        deps.setAppStateForTasks((state) => ({
          ...state,
          agentSummaries: {
            ...state.agentSummaries,
            [agentId]: description,
          },
        }))
        logger.debug("summarization result pushed", { agentId, description })
      }
    } catch (err) {
      // Summarization is best-effort — errors must not crash the agent.
      // This is an intentional exception to Constitution §VI (Fail-Fast):
      // summarization is a non-critical observability side-channel.
      if (!stopped) {
        logger.debug("summarization tick failed", { error: err, sessionId, agentId })
      }
    } finally {
      summaryAbortController = null
      // Restart-after-completion: schedule the next tick only after this one
      // completes. This prevents overlapping summarization calls.
      if (!stopped) {
        scheduleNext()
      }
    }
  }

  function scheduleNext(): void {
    if (stopped) return
    pendingTimeout = setTimeout(() => {
      void runSummary()
    }, effectiveIntervalMs)
  }

  function stop(): void {
    logger.debug("stopping agent summarization", { agentId })
    stopped = true
    if (pendingTimeout) {
      clearTimeout(pendingTimeout)
      pendingTimeout = undefined
    }
    if (summaryAbortController) {
      summaryAbortController.abort()
      summaryAbortController = null
    }
  }

  // Start the first timer
  scheduleNext()

  return stop
}

// ─── Async Agent Lifecycle ────────────────────────────────────────────────────

/**
 * Options for async agent lifecycle execution.
 * Extends the base lifecycle with fork-specific cache sharing params.
 */
export interface AsyncAgentLifecycleOptions {
  /** Dependencies for the periodic summarization loop. */
  summarizationDeps?: SummarizationDeps
  /**
   * Cache-safe params for fork child spawning. When provided, the params are
   * threaded through the ALS context so the fork child's query loop can produce
   * cache-compatible API requests with the parent's prompt cache.
   *
   * FR-023, Contract: cache-safe-params.md
   */
  cacheSafeParams?: import("./fork").CacheSafeParams
}

export async function runAsyncAgentLifecycle(
  agentName: string,
  sessionId: string,
  agentId: string,
  runAgentImpl: () => Promise<import("./agent").Agent.RunAgentResult>,
  summarizationDeps?: SummarizationDeps,
  options?: AsyncAgentLifecycleOptions,
) {
  const existingContext = AgentExecutionContext.getStore()

  // If no ALS context exists (e.g., agent spawned from an HTTP handler),
  // construct a minimal SubagentContext for attribution isolation (FR-024).
  // This ensures ALS is always established — running without context
  // breaks analytics attribution and concurrent agent isolation.
  const context: import("./context").AgentContext =
    existingContext ??
    ({
      type: "subagent" as const,
      agentId,
      agentType: agentName,
      isFork: !!options?.cacheSafeParams,
      cacheSafeParams: options?.cacheSafeParams,
      parentSessionId: sessionId,
      isBuiltIn: false,
      invocationKind: "spawn" as const,
      queryTracking: { depth: 1 },
      abortController: new AbortController(),
      readFileState: new Map(),
      toolDecisions: undefined,
      getAppState: () => ({}),
      setAppState: () => {},
      setAppStateForTasks: () => {},
      cwd: process.cwd(),
    } as import("./context").SubagentContext)

  return await runWithAgentContext(context, async () => {
    let status: "completed" | "failed" | "killed" = "completed"
    let error: Error | undefined
    let usage: UsageMetrics = { totalTokens: 0, toolCalls: 0, duration: 0 }
    let stopSummarization: (() => void) | undefined
    const tracker = new ProgressTracker()

    const { Message } = await import("@/session/message")
    const stopTracking = Bus.subscribe(Message.Event.PartUpdated, (event) => {
      // Must match the currently running subagent's session!
      if (
        event.properties.part.sessionID === agentId &&
        event.properties.part.type === "tool" &&
        event.properties.part.state.status === "completed"
      ) {
        usage.toolCalls++
        tracker.updateActivity(event.properties.part.tool)
        Bus.publish(AgentEvent.Progress, {
          agentId,
          activity: tracker.currentActivity,
        })
      }
    })

    // Start summarization loop if dependencies are provided
    if (summarizationDeps) {
      stopSummarization = startAgentSummarization(sessionId, agentId, summarizationDeps)
    }

    try {
      const result = await runAgentImpl()
      usage = result.usage ?? usage
      return result
    } catch (err: unknown) {
      if (
        err instanceof Error &&
        (err.name === "AgentTimeoutError" || err.name === "AbortError" || err.message?.includes("Abort"))
      ) {
        status = "killed"
      } else {
        status = "failed"
      }
      error = err instanceof Error ? err : new Error(String(err))
      throw err // We rethrow usually, but we must enqueue notification first
    } finally {
      stopTracking()

      // Stop summarization before notifications — no point summarizing a
      // terminated agent.
      stopSummarization?.()

      let partialResult: string | undefined
      if ((status === "killed" || status === "completed") && summarizationDeps) {
        partialResult = extractPartialResult(summarizationDeps.getTranscript())
      }

      Bus.publish(AgentEvent.CacheEvictionHint, { agentId })
      enqueueAgentNotification(sessionId, {
        agentId,
        status,
        description: `Agent ${agentName} ${status}`,
        usage,
        error,
        partialResult,
      })
    }
  })
}
