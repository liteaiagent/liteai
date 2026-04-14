import { Bus } from "@/bus/index"
import { clearSessionHooks, type RegisteredSessionGroup, registerSessionHook } from "@/hook/hook"
import type { IsolationArtifactIdentifier } from "@/isolation/registry"
import { Provider } from "@/provider/provider"
import { SessionPrompt } from "@/session/engine"
import type { PromptInput } from "@/session/engine/loop"
import { Session } from "@/session/index"
import type { SessionID } from "@/session/schema"
import type { TranscriptMessage } from "@/session/transcript"
import { Log } from "@/util/log"
import { Agent } from "./agent"
import {
  AgentExecutionContext,
  createSubagentContext,
  type ParentContext,
  runWithAgentContext,
  type SubagentContext,
  type SubagentContextOverrides,
} from "./context"
import { AgentSpawnError, AgentTimeoutError, ConcurrentAgentLimitError, RequiredMcpServerError } from "./errors"
import { AgentEvent } from "./events"
import type { CacheSafeParams } from "./fork"
import { isRestrictedToPluginOnly } from "./policy"

const logger = Log.create({ service: "agent:runner" })

import { registerPerfettoAgent } from "@/telemetry/perfetto"
import { type AcquiredResources, AgentCleanup } from "./cleanup"
import { extractPartialResult, runAsyncAgentLifecycle, type SummarizationDeps } from "./lifecycle"

export const DEFAULT_CONCURRENT_AGENT_LIMIT = 8

/**
 * Input for `runAgent`. The caller is responsible for resolving and validating
 * the `agentDefinition` before invoking the runner — this ensures the type
 * system prevents null/undefined definitions, and lets each call site
 * (tool handler, API handler) produce context-appropriate error responses.
 */
/**
 * Fork-specific context for fork child agent spawning.
 * When provided, the runner threads parent cache-safe params and forces async
 * mode for all agent spawns to produce a unified task-notification UX.
 *
 * MVP Reference: `AgentTool.ts` fork path, `forkSubagent.ts:47-71`
 */
export interface ForkSpawnContext {
  /** Parent's rendered system prompt (byte-exact, not recomputed). */
  parentSystemPrompt: string
  /** Cache-safe params for prompt cache sharing with the parent. */
  cacheSafeParams: CacheSafeParams
  /**
   * Parent's transcript messages (last assistant message + prior context).
   * Used by `buildForkedMessages()` to construct cache-compatible prefixes.
   */
  forkMessages: import("@/session/message").Message.WithParts[]
  /** Bypass sidechain transcript recording for ephemeral forks */
  skipTranscript?: boolean
}

export interface RunAgentInput {
  /** Pre-resolved agent definition. Must be non-null — caller validates. */
  agentDefinition: Agent.AgentDefinition
  /** Target session for agent execution. */
  sessionId: SessionID | string
  /** Parent context for context forking. Auto-detected from ALS if omitted. */
  parentContext?: ParentContext
  /** Override fields on the forked SubagentContext. */
  overrides?: SubagentContextOverrides
  /** Additional prompt input parts (tool results, skill content, etc.) */
  inputParts?: PromptInput["parts"]
  /** Force async/background execution. Defaults to agentDefinition.background. */
  isAsync?: boolean
  /**
   * Fork-specific context. When provided, the agent is spawned as a fork child
   * with the parent's prompt cache shared via CacheSafeParams. Forces async
   * mode for ALL agent spawns when fork is active (FR-005, Research R-010).
   */
  forkContext?: ForkSpawnContext
}

