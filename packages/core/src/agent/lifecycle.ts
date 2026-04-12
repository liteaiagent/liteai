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

export function enqueueAgentNotification(_sessionId: string, _notification: TerminalNotification) {
  // Enqueue notification via some system or event
  // _sessionId and _notification are needed by signature, but unused because terminal notification transport is a stub
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

// _sessionId and _agentId are required by external callers, but summarization is not fully implemented yet
export function startAgentSummarization(_sessionId: string, _agentId: string) {
  let isRunning = true

  const loop = async () => {
    if (!isRunning) return
    try {
      // fork the agent's current transcript to produce a 3-5 word activity description -> parent SetAppState
      const storeContext = AgentExecutionContext.getStore()
      if (storeContext && "setAppState" in storeContext) {
        // Bypass sub-agent setAppState explicitly, we assume we have rootSetAppState or we just call the parent context
      }
    } catch (err) {
      logger.error("Agent summarization loop cycle failed", { error: err, sessionId: _sessionId, agentId: _agentId })
    }
    setTimeout(loop, 30_000)
  }
  setTimeout(loop, 30_000)

  return () => {
    isRunning = false
  }
}

export async function runAsyncAgentLifecycle(
  agentName: string,
  sessionId: string,
  agentId: string,
  runAgentImpl: () => Promise<import("./agent").Agent.RunAgentResult>,
) {
  const storeContext = AgentExecutionContext.getStore()
  if (!storeContext) return await runAgentImpl()

  return await runWithAgentContext(storeContext, async () => {
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
