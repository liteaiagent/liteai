import { Log } from "@liteai/util/log"
import { trace } from "@opentelemetry/api"
import { ulid } from "ulid"
import z from "zod"
import { Bus } from "@/bus"
import { BackgroundTaskRegistry } from "@/command/background"
import { PermissionNext } from "@/permission/next"
import { TaskTool } from "@/tool/task"
import type { Tool } from "@/tool/tool"
import { fn } from "@/util/fn"
import { Agent } from "../../agent/agent"
import { isRootAgent } from "../../agent/context"
import { Plugin } from "../../plugin"
import { Instance } from "../../project/instance"
import { Provider } from "../../provider/provider"
import { ModelID, ProviderID } from "../../provider/schema"
import { defer } from "../../util/defer"
import { Session } from ".."
import type { EngineEvent } from "../events"
import { Message } from "../message"
import { createDefaultPlanModeState, PlanModeStateRef } from "../plan-mode-state"
import { SessionRetry } from "../retry"
import { SessionRevert } from "../revert"
import { MessageID, PartID, SessionID } from "../schema"
import { SessionStatus } from "../status"
import { SessionSummary } from "../tasks/summary"
import { CompactionOrchestrator } from "./compaction-orchestrator"
import { CorrectionInjector } from "./correction-injector"
import { createUserMessage } from "./input"
import { InstructionPrompt } from "./instruction"
import { type Checkpointer, type SessionResult, SqliteCheckpointer } from "./loop/checkpointer"
import { PromiseTracker } from "./loop/promise-tracker"
import { type LoopDetectionResult, LoopType } from "./loop-detection"
import { EventPersister } from "./persister"
import { queryLoop } from "./query"
import type { TelemetryTracker } from "./telemetry"

globalThis.AI_SDK_LOG_WARNINGS = false

const log = Log.create({ service: "session.engine" })

type SessionState = Record<
  string,
  {
    abort: AbortController
    callbacks: {
      resolve(input: Message.WithParts): void
      reject(reason?: unknown): void
    }[]
  }
>

const _state = Instance.state(
  () => {
    const data: SessionState = {}
    return data
  },
  async (current) => {
    for (const [id, item] of Object.entries(current)) {
      log.info("state cleanup aborting session", { sessionID: id })
      try {
        item.abort.abort()
      } catch {
        // Swallowed — see safeAbort() for full explanation of the Bun quirk
      }
    }
  },
)

export function state() {
  return _state()
}

export function assertNotBusy(sessionID: SessionID) {
  const match = state()[sessionID]
  if (match) throw new Session.BusyError(sessionID)
}

export const PromptInput = z.object({
  sessionID: SessionID.zod,
  messageID: MessageID.zod.optional(),
  model: z
    .object({
      providerID: ProviderID.zod,
      modelID: ModelID.zod,
    })
    .optional(),
  agent: z.string().optional(),
  noReply: z.boolean().optional(),
  format: Message.Format.optional(),
  system: z.string().optional(),
  variant: z.string().optional(),
  parts: z.array(
    z.discriminatedUnion("type", [
      Message.TextPart.omit({
        messageID: true,
        sessionID: true,
      })
        .partial({
          id: true,
        })
        .meta({
          ref: "TextPartInput",
        }),
      Message.FilePart.omit({
        messageID: true,
        sessionID: true,
      })
        .partial({
          id: true,
        })
        .meta({
          ref: "FilePartInput",
        }),
      Message.AgentPart.omit({
        messageID: true,
        sessionID: true,
      })
        .partial({
          id: true,
        })
        .meta({
          ref: "AgentPartInput",
        }),
      Message.SubtaskPart.omit({
        messageID: true,
        sessionID: true,
      })
        .partial({
          id: true,
        })
        .meta({
          ref: "SubtaskPartInput",
        }),
    ]),
  ),
})
export type PromptInput = z.infer<typeof PromptInput>

export const prompt = fn(PromptInput, async (input) => {
  const session = await Session.get(input.sessionID)
  await SessionRevert.cleanup(session)

  const message = await createUserMessage(input)
  await Session.touch(input.sessionID)

  if (input.noReply === true) {
    return message
  }

  return await loop({ sessionID: input.sessionID })
})

export function start(sessionID: SessionID) {
  const s = state()
  if (s[sessionID]) {
    log.info("start: session already active, queuing", { sessionID })
    return
  }
  log.info("start", { sessionID })

  const controller = new AbortController()
  s[sessionID] = {
    abort: controller,
    callbacks: [],
  }
  return controller.signal
}