async function executeSubagentStartHooks(
  agentDef: Agent.AgentDefinition,
  agentId: string,
  cwd: string,
  session_id: string,
): Promise<string[]> {
  const additionalContexts: string[] = []
  if (!agentDef.hooks) return additionalContexts

  if (isRestrictedToPluginOnly("hooks", agentDef)) {
    logger.warn("blocking execution of user-defined hooks for custom agent", { agentName: agentDef.name })
    return additionalContexts
  }

  for (const [evtName, groups] of Object.entries(agentDef.hooks)) {
    const targetEvent = evtName === "Stop" ? "SubagentStop" : evtName
    if (Array.isArray(groups)) {
      for (const group of groups) {
        const registeredGroup: RegisteredSessionGroup = { ...group, isAgent: true }
        registerSessionHook(agentId, targetEvent, registeredGroup)
      }
    }
  }

  const { trigger } = await import("@/hook/hook")
  const res = await trigger("SubagentStart", {
    cwd,
    session_id,
    hook_event_name: "SubagentStart",
    source: agentDef.name,
    agent_id: agentId,
  })

  if (res.context) {
    additionalContexts.push(res.context)
  }

  return additionalContexts
}

/**
 * Primary orchestrator for spawning and executing a sub-agent.
 *
 * Accepts a pre-validated `AgentDefinition` — the caller must resolve the
 * agent by name (via `Agent.get()`) and validate it is non-null before
 * calling this function. This design eliminates null-handling bugs by
 * construction and allows each call site to produce context-appropriate
 * error responses (e.g., tool_result errors vs HTTP 404).
 *
 * For a convenience wrapper that resolves an agent by name and throws
 * `AgentSpawnError` if not found, see `runAgentByName()`.
 *
 * @see RunAgentInput
 * @see runAgentByName
 */
