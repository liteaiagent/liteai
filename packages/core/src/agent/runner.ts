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
import { AgentTimeoutError, ConcurrentAgentLimitError, RequiredMcpServerError } from "./errors"
import { AgentEvent } from "./events"
import { isRestrictedToPluginOnly } from "./policy"

const logger = Log.create({ service: "agent:runner" })

// Phase-local stub for T016. Will be replaced by T037 (Phase 6)
function extractPartialResultStub(_sessionId: string): string {
  return "Partial result extraction stub" // TODO: scan messages in reverse for last assistant text, truncate to 2000 chars
}

export interface RunAgentOptions {
  parentContext?: ParentContext
  overrides?: SubagentContextOverrides
  inputParts?: PromptInput["parts"]
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

export async function runAgent(
  agentName: string,
  sessionId: SessionID | string,
  options?: RunAgentOptions,
): Promise<Agent.RunAgentResult> {
  const sessId = sessionId as SessionID
  const agentDef = await Agent.get(agentName)
  const agentId = Math.random().toString(36).substring(7)
  const storeContext = options?.parentContext ?? AgentExecutionContext.getStore()
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
    : 8
  const currentCount = Session.getAgentCount(sessId)
  if (currentCount >= concurrentLimit) {
    throw new ConcurrentAgentLimitError(`Concurrent agent limit reached: ${concurrentLimit}`)
  }
  Session.incrementAgentCount(sessId)

  const startTime = Date.now()
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

    const subContext = createSubagentContext(parentMock, agentDef, options?.overrides)
    subContext.agentId = agentId

    const { PermissionSandbox } = await import("@/permission/sandbox")
    PermissionSandbox.apply(subContext, { agentDef })

    const finalParts = options?.inputParts ? [...options.inputParts] : []
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
      const scope = (await import("@/project/instance")).Instance.worktree ? "local" : "project"
      const memPrompt = await AgentMemory.loadAgentMemoryPrompt(agentName, scope)
      finalParts.unshift({ type: "text", text: memPrompt })
    }

    // 2. Wrap entire execution with Context
    return await runWithAgentContext(subContext, async () => {
      executeSubagentStartHooks(agentDef, agentId)

      Bus.publish(AgentEvent.Spawned, {
        agentId,
        agentType: agentName,
        parentId: storeContext?.agentId ?? "",
        isAsync: !!agentDef.background,
      })

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

      // Run session prompt
      const runPromise = SessionPrompt.prompt({
        sessionID: sessId,
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
      }

      let finalOutput = "No text output."

      // Attempt to extract result
      if (resultMsg?.parts) {
        const textParts = resultMsg.parts.filter((p) => p.type === "text") as { text: string }[]
        if (textParts.length > 0) {
          finalOutput = textParts.map((p) => p.text).join("\n")
        }
      }

      const duration = Date.now() - startTime

      const result: Agent.RunAgentResult = {
        agentId,
        status: "completed",
        result: finalOutput,
        usage: {
          // TODO: reference Agent.RunAgentResult and SessionPrompt.prompt to calculate true totalTokens
          totalTokens: 0,
          // TODO: track tool invocations in this runner to calculate true toolCalls
          toolCalls: 0,
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
    })
  } catch (err: unknown) {
    const duration = Date.now() - startTime
    logger.error("runAgent failed", { error: err, agentId, agentName })

    let status: "failed" | "killed" = "failed"
    let partialResult: string | undefined

    if (err instanceof AgentTimeoutError || (err instanceof Error && err.name === "AbortError")) {
      status = "killed"
      partialResult = extractPartialResultStub(sessId)
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
    if (parentContext === undefined) {
      // We initialized a fresh abort controller maybe, but GC will handle it
    }
  }
}
