import fs from "node:fs/promises"
import type { SessionID } from "@/session/schema"
import { Session } from "../session/index"
import { SidechainTranscript, type TranscriptMessage } from "../session/transcript"
import { Log } from "../util/log"
import { Worktree } from "../worktree/index"
import { Agent } from "./agent"
import { createSubagentContext, type ParentContext, runWithAgentContext } from "./context"
import { AgentSpawnError, AgentTimeoutError } from "./errors"
import {
  filterOrphanedThinkingOnlyMessages,
  filterUnresolvedToolUses,
  filterWhitespaceOnlyAssistantMessages,
} from "./filter"
import { ForkAgentConfig, getLastCacheSafeParams } from "./fork"
import { runAsyncAgentLifecycle } from "./lifecycle"

const logger = Log.create({ service: "agent:resume" })

export interface ResumeAgentResult {
  agentId: string
  description: string
}

export interface AgentMetadata {
  agentType?: string
  description?: string
  worktreePath?: string
  [key: string]: unknown
}

// Temporary shim until actual agent metadata persistence is introduced to backend
async function readAgentMetadata(
  // explicitly unused pending metadata persistence database implementation
  _agentId: string,
): Promise<AgentMetadata | null> {
  // In the backend MVP context, we might not have a standalone metadata.json.
  // We'll return null to trigger the graceful fallbacks defined in the contract.
  return null
}

export function reconstructContentOptimizationState(
  parentState: Record<string, unknown> | undefined,
  messages: TranscriptMessage[],
  persistedReplacements?: Record<string, unknown>,
): Record<string, unknown> {
  // Gap-filling from parent's live optimization state for inherited entries
  const state: Record<string, unknown> = parentState ? { ...parentState } : {}
  if (persistedReplacements) {
    Object.assign(state, persistedReplacements)
  }
  // Scanning resumed messages for persisted content references
  for (const msg of messages) {
    if (msg.role === "assistant" && Array.isArray(msg.content)) {
      // biome-ignore lint/suspicious/noExplicitAny: transcript content blocks are loosely typed
      for (const part of msg.content as any[]) {
        if (part.type === "tool_result" && part.contentReplacementId) {
          if (!state[part.contentReplacementId]) {
            // Content optimization reference exists in transcript but was not
            // present in parentState or persistedReplacements. This means the
            // original replacement content is irrecoverable from the transcript
            // alone — tool_result blocks don't carry the cached payload.
            // Set to null so downstream consumers see a deterministic sentinel
            // rather than an implicit undefined gap.
            state[part.contentReplacementId] = null
            logger.warn("content optimization reference not found during reconstruction; set to null", {
              contentReplacementId: part.contentReplacementId,
            })
          }
        }
      }
    }
  }
  return state
}

/**
 * Resolve the sidechain subsession for a resumed agent.
 *
 * Strategy:
 * 1. Search Session.children for the original subsession created by runner.ts
 *    (title pattern: `Subagent: ${agentType} (${agentId})`)
 * 2. If found, return it — the SQLite session contains the full conversation
 * 3. If not found (GC'd or cleaned up), create a fresh subsession and log a
 *    degraded warning. The model will start without prior conversation context.
 */
async function resolveResumeSubsession(
  parentSessionId: SessionID,
  parentDirectory: string,
  agentId: string,
  agentType: string,
): Promise<{ session: Session.Info; isDegraded: boolean }> {
  const childSessions = await Session.children(parentSessionId)
  const existing = childSessions.find((s) => s.title.includes(`(${agentId})`))

  if (existing) {
    logger.info("found existing sidechain subsession for resume", {
      agentId,
      subsessionId: existing.id,
    })
    return { session: existing, isDegraded: false }
  }

  // Subsession was cleaned up — create a fresh one. The model starts without
  // prior conversation context since the JSONL transcript is an audit log
  // (summary-level) and cannot reconstruct full conversation messages.
  logger.warn("original sidechain subsession not found; creating fresh subsession for resume", {
    agentId,
    agentType,
  })

  const newSession = await Session.createNext({
    parentID: parentSessionId,
    directory: parentDirectory,
    title: `Subagent: ${agentType} (resumed) (${agentId})`,
  })

  return { session: newSession, isDegraded: true }
}

/**
 * Orchestrator: Resume a previously-interrupted agent in the background.
 */