export async function runAgent(input: RunAgentInput): Promise<Agent.RunAgentResult> {
  const { agentDefinition: agentDef, overrides, inputParts, forkContext } = input
  const sessId = input.sessionId as SessionID
  const agentName = agentDef.name

  // FR-005 / R-010: When fork context is provided, ALL agent spawns are forced
  // to async mode for a unified task-notification interaction model.
  const isAsync = forkContext ? true : (input.isAsync ?? !!agentDef.background)
  const agentId = crypto.randomUUID()
  const storeContext = input.parentContext ?? AgentExecutionContext.getStore()
  const isFullParent = storeContext && "abortController" in storeContext
  const parentContext = isFullParent ? (storeContext as ParentContext) : undefined

  // 1. Validation for constraints
  if (agentDef.requiredMcpServers && agentDef.requiredMcpServers.length > 0) {
    const { MCP } = await import("@/mcp/index")
    const mcpStatus = await MCP.status()
    const availableNames = Object.entries(mcpStatus)
      .filter(([_, status]) => status.status === "connected")
      .map(([name]) => name)
    for (const req of agentDef.requiredMcpServers) {
      if (!availableNames.includes(req)) {
        throw new RequiredMcpServerError({ message: `Required MCP server ${req} is not connected` })
      }
    }
  }

  const timeoutMs = agentDef.timeout ?? 1800000 // 30 mins default

  logger.info("runAgent invoked", { agentName, sessionId: sessId, timeoutMs })

  const concurrentLimit = process.env.LITEAI_CONCURRENT_AGENT_LIMIT
    ? Number.parseInt(process.env.LITEAI_CONCURRENT_AGENT_LIMIT, 10)
    : DEFAULT_CONCURRENT_AGENT_LIMIT
  const currentCount = Session.getAgentCount(sessId)
  if (currentCount >= concurrentLimit) {
    throw new ConcurrentAgentLimitError({ message: `Concurrent agent limit reached: ${concurrentLimit}` })
  }
  Session.incrementAgentCount(sessId)

  const startTime = Date.now()
  let transcriptMessagesRef: TranscriptMessage[] | undefined
  let mcpCleanup: (() => Promise<void>) | undefined

  let subContext: SubagentContext | undefined
  let registeredIsolationArtifact: IsolationArtifactIdentifier | undefined

  try {
    const { initializeAgentMcpServers } = await import("@/mcp/agent-mcp")
    const initResult = await initializeAgentMcpServers(agentDef)
    const mcpClients = initResult.clients
    mcpCleanup = initResult.cleanup

    // Build subagent context
    const parentMock: ParentContext = parentContext ?? {
      sessionId: sessId,
      abortController: new AbortController(),
      readFileState: new Map(),
      contentReplacementState: {},
      toolDecisions: undefined, // Default for root agents, maybe retrieved from session elsewhere if available
      getAppState: () => ({}),
      setAppState: () => {},
      model: agentDef.model ?? (await Provider.defaultModel()),
    }

    const updatedOverrides: SubagentContextOverrides = overrides ? { ...overrides } : {}

    if (agentDef.isolation === "worktree") {
      logger.info("Initializing worktree isolation", { agentId, agentName })
      const { Worktree } = await import("@/worktree")
      const info = await Worktree.makeWorktreeInfo(agentName)
      const bootstrap = await Worktree.createFromInfo(info)
      await bootstrap()

      const { IsolationArtifactRegistry } = await import("@/isolation/registry")
      await IsolationArtifactRegistry.registerWorktreeArtifact(agentId, info.directory)
      registeredIsolationArtifact = { type: "worktree", directory: info.directory }

      if (forkContext) {
        const { buildWorktreeNotice } = await import("./fork")
        const notice = buildWorktreeNotice(parentContext?.cwd ?? process.cwd(), info.directory)

        // Inject the worktree notice into the last user message of the fork context.
        // This ensures the child agent explicitly knows about its isolated worktree.
        const forkMessages = [...forkContext.cacheSafeParams.forkContextMessages]
        if (forkMessages && forkMessages.length > 0) {
          const originalLastMsg = forkMessages[forkMessages.length - 1]
          const lastMsg = { ...originalLastMsg, parts: [...originalLastMsg.parts] }
          forkMessages[forkMessages.length - 1] = lastMsg
          if (lastMsg.info.role === "user") {
            lastMsg.parts.push({
              type: "text",
              id: originalLastMsg.parts.find((p) => p.type === "text")?.id ?? "", // Dummy fallback ID, true ID generated on save
              sessionID: lastMsg.info.sessionID,
              messageID: lastMsg.info.id,
              text: `<worktree_notice>\n${notice}\n</worktree_notice>`,
              synthetic: true,
            } as import("@/session/message").Message.TextPart)
          }
        }
        // Update the fork context with the modified messages
        forkContext.cacheSafeParams = {
          ...forkContext.cacheSafeParams,
          forkContextMessages: forkMessages,
        }
      }

      updatedOverrides.cwd = info.directory
    } else if (agentDef.isolation === "remote") {
      logger.info("Initializing remote (Docker) isolation", { agentId, agentName })
      const { DockerIsolation } = await import("@/isolation/docker")
      const result = await DockerIsolation.createContainer({
        agentId,
        projectPath: (await import("@/project/instance")).Instance.directory,
        subPath: overrides?.cwd,
        containerImage: agentDef.containerImage,
      })

      const { IsolationArtifactRegistry } = await import("@/isolation/registry")
      await IsolationArtifactRegistry.registerRemoteArtifact(agentId, result.containerId)
      registeredIsolationArtifact = { type: "remote", containerId: result.containerId }

      updatedOverrides.cwd = result.mappedCwd
      updatedOverrides.execController = result.execController
    }

    // Fork-aware context construction: thread parent's system prompt and
    // cache-safe params into the SubagentContext for cache-identical API
    // prefixes (FR-001, FR-007, FR-009).
    const forkOverrides: SubagentContextOverrides = forkContext
      ? {
          isFork: true,
          parentSystemPrompt: forkContext.parentSystemPrompt,
          cacheSafeParams: forkContext.cacheSafeParams,
        }
      : {}

    subContext = createSubagentContext(parentMock, agentDef, agentId, {
      ...updatedOverrides,
      ...forkOverrides,
      mcpClients: updatedOverrides.mcpClients ?? mcpClients,
    })

    const { pruneContext } = await import("./filter")
    const { prunedUserContext, prunedSystemContext } = pruneContext(
      agentDef,
      overrides?.userContext,
      overrides?.systemContext,
      {
        hasUserOverride: !!overrides?.userContext,
      },
    )

    // Save pruned context overrides so they can be consumed by the inner prompt or query loop
    subContext.prunedUserContext = prunedUserContext
    subContext.prunedSystemContext = prunedSystemContext

    const { applyPermissionSandboxToContext } = await import("@/permission/sandbox")

    // R-009: Permission mode composition for fork children. Elevated parent
    // modes (bypassPermissions, acceptEdits, auto) override the fork child's
    // default 'bubble' mode. A parent in 'auto' mode has already authorized
    // non-interactive execution — forcing the fork child to 'bubble' would
    // surface permission prompts for background workers, defeating the purpose.
    const effectivePermissionMode = forkContext
      ? resolveForkedPermissionMode(agentDef.permissionMode, parentContext?.getAppState?.()?.permissionMode)
      : undefined
    if (effectivePermissionMode && subContext) {
      // Overwrite the default 'bubble' with the composed permission mode
      subContext.prunedUserContext = {
        ...subContext.prunedUserContext,
        permissionMode: effectivePermissionMode,
      }
    }

    applyPermissionSandboxToContext(subContext, agentDef, {
      isAsync,
      canShowPermissionPrompts: false,
    })

    const finalParts = inputParts ? [...inputParts] : []
    if (agentDef.skills && agentDef.skills.length > 0) {
      const { SkillLoader } = await import("@/skill/loader")
      for (const skillName of agentDef.skills) {
        const skill = await SkillLoader.resolveSkillName(skillName)
        if (skill) {
          SkillLoader.registerInvokedSkill(agentId, skill.name)
          finalParts.unshift({
            type: "text",
            text: `<skill name="${skill.name}">\n${skill.content}\n</skill>`,
          })
        }
      }
    }

    const { AgentMemory } = await import("@/agent/memory")
    if (await AgentMemory.isAutoMemoryEnabled()) {
      const defaultScope = (await import("@/project/instance")).Instance.worktree ? "local" : "project"
      const scope =
        agentDef.memory === "local" || agentDef.memory === "project" || agentDef.memory === "user"
          ? agentDef.memory
          : defaultScope
      const memPrompt = await AgentMemory.loadAgentMemoryPrompt(agentName, scope)
      finalParts.unshift({ type: "text", text: memPrompt })
    }

    // 2. Wrap entire execution with Context
    const localTranscriptMessages: TranscriptMessage[] = []
    transcriptMessagesRef = localTranscriptMessages

    const executeLogic = async () => {
      // US4: Sidechain Transcript Isolation
      //
      // A full SQLite subsession is architecturally necessary because
      // SessionPrompt.prompt() persists messages via Session.updateMessage()
      // and Session.updatePart(). Without a subsession:
      //   1. Sub-agent messages would leak into the parent conversation
      //   2. Message.Event.Updated bus events would fire for parent listeners
      //   3. The BackgroundTaskRegistry in loop.ts is session-scoped — sharing
      //      the parent session would mix task lifecycles
      //
      // The liteai approach provides full observability and crash-resumability
      // at the cost of additional DB writes. The JSONL sidechain transcript below
      // captures the same fire-and-forget audit trail for analytics.
      const parentSession = await Session.get(sessId)
      const sidechainSess = await Session.createNext({
        parentID: sessId,
        directory: parentSession.directory,
        title: `Subagent: ${agentName} (${agentId})`,
      })

      const additionalContexts = await executeSubagentStartHooks(
        agentDef,
        agentId,
        subContext?.cwd ?? process.cwd(),
        sidechainSess.id,
      )
      if (additionalContexts.length > 0) {
        finalParts.push({
          type: "text",
          text: `<hook-additional-context>\n${additionalContexts.join("\n")}\n</hook-additional-context>`,
        })
      }

      registerPerfettoAgent(agentId, storeContext?.agentId)

      Bus.publish(AgentEvent.Spawned, {
        agentId,
        agentType: agentName,
        parentId: storeContext?.agentId ?? "",
        isAsync,
      })

      const { SidechainTranscript } = await import("@/session/transcript")
      const transcript = forkContext?.skipTranscript
        ? {
            getPath: () => "",
            recordMessage: async () => {},
            recordChain: async () => {},
          }
        : SidechainTranscript.create(parentSession.directory, sessId, agentName, agentId)

      // Persist agent metadata sidecar alongside the JSONL transcript.
      // Stores identity fields (agentType, worktreePath, description) and the
      // byte-exact rendered system prompt for fork children — enabling
      // zero-degradation Tier 2 system prompt recovery on resume.
      const { AgentMeta } = await import("./agent-meta")
      await AgentMeta.write(parentSession.directory, sessId, agentName, agentId, {
        agentType: agentName,
        agentId,
        worktreePath: updatedOverrides.cwd !== process.cwd() ? updatedOverrides.cwd : undefined,
        description: agentDef.description,
        renderedSystemPrompt: forkContext?.parentSystemPrompt,
      })

      let lastRecordedUuid = "root"

      // Record initial messages before query loop
      const initialUuid = crypto.randomUUID()
      const sysMsg: TranscriptMessage = {
        isSidechain: true,
        uuid: initialUuid,
        parentUuid: lastRecordedUuid,
        role: "system",
        content: agentDef.prompt ?? "No system prompt",
        timestamp: Date.now(),
      }
      await transcript.recordMessage(sysMsg)
      localTranscriptMessages.push(sysMsg)
      lastRecordedUuid = initialUuid

      const userMsg: TranscriptMessage = {
        isSidechain: true,
        uuid: crypto.randomUUID(),
        parentUuid: lastRecordedUuid,
        role: "user",
        // Using JSON stringify to dump the parts array since it contains tool responses or prompts
        content: JSON.stringify(finalParts),
        timestamp: Date.now(),
      }
      await transcript.recordMessage(userMsg)
      localTranscriptMessages.push(userMsg)

      // Setup incremental write using Bus to guarantee abort-safe partial preservation
      const recordedMessageIds = new Set<string>()
      const { Message } = await import("@/session/message")

      const unsubs = [
        Bus.subscribe(Message.Event.Updated, async (evt) => {
          const info = evt.properties.info
          if (info.sessionID === sidechainSess.id && info.role === "assistant" && "finish" in info && info.finish) {
            if (recordedMessageIds.has(info.id)) return
            recordedMessageIds.add(info.id)
            const newUuid = info.id
            const astMsg: TranscriptMessage = {
              isSidechain: true,
              uuid: newUuid,
              parentUuid: lastRecordedUuid,
              role: "assistant",
              content: `Assistant turn result: ${info.finish} with ${info.cost} cost.`,
              timestamp: Date.now(),
            }
            await transcript.recordMessage(astMsg)
            localTranscriptMessages.push(astMsg)
            lastRecordedUuid = newUuid
          }
        }),
      ]

      let timeoutId: ReturnType<typeof setTimeout> | undefined
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          const err = new AgentTimeoutError({ message: `Agent execution timed out after ${timeoutMs}ms` })
          subContext?.abortController.abort(err)
          reject(err)
        }, timeoutMs)
      })

      let finalSystemPrompt = agentDef.prompt ?? ""
      const criticalReminder = subContext?.criticalSystemReminder
      if (criticalReminder) {
        finalSystemPrompt = finalSystemPrompt
          ? `${finalSystemPrompt}\n\n<system-reminder>\n${criticalReminder}\n</system-reminder>`
          : `<system-reminder>\n${criticalReminder}\n</system-reminder>`
      }

      // Run session prompt explicitly on sidechain subsession
      const runPromise = SessionPrompt.prompt({
        sessionID: sidechainSess.id,
        agent: agentName,
        parts: finalParts,
        model: agentDef.model,
        system: finalSystemPrompt,
      })

      let resultMsg: Awaited<ReturnType<typeof SessionPrompt.prompt>> | undefined
      try {
        resultMsg = await Promise.race([runPromise, timeoutPromise])
      } finally {
        if (timeoutId) clearTimeout(timeoutId)
        for (const u of unsubs) u() // cleanup listener
      }

      let finalOutput = "No text output."

      // Ensure only dense task result returns to parent
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
        agentType: agentName,
        status: "completed",
        duration,
        usage: result.usage,
      })
      return result
    }

    if (isAsync) {
      // Wire summarization deps: the runner has access to the accumulated
      // transcript and the subContext's root store passthrough.
      const summarizationDeps: SummarizationDeps | undefined = subContext
        ? {
            getTranscript: () => transcriptMessagesRef ?? [],
            setAppStateForTasks: subContext.setAppStateForTasks,
          }
        : undefined
      return await runAsyncAgentLifecycle(agentName, sessId, agentId, executeLogic, summarizationDeps, {
        cacheSafeParams: forkContext?.cacheSafeParams,
      })
    } else {
      return await runWithAgentContext(subContext, executeLogic)
    }
  } catch (err: unknown) {
    const duration = Date.now() - startTime
    logger.error("runAgent failed", { error: err, agentId, agentName })

    let status: "failed" | "killed" = "failed"
    let partialResult: string | undefined

    if (err instanceof AgentTimeoutError || (err instanceof Error && err.name === "AbortError")) {
      status = "killed"
      partialResult = extractPartialResult(transcriptMessagesRef ?? []) ?? "Killed with no partial result"
    }

    Bus.publish(AgentEvent.Completed, {
      agentId,
      agentType: agentName,
      status,
      duration,
      usage: { totalTokens: 0, toolCalls: 0, duration },
    })

    if (status === "killed") {
      return {
        agentId,
        status: "killed",
        result: partialResult ?? "Killed with no partial result",
        usage: { totalTokens: 0, toolCalls: 0, duration },
        partialResult,
        error: err instanceof Error ? err : new Error(String(err)),
      }
    }

    throw err
  } finally {
    const resources: AcquiredResources = {
      mcpSession: mcpCleanup ? { cleanup: mcpCleanup } : undefined,
      contextMessages: transcriptMessagesRef,
    }

    if (subContext) {
      await AgentCleanup.execute(subContext, resources).catch((err) =>
        logger.error("AgentCleanup execution failed", { error: err, agentId }),
      )
    } else {
      // Fallback cleanup if context creation failed
      if (mcpCleanup) {
        await mcpCleanup().catch((err) => logger.warn("Agent MCP cleanup fallback failed", { error: err }))
      }
      if (registeredIsolationArtifact) {
        const { IsolationArtifactRegistry } = await import("@/isolation/registry")
        await IsolationArtifactRegistry.deregisterArtifact(agentId, registeredIsolationArtifact).catch((err) =>
          logger.error("Isolation artifact fallback deregistration failed", { agentId, error: err }),
        )
      }
      clearSessionHooks(agentId)
    }

    Session.decrementAgentCount(sessId)
  }
}