function resume(sessionID: SessionID) {
  const s = state()
  if (!s[sessionID]) return

  return s[sessionID].abort.signal
}

export function cancel(sessionID: SessionID) {
  log.info("cancel", { sessionID })
  const s = state()
  const match = s[sessionID]
  if (!match) {
    SessionStatus.set(sessionID, { type: "idle" })
    return
  }
  safeAbort(match.abort, sessionID)
}

/**
 * Safely abort an AbortController, swallowing any errors thrown by
 * abort event listeners added by providers.
 *
 * ## Bun Runtime Discovery (April 2026, Bun v1.3.x)
 *
 * When an EventTarget listener throws during `AbortController.abort()`,
 * Bun exhibits three behaviors simultaneously:
 *
 * 1. **JS-level propagation**: The error propagates through `abort()` and
 *    CAN be caught by a standard `try/catch` — so `cancel()` doesn't crash
 *    at the JS level.
 *
 * 2. **Native error reporting**: Bun's C++ EventTarget dispatcher ALSO
 *    reports the error through its internal error pipeline, printing the
 *    error to stderr independently of JS exception handling.
 *
 * 3. **Exit code 1**: Bun sets the process exit code to 1 regardless of
 *    whether JS caught the error.
 *
 * Because of (2) and (3), a simple `try/catch` around `abort()` is
 * insufficient — the process still crashes with exit code 1.
 *
 * **What doesn't work:**
 * - `try/catch` around `abort()` — catches the JS error but Bun still
 *   reports it natively and exits with code 1.
 * - Overriding `signal.dispatchEvent()` — Bun's native `abort()` bypasses
 *   the JS `dispatchEvent` method entirely, calling listeners at the C++ level.
 * - `globalThis.addEventListener("error")` — Bun reports the error at a
 *   level below the global error event.
 *
 * **What works:**
 * - `process.on("uncaughtException")` — This is the ONLY mechanism that
 *   intercepts Bun's native error pipeline. Installing a temporary handler
 *   before `abort()` prevents both the error output and the exit code 1.
 *
 * ## Why this matters
 *
 * Provider SDKs add abort listeners on the signal to do cleanup work
 * (e.g., google-code-assist's `sourceStream.destroy()`, `rl.close()`).
 * If those listeners throw — which is common during stream teardown —
 * the process crashes even though the abort itself succeeded.
 */
function safeAbort(controller: AbortController, sessionID: string) {
  const errors: unknown[] = []

  // Install a temporary uncaughtException handler to suppress Bun's
  // native error reporting during abort(). This is the ONLY mechanism
  // that prevents Bun from setting exit code 1 (see discovery above).
  const suppressHandler = (err: Error) => {
    errors.push(err)
  }
  process.on("uncaughtException", suppressHandler)

  try {
    log.info("session/loop abort: controller.abort()", { sessionID })
    controller.abort()
  } catch (e: unknown) {
    errors.push(e)
  } finally {
    process.removeListener("uncaughtException", suppressHandler)
  }

  if (errors.length > 0) {
    for (const e of errors) {
      log.info("cancel: abort listener threw (swallowed)", {
        sessionID,
        error: e instanceof Error ? e.message : String(e),
        name: e instanceof DOMException ? (e as DOMException).name : undefined,
      })
    }
  }
}

/**
 * Cleans up session state after the processor has finished flushing.
 * Called by the deferred cleanup in loop(), NOT by the cancel API.
 */
function cleanup(sessionID: SessionID) {
  log.info("cleanup", { sessionID })

  // Deregister the in-memory PlanModeStateRef for this session.
  // Safe to call even if no ref was registered (e.g., early abort before runSession).
  if (PlanModeStateRef.has(sessionID)) {
    PlanModeStateRef.for(sessionID).deregister()
  }

  const s = state()
  delete s[sessionID]
  SessionStatus.set(sessionID, { type: "idle" })
}

export async function lastModel(sessionID: SessionID) {
  for await (const item of Message.stream(sessionID)) {
    if (item.info.role === "user" && item.info.model) {
      const m = item.info.model
      if (m.providerID === "unknown" || m.modelID === "unknown") {
        log.warn("lastModel: found stored message with unknown model identifier — skipping", {
          sessionID,
          messageID: item.info.id,
          providerID: m.providerID,
          modelID: m.modelID,
        })
        continue
      }
      return m
    }
  }
  const result = await Provider.defaultModel()
  if (!result) throw new Error("no model available: connect a provider first")
  return result
}

