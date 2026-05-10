import { NamedError } from "@liteai/util/error"
import { Log } from "@liteai/util/log"
import { trace } from "@opentelemetry/api"
import type { BackgroundTaskRegistry } from "@/command/background"
import { Agent } from "../../agent/agent"
import { AgentExecutionContext, isRootAgent } from "../../agent/context"
import { Bundled } from "../../bundled"
import { Hook } from "../../hook"
import { Plugin } from "../../plugin"
import { Instance } from "../../project/instance"
import { Provider } from "../../provider/provider"
import type { ModelID, ProviderID } from "../../provider/schema"
import { Snapshot } from "../../snapshot"
import type { Session } from ".."
import type { EngineEvent } from "../events"
import { Message } from "../message"
import type { PlanModeState, PlanModeStateRef } from "../plan-mode-state"
import { SessionProcessor } from "../processor"
import { MessageID, PartID, type SessionID } from "../schema"
import { SessionCompaction } from "../tasks/compaction"
import { SessionDescription } from "../tasks/description"
import { ensureTitle } from "../tasks/title"
import { InstructionPrompt } from "./instruction"
import { type CheckpointMetadata, CheckpointStoreManager } from "./loop/checkpoint-store"
import { LoopDetectionService } from "./loop-detection"
import { type AutocompactState, createAutocompactState, executePipeline, shouldAutocompact } from "./pipeline"
import { injectPlanAttachment } from "./plan-reminder"
import { StopDriftService } from "./stop-drift"
import { StreamingToolExecutor } from "./streaming-tool-executor"
import { SystemPrompt } from "./system"
import { TelemetryTracker } from "./telemetry"
import { createStructuredOutputTool, resolveTools, STRUCTURED_OUTPUT_SYSTEM_PROMPT } from "./tools"

const log = Log.create({ service: "session.engine" })

// ─── Types ───────────────────────────────────────────────────────────────────

export type QueryLoopParams = {
  sessionID: SessionID
  session: Session.Info
  abort: AbortSignal
  /** Shared in-memory message buffer owned by the orchestrator (loop.ts).
   * Eliminates per-turn DB reads — loop.ts reads DB once and keeps this live. */
  msgsBuffer: { current: Message.WithParts[] }
  /** Session-scoped in-memory plan mode state. Owned by the orchestrator,
   * eliminates per-turn DB reads for plan mode state. */
  planModeStateRef: PlanModeStateRef
  /** Whether this is a resume of an existing session (skip start() call) */
  resumeExisting?: boolean
  /** Session-scoped registry for background tasks. Passed through to resolveTools
   * so tools can register/query background processes via ctx.extra. */
  backgroundTaskRegistry?: BackgroundTaskRegistry
  /** Mutable ref to the step mode flag — controls whether the loop pauses between iterations */
  stepModeRef?: { current: boolean }
}

// ─── queryLoop ───────────────────────────────────────────────────────────────

/**
 * The core multi-turn async generator. Replaces the old `while(true)` loop
 * in `loop.ts` with a pure event-sourced architecture.
 *
 * **Contract:**
 * - Yields `EngineEvent.Any` events for every state change
 * - Zero SQLite writes — all DB mutations are delegated to the consumer
 *   via `TurnStartEvent` (create assistant message) and event routing
 *   to `EventPersister`
 * - Yields `GeneratorResultEvent` for flow control (compact, subtask, etc.)
 * - ALL errors (including stream crashes) are yielded as events, never swallowed
 *
 * The consumer (`runSession` in loop.ts) should:
 * 1. On `turn-start`: persist the assistant message, create EventPersister
 * 2. On stream events: route to persister.handleEvent()
 * 3. On `turn-end`: flush persister, handle result
 * 4. On `control`: trigger compaction, process subtasks, etc.
 */