/**
 * Convenience wrapper that resolves an agent by name and runs it.
 * Throws `AgentSpawnError` if the agent is not found.
 *
 * For boundary handlers (HTTP, tool call sites) that need custom error
 * formatting, use `Agent.get()` + `runAgent()` directly instead.
 */
export async function runAgentByName(
  agentName: string,
  sessionId: SessionID | string,
  options?: Omit<RunAgentInput, "agentDefinition" | "sessionId">,
): Promise<Agent.RunAgentResult> {
  const agentDef = await Agent.get(agentName)
  if (!agentDef) {
    throw new AgentSpawnError({ message: `Agent '${agentName}' not found or not loaded` })
  }
  return runAgent({ agentDefinition: agentDef, sessionId, ...options })
}

// ─── Fork Permission Composition ──────────────────────────────────────────────

/**
 * Elevated parent permission modes that override fork child's default 'bubble'.
 * When the parent session has already opted into a permissive mode, the fork
 * child inherits that mode rather than forcing interactive prompts for a
 * background worker.
 *
 * MVP Reference: `resumeAgent.ts:158-161` — worker permission context override
 * Research: R-009
 */
const ELEVATED_PERMISSION_MODES = new Set(["bypassPermissions", "acceptEdits", "dontAsk"])

function resolveForkedPermissionMode(
  childDefault: Agent.Info["permissionMode"],
  parentMode: Agent.Info["permissionMode"] | undefined,
): Agent.Info["permissionMode"] | undefined {
  if (!parentMode) return undefined
  // If the parent has an elevated mode, override the child's bubble default
  if (ELEVATED_PERMISSION_MODES.has(parentMode)) {
    return parentMode
  }
  return childDefault
}
