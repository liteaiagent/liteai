import { Bus } from "@/bus/index"
import { clearSessionHooks, type RegisteredSessionGroup, registerSessionHook } from "@/hook/hook"
import { Provider } from "@/provider/provider"
import { SessionPrompt } from "@/session/engine"
import type { PromptInput } from "@/session/engine/loop"
import { Session } from "@/session/index"
import type { SessionID } from "@/session/schema"
import { Log } from "@/util/log"
import { Agent } from "./agent"
import {
  AgentExecutionContext,
  createSubagentContext,
  type ParentContext,
  runWithAgentContext,
  type SubagentContextOverrides,
} from "./context"
import { AgentSpawnError, AgentTimeoutError, ConcurrentAgentLimitError, RequiredMcpServerError } from "./errors"
import { AgentEvent } from "./events"
import { isRestrictedToPluginOnly } from "./policy"

const logger = Log.create({ service: "agent:runner" })

import { extractPartialResult, runAsyncAgentLifecycle } from "./lifecycle"

export const DEFAULT_CONCURRENT_AGENT_LIMIT = 8

/**
 * Input for `runAgent`. The caller is responsible for resolving and validating
 * the `agentDefinition` before invoking the runner — this ensures the type
 * system prevents null/undefined definitions, and lets each call site
 * (tool handler, API handler) produce context-appropriate error responses.
 */
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
}

function executeSubagentStartHooks(agentDef: Agent.AgentDefinition, agentId: string) {
  if (!agentDef.hooks) return

  if (isRestrictedToPluginOnly("hooks", agentDef)) {
    logger.warn("blocking execution of user-defined hooks for custom agent", { agentName: agentDef.name })
    return
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
  const { agentDefinition: agentDef, overrides, inputParts } = input
  const sessId = input.sessionId as SessionID
  const agentName = agentDef.name
  const isAsync = input.isAsync ?? !!agentDef.background
  const agentId = Math.random().toString(36).substring(7)
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
        throw new RequiredMcpServerError(`Required MCP server ${req} is not connected`)
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
    throw new ConcurrentAgentLimitError(`Concurrent agent limit reached: ${concurrentLimit}`)
  }
  Session.incrementAgentCount(sessId)

  const startTime = Date.now()
  let transcriptMessagesRef: import("@/session/transcript").TranscriptMessage[] | undefined
  try {
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

    const subContext = createSubagentContext(parentMock, agentDef, overrides)
    subContext.agentId = agentId

    const { applyPermissionSandboxToContext } = await import("@/permission/sandbox")
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
    const localTranscriptMessages: import("@/session/transcript").TranscriptMessage[] = []
    transcriptMessagesRef = localTranscriptMessages

    const executeLogic = async () => {
      executeSubagentStartHooks(agentDef, agentId)

      Bus.publish(AgentEvent.Spawned, {
        agentId,
        agentType: agentName,
        parentId: storeContext?.agentId ?? "",
        isAsync,
      })

      // US4: Sidechain Transcript Isolation
      // Create an isolated subsession so SQLite doesn't mix messages with the parent.
      const parentSession = await Session.get(sessId)
      const sidechainSess = await Session.createNext({
        parentID: sessId,
        directory: parentSession.directory,
        title: `Subagent: ${agentName} (${agentId})`,
      })

      const { SidechainTranscript } = await import("@/session/transcript")
      const transcript = SidechainTranscript.create(parentSession.directory, sessId, agentName, agentId)

      let lastRecordedUuid = "root"

      // Record initial messages before query loop
      const initialUuid = Math.random().toString(36).substring(7)
      const sysMsg: import("@/session/transcript").TranscriptMessage = {
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

      const userMsg: import("@/session/transcript").TranscriptMessage = {
        isSidechain: true,
        uuid: Math.random().toString(36).substring(7),
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
            const astMsg: import("@/session/transcript").TranscriptMessage = {
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
          subContext.abortController.abort(new AgentTimeoutError(`Agent execution timed out after ${timeoutMs}ms`))
          reject(new AgentTimeoutError(`Agent execution timed out after ${timeoutMs}ms`))
        }, timeoutMs)
      })

      let finalSystemPrompt = agentDef.prompt ?? ""
      if (subContext.criticalSystemReminder) {
        finalSystemPrompt = finalSystemPrompt
          ? `${finalSystemPrompt}\n\n<system-reminder>\n${subContext.criticalSystemReminder}\n</system-reminder>`
          : `<system-reminder>\n${subContext.criticalSystemReminder}\n</system-reminder>`
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
      return await runAsyncAgentLifecycle(agentName, sessId, agentId, executeLogic)
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
    clearSessionHooks(agentId)
    try {
      const m = await import("@/skill/loader")
      await m.SkillLoader.clearInvokedSkillsForAgent(agentId)
    } catch (err) {
      logger.error("Failed to clear invoked skills", { error: err, agentId })
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
    throw new AgentSpawnError(`Agent '${agentName}' not found or not loaded`)
  }
  return runAgent({ agentDefinition: agentDef, sessionId, ...options })
}