export const LoopInput = z.object({
  sessionID: SessionID.zod,
  resume_existing: z.boolean().optional(),
})

// ─── runSession: The Event-Sourced Orchestrator ─────────────────────────────
//
// Consumes the queryLoop async generator and routes events to the appropriate
// handlers. All SQLite writes flow through EventPersister or direct Session.*
// calls here — the generator never writes to the database.
//
// Event routing:
//   turn-start  → persist assistant message, create EventPersister
//   stream events → persister.handleEvent()
//   turn-end    → persister.flush(), handle structured output/compaction
//   control     → trigger compaction, process subtasks, handle overflow
//   tombstone   → flush persister to clean up orphaned message

async function runSession(input: {
  sessionID: SessionID
  session: Session.Info
  abort: AbortSignal
  registry: BackgroundTaskRegistry
  checkpointer: Checkpointer
  tracker: PromiseTracker
}) {
  const tracer = trace.getTracer("liteai")

  // Resolve the first user message text to use as the trace name/input in Langfuse
  const msgs = await Message.filterCompacted(Message.stream(input.sessionID))
  const firstUserText = msgs
    .findLast((m) => m.info.role === "user")
    ?.parts.filter((p) => p.type === "text")
    .map((p) => (p as { text: string }).text)
    .join(" ")
    .slice(0, 200)

  return tracer.startActiveSpan(
    "LiteAI", // Hardcode trace name to LiteAI to fix the "Unnamed trace" issue
    {
      attributes: {
        "langfuse.session.id": input.sessionID,
        "input.value": firstUserText || "No user input",
        "session.title": input.session.title ?? "",
        "langfuse.internal.as_root": true,
      },
    },
    async (sessionSpan) => {
      try {
        const result = await runSessionInner(input)
        return result
      } catch (e) {
        sessionSpan.recordException(e as Error)
        throw e
      } finally {
        const finalMsgs = await Message.filterCompacted(Message.stream(input.sessionID))
        const lastAssistant = finalMsgs.findLast((m) => m.info.role === "assistant")
        const outputText = lastAssistant?.parts
          .filter((p) => p.type === "text")
          .map((p) => (p as { text: string }).text)
          .join(" ")
          .slice(0, 500)

        if (outputText) {
          sessionSpan.setAttribute("output.value", outputText)
        }
        sessionSpan.end()
      }
    },
  )
}

