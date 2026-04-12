import { Bus } from "@/bus/index"
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

const logger = Log.create({ service: "agent:runner" })

export interface RunAgentOptions {
  parentContext?: ParentContext
  overrides?: SubagentContextOverrides
  inputParts?: PromptInput["parts"]
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
    Bus.publish(AgentEvent.Spawned, {
      agentId,
      agentType: agentName,
      parentId: storeContext?.agentId ?? "",
      isAsync: !!agentDef.background,
    })

    // Build subagent context
    const parentMock = parentContext ?? {
      sessionId: sessId,
      abortController: new AbortController(),
      readFileState: new Map(),
      contentReplacementState: {},
      getAppState: () => ({}),
      setAppState: () => {},
      model: agentDef.model ?? (await Provider.defaultModel()),
    }

    const subContext = createSubagentContext(parentMock, agentDef, options?.overrides)
    subContext.agentId = agentId

    // 2. Wrap execution with Context
    const resultMsg = await runWithAgentContext(subContext, async () => {
      let timeoutId: ReturnType<typeof setTimeout> | undefined

      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          subContext.abortController.abort(new AgentTimeoutError(`Agent execution timed out after ${timeoutMs}ms`))
          reject(new AgentTimeoutError(`Agent execution timed out after ${timeoutMs}ms`))
        }, timeoutMs)
      })

      // Run session prompt
      const runPromise = SessionPrompt.prompt({
        sessionID: sessId,
        agent: agentName,
        parts: options?.inputParts ?? [],
        model: agentDef.model,
        system: agentDef.prompt,
      })

      try {
        return await Promise.race([runPromise, timeoutPromise])
      } finally {
        if (timeoutId) clearTimeout(timeoutId)
      }
    })

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
  } catch (err: unknown) {
    const duration = Date.now() - startTime
    logger.error("runAgent failed", { error: err, agentId, agentName })
    Bus.publish(AgentEvent.Completed, {
      agentId,
      agentType: agentName,
      status: "failed",
      duration,
      usage: { totalTokens: 0, toolCalls: 0, duration },
    })
    throw err
  } finally {
    Session.decrementAgentCount(sessId)
    if (parentContext === undefined) {
      // We initialized a fresh abort controller maybe, but GC will handle it
    }
  }
}
