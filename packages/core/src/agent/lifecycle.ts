import { Bus } from "@/bus/index"
import { Log } from "@/util/log"
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

export function extractPartialResult(messages: import("@/session/transcript").TranscriptMessage[]): string | undefined {
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
  transcript?: import("@/session/transcript").TranscriptMessage[],
): Promise<string> {
  const flag = process.env.TRANSCRIPT_CLASSIFIER === "true"
  if (!flag || permissionMode !== "auto") return result

  try {
    let finalTranscript = transcript
    if (!finalTranscript) {
      const { Message } = await import("@/session/message")
      const messages: import("@/session/transcript").TranscriptMessage[] = []
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
    const isYolo = await classifyYoloAction(finalTranscript)
    if (isYolo) {
      return `[SECURITY WARNING] This agent executed potentially sensitive actions.\n\n${result}`
    }
    return result
  } catch (err) {
    logger.error("Failed to classify agent handoff", { error: err, sessionId })
    return `[NOTICE] Classifier unavailable.\n\n${result}`
  }
}

/**
 * Periodically forks the agent's transcript to produce a 3–5 word activity
 * description that is pushed to the parent session's AppState for UI display.
 *
 * **DEFERRED** — Summarization requires the query loop infrastructure (Phase 9+)
 * to fork a read-only transcript snapshot. The current function is a no-op that
 * returns a valid cleanup closure for call-site compatibility.
 *
 * @returns A cleanup function that stops the summarization loop (currently a no-op).
 */
export function startAgentSummarization(_sessionId: string, _agentId: string): () => void {
  // TODO (R009 / Phase 9): Implement summarization loop.
  // Requirements:
  //   1. Fork current transcript (read-only snapshot)
  //   2. Send to a lightweight model for 3–5 word description
  //   3. Push description via setAppStateForTasks (root store passthrough)
  //   4. Run every 30s with backoff on empty deltas
  logger.debug("startAgentSummarization called but not yet implemented", {
    sessionId: _sessionId,
    agentId: _agentId,
  })
  return () => {
    // Cleanup no-op — no timers to clear
  }
}

export async function runAsyncAgentLifecycle(
  agentName: string,
  sessionId: string,
  agentId: string,
  runAgentImpl: () => Promise<import("./agent").Agent.RunAgentResult>,
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

    try {
      const result = await runAgentImpl()
      usage = result.usage ?? usage
      return result
    } catch (err: unknown) {
      if (err instanceof Error && (err.name === "AgentTimeoutError" || err.name === "AbortError")) {
        status = "killed"
      } else {
        status = "failed"
      }
      error = err instanceof Error ? err : new Error(String(err))
      throw err // We rethrow usually, but we must enqueue notification first
    } finally {
      Bus.publish(AgentEvent.CacheEvictionHint, { agentId })
      enqueueAgentNotification(sessionId, {
        agentId,
        status,
        description: `Agent ${agentName} ${status}`,
        usage,
        error,
      })
    }
  })
}