async function runSessionInner(input: {
  sessionID: SessionID
  session: Session.Info
  abort: AbortSignal
  registry: BackgroundTaskRegistry
  checkpointer: Checkpointer
  tracker: PromiseTracker
}) {
  const isAbortError = (e: unknown): e is DOMException => e instanceof DOMException && e.name === "AbortError"
  const { sessionID, session, abort, tracker } = input

  let persister: EventPersister | undefined
  let currentAssistantMessage: Message.Assistant | undefined
  let currentStreamResult: unknown
  let currentTurnCache: { system: string[] | string; tools: Record<string, unknown> } | undefined

  // Loop detection recovery state — persisted across turns for escalation
  let loopDetectionCount = 0
  let pendingLoopRecovery: LoopDetectionResult | undefined

  // ── PlanModeState: in-memory ref, lifecycle-bound to this session ──
  // Created once at session start with defaults. No DB read.
  const planModeStateRef = new PlanModeStateRef(createDefaultPlanModeState(session), sessionID)
  planModeStateRef.register()

  // ── Phase 2+3 services: decoupled persistence and extracted concerns ──
  const compactionOrchestrator = new CompactionOrchestrator(sessionID)
  const correctionInjector = new CorrectionInjector(sessionID)

  // Single one-time DB read — after this the buffer is the live message view (FR-1)
  const msgsBuffer: { current: Message.WithParts[] } = {
    current: await input.checkpointer.loadHistory(sessionID),
  }

  const generator = queryLoop({
    sessionID,
    session,
    abort,
    msgsBuffer,
    planModeStateRef,
    backgroundTaskRegistry: input.registry,
  })

  try {
    for await (const event of generator) {
      switch (event.type) {
        // ── Turn Start: persist assistant message, create persister ──
        case "turn-start": {
          currentAssistantMessage = event.assistantMessage
          tracker.track(input.checkpointer.saveMessage(currentAssistantMessage))

          // Create fresh persister for this turn
          persister = new EventPersister(currentAssistantMessage, sessionID, event.model, abort)

          // Set up instruction prompt cleanup
          // Note: InstructionPrompt.clear will be called in turn-end
          SessionStatus.set(sessionID, { type: "busy" })

          currentTurnCache = {
            system: event.streamInput.system,
            tools: event.streamInput.tools,
          }

          // Fire-and-forget summary on first turn
          const lastUser = event.streamInput.user
          if (lastUser && isRootAgent()) {
            SessionSummary.summarize({
              sessionID,
              messageID: lastUser.id,
            })
          }
          break
        }

        // ── Turn End: flush persister, handle result ──
        case "turn-end": {
          if (!persister || !currentAssistantMessage) break

          // Capture raw SDK stream result for partial token recovery on error
          currentStreamResult = event.streamResult

          // Flush the persister
          const flushResult = await persister.flush(currentStreamResult)
          currentStreamResult = undefined

          // Drain accumulated writes and persist to DB
          const flushOps = persister.drainWrites()
          if (flushOps.length > 0) {
            tracker.track(input.checkpointer.write(flushOps))
          }

          // Update in-memory buffer with this turn's completed message (FR-3, no DB read)
          msgsBuffer.current = [...msgsBuffer.current, persister.getCompletedMessage()]

          // ── Loop recovery: handle pending detection after flush ──
          if (pendingLoopRecovery) {
            const recovery = pendingLoopRecovery
            pendingLoopRecovery = undefined

            // Strip incomplete thinking parts from DB (critical for Code Assist API —
            // partial thought blocks without thoughtSignature cause 400 errors on retry)
            await stripIncompleteThinking({
              sessionID,
              message: currentAssistantMessage,
              msgsBuffer,
              checkpointer: input.checkpointer,
              tracker,
            })

            // Escalation strategy
            if (loopDetectionCount >= 3) {
              log.warn("loop escalation: max retries reached, stopping session", {
                sessionID,
                count: loopDetectionCount,
              })
              return { status: "error", error: new Error("loop escalation: max retries reached") } as SessionResult
            }

            // Inject corrective user message
            const lastUser = findLastUserFromBuffer(msgsBuffer.current)
            if (lastUser) {
              const hint =
                recovery.type === LoopType.THINKING_LOOP
                  ? "Do not over-plan. Take action immediately using the available tools."
                  : `Potential loop detected: ${recovery.detail}. Step back and rethink your approach.`

              await correctionInjector.inject({
                lastUser,
                text: `<system-correction>${hint}</system-correction>`,
                msgsBuffer,
              })
            }

            // Clean up instruction prompt and continue to next turn
            await InstructionPrompt.clear(currentAssistantMessage.id)
            break
          }

          // Handle structured output
          if (event.structuredOutput !== undefined) {
            currentAssistantMessage.structured = event.structuredOutput
            currentAssistantMessage.finish = currentAssistantMessage.finish ?? "stop"
            await input.checkpointer.updateMessage(currentAssistantMessage)
            log.info("runSession: structured output captured", { sessionID })
            // Don't call .next() — let the generator break naturally
            break
          }

          // Handle structured output error (model finished without calling tool)
          const modelFinished =
            currentAssistantMessage.finish && !["tool-calls", "unknown"].includes(currentAssistantMessage.finish)
          if (modelFinished && !currentAssistantMessage.error) {
            const lastUser = findLastUserFromBuffer(msgsBuffer.current)
            const format = lastUser?.format ?? { type: "text" }
            if (format.type === "json_schema") {
              currentAssistantMessage.error = new Message.StructuredOutputError({
                message: "Model did not produce structured output",
                retries: 0,
              }).toObject()
              await input.checkpointer.updateMessage(currentAssistantMessage)
              log.info("runSession: structured output error", { sessionID })
            }
          }

          // Process the flush result
          if (flushResult === "stop") {
            log.info("runSession: persister returned stop", {
              sessionID,
              error: currentAssistantMessage.error,
              finish: currentAssistantMessage.finish,
            })
            // Exit runSessionInner entirely — this stops the for-await loop
            // and terminates the generator. Using `return` (not `break`) because
            // `break` only exits the switch, not the for-await.
            return {
              status: "error",
              error: currentAssistantMessage?.error,
              message: persister?.getCompletedMessage(),
            } as SessionResult
          }
          if (flushResult === "compact") {
            const lastUser = findLastUserFromBuffer(msgsBuffer.current)
            if (lastUser) {
              const { markerWithParts } = await compactionOrchestrator.createMarker({
                agent: lastUser.agent,
                model: lastUser.model,
                auto: true,
                overflow: !currentAssistantMessage.finish,
              })
              // Buffer remains as-is after create() — process() will reset it via compaction-task
              // The query loop will re-scan the buffer and emit a compaction-task control event
              // for the marker, so buffer will be reset there.
              log.info("runSession: compaction marker created", { markerID: markerWithParts.info.id, sessionID })
            }
            break
          }

          // flushResult === "continue" — inject any task completion notifications
          // before the generator's next iteration picks up the buffer.
          {
            const lastUser = findLastUserFromBuffer(msgsBuffer.current)
            if (lastUser) {
              await correctionInjector
                .injectNotifications({
                  registry: input.registry,
                  lastUser,
                  msgsBuffer,
                })
                .catch((e: unknown) => {
                  // Notification injection failure must NOT crash the engine loop.
                  log.error("runSession: injectTaskNotifications failed", { error: e, sessionID })
                })
            }
          }

          // Save cache-safe params so forks can inherit them
          if (currentTurnCache && isRootAgent()) {
            const { saveCacheSafeParams } = await import("@/agent/fork")
            saveCacheSafeParams(sessionID, {
              systemPrompt: currentTurnCache.system,
              toolConfig: currentTurnCache.tools,
              forkContextMessages: msgsBuffer.current,
            })
          }

          // Clean up instruction prompt
          await InstructionPrompt.clear(currentAssistantMessage.id)
          break
        }

        // ── Control: compaction, subtask, overflow ──
        case "control": {
          switch (event.action) {
            case "subtask": {
              const { task, model, lastUser, msgs, telemetryTracker, telemetryBatchId } = event.payload
              const { subtaskAssistant, syntheticUser } = await processSubtask({
                task,
                model,
                lastUser,
                sessionID,
                session,
                abort,
                msgs,
                telemetryTracker,
                telemetryBatchId,
                checkpointer: input.checkpointer,
                tracker,
              })
              // Append subtask messages to buffer (FR-8) — no DB read
              msgsBuffer.current = [...msgsBuffer.current, subtaskAssistant, ...(syntheticUser ? [syntheticUser] : [])]
              break
            }
            case "compaction-task": {
              const { task, lastUser, msgs, telemetryTracker, telemetryBatchId } = event.payload

              const { result, summaryWithParts } = await compactionOrchestrator.process({
                messages: msgs,
                parentID: lastUser.id,
                abort,
                auto: task.auto,
                overflow: task.overflow,
                telemetryTracker,
                telemetryBatchId,
              })
              if (result === "stop") {
                return { status: "ok", message: persister?.getCompletedMessage() } as SessionResult
              }
              const markerMsg = msgs.findLast(
                (m: Message.WithParts) =>
                  m.info.role === "user" && m.parts.some((p: Message.Part) => p.type === "compaction"),
              )
              if (markerMsg && summaryWithParts) {
                msgsBuffer.current = [markerMsg, summaryWithParts]
                log.info("runSession: buffer reset after compaction-task", {
                  sessionID,
                  bufferLen: msgsBuffer.current.length,
                })
              }
              break
            }
            case "overflow": {
              const { lastUser } = event.payload
              const { markerWithParts } = await compactionOrchestrator.createMarker({
                agent: lastUser.agent,
                model: lastUser.model,
                auto: true,
              })
              msgsBuffer.current = [...msgsBuffer.current, markerWithParts]
              break
            }
            case "compact": {
              const { lastUser } = event.payload
              const { markerWithParts } = await compactionOrchestrator.createMarker({
                agent: lastUser.agent,
                model: lastUser.model,
                auto: true,
              })
              msgsBuffer.current = [...msgsBuffer.current, markerWithParts]
              break
            }
            case "loop-detected": {
              const { loopResult } = event.payload as { loopResult: LoopDetectionResult }
              loopDetectionCount = loopResult.count
              pendingLoopRecovery = loopResult
              log.warn("loop detected", {
                sessionID,
                type: loopResult.type,
                detail: loopResult.detail,
                count: loopResult.count,
              })
              break
            }
            case "plan-stop-correction": {
              const { correctionCount, correctionText } = event.payload as {
                correctionCount: number
                correctionText: string
              }
              log.warn("plan mode stop-drift: injecting correction message", {
                sessionID,
                correctionCount,
              })

              // Strip incomplete thinking parts (same cleanup as loop recovery)
              if (currentAssistantMessage) {
                await stripIncompleteThinking({
                  sessionID,
                  message: currentAssistantMessage,
                  msgsBuffer,
                  checkpointer: input.checkpointer,
                  tracker,
                })
              }

              const lastUser = findLastUserFromBuffer(msgsBuffer.current)
              if (lastUser && correctionText) {
                await correctionInjector.inject({
                  lastUser,
                  text: correctionText,
                  msgsBuffer,
                })
              }

              // Clean up instruction prompt before next turn
              if (currentAssistantMessage) {
                await InstructionPrompt.clear(currentAssistantMessage.id)
              }
              break
            }
            case "stop": {
              return { status: "ok", message: persister?.getCompletedMessage() } as SessionResult
            }
            case "continue": {
              // Normal continuation — no-op, generator resumes
              break
            }
          }
          break
        }

        // ── Stream events: route to persister ──
        default: {
          // ── Pre-turn error: model resolution or other early failures ──
          // When queryLoop yields an error BEFORE turn-start, persister is undefined.
          // We must intercept here to prevent the "Impossible" guard from firing.
          if (!persister && "type" in event && event.type === "error") {
            log.error("runSession: pre-turn error (no persister)", {
              sessionID,
              error: (event as EngineEvent.BlockEvent & { type: "error" }).error,
            })
            // Exit cleanly — cleanup()/defer will emit session.idle
            return {
              status: "error",
              error: (event as EngineEvent.BlockEvent & { type: "error" }).error,
            } as SessionResult
          }

          if (persister) {
            const action = persister.handleEvent(event) // synchronous — no DB writes
            // Drain accumulated writes and persist to DB
            const ops = persister.drainWrites()
            if (ops.length > 0) {
              tracker.track(input.checkpointer.write(ops))
            }
            if (action === "stop") {
              log.info("runSession: persister signalled stop during event handling", { sessionID })
              return {
                status: "error",
                error: currentAssistantMessage?.error,
                message: persister?.getCompletedMessage(),
              } as SessionResult
            }
            if (action === "retry") {
              // Retry sleep extracted from persister — loop.ts handles the blocking wait
              const delay = SessionRetry.delay(persister.attempt)
              await SessionRetry.sleep(delay, abort).catch(() => {})
              // Don't break — let the for-await continue to process the next event
            }
          }
          break
        }
      }
    }
  } catch (e: unknown) {
    // AbortError is expected when the user cancels mid-stream.
    // Swallow it here so it doesn't propagate as an unhandled rejection.
    if (isAbortError(e)) {
      log.info("session/loop abort: caught AbortError in event loop", { sessionID })
      return { status: "aborted" } as SessionResult
    } else {
      throw e
    }
  }

  // Post-loop cleanup (fire-and-forget with catch to prevent unhandled rejection)
  if (isRootAgent()) {
    import("@/agent/fork").then((m) => m.saveCacheSafeParams(sessionID, null)).catch(() => {})

    compactionOrchestrator.prune().catch((e: unknown) => {
      if (!isAbortError(e)) {
        log.error("runSession: prune failed", { error: e, sessionID })
      }
    })
  }

  return { status: "ok", message: persister?.getCompletedMessage() } as SessionResult
}