export async function* queryLoop(params: QueryLoopParams): AsyncGenerator<EngineEvent.Any, void, unknown> {
  const { sessionID, session, abort, msgsBuffer, planModeStateRef } = params

  let structuredOutput: unknown | undefined
  let step = 0
  const telemetryTracker = new TelemetryTracker()
  const autocompactState: AutocompactState = createAutocompactState()
  const loopDetector = new LoopDetectionService(sessionID)
  const stopDriftService = new StopDriftService(sessionID, planModeStateRef)

  while (true) {
    if (abort.aborted) {
      log.info("queryLoop exiting: abort signal already set", { sessionID, step })
      break
    }

    // Use the shared in-memory buffer — no DB read on every turn (FR-2, FR-3)
    let msgs = msgsBuffer.current

    // ── Scan for last user/assistant messages ──
    let lastUser: Message.User | undefined
    let lastAssistant: Message.Assistant | undefined
    let lastFinished: Message.Assistant | undefined
    const tasks: (Message.CompactionPart | Message.SubtaskPart)[] = []

    for (let i = msgs.length - 1; i >= 0; i--) {
      const msg = msgs[i]
      if (!lastUser && msg.info.role === "user") lastUser = msg.info as Message.User
      if (!lastAssistant && msg.info.role === "assistant") lastAssistant = msg.info as Message.Assistant
      if (!lastFinished && msg.info.role === "assistant" && msg.info.finish)
        lastFinished = msg.info as Message.Assistant
      if (lastUser && lastFinished) break
      const task = msg.parts.filter((part) => part.type === "compaction" || part.type === "subtask")
      if (task && !lastFinished) {
        tasks.push(...task)
      }
    }

    if (!lastUser) throw new Error("No user message found in stream. This should never happen.")

    // ── Check if model already finished ──
    if (
      lastAssistant?.finish &&
      !["tool-calls", "unknown"].includes(lastAssistant.finish) &&
      lastUser.id < lastAssistant.id
    ) {
      // ── Plan mode stop-drift recovery ──
      // With toolChoice: "auto", a bare stop is normal behavior.
      // Only plan mode still requires tool calls (plan_exit / ask_user).
      const driftResult = stopDriftService.check(lastAssistant)
      if (driftResult.drifted) {
        log.warn("plan mode stop-drift: model stopped without calling ask_user/plan_exit", {
          sessionID,
          correctionCount: driftResult.correctionCount,
          finish: lastAssistant.finish,
        })
        yield {
          type: "control",
          action: "plan-stop-correction",
          payload: {
            correctionCount: driftResult.correctionCount,
            correctionText: driftResult.correctionText,
          },
        } satisfies EngineEvent.GeneratorResultEvent
        continue
      }

      // ── Normal stop: model finished naturally ──
      // With toolChoice: "auto", the model can stop by returning text without
      // tool calls. This is expected behavior (matches Gemini CLI, Claude Code).
      log.info("queryLoop exiting: model finished", { sessionID, finish: lastAssistant.finish })
      break
    }

    step++
    loopDetector.turnStarted()

    // ── Model resolution ──
    if (lastUser.model.providerID === "unknown" || lastUser.model.modelID === "unknown") {
      log.warn("queryLoop: lastUser message has unknown model identifier", {
        sessionID,
        step,
        messageID: lastUser.id,
        providerID: lastUser.model.providerID,
        modelID: lastUser.model.modelID,
      })
    }

    const model = await Provider.getModel(lastUser.model.providerID, lastUser.model.modelID).catch((e) => {
      log.error("model resolution failed", {
        providerID: lastUser.model.providerID,
        modelID: lastUser.model.modelID,
        error: e,
      })
      if (Provider.ModelNotFoundError.isInstance(e)) {
        const hint = e.data.suggestions?.length ? ` Did you mean: ${e.data.suggestions.join(", ")}?` : ""
        return new NamedError.Unknown({
          message: `Model not found: ${e.data.providerID}/${e.data.modelID}.${hint}`,
        })
      }
      return e as Error
    })

    if (model instanceof Error) {
      yield {
        type: "error",
        kind: "stream",
        error: model,
        isAbortError: false,
      } satisfies EngineEvent.BlockEvent
      break
    }

    // ── Title generation (fire-and-forget on first step, AFTER model validated) ──
    if (step === 1 && isRootAgent()) {
      ensureTitle({
        session,
        modelID: lastUser.model.modelID,
        providerID: lastUser.model.providerID,
        history: msgs,
        telemetryTracker,
        telemetryBatchId: `gen_${step}`,
      }).catch((e: unknown) => log.error("ensureTitle failed", { error: e }))

      SessionDescription.create({ sessionID }).catch((e: unknown) =>
        log.error("SessionDescription failed", { error: e }),
      )
    }

    const task = tasks.pop()

    // ── Pending subtask: delegate to orchestrator ──
    if (task?.type === "subtask") {
      yield {
        type: "control",
        action: "subtask",
        payload: { task, model, lastUser, msgs, telemetryTracker, telemetryBatchId: `task_${step}` },
      } satisfies EngineEvent.GeneratorResultEvent
      continue
    }

    // ── Pending compaction task: delegate to orchestrator ──
    if (task?.type === "compaction") {
      yield {
        type: "control",
        action: "compaction-task",
        payload: { task, lastUser, msgs, telemetryTracker, telemetryBatchId: `compaction_task_${step}` },
      } satisfies EngineEvent.GeneratorResultEvent
      // If orchestrator signals "stop", it won't call .next() and the generator closes
      continue
    }

    // ── Context overflow: needs compaction ──
    if (
      lastFinished &&
      lastFinished.summary !== true &&
      (await SessionCompaction.isOverflow({ tokens: lastFinished.tokens, model }))
    ) {
      yield {
        type: "control",
        action: "overflow",
        payload: { lastUser },
      } satisfies EngineEvent.GeneratorResultEvent
      continue
    }

    // ── Normal processing ──
    const agent = await Agent.get(lastUser.agent)
    const maxSteps = agent.steps ?? Infinity
    const isLastStep = step >= maxSteps

    // ── Read PlanModeState at turn start — synchronous in-memory access (T006/FR-001) ──
    let planModeState: PlanModeState = planModeStateRef.get()

    const text = msgs
      .findLast((m) => m.info.role === "user")
      ?.parts.filter((p) => p.type === "text")
      .map((p) => ("text" in p ? p.text : ""))
      .join(" ")

    log.info(`sending stream text to ${agent.name} agent: ${text?.slice(0, 200)}`, {
      sessionID,
      agent: agent.name,
      model: `${lastUser.model.providerID}/${lastUser.model.modelID}`,
      temperature: agent.temperature,
      step,
      planModeActive: planModeState.active,
    })

    // ── Plan attachment injection (replaces legacy insertPlanReminder) ──
    const planResult = await injectPlanAttachment({
      messages: msgs,
      planModeState,
      session,
    })
    msgs = planResult.messages
    planModeState = planResult.updatedState

    // ── Pre-processing context pipeline: budget + snip ──
    msgs = executePipeline(msgs)

    // ── Subagent Critical System Reminder Injection ──
    if (!isRootAgent()) {
      const ctx = AgentExecutionContext.getStore()
      if (ctx && "criticalSystemReminder" in ctx && ctx.criticalSystemReminder) {
        const lastUserIdx = msgs.findLastIndex((m) => m.info.role === "user")
        if (lastUserIdx !== -1) {
          const userMsg = msgs[lastUserIdx]
          msgs = [...msgs]
          msgs[lastUserIdx] = {
            ...userMsg,
            parts: [
              ...userMsg.parts,
              {
                type: "text",
                id: PartID.ascending(),
                text: `<system-reminder>\n${ctx.criticalSystemReminder}\n</system-reminder>`,
                synthetic: true,
                messageID: userMsg.info.id,
                sessionID,
              } satisfies Message.TextPart,
            ],
          }
        }
      }
    }

    // ── Proactive autocompact check ──
    if (shouldAutocompact(msgs, model, autocompactState)) {
      log.info("queryLoop: proactive autocompact triggered", { sessionID, step })
      yield {
        type: "control",
        action: "compact",
        payload: { lastUser },
      } satisfies EngineEvent.GeneratorResultEvent
      continue
    }

    // ── Check if user explicitly invoked an agent via @ ──
    const lastUserMsg = msgs.findLast((m) => m.info.role === "user")
    const bypassAgentCheck = lastUserMsg?.parts.some((p) => p.type === "agent") ?? false

    // ── Build the assistant message object (in-memory only) ──
    const assistantMessage: Message.Assistant = {
      id: MessageID.ascending(),
      parentID: lastUser.id,
      role: "assistant",
      mode: agent.name,
      agent: agent.name,
      variant: lastUser.variant,
      path: {
        cwd: Instance.directory,
        root: Instance.worktree,
      },
      cost: 0,
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
      modelID: model.id as ModelID,
      providerID: model.providerID as ProviderID,
      time: {
        created: Date.now(),
      },
      sessionID,
    }

    // ── Resolve tools ──
    // We need a mock processor-like interface for tool context
    // The actual processor is created by the orchestrator after turn-start
    // Tools are resolved here using a temporary processor reference
    const toolProcessorRef = { message: assistantMessage, partFromToolCall: (_id: string) => undefined }
    let tools = await resolveTools({
      agent,
      session,
      model,
      processor: toolProcessorRef as unknown as SessionProcessor.Info,
      bypassAgentCheck,
      messages: msgs,
      backgroundTaskRegistry: params.backgroundTaskRegistry,
      step,
      telemetryTracker,
      telemetryBatchId: `tools_${step}`,
      onInject: (msg: Message.WithParts) => {
        msgsBuffer.current = [...msgsBuffer.current, msg]
        log.info("queryLoop: appended synthetic message via onInject", { sessionID, messageID: msg.info.id })
      },
    })

    const { isCoordinatorMode, applyCoordinatorToolFilter, getCoordinatorUserContext, getCoordinatorSystemPrompt } =
      await import("../../coordinator")

    const inCoordinatorMode = isCoordinatorMode(session.sessionMode)
    if (inCoordinatorMode) {
      tools = applyCoordinatorToolFilter(tools) as typeof tools
    }

    // ── Inject StructuredOutput tool if JSON schema mode enabled ──
    const format: Message.OutputFormat = lastUser.format ?? { type: "text" }
    if (format.type === "json_schema") {
      tools.StructuredOutput = createStructuredOutputTool({
        schema: format.schema,
        onSuccess(output) {
          structuredOutput = output
        },
      })
    }

    // ── Summary generation (fire-and-forget on first step) ──
    // Note: moved to orchestrator since it needs sessionID/messageID

    // ── Ephemeral user message reminder wrapping ──
    if (step > 1 && lastFinished) {
      for (const msg of msgs) {
        if (msg.info.role !== "user" || msg.info.id <= lastFinished.id) continue
        for (const part of msg.parts) {
          if (part.type !== "text" || part.ignored || part.synthetic) continue
          if (!part.text.trim()) continue
          part.text = [
            "<system-reminder>",
            "The user sent the following message:",
            part.text,
            "",
            "Please address this message and continue with your tasks.",
            "</system-reminder>",
          ].join("\n")
        }
      }
    }

    // ── Plugin transform ──
    await Plugin.trigger("experimental.chat.messages.transform", {}, { messages: msgs })

    // ── Build system prompt ──
    const { parts: providerParts, boundary } = await SystemPrompt.resolveSystemPromptSections(model, agent)
    const enabledToolNames = new Set(Object.keys(tools))
    const skills = await SystemPrompt.skills(agent, enabledToolNames)
    const instructions = agent?.omitLiteaiMd ? [] : await InstructionPrompt.system()
    let system = [...providerParts, ...(skills ? [skills] : []), ...instructions]

    if (inCoordinatorMode) {
      const { MCP } = await import("../../mcp")
      const clients = await MCP.clients()
      const mcpServers = Object.keys(clients).map((name) => ({ name }))
      const workerCapabilities = getCoordinatorUserContext(session.sessionMode, mcpServers).workerToolsContext
      system = [getCoordinatorSystemPrompt({ workerCapabilities })]
    }

    if (format.type === "json_schema") {
      system.push(STRUCTURED_OUTPUT_SYSTEM_PROMPT)
    }

    // ── Construct LLM stream input ──
    const streamInput = {
      user: lastUser,
      agent,
      abort,
      sessionID,
      system,
      systemBoundary: boundary,
      step,
      telemetryTracker,
      telemetryBatchId: `gen_${step}`,
      messages: [
        ...Message.toModelMessages(msgs, model),
        ...(isLastStep
          ? [
              {
                role: "assistant" as const,
                content: await Bundled.miscPrompt("max-steps"),
              },
            ]
          : []),
      ],
      tools,
      model,
      toolChoice: (agent.toolChoice as "auto" | "required" | "none") ?? "auto",
    }

    // ── Create streaming tool executor for this turn ──
    const toolExecutor = new StreamingToolExecutor(abort)

    // ── Yield turn-start: orchestrator creates DB record + persister ──
    yield {
      type: "turn-start",
      assistantMessage,
      streamInput,
      tools,
      model,
      isLastStep,
      format,
      toolExecutor,
    } satisfies EngineEvent.TurnStartEvent

    let streamResult: unknown
    let reasoningChunkCount = 0
    try {
      const generator = SessionProcessor.streamGenerator(streamInput, undefined, (r) => {
        streamResult = r
      })

      for await (const event of generator) {
        if (event.type === "delta" && event.part === "reasoning") {
          reasoningChunkCount++
          log.info(`received reasoning chunk ${reasoningChunkCount} from ${agent.name} agent`, { sessionID })
        } else if (event.type === "call" && event.kind === "tool") {
          log.info(`${agent.name} agent tool call ${event.toolName}`, { sessionID, input: event.input })
        } else if (event.type === "result" && event.kind === "tool") {
          log.info(`${agent.name} agent tool result ${event.toolName}`, { sessionID, title: event.title })
        }

        // Feed every event through the executor for lifecycle tracking.
        // The executor monitors tool start/delta/call/result/error events
        // and maintains concurrency state without intercepting the event flow.
        toolExecutor.processEvent(event)

        // ── Loop detection ──
        // Check every event for repetitive patterns (thinking loops, tool call
        // loops, content chanting). On detection, yield control event and break
        // the streaming loop — the orchestrator handles recovery.
        const loopResult = loopDetector.check(event)
        if (loopResult.count > 0) {
          // Yield the triggering event first so the persister records partial work
          yield event
          yield {
            type: "control",
            action: "loop-detected",
            payload: { loopResult },
          } satisfies EngineEvent.GeneratorResultEvent
          break
        }

        // All events — including stream errors — are yielded to the orchestrator,
        // which routes them to persister.handleEvent() for proper classification
        // (abort → stop, retryable → backoff, overflow → compact, fatal → error).
        yield event
      }
    } catch (unexpectedError: unknown) {
      // This catch only fires for truly unexpected errors (bugs in queryLoop,
      // toolExecutor, or generator protocol errors — NOT stream errors from the
      // AI SDK, which are already yielded as { type: "error", kind: "stream" }).
      // Route them through the standard error pipeline so persister can classify.
      toolExecutor.discard()
      log.error("queryLoop: unexpected error during stream processing", { error: unexpectedError, sessionID })
      yield {
        type: "error",
        kind: "stream",
        error: unexpectedError,
        isAbortError: unexpectedError instanceof DOMException && unexpectedError.name === "AbortError",
      } satisfies EngineEvent.BlockEvent
    }

    // ── Log streaming tool execution stats ──
    const toolStats = toolExecutor.getConcurrencyState()
    if (toolStats.total > 0) {
      log.info("queryLoop: tool execution stats", {
        sessionID,
        step,
        ...toolStats,
        siblingError: toolExecutor.hasSiblingError(),
      })
    }

    // ── Update in-memory PlanModeState at turn end (T007/FR-006) ──
    // Persist the counter updates from injectPlanAttachment back to the ref.
    // The counter may already have been reset to 0 by injectPlanAttachment (full reminder).
    if (planModeState.active) {
      planModeStateRef.update(() => planModeState)
    }

    // ── Yield turn-end: orchestrator flushes persister ──
    yield {
      type: "turn-end",
      structuredOutput,
      streamResult,
    } satisfies EngineEvent.TurnEndEvent

    // ── Step mode: capture checkpoint and pause (T009/T015/T024) ──
    // Zero overhead on the non-step-mode path: single boolean check, no function
    // calls, no allocations (FR-015, SC-007).
    if (params.stepModeRef?.current) {
      // Capture file state via Snapshot
      const snapshotHash = await Snapshot.track().catch((e: unknown) => {
        log.warn("step-pause: Snapshot.track() failed, proceeding without snapshot", { error: e, sessionID })
        return undefined
      })

      // Build enriched metadata (T024)
      const stepTimingEnd = Date.now()
      const trigger = tasks.length > 0 ? (tasks[0].type as CheckpointMetadata["trigger"]) : "user"

      const checkpoint = CheckpointStoreManager.captureCheckpoint(sessionID, {
        step,
        messages: msgsBuffer.current,
        snapshot: snapshotHash,
        metadata: {
          agent: agent.name,
          model: { providerID: lastUser.model.providerID, modelID: lastUser.model.modelID },
          trigger,
          timing: { start: assistantMessage.time.created, end: stepTimingEnd },
          tokenUsage: assistantMessage.tokens
            ? {
                input: assistantMessage.tokens.input,
                output: assistantMessage.tokens.output,
                reasoning: assistantMessage.tokens.reasoning,
              }
            : undefined,
          traceSpanID: trace.getActiveSpan()?.spanContext().spanId,
        },
      })

      // Yield step-pause control event — the orchestrator will gate on the latch
      yield {
        type: "control",
        action: "step-pause",
        payload: { step, checkpoint },
      } satisfies EngineEvent.GeneratorResultEvent
    }

    // ── yield_turn detection ──
    // If the model called yield_turn (and naturally finished streaming), break the loop
    const calledYieldTurn = toolExecutor.hasToolCall("yield_turn")
    if (calledYieldTurn) {
      log.info("queryLoop: yield_turn called, ending session", { sessionID })
      break
    }

    // ── Exit on fatal error ──
    // After persister classifies a non-retryable error, it sets assistantMessage.error.
    // We must break here to prevent the while(true) from creating a new turn.
    if (assistantMessage.error) {
      log.info("queryLoop: ending due to fatal error", { sessionID })
      break
    }

    // ── Reset structured output for next turn ──
    if (structuredOutput !== undefined) {
      log.info("queryLoop: structured output captured, ending", { sessionID })
      break
    }

    // ── Check if model finished ──
    // NOTE: This check uses the generator's local `assistantMessage` which may
    // NOT have `finish` set (the persister mutates the orchestrator's copy).
    // The primary stop-drift recovery for plan mode is at the EARLY EXIT check
    // at the top of the while loop, where `lastAssistant.finish` from the
    // buffer is always accurate.
    const modelFinished = assistantMessage.finish && !["tool-calls", "unknown"].includes(assistantMessage.finish)
    if (modelFinished && !assistantMessage.error) {
      if (format.type === "json_schema") {
        // Model stopped without calling StructuredOutput tool — error is set by orchestrator
        log.info("queryLoop: structured output missing, ending", { sessionID })
      }
      break
    }

    // The orchestrator's turn-end handling determines whether to stop or continue:
    // - If persister reports "stop" (error, blocked), orchestrator stops calling .next()
    // - If persister reports "compact", orchestrator creates compaction and calls .next()
    // - If persister reports "continue", orchestrator calls .next() to continue the while loop
  }

  // ── Dispatch Stop hook ──
  try {
    if (isRootAgent()) {
      await Hook.dispatch("Stop", {
        session_id: sessionID,
        cwd: Instance.directory,
        hook_event_name: "Stop",
      })
    }
  } catch (e: unknown) {
    // AbortError during Stop hook dispatch is expected when session is cancelled
    if (!(e instanceof DOMException && e.name === "AbortError")) {
      log.error("queryLoop: Stop hook dispatch failed", { error: e, sessionID })
    }
  }
}