export async function resumeAgentBackground(params: {
  agentId: string
  prompt: string
  sessionContext: ParentContext
  invokingRequestId?: string
}): Promise<ResumeAgentResult> {
  const { agentId, sessionContext, invokingRequestId } = params

  const parentSession = await Session.get(sessionContext.sessionId as SessionID)

  // 1. Load metadata
  const meta = await readAgentMetadata(agentId)

  // Try to determine agentType from DB if metadata is null
  let fallbackAgentType = "explore"
  if (!meta) {
    const childSessions = await Session.children(sessionContext.sessionId as SessionID)
    const subSession = childSessions.find((s) => s.title.includes(`(${agentId})`))
    if (subSession) {
      const match = subSession.title.match(/Subagent:\s+(.+)\s+\(/)
      if (match) {
        fallbackAgentType = match[1]
      }
    }
  }

  const agentType = meta?.agentType || fallbackAgentType

  // 2. Load transcript
  const transcript = await SidechainTranscript.read(
    parentSession.directory,
    sessionContext.sessionId,
    agentType,
    agentId,
  )

  if (!transcript || transcript.length === 0) {
    throw new Error(`No transcript found for agent ID: ${agentId}`)
  }

  // 3. Filter orphaned messages
  const resumedMessages = filterWhitespaceOnlyAssistantMessages(
    filterOrphanedThinkingOnlyMessages(filterUnresolvedToolUses(transcript)),
  )

  // 4. Reconstruct content optimization state
  const resumedReplacementState = reconstructContentOptimizationState(
    sessionContext.contentReplacementState,
    resumedMessages,
    undefined, // sidechain transcript replacements if they exist
  )

  // 5. Worktree validation
  let resumedWorktreePath: string | undefined
  if (meta?.worktreePath) {
    try {
      const stat = await fs.stat(meta.worktreePath)
      if (stat.isDirectory()) {
        resumedWorktreePath = meta.worktreePath
      }
    } catch {
      logger.debug(`Resumed worktree ${meta.worktreePath} no longer exists; falling back to parent cwd`)
    }
  }

  if (resumedWorktreePath) {
    await Worktree.refreshWorktreeMtime(resumedWorktreePath)
  }

  // Skip filterDeniedAgents re-gating — original spawn already passed
  let isResumedFork = false
  if (agentType === "fork") {
    isResumedFork = true
  }

  const selectedAgentDef = isResumedFork
    ? (ForkAgentConfig as unknown as Agent.AgentDefinition)
    : ((await Agent.get(agentType).catch(() => null)) ?? (await Agent.get("explore").catch(() => null)))

  if (!selectedAgentDef) {
    throw new AgentSpawnError({ message: `Agent definition not found for: ${agentType}` })
  }

  const uiDescription = meta?.description ?? "(resumed)"

  // 6. System prompt re-threading for fork child
  let forkParentSystemPrompt: string | undefined
  if (isResumedFork) {
    // Tier 1
    const storedLastParams = getLastCacheSafeParams(sessionContext.sessionId)
    if (storedLastParams?.systemPrompt) {
      forkParentSystemPrompt = Array.isArray(storedLastParams.systemPrompt)
        ? storedLastParams.systemPrompt.join("\n")
        : storedLastParams.systemPrompt
    } else {
      // Tier 2 rebuild isn't straightforward without full session config.
      // Tier 3 fail fast
      throw new Error("Cannot resume fork agent: unable to reconstruct parent system prompt")
    }
  }

  const asyncAgentContext = createSubagentContext(sessionContext, selectedAgentDef, agentId, {
    cwd: resumedWorktreePath ?? sessionContext.cwd,
    isFork: isResumedFork,
    parentSystemPrompt: forkParentSystemPrompt,
    contentReplacementState: resumedReplacementState,
  })

  // set invocationKind marking
  asyncAgentContext.invocationKind = "resume"
  asyncAgentContext.invokingRequestId = invokingRequestId

  // Resolve timeout from agent definition
  const timeoutMs = isResumedFork ? ForkAgentConfig.wallClockTimeout : (selectedAgentDef.timeout ?? 1_800_000) // 30 min default

  // We do not await this, we just dispatch it (it's runAsyncAgentLifecycle under the hood)
  void runWithAgentContext(asyncAgentContext, async () => {
    try {
      // Accumulate transcript messages for summarization deps
      const localTranscriptMessages: TranscriptMessage[] = []

      await runAsyncAgentLifecycle(
        agentType,
        sessionContext.sessionId,
        agentId,
        async (): Promise<Agent.RunAgentResult> => {
          const startTime = Date.now()

          // 1. Resolve (or create) the sidechain subsession
          const { session: sidechainSess, isDegraded } = await resolveResumeSubsession(
            sessionContext.sessionId as SessionID,
            parentSession.directory,
            agentId,
            agentType,
          )

          if (isDegraded) {
            logger.warn("resume operating in degraded mode — model has no prior conversation context", {
              agentId,
              agentType,
            })
          }

          // 2. Set up sidechain JSONL transcript for the resumed execution
          const sidechainTranscript = SidechainTranscript.create(
            parentSession.directory,
            sessionContext.sessionId,
            agentType,
            agentId,
          )

          // Record the resume event into the JSONL audit log
          const resumeAuditMsg: TranscriptMessage = {
            isSidechain: true,
            uuid: crypto.randomUUID(),
            role: "user",
            content: `[Resume]: ${params.prompt}`,
            timestamp: Date.now(),
          }
          await sidechainTranscript.recordMessage(resumeAuditMsg)
          localTranscriptMessages.push(resumeAuditMsg)

          // 3. Set up Bus listener for transcript recording (mirrors runner.ts pattern)
          const { Bus } = await import("@/bus/index")
          const { Message } = await import("@/session/message")
          const { AgentEvent } = await import("./events")

          const recordedMessageIds = new Set<string>()
          const unsubs = [
            Bus.subscribe(Message.Event.Updated, async (evt) => {
              const info = evt.properties.info
              if (info.sessionID === sidechainSess.id && info.role === "assistant" && "finish" in info && info.finish) {
                if (recordedMessageIds.has(info.id)) return
                recordedMessageIds.add(info.id)
                const astMsg: TranscriptMessage = {
                  isSidechain: true,
                  uuid: info.id,
                  parentUuid: resumeAuditMsg.uuid,
                  role: "assistant",
                  content: `Assistant turn result: ${info.finish} with ${info.cost} cost.`,
                  timestamp: Date.now(),
                }
                await sidechainTranscript.recordMessage(astMsg)
                localTranscriptMessages.push(astMsg)
              }
            }),
          ]

          // 4. Set up timeout
          let timeoutId: ReturnType<typeof setTimeout> | undefined
          const timeoutPromise = new Promise<never>((_, reject) => {
            timeoutId = setTimeout(() => {
              const err = new AgentTimeoutError({
                message: `Resumed agent execution timed out after ${timeoutMs}ms`,
              })
              asyncAgentContext.abortController.abort(err)
              reject(err)
            }, timeoutMs)
          })

          // 5. Build final system prompt
          let finalSystemPrompt = forkParentSystemPrompt ?? selectedAgentDef.prompt ?? ""
          const criticalReminder = asyncAgentContext.criticalSystemReminder
          if (criticalReminder) {
            finalSystemPrompt = finalSystemPrompt
              ? `${finalSystemPrompt}\n\n<system-reminder>\n${criticalReminder}\n</system-reminder>`
              : `<system-reminder>\n${criticalReminder}\n</system-reminder>`
          }

          // 6. Call SessionPrompt.prompt() to continue the conversation
          //
          // The sidechain subsession already contains the agent's prior conversation
          // (persisted by runner.ts during the original execution). SessionPrompt.prompt()
          // creates a new user message from `parts`, then loop() reads ALL messages
          // (prior + new) via Message.stream(). The model sees the full history and
          // responds from where it left off.
          const { SessionPrompt } = await import("@/session/engine")

          Bus.publish(AgentEvent.Spawned, {
            agentId,
            agentType,
            parentId: sessionContext.agentId ?? "",
            isAsync: true,
          })

          const runPromise = SessionPrompt.prompt({
            sessionID: sidechainSess.id,
            agent: agentType,
            parts: [{ type: "text", text: params.prompt }],
            system: finalSystemPrompt,
          })

          let resultMsg: Awaited<ReturnType<typeof SessionPrompt.prompt>> | undefined
          try {
            resultMsg = await Promise.race([runPromise, timeoutPromise])
          } finally {
            if (timeoutId) clearTimeout(timeoutId)
            for (const u of unsubs) u()
          }

          // 7. Extract result and compute usage metrics
          let finalOutput = "No text output."
          if (resultMsg?.parts) {
            const textParts = resultMsg.parts.filter((p) => p.type === "text") as { text: string }[]
            if (textParts.length > 0) {
              finalOutput = textParts.map((p) => p.text).join("\n")
            }
          }

          const duration = Date.now() - startTime

          let totalTokens = 0
          if (resultMsg && resultMsg.info.role === "assistant" && "tokens" in resultMsg.info) {
            const inputTokens = resultMsg.info.tokens?.input ?? 0
            const outputTokens = resultMsg.info.tokens?.output ?? 0
            totalTokens = inputTokens + outputTokens
          }

          // Record completion to JSONL audit log
          const completionMsg: TranscriptMessage = {
            isSidechain: true,
            uuid: crypto.randomUUID(),
            role: "assistant",
            content: `Resumed agent completed in ${duration}ms. Output: ${finalOutput.slice(0, 500)}`,
            timestamp: Date.now(),
          }
          await sidechainTranscript.recordMessage(completionMsg)
          localTranscriptMessages.push(completionMsg)

          const result: Agent.RunAgentResult = {
            agentId,
            status: "completed",
            result: finalOutput,
            usage: {
              totalTokens,
              toolCalls: resultMsg?.parts ? resultMsg.parts.filter((p) => p.type === "tool").length : 0,
              duration,
            },
          }

          Bus.publish(AgentEvent.Completed, {
            agentId,
            agentType,
            status: "completed",
            duration,
            usage: result.usage,
          })

          return result
        },
        {
          getTranscript: () => localTranscriptMessages,
          setAppStateForTasks: asyncAgentContext.setAppStateForTasks,
        },
      )
    } catch (err) {
      logger.error("Unhandled error in resume agent lifecycle", { agentId, error: err })
      throw err
    }
  })

  return {
    agentId,
    description: uiDescription,
  }
}