/**
 * Helper: find the last user message from the in-memory buffer (no DB read).
 */
function findLastUserFromBuffer(msgs: Message.WithParts[]): Message.User | undefined {
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].info.role === "user") return msgs[i].info as Message.User
  }
  return undefined
}

export const loop = fn(LoopInput, async (input) => {
  const { sessionID, resume_existing } = input

  const abort = resume_existing ? resume(sessionID) : start(sessionID)
  if (!abort) {
    return new Promise<Message.WithParts>((resolve, reject) => {
      const callbacks = state()[sessionID].callbacks
      callbacks.push({ resolve, reject })
    })
  }

  // Create a fresh BackgroundTaskRegistry scoped to this session.
  // Disposed (all running tasks terminated) when the session ends via defer.
  const registry = new BackgroundTaskRegistry()

  const tracker = new PromiseTracker()

  await using _ = defer(async () => {
    // Flush all pending async writes before cleaning up session
    await tracker.flush().catch((e: unknown) => {
      log.error("loop tracker.flush() failed during cleanup", { error: e, sessionID })
    })
    await registry.disposeAll()
    cleanup(sessionID)
  })

  const session = await Session.get(sessionID)

  // Delegate to the event-sourced orchestrator
  const checkpointer = new SqliteCheckpointer()
  const result = await runSession({ sessionID, session, abort, registry, checkpointer, tracker })

  const queued = state()[sessionID]?.callbacks ?? []
  switch (result.status) {
    case "ok": {
      for (const q of queued) q.resolve(result.message)
      return result.message
    }
    case "error": {
      const err = result.error instanceof Error ? result.error : new Error(String(result.error))
      for (const q of queued) q.reject(err)
      const publishedError =
        err && typeof err === "object" && "name" in err && "data" in err
          ? err
          : { name: "UnknownError", data: { message: err.message } }
      // T013/T014: Publish to Bus so TUI and frontend SSE can receive it
      // Do not block loop exit on Bus publish
      // biome-ignore lint/suspicious/noExplicitAny: error is a generic union in the bus
      Bus.publish(Session.Event.Error, { sessionID, error: publishedError as any }).catch((busErr: unknown) => {
        log.error("Bus.publish(Session.Event.Error) failed", { error: busErr, sessionID })
      })
      if (result.message) return result.message
      throw err
    }
    case "aborted": {
      const abortErr = new DOMException("Session aborted", "AbortError")
      for (const q of queued) q.reject(abortErr)
      throw abortErr
    }
  }
})

