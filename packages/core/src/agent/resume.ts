import fs from "node:fs/promises"
import path from "node:path"
import { Log } from "@liteai/util/log"
import type { SessionID } from "@/session/schema"
import { Session } from "../session/index"
import { SidechainTranscript, type TranscriptMessage } from "../session/transcript"
import { Worktree } from "../worktree/index"
import { Agent } from "./agent"
import { AgentMeta } from "./agent-meta"
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

/**
 * Concurrent resume dedup guard.
 *
 * Prevents multiple simultaneous resume attempts for the same agent ID.
 * Without this, two concurrent `routeMessage()` calls for a stopped agent
 * would spawn duplicate execution contexts.
 */
const activeResumes = new Set<string>()

export interface ResumeAgentResult {
  agentId: string
  description: string
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

  // Dedup guard: prevent duplicate resume execution for the same agent
  if (activeResumes.has(agentId)) {
    logger.info("resume already in progress for agent; skipping duplicate", { agentId })
    return { agentId, description: "(already resuming)" }
  }
  activeResumes.add(agentId)

  const parentSession = await Session.get(sessionContext.sessionId as SessionID)

  // 1. Derive agentType: first pass via subsession title, then refine from sidecar metadata
  let fallbackAgentType = "explore"
  const childSessions = await Session.children(sessionContext.sessionId as SessionID)
  const subSession = childSessions.find((s) => s.title.includes(`(${agentId})`))
  if (subSession) {
    const match = subSession.title.match(/Subagent:\s+(.+)\s+\(/)
    if (match) {
      fallbackAgentType = match[1]
    }
  }

  // 2. Load metadata sidecar — authoritative source for agentType, worktreePath,
  //    description, and rendered system prompt.
  //
  //    The `subdir` param in AgentMeta.read maps to the filesystem path
  //    `{dir}/{sessionId}/subagents/{subdir}/agent-{agentId}.meta.json`.
  //    When the subsession has been GC'd, the title-derived fallbackAgentType
  //    may be wrong (e.g., "explore" when the agent was actually "code").
  //    Strategy: try the fast path first, then enumerate all subagent
  //    subdirectories to find the correct sidecar.
  let meta = await AgentMeta.read(parentSession.directory, sessionContext.sessionId, fallbackAgentType, agentId)

  if (!meta) {
    // Fast path missed — probe across all subagent subdirectories.
    const subagentsDir = path.join(parentSession.directory, sessionContext.sessionId, "subagents")
    try {
      const entries = await fs.readdir(subagentsDir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name === fallbackAgentType) continue
        const probedMeta = await AgentMeta.read(parentSession.directory, sessionContext.sessionId, entry.name, agentId)
        if (probedMeta) {
          meta = probedMeta
          logger.info("found agent metadata in alternate subdir via directory probe", {
            agentId,
            probed: entry.name,
            fallback: fallbackAgentType,
          })
          break
        }
      }
    } catch (err: unknown) {
      // ENOENT: subagents directory doesn't exist — no metadata available.
      // All other errors: fail-fast per Constitution §5.
      if (typeof err === "object" && err !== null && (err as { code?: string }).code !== "ENOENT") {
        throw err
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
  //
  // Three-tier recovery (strictly better than MVP which accepts cache
  // degradation in Tier 2 — see forkSubagent.ts L56-58 in liteai_cli_mvp):
  //   Tier 1: CacheSafeParams LRU (in-memory, byte-exact) — warm server
  //   Tier 2: .meta.json sidecar  (on-disk, byte-exact) — cold server / LRU eviction
  //   Tier 3: Throw (unrecoverable)
  let forkParentSystemPrompt: string | undefined
  if (isResumedFork) {
    // Tier 1: in-memory CacheSafeParams (byte-exact, cache-safe)
    const storedLastParams = getLastCacheSafeParams(sessionContext.sessionId)
    if (storedLastParams?.systemPrompt) {
      forkParentSystemPrompt = Array.isArray(storedLastParams.systemPrompt)
        ? storedLastParams.systemPrompt.join("\n")
        : storedLastParams.systemPrompt
      logger.debug("Tier 1 system prompt recovery from CacheSafeParams", { agentId })
    }
    // Tier 2: on-disk sidecar (byte-exact, survives LRU eviction / server restart)
    else if (meta?.renderedSystemPrompt) {
      forkParentSystemPrompt = meta.renderedSystemPrompt
      logger.info("Tier 2 system prompt recovery from sidecar", { agentId })
    }
    // Tier 3: fail-fast — no cache and no sidecar → unrecoverable
    else {
      activeResumes.delete(agentId)
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
    // Outer try/finally ensures the dedup guard is always cleaned up,
    // even if the lifecycle throws or the agent is aborted.
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
      // Log only — do NOT rethrow. This callback is dispatched via
      // `void runWithAgentContext(...)` (fire-and-forget), so rethrowing
      // would create an unhandled promise rejection. The finally block
      // still runs to clean up the dedup guard.
      logger.error("Unhandled error in resume agent lifecycle", { agentId, error: err })
    } finally {
      activeResumes.delete(agentId)
    }
  })

  return {
    agentId,
    description: uiDescription,
  }
}