// ─── Loop Recovery Helpers ──────────────────────────────────────────────────

/**
 * Strips incomplete reasoning parts from the assistant message in the database.
 *
 * When we abort streaming mid-thinking, the partial reasoning block has no end
 * timestamp and no valid `thoughtSignature` in metadata. The Code Assist API
 * requires valid signatures on all thinking parts in history — sending back a
 * partial block causes 400 errors on retry.
 *
 * This function removes reasoning parts that were never closed (no `time.end`),
 * making the message safe to include in subsequent inference calls.
 */
async function stripIncompleteThinking(input: {
  sessionID: SessionID
  message: Message.Assistant
  msgsBuffer: { current: Message.WithParts[] }
  checkpointer: Checkpointer
  tracker: PromiseTracker
}): Promise<void> {
  const { sessionID, message, msgsBuffer, checkpointer, tracker } = input

  // Read from in-memory buffer instead of DB
  const assistantMsg = msgsBuffer.current.find((m) => m.info.id === message.id && m.info.role === "assistant")
  if (!assistantMsg) return

  for (const part of assistantMsg.parts) {
    if (part.type === "reasoning" && !part.time?.end && !part.metadata?.thoughtSignature) {
      log.info("stripIncompleteThinking: removing incomplete reasoning part", {
        sessionID,
        messageID: message.id,
        partID: part.id,
      })
      // Persist deletion through checkpointer
      tracker.track(checkpointer.deletePart({ sessionID, messageID: message.id, partID: part.id }))
      // Update the in-memory buffer
      assistantMsg.parts = assistantMsg.parts.filter((p) => p.id !== part.id)
    }
  }
}

async function processSubtask(input: {
  task: Message.SubtaskPart
  model: Provider.Model
  lastUser: Message.User
  sessionID: SessionID
  session: Session.Info
  abort: AbortSignal
  msgs: Message.WithParts[]
  telemetryTracker?: TelemetryTracker
  telemetryBatchId?: string
  checkpointer: Checkpointer
  tracker: PromiseTracker
}): Promise<{ subtaskAssistant: Message.WithParts; syntheticUser?: Message.WithParts }> {
  const { task, lastUser, sessionID, session, abort, msgs, telemetryTracker, telemetryBatchId, checkpointer, tracker } =
    input
  const taskTool = await TaskTool.init()
  const taskModel = task.model
    ? await Provider.getModel(task.model.providerID, task.model.modelID).catch((e) => {
        log.warn("subtask model not available, falling back to parent model", {
          configured: `${task.model?.providerID}/${task.model?.modelID}`,
          error: e instanceof Error ? e.message : e,
        })
        return input.model
      })
    : input.model
  const assistantMessage = {
    id: MessageID.ascending(),
    role: "assistant",
    parentID: lastUser.id,
    sessionID,
    mode: task.agent,
    agent: task.agent,
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
    modelID: taskModel.id,
    providerID: taskModel.providerID,
    time: {
      created: Date.now(),
    },
  } as Message.Assistant
  tracker.track(checkpointer.saveMessage(assistantMessage))

  let part = {
    id: PartID.ascending(),
    messageID: assistantMessage.id,
    sessionID: assistantMessage.sessionID,
    type: "tool",
    callID: ulid(),
    tool: TaskTool.id,
    state: {
      status: "running",
      input: {
        prompt: task.prompt,
        description: task.description,
        subagent_type: task.agent,
        command: task.command,
      },
      time: {
        start: Date.now(),
      },
    },
  } as Message.ToolPart
  tracker.track(checkpointer.savePart(part))
  const taskArgs = {
    prompt: task.prompt,
    description: task.description,
    subagent_type: task.agent,
    command: task.command,
  }

  await Plugin.trigger(
    "tool.execute.before",
    {
      tool: "task",
      sessionID,
      callID: part.id,
    },
    { args: taskArgs },
  )
  let executionError: Error | undefined
  const taskAgent = await Agent.get(task.agent)
  const ctx: Tool.Context = {
    agent: task.agent,
    messageID: assistantMessage.id,
    sessionID: sessionID,
    abort,
    callID: part.callID,
    extra: { bypassAgentCheck: true },
    messages: msgs,
    async metadata(val) {
      part = {
        ...part,
        type: "tool",
        state: {
          ...part.state,
          ...val,
        },
      } satisfies Message.ToolPart as Message.ToolPart
      tracker.track(checkpointer.savePart(part))
    },
    async ask(req) {
      await PermissionNext.ask({
        ...req,
        sessionID: sessionID,
        ruleset: PermissionNext.merge(taskAgent.permission, session.permission ?? []),
      })
    },
  }

  const activeSpan = trace.getActiveSpan()
  if (activeSpan) {
    activeSpan.setAttribute("input.value", JSON.stringify(taskArgs))
    activeSpan.setAttribute("ai.telemetry.metadata.langgraph_node", "task")
    activeSpan.setAttribute(
      "ai.telemetry.metadata.langgraph_step",
      String(telemetryTracker?.getStep(telemetryBatchId) ?? 1),
    )
  }

  const result = await taskTool.execute(taskArgs, ctx).catch((error) => {
    executionError = error
    log.error("subtask execution failed", { error, agent: task.agent, description: task.description })
    if (activeSpan) {
      activeSpan.setAttribute("output.value", String(error))
    }
    return undefined
  })
  if (activeSpan && result) {
    activeSpan.setAttribute("output.value", result.output ?? "")
  }
  const attachments = result?.attachments?.map((attachment) => ({
    ...attachment,
    id: PartID.ascending(),
    sessionID,
    messageID: assistantMessage.id,
  }))
  await Plugin.trigger(
    "tool.execute.after",
    {
      tool: "task",
      sessionID,
      callID: part.id,
      args: taskArgs,
    },
    result,
  )
  assistantMessage.finish = "tool-calls"
  assistantMessage.time.completed = Date.now()
  tracker.track(checkpointer.updateMessage(assistantMessage))
  if (result && part.state.status === "running") {
    part = {
      ...part,
      state: {
        status: "completed",
        input: part.state.input,
        title: result.title,
        metadata: result.metadata,
        output: result.output,
        attachments,
        time: {
          ...part.state.time,
          end: Date.now(),
        },
      },
    } satisfies Message.ToolPart as Message.ToolPart
    tracker.track(checkpointer.savePart(part))
  }
  if (!result) {
    part = {
      ...part,
      state: {
        status: "error",
        error: executionError ? `Tool execution failed: ${executionError.message}` : "Tool execution failed",
        time: {
          start: part.state.status === "running" ? part.state.time.start : Date.now(),
          end: Date.now(),
        },
        metadata: "metadata" in part.state ? part.state.metadata : undefined,
        input: part.state.input,
      },
    } satisfies Message.ToolPart as Message.ToolPart
    tracker.track(checkpointer.savePart(part))
  }

  // Build the in-memory WithParts for the subtask assistant message (FR-8)
  const subtaskAssistant: Message.WithParts = {
    info: assistantMessage,
    parts: [part as Message.Part],
  }

  if (task.command) {
    // Add synthetic user message to prevent certain reasoning models from erroring
    // If we create assistant messages w/ out user ones following mid loop thinking signatures
    // will be missing and it can cause errors for models like gemini for example
    const summaryUserMsg: Message.User = {
      id: MessageID.ascending(),
      sessionID,
      role: "user",
      time: {
        created: Date.now(),
      },
      agent: lastUser.agent,
      model: lastUser.model,
    }
    tracker.track(checkpointer.saveMessage(summaryUserMsg))
    const summaryTextPart = {
      id: PartID.ascending(),
      messageID: summaryUserMsg.id,
      sessionID,
      type: "text",
      text: "Summarize the task tool output above and continue with your task.",
      synthetic: true,
    } satisfies Message.TextPart as Message.TextPart
    tracker.track(checkpointer.savePart(summaryTextPart))
    const syntheticUser: Message.WithParts = {
      info: summaryUserMsg,
      parts: [summaryTextPart],
    }
    return { subtaskAssistant, syntheticUser }
  }

  return { subtaskAssistant }
}
