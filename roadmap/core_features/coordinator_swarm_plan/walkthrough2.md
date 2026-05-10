# Phase 1 Coordinator Remediation — Walkthrough

## Overview

This session fixed all 11 issues identified in the [critical review](file:///C:/Users/ahmed/.gemini/antigravity/brain/0a93441d-987c-4132-b4d8-c74e3aa58f4d/phase1_critical_review.md). The fixes span 5 source files and 1 new test file.

---

## Files Modified

### [loop.ts](file:///d:/liteai/packages/core/src/session/engine/loop.ts) — C-1, C-2, C-3, M-3

```diff:loop.ts
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
import { CheckpointStoreManager } from "./loop/checkpoint-store"
import { type Checkpointer, type SessionResult, SqliteCheckpointer } from "./loop/checkpointer"
import { PromiseTracker } from "./loop/promise-tracker"
import type { ResumePayload } from "./loop/step-latch"
import { SessionNotPausedError, type StepLatchHandle, StepPauseLatch } from "./loop/step-latch"
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
    /** Active step-pause latch — present only while the session is paused in step mode */
    stepLatch?: StepLatchHandle
    /** Mutable ref to the step mode flag — can be toggled by resume API */
    stepModeRef?: { current: boolean }
    appState: import("../../agent/context").AppState
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
  /** Enable step-by-step execution — loop pauses after each iteration */
  stepMode: z.boolean().optional(),
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

  return await loop({ sessionID: input.sessionID, stepMode: input.stepMode })
})

export const runSubagent = fn(PromptInput, async (input) => {
  const session = await Session.get(input.sessionID)
  await SessionRevert.cleanup(session)

  await createUserMessage(input)
  await Session.touch(input.sessionID)

  if (input.noReply === true) {
    throw new Error("runSubagent does not support noReply — subagents must always produce a result")
  }

  const { sessionID } = input
  const abort = start(sessionID)
  if (!abort) {
    return { status: "error", error: new Error("Session busy") } as SessionResult
  }

  const registry = new BackgroundTaskRegistry()
  const tracker = new PromiseTracker()

  await using _ = defer(async () => {
    await tracker.flush().catch((e: unknown) => {
      log.error("runSubagent tracker.flush() failed during cleanup", { error: e, sessionID })
    })
    await registry.disposeAll()
    cleanup(sessionID)
  })

  const checkpointer = new SqliteCheckpointer()
  return await runSession({ sessionID, session, abort, registry, checkpointer, tracker })
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
    appState: {},
  }
  return controller.signal
}

function resume(sessionID: SessionID) {
  const s = state()
  if (!s[sessionID]) return

  return s[sessionID].abort.signal
}

/**
 * Resume a session that is paused in step mode.
 * Resolves the pending step-pause latch, unblocking the loop.
 */
export function resumeStepMode(sessionID: SessionID, payload: ResumePayload) {
  const s = state()
  const match = s[sessionID]
  if (!match || !match.stepLatch) {
    throw new SessionNotPausedError({ sessionID })
  }
  match.stepLatch.resolve(payload)
  // Clear the latch reference — the loop will create a new one on next pause
  match.stepLatch = undefined
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
  const entry = s[sessionID]
  
  if (entry?.appState?.teamContext) {
    const teamFilePath = entry.appState.teamContext.teamFilePath
    import("node:path").then((path) => {
      import("node:fs/promises").then((fs) => {
        fs.rm(path.dirname(teamFilePath), { recursive: true, force: true }).catch((e) => {
          log.warn("cleanup: failed to delete team directory", { sessionID, teamFilePath, error: e })
        })
      })
    })
  }

  delete s[sessionID]
  SessionStatus.set(sessionID, { type: "idle" })

  // Clear the in-memory checkpoint store for this session to prevent leaks.
  // Uses CheckpointStoreManager directly — pure static operation, no instance needed.
  try {
    CheckpointStoreManager.clearSession(sessionID)
  } catch (e) {
    log.warn("cleanup: failed to clear checkpoint store", { sessionID, error: e })
  }
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
  stepMode: z.boolean().optional(),
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
  stepModeRef?: { current: boolean }
}) {
  const tracer = trace.getTracer("liteai")

  // Single DB read via checkpointer — passed through to runSessionInner.
  // This is the ONLY database read in the entire forward execution path.
  const initialHistory = await input.checkpointer.loadHistory(input.sessionID)
  const firstUserText = initialHistory
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
      let caughtError: unknown
      try {
        const result = await runSessionInner({ ...input, initialHistory })

        // Use SessionResult.message for output span — no DB read.
        // The result already contains the completed assistant message with parts.
        if (result.status !== "aborted" && result.message) {
          const outputText = result.message.parts
            .filter((p) => p.type === "text")
            .map((p) => (p as { text: string }).text)
            .join(" ")
            .slice(0, 500)
          if (outputText) {
            sessionSpan.setAttribute("output.value", outputText)
          }
        }

        return result
      } catch (e) {
        caughtError = e
        throw e
      } finally {
        if (caughtError) {
          sessionSpan.recordException(caughtError as Error)
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
  stepModeRef?: { current: boolean }
  /** Pre-loaded message history — loaded once by runSession() via checkpointer.
   * Eliminates the DB read that was previously inside runSessionInner. */
  initialHistory: Message.WithParts[]
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
  const correctionInjector = new CorrectionInjector(sessionID, input.checkpointer)

  // Step mode: mutable ref so the resume API can toggle it externally
  const stepModeRef = input.stepModeRef ?? { current: false }

  // Store stepModeRef on SessionState so resume API can access it
  const sessionEntry = state()[sessionID]
  if (sessionEntry) {
    sessionEntry.stepModeRef = stepModeRef
  }

  const msgsBuffer: { current: Message.WithParts[] } = {
    current: input.initialHistory,
  }

  const generator = queryLoop({
    sessionID,
    session,
    abort,
    msgsBuffer,
    planModeStateRef,
    backgroundTaskRegistry: input.registry,
    stepModeRef,
  })

  // Create the root AgentContext to provide mutable AppState to the session tools
  const rootContext: import("../../agent/context").RootAgentContext = {
    type: "root",
    getAppState: () => {
      const entry = state()[sessionID]
      return entry?.appState ?? {}
    },
    setAppState: (updater) => {
      const entry = state()[sessionID]
      if (entry) {
        entry.appState = updater(entry.appState)
      }
    },
    setAppStateForTasks: (updater) => {
      const entry = state()[sessionID]
      if (entry) {
        entry.appState = updater(entry.appState)
      }
    },
    cwd: process.cwd(),
    abortController: state()[sessionID]?.abort ?? new AbortController(),
    readFileState: new Map(),
  }

  const { runWithAgentContext } = await import("../../agent/context")

  return await runWithAgentContext(rootContext, async () => {
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
            case "step-pause": {
              const { step, checkpoint } = event.payload as {
                step: number
                checkpoint: import("./loop/checkpoint-store").CheckpointData
              }

              // 1. Set session status to paused
              SessionStatus.set(sessionID, { type: "paused", step })

              // 2. Publish checkpoint event (fire-and-forget)
              Bus.publish(SessionStatus.Event.Checkpoint, {
                sessionID,
                checkpoint: {
                  id: checkpoint.id,
                  step: checkpoint.step,
                  timestamp: checkpoint.timestamp,
                  metadata: checkpoint.metadata,
                },
              }).catch((e: unknown) => {
                log.error("Bus.publish(session.checkpoint) failed", { error: e, sessionID })
              })

              // 3. Create a new latch and store it on SessionState
              const latch = StepPauseLatch.create()
              const sessionStateEntry = state()[sessionID]
              if (sessionStateEntry) {
                sessionStateEntry.stepLatch = latch
              }

              // 4. Wire abort signal to reject the latch (cancel during pause)
              const abortHandler = () => {
                latch.reject(new DOMException("Session aborted during pause", "AbortError"))
              }
              abort.addEventListener("abort", abortHandler, { once: true })

              try {
                // 5. Await the latch — blocks until user resumes or aborts
                const resumePayload = await latch.promise

                // 6. Handle resume payload
                if (resumePayload.guidance) {
                  // Inject guidance as a synthetic user text part (same pattern as correctionInjector)
                  const lastUser = findLastUserFromBuffer(msgsBuffer.current)
                  if (lastUser) {
                    await correctionInjector.inject({
                      lastUser,
                      text: resumePayload.guidance,
                      msgsBuffer,
                    })
                  }
                }

                // Only disable step mode if the caller explicitly owns a stepModeRef.
                // The local `stepModeRef` always exists (defaulted to { current: false }),
                // but `input.stepModeRef` is only set when the session was started with
                // step mode support — without this check the guard is always true.
                if (resumePayload.disableStepMode && input.stepModeRef) {
                  stepModeRef.current = false
                }

                // 7. Set status back to busy
                SessionStatus.set(sessionID, { type: "busy" })
              } finally {
                abort.removeEventListener("abort", abortHandler)
              }
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
  })
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
  const stepModeRef = input.stepMode ? { current: true } : undefined
  const result = await runSession({ sessionID, session, abort, registry, checkpointer, tracker, stepModeRef })

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
  abort: AbortSignal
  msgs: Message.WithParts[]
  telemetryTracker?: TelemetryTracker
  telemetryBatchId?: string
  checkpointer: Checkpointer
  tracker: PromiseTracker
}): Promise<{ subtaskAssistant: Message.WithParts; syntheticUser?: Message.WithParts }> {
  const { task, lastUser, sessionID, abort, msgs, telemetryTracker, telemetryBatchId, checkpointer, tracker } = input
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
        ruleset: taskAgent.permission ?? [],
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
===
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
import { isRootAgent, runWithAgentContext } from "../../agent/context"
import { cleanupTeamDirectories } from "../../coordinator/team-helpers"
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
import { CheckpointStoreManager } from "./loop/checkpoint-store"
import { type Checkpointer, type SessionResult, SqliteCheckpointer } from "./loop/checkpointer"
import { PromiseTracker } from "./loop/promise-tracker"
import type { ResumePayload } from "./loop/step-latch"
import { SessionNotPausedError, type StepLatchHandle, StepPauseLatch } from "./loop/step-latch"
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
    /** Active step-pause latch — present only while the session is paused in step mode */
    stepLatch?: StepLatchHandle
    /** Mutable ref to the step mode flag — can be toggled by resume API */
    stepModeRef?: { current: boolean }
    appState: import("../../agent/context").AppState
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
  /** Enable step-by-step execution — loop pauses after each iteration */
  stepMode: z.boolean().optional(),
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

  return await loop({ sessionID: input.sessionID, stepMode: input.stepMode })
})

export const runSubagent = fn(PromptInput, async (input) => {
  const session = await Session.get(input.sessionID)
  await SessionRevert.cleanup(session)

  await createUserMessage(input)
  await Session.touch(input.sessionID)

  if (input.noReply === true) {
    throw new Error("runSubagent does not support noReply — subagents must always produce a result")
  }

  const { sessionID } = input
  const abort = start(sessionID)
  if (!abort) {
    return { status: "error", error: new Error("Session busy") } as SessionResult
  }

  const registry = new BackgroundTaskRegistry()
  const tracker = new PromiseTracker()

  await using _ = defer(async () => {
    await tracker.flush().catch((e: unknown) => {
      log.error("runSubagent tracker.flush() failed during cleanup", { error: e, sessionID })
    })
    await registry.disposeAll()
    cleanup(sessionID)
  })

  const checkpointer = new SqliteCheckpointer()
  return await runSession({ sessionID, session, abort, registry, checkpointer, tracker })
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
    appState: {},
  }
  return controller.signal
}

function resume(sessionID: SessionID) {
  const s = state()
  if (!s[sessionID]) return

  return s[sessionID].abort.signal
}

/**
 * Resume a session that is paused in step mode.
 * Resolves the pending step-pause latch, unblocking the loop.
 */
export function resumeStepMode(sessionID: SessionID, payload: ResumePayload) {
  const s = state()
  const match = s[sessionID]
  if (!match || !match.stepLatch) {
    throw new SessionNotPausedError({ sessionID })
  }
  match.stepLatch.resolve(payload)
  // Clear the latch reference — the loop will create a new one on next pause
  match.stepLatch = undefined
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
  const entry = s[sessionID]
  
  if (entry?.appState?.teamContext) {
    const teamName = entry.appState.teamContext.teamName
    cleanupTeamDirectories(teamName).catch((e) => {
      log.error("cleanup: team directory removal failed", { sessionID, teamName, error: e })
    })
  }

  delete s[sessionID]
  SessionStatus.set(sessionID, { type: "idle" })

  // Clear the in-memory checkpoint store for this session to prevent leaks.
  // Uses CheckpointStoreManager directly — pure static operation, no instance needed.
  try {
    CheckpointStoreManager.clearSession(sessionID)
  } catch (e) {
    log.warn("cleanup: failed to clear checkpoint store", { sessionID, error: e })
  }
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
  stepMode: z.boolean().optional(),
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
  stepModeRef?: { current: boolean }
}) {
  const tracer = trace.getTracer("liteai")

  // Single DB read via checkpointer — passed through to runSessionInner.
  // This is the ONLY database read in the entire forward execution path.
  const initialHistory = await input.checkpointer.loadHistory(input.sessionID)
  const firstUserText = initialHistory
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
      let caughtError: unknown
      try {
        const result = await runSessionInner({ ...input, initialHistory })

        // Use SessionResult.message for output span — no DB read.
        // The result already contains the completed assistant message with parts.
        if (result.status !== "aborted" && result.message) {
          const outputText = result.message.parts
            .filter((p) => p.type === "text")
            .map((p) => (p as { text: string }).text)
            .join(" ")
            .slice(0, 500)
          if (outputText) {
            sessionSpan.setAttribute("output.value", outputText)
          }
        }

        return result
      } catch (e) {
        caughtError = e
        throw e
      } finally {
        if (caughtError) {
          sessionSpan.recordException(caughtError as Error)
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
  stepModeRef?: { current: boolean }
  /** Pre-loaded message history — loaded once by runSession() via checkpointer.
   * Eliminates the DB read that was previously inside runSessionInner. */
  initialHistory: Message.WithParts[]
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
  const correctionInjector = new CorrectionInjector(sessionID, input.checkpointer)

  // Step mode: mutable ref so the resume API can toggle it externally
  const stepModeRef = input.stepModeRef ?? { current: false }

  // Store stepModeRef on SessionState so resume API can access it
  const sessionEntry = state()[sessionID]
  if (sessionEntry) {
    sessionEntry.stepModeRef = stepModeRef
  }

  const msgsBuffer: { current: Message.WithParts[] } = {
    current: input.initialHistory,
  }

  const generator = queryLoop({
    sessionID,
    session,
    abort,
    msgsBuffer,
    planModeStateRef,
    backgroundTaskRegistry: input.registry,
    stepModeRef,
  })

  // Create the root AgentContext to provide mutable AppState to the session tools.
  // Getters/setters throw if the session entry is missing — during active execution
  // the entry MUST exist. Cleanup uses optional chaining because it runs during teardown.
  const rootContext: import("../../agent/context").RootAgentContext = {
    type: "root",
    sessionId: sessionID,
    getAppState: () => {
      const entry = state()[sessionID]
      if (!entry) {
        throw new Error(`Session ${sessionID} state not found during getAppState — session was cleaned up while tools were still executing`)
      }
      return entry.appState
    },
    setAppState: (updater) => {
      const entry = state()[sessionID]
      if (!entry) {
        throw new Error(`Session ${sessionID} state not found during setAppState — session was cleaned up while tools were still executing`)
      }
      entry.appState = updater(entry.appState)
    },
    setAppStateForTasks: (updater) => {
      const entry = state()[sessionID]
      if (!entry) {
        throw new Error(`Session ${sessionID} state not found during setAppStateForTasks — session was cleaned up while tools were still executing`)
      }
      entry.appState = updater(entry.appState)
    },
    cwd: session.directory ?? process.cwd(),
    abortController: state()[sessionID]?.abort ?? new AbortController(),
    readFileState: new Map(),
  }

  return await runWithAgentContext(rootContext, async () => {
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
            case "step-pause": {
              const { step, checkpoint } = event.payload as {
                step: number
                checkpoint: import("./loop/checkpoint-store").CheckpointData
              }

              // 1. Set session status to paused
              SessionStatus.set(sessionID, { type: "paused", step })

              // 2. Publish checkpoint event (fire-and-forget)
              Bus.publish(SessionStatus.Event.Checkpoint, {
                sessionID,
                checkpoint: {
                  id: checkpoint.id,
                  step: checkpoint.step,
                  timestamp: checkpoint.timestamp,
                  metadata: checkpoint.metadata,
                },
              }).catch((e: unknown) => {
                log.error("Bus.publish(session.checkpoint) failed", { error: e, sessionID })
              })

              // 3. Create a new latch and store it on SessionState
              const latch = StepPauseLatch.create()
              const sessionStateEntry = state()[sessionID]
              if (sessionStateEntry) {
                sessionStateEntry.stepLatch = latch
              }

              // 4. Wire abort signal to reject the latch (cancel during pause)
              const abortHandler = () => {
                latch.reject(new DOMException("Session aborted during pause", "AbortError"))
              }
              abort.addEventListener("abort", abortHandler, { once: true })

              try {
                // 5. Await the latch — blocks until user resumes or aborts
                const resumePayload = await latch.promise

                // 6. Handle resume payload
                if (resumePayload.guidance) {
                  // Inject guidance as a synthetic user text part (same pattern as correctionInjector)
                  const lastUser = findLastUserFromBuffer(msgsBuffer.current)
                  if (lastUser) {
                    await correctionInjector.inject({
                      lastUser,
                      text: resumePayload.guidance,
                      msgsBuffer,
                    })
                  }
                }

                // Only disable step mode if the caller explicitly owns a stepModeRef.
                // The local `stepModeRef` always exists (defaulted to { current: false }),
                // but `input.stepModeRef` is only set when the session was started with
                // step mode support — without this check the guard is always true.
                if (resumePayload.disableStepMode && input.stepModeRef) {
                  stepModeRef.current = false
                }

                // 7. Set status back to busy
                SessionStatus.set(sessionID, { type: "busy" })
              } finally {
                abort.removeEventListener("abort", abortHandler)
              }
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
  })
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
  const stepModeRef = input.stepMode ? { current: true } : undefined
  const result = await runSession({ sessionID, session, abort, registry, checkpointer, tracker, stepModeRef })

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
  abort: AbortSignal
  msgs: Message.WithParts[]
  telemetryTracker?: TelemetryTracker
  telemetryBatchId?: string
  checkpointer: Checkpointer
  tracker: PromiseTracker
}): Promise<{ subtaskAssistant: Message.WithParts; syntheticUser?: Message.WithParts }> {
  const { task, lastUser, sessionID, abort, msgs, telemetryTracker, telemetryBatchId, checkpointer, tracker } = input
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
        ruleset: taskAgent.permission ?? [],
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
```

**C-1: AppState getters/setters now throw** when the session entry is missing instead of silently returning `{}` or dropping mutations. The root context now includes clear error messages identifying the session ID.

**C-2: Cleanup uses `cleanupTeamDirectories()`** — replaced the triple-nested dynamic import chain (`import("node:path").then(...)`) with the existing shared helper that already handles error logging.

**C-3: Multi-tenant cwd** — changed `process.cwd()` to `session.directory ?? process.cwd()` so each session uses its own project directory.

**M-3: Static import** — `runWithAgentContext` is now imported statically alongside `isRootAgent` from the same module, eliminating an unnecessary async hop.

---

### [context.ts](file:///d:/liteai/packages/core/src/agent/context.ts) — M-1, H-4

```diff:context.ts
import { AsyncLocalStorage } from "node:async_hooks"
import type { Config } from "@/config/config"
import type { MCP } from "@/mcp"
import type { Provider } from "@/provider/provider"
import type { Agent } from "./agent"
import type { CacheSafeParams } from "./fork"

export interface ThinkingConfig {
  enabled: boolean
  budget?: number
}

export interface ExecController {
  exec(
    cmd: string,
    args: string[],
    options?: { cwd?: string; env?: Record<string, string> },
  ): Promise<{ stdout: string; stderr: string; exitCode: number }>
}

export interface BackgroundTaskState {
  status?: "running" | "stopped" | "error" | "completed" | string
  pendingMessages?: string[]
  [key: string]: unknown
}

export interface AppState {
  shouldAvoidPermissionPrompts?: boolean
  permissionMode?: Agent.Info["permissionMode"]
  /** Per-agent activity descriptions from the periodic summarization loop. */
  agentSummaries?: Record<string, string>
  /** Name-to-agentId registry for background agents. */
  agentNameRegistry?: Record<string, string>
  /** Tasks/state tracking for background agents. */
  tasks?: Record<string, BackgroundTaskState>
  /** Team context for coordinator/swarm mode. */
  teamContext?: {
    teamName: string
    teamFilePath: string
    leadAgentId: string
    teammates: Record<
      string,
      {
        name: string
        agentType: string
        color: string
        spawnedAt: number
        cwd: string
      }
    >
  }
}

export type AgentContext = SubagentContext | TeammateAgentContext | RootAgentContext

export interface Scope {
  readonly mode: "memory"
}

export interface ParentContext {
  sessionId: string
  agentId?: string
  abortController: AbortController
  // biome-ignore lint/suspicious/noExplicitAny: compatibility with FileStateMap and Session state requires any
  readFileState: Map<string, any>
  // biome-ignore lint/suspicious/noExplicitAny: compatibility with Session state requires any
  contentReplacementState?: any
  getAppState: () => AppState
  setAppState: (updater: (state: AppState) => AppState) => void
  /**
   * Root store passthrough for task management. Ensures task registration/kill
   * always reaches the root session's AppState, even when the sub-agent's
   * `setAppState` is no-op'd for isolation. Without this, background tasks
   * spawned by sub-agents become PPID=1 zombies.
   *
   */
  setAppStateForTasks?: (updater: (state: AppState) => AppState) => void
  queryTracking?: { depth: number }
  model?: { providerID: string; modelID: string } | Provider.Model
  thinkingConfig?: ThinkingConfig
  cwd?: string
}

export interface SubagentContext {
  type: "subagent"
  agentId: string
  /** Agent definition name (e.g., "explore", "build"). */
  agentType: string
  isFork: boolean
  parentSystemPrompt?: string
  cacheSafeParams?: CacheSafeParams
  /** Session ID of the parent that spawned this agent. */
  parentSessionId: string
  /** Whether this agent is a built-in (native) agent. */
  isBuiltIn: boolean
  abortController: AbortController
  // biome-ignore lint/suspicious/noExplicitAny: compatibility with Session state requires any
  readFileState: Map<string, any>
  // biome-ignore lint/suspicious/noExplicitAny: cloned from parent for cache stability (FR-004)
  contentReplacementState?: any
  /** Recursion depth tracking for nested sub-agent spawns. */
  queryTracking: { depth: number }
  /** Whether this invocation is a fresh spawn or a resume. */
  invocationKind: "spawn" | "resume"
  thinkingConfig?: ThinkingConfig
  getAppState: () => AppState
  setAppState: (updater: (state: AppState) => AppState) => void
  /**
   * Root store passthrough for task management. Ensures task registration/kill
   * always reaches the root session's AppState, even when this agent's
   * `setAppState` is no-op'd for isolation.
   */
  setAppStateForTasks: (updater: (state: AppState) => AppState) => void
  cwd: string
  effort?: string
  criticalSystemReminder?: string
  invokingRequestId?: string
  prunedUserContext?: Record<string, unknown>
  prunedSystemContext?: Record<string, unknown>
  mcpClients?: Array<{ name: string; client: MCP.MCPClient; config: Config.Mcp }>
  execController?: ExecController
}

export interface TeammateAgentContext {
  type: "teammate"
  agentId: string
  teamName: string
  agentColor: string
  planModeRequired: boolean
  isTeamLead: boolean
  invokingRequestId?: string
}

export interface RootAgentContext {
  type: "root"
  agentId?: undefined
  invokingRequestId?: string
  getAppState: () => AppState
  setAppState: (updater: (state: AppState) => AppState) => void
  setAppStateForTasks: (updater: (state: AppState) => AppState) => void
  cwd: string
  abortController: AbortController
  // biome-ignore lint/suspicious/noExplicitAny: compatibility with Session state requires any
  readFileState: Map<string, any>
  // biome-ignore lint/suspicious/noExplicitAny: compatibility with Session state requires any
  contentReplacementState?: any
}

export interface SubagentContextOverrides {
  shareSetAppState?: boolean
  shareSetResponseLength?: boolean // Not yet wired — response length sharing requires query loop integration
  shareAbortController?: boolean
  isFork?: boolean
  parentSystemPrompt?: string
  cacheSafeParams?: CacheSafeParams
  criticalSystemReminder?: string
  userContext?: Record<string, unknown>
  systemContext?: Record<string, unknown>
  mcpClients?: Array<{ name: string; client: MCP.MCPClient; config: Config.Mcp }>
  execController?: ExecController
  cwd?: string
  contentReplacementState?: Record<string, unknown>
}

export const AgentExecutionContext = new AsyncLocalStorage<AgentContext>()

export function runWithAgentContext<T>(context: AgentContext, fn: () => T): T {
  return AgentExecutionContext.run(context, fn)
}

export function consumeInvokingRequestId(): string | undefined {
  const ctx = AgentExecutionContext.getStore()
  if (!ctx) return undefined
  const reqId = ctx.invokingRequestId
  ctx.invokingRequestId = undefined
  return reqId
}

export function isRootAgent(): boolean {
  const ctx = AgentExecutionContext.getStore()
  return !ctx || ctx.agentId === undefined
}

export function createSubagentContext(
  parent: ParentContext,
  agent: Agent.Info,
  agentId: string,
  overrides?: SubagentContextOverrides,
): SubagentContext {
  const abortController = overrides?.shareAbortController ? parent.abortController : new AbortController()

  if (!overrides?.shareAbortController) {
    const parentSignal = parent.abortController.signal
    const onAbort = () => abortController.abort(parentSignal.reason)
    if (parentSignal.aborted) {
      abortController.abort(parentSignal.reason)
    } else {
      parentSignal.addEventListener("abort", onAbort, { once: true })
    }
  }

  // Implement deep isolation unless shareSetAppState is explicitly true
  // biome-ignore lint/suspicious/noExplicitAny: generic application state
  let independentState: any
  if (!overrides?.shareSetAppState) {
    const parentState = parent.getAppState?.() || {}
    independentState =
      typeof structuredClone === "function" ? structuredClone(parentState) : JSON.parse(JSON.stringify(parentState))

    if (agent.background) {
      independentState.shouldAvoidPermissionPrompts = true
    }
  }

  const getAppState = () => {
    if (overrides?.shareSetAppState) {
      const state = parent.getAppState?.() || {}
      if (agent.background) {
        return { ...state, shouldAvoidPermissionPrompts: true }
      }
      return state
    }
    return independentState
  }

  const setAppState = overrides?.shareSetAppState
    ? parent.setAppState
    : // biome-ignore lint/suspicious/noExplicitAny: generic app state
      (arg: any) => {
        if (typeof arg === "function") {
          const temp = arg(independentState)
          independentState = temp === undefined ? independentState : temp
        } else {
          independentState = { ...independentState, ...arg }
        }
      }

  // Task registration/kill must always reach the root store, even when
  // setAppState is a no-op — otherwise background tasks are never
  // registered and never killed (PPID=1 zombie).
  const setAppStateForTasks = parent.setAppStateForTasks ?? parent.setAppState

  // Clone contentReplacementState for cache stability (FR-004) or use override
  // biome-ignore lint/suspicious/noExplicitAny: generic content replacement state
  let contentReplacementState: any
  if (overrides?.contentReplacementState) {
    contentReplacementState = overrides.contentReplacementState
  } else if (parent.contentReplacementState) {
    contentReplacementState =
      typeof structuredClone === "function"
        ? structuredClone(parent.contentReplacementState)
        : JSON.parse(JSON.stringify(parent.contentReplacementState))
  }

  return {
    type: "subagent",
    agentId,
    agentType: agent.name || "unknown",
    isFork: overrides?.isFork ?? false,
    parentSystemPrompt: overrides?.parentSystemPrompt,
    cacheSafeParams: overrides?.cacheSafeParams,
    parentSessionId: parent.sessionId,
    isBuiltIn: agent.native === true,
    invocationKind: "spawn",
    queryTracking: {
      depth: (parent.queryTracking?.depth ?? 0) + 1,
    },
    abortController,
    readFileState: new Map(parent.readFileState), // shallow clone
    contentReplacementState,
    thinkingConfig: agent.thinking
      ? {
          ...(parent.thinkingConfig || {}),
          enabled: true,
          ...(agent.thinkingBudget !== undefined ? { budget: agent.thinkingBudget } : {}),
        }
      : undefined,
    getAppState,
    setAppState,
    setAppStateForTasks,
    cwd: overrides?.cwd ?? parent.cwd ?? process.cwd(),
    effort: agent.effort,
    criticalSystemReminder: overrides?.criticalSystemReminder,
    mcpClients: overrides?.mcpClients,
    execController: overrides?.execController,
  }
}
===
import { AsyncLocalStorage } from "node:async_hooks"
import type { Config } from "@/config/config"
import type { MCP } from "@/mcp"
import type { Provider } from "@/provider/provider"
import type { Agent } from "./agent"
import type { CacheSafeParams } from "./fork"

export interface ThinkingConfig {
  enabled: boolean
  budget?: number
}

export interface ExecController {
  exec(
    cmd: string,
    args: string[],
    options?: { cwd?: string; env?: Record<string, string> },
  ): Promise<{ stdout: string; stderr: string; exitCode: number }>
}

export interface BackgroundTaskState {
  status?: "running" | "stopped" | "error" | "completed" | string
  pendingMessages?: string[]
  [key: string]: unknown
}

export interface AppState {
  shouldAvoidPermissionPrompts?: boolean
  permissionMode?: Agent.Info["permissionMode"]
  /** Per-agent activity descriptions from the periodic summarization loop. */
  agentSummaries?: Record<string, string>
  /** Name-to-agentId registry for background agents. */
  agentNameRegistry?: Record<string, string>
  /** Tasks/state tracking for background agents. */
  tasks?: Record<string, BackgroundTaskState>
  /** Team context for coordinator/swarm mode. */
  teamContext?: {
    teamName: string
    teamFilePath: string
    leadAgentId: string
    teammates: Record<
      string,
      {
        name: string
        agentType: string
        color: string
        spawnedAt: number
        cwd: string
      }
    >
  }
}

export type AgentContext = SubagentContext | TeammateAgentContext | RootAgentContext

export interface Scope {
  readonly mode: "memory"
}

export interface ParentContext {
  sessionId: string
  agentId?: string
  abortController: AbortController
  // biome-ignore lint/suspicious/noExplicitAny: compatibility with FileStateMap and Session state requires any
  readFileState: Map<string, any>
  // biome-ignore lint/suspicious/noExplicitAny: compatibility with Session state requires any
  contentReplacementState?: any
  getAppState: () => AppState
  setAppState: (updater: (state: AppState) => AppState) => void
  /**
   * Root store passthrough for task management. Ensures task registration/kill
   * always reaches the root session's AppState, even when the sub-agent's
   * `setAppState` is no-op'd for isolation. Without this, background tasks
   * spawned by sub-agents become PPID=1 zombies.
   *
   */
  setAppStateForTasks?: (updater: (state: AppState) => AppState) => void
  queryTracking?: { depth: number }
  model?: { providerID: string; modelID: string } | Provider.Model
  thinkingConfig?: ThinkingConfig
  cwd?: string
}

export interface SubagentContext {
  type: "subagent"
  agentId: string
  /** Agent definition name (e.g., "explore", "build"). */
  agentType: string
  isFork: boolean
  parentSystemPrompt?: string
  cacheSafeParams?: CacheSafeParams
  /** Session ID of the parent that spawned this agent. */
  parentSessionId: string
  /** Whether this agent is a built-in (native) agent. */
  isBuiltIn: boolean
  abortController: AbortController
  // biome-ignore lint/suspicious/noExplicitAny: compatibility with Session state requires any
  readFileState: Map<string, any>
  // biome-ignore lint/suspicious/noExplicitAny: cloned from parent for cache stability (FR-004)
  contentReplacementState?: any
  /** Recursion depth tracking for nested sub-agent spawns. */
  queryTracking: { depth: number }
  /** Whether this invocation is a fresh spawn or a resume. */
  invocationKind: "spawn" | "resume"
  thinkingConfig?: ThinkingConfig
  getAppState: () => AppState
  setAppState: (updater: (state: AppState) => AppState) => void
  /**
   * Root store passthrough for task management. Ensures task registration/kill
   * always reaches the root session's AppState, even when this agent's
   * `setAppState` is no-op'd for isolation.
   */
  setAppStateForTasks: (updater: (state: AppState) => AppState) => void
  cwd: string
  effort?: string
  criticalSystemReminder?: string
  invokingRequestId?: string
  prunedUserContext?: Record<string, unknown>
  prunedSystemContext?: Record<string, unknown>
  mcpClients?: Array<{ name: string; client: MCP.MCPClient; config: Config.Mcp }>
  execController?: ExecController
}

/**
 * Teammate agent context for in-process swarm teammates.
 *
 * Phase 1: Stub with identity-only fields. All coordinator tools guard against
 * this context type and throw immediately.
 *
 * Phase 2/3 Roadmap: This interface must be extended with core capabilities
 * before in-process teammates can execute tools:
 *   - getAppState / setAppState (read-only view or isolated copy)
 *   - abortController (for graceful shutdown via mailbox protocol)
 *   - readFileState (for file-level caching)
 *   - cwd (worktree-scoped working directory)
 *
 * Design Decision: Do NOT add these as optional properties. When Phase 3
 * implementation begins, extract a `BaseExecutableContext` interface with
 * the shared capabilities and have SubagentContext, TeammateAgentContext,
 * and RootAgentContext all extend it. This ensures type safety at the
 * call site rather than optional-property checks.
 */
export interface TeammateAgentContext {
  type: "teammate"
  agentId: string
  teamName: string
  agentColor: string
  planModeRequired: boolean
  isTeamLead: boolean
  invokingRequestId?: string
}

export interface RootAgentContext {
  type: "root"
  agentId?: undefined
  /** The session ID this root context is bound to. Used by tools that need
   *  to reference the active session (e.g., team_create for leadSessionId). */
  sessionId: string
  invokingRequestId?: string
  getAppState: () => AppState
  setAppState: (updater: (state: AppState) => AppState) => void
  setAppStateForTasks: (updater: (state: AppState) => AppState) => void
  cwd: string
  abortController: AbortController
  // biome-ignore lint/suspicious/noExplicitAny: compatibility with Session state requires any
  readFileState: Map<string, any>
  // biome-ignore lint/suspicious/noExplicitAny: compatibility with Session state requires any
  contentReplacementState?: any
}

export interface SubagentContextOverrides {
  shareSetAppState?: boolean
  shareSetResponseLength?: boolean // Not yet wired — response length sharing requires query loop integration
  shareAbortController?: boolean
  isFork?: boolean
  parentSystemPrompt?: string
  cacheSafeParams?: CacheSafeParams
  criticalSystemReminder?: string
  userContext?: Record<string, unknown>
  systemContext?: Record<string, unknown>
  mcpClients?: Array<{ name: string; client: MCP.MCPClient; config: Config.Mcp }>
  execController?: ExecController
  cwd?: string
  contentReplacementState?: Record<string, unknown>
}

export const AgentExecutionContext = new AsyncLocalStorage<AgentContext>()

export function runWithAgentContext<T>(context: AgentContext, fn: () => T): T {
  return AgentExecutionContext.run(context, fn)
}

export function consumeInvokingRequestId(): string | undefined {
  const ctx = AgentExecutionContext.getStore()
  if (!ctx) return undefined
  const reqId = ctx.invokingRequestId
  ctx.invokingRequestId = undefined
  return reqId
}

export function isRootAgent(): boolean {
  const ctx = AgentExecutionContext.getStore()
  return !ctx || ctx.agentId === undefined
}

export function createSubagentContext(
  parent: ParentContext,
  agent: Agent.Info,
  agentId: string,
  overrides?: SubagentContextOverrides,
): SubagentContext {
  const abortController = overrides?.shareAbortController ? parent.abortController : new AbortController()

  if (!overrides?.shareAbortController) {
    const parentSignal = parent.abortController.signal
    const onAbort = () => abortController.abort(parentSignal.reason)
    if (parentSignal.aborted) {
      abortController.abort(parentSignal.reason)
    } else {
      parentSignal.addEventListener("abort", onAbort, { once: true })
    }
  }

  // Implement deep isolation unless shareSetAppState is explicitly true
  // biome-ignore lint/suspicious/noExplicitAny: generic application state
  let independentState: any
  if (!overrides?.shareSetAppState) {
    const parentState = parent.getAppState?.() || {}
    independentState =
      typeof structuredClone === "function" ? structuredClone(parentState) : JSON.parse(JSON.stringify(parentState))

    if (agent.background) {
      independentState.shouldAvoidPermissionPrompts = true
    }
  }

  const getAppState = () => {
    if (overrides?.shareSetAppState) {
      const state = parent.getAppState?.() || {}
      if (agent.background) {
        return { ...state, shouldAvoidPermissionPrompts: true }
      }
      return state
    }
    return independentState
  }

  const setAppState = overrides?.shareSetAppState
    ? parent.setAppState
    : // biome-ignore lint/suspicious/noExplicitAny: generic app state
      (arg: any) => {
        if (typeof arg === "function") {
          const temp = arg(independentState)
          independentState = temp === undefined ? independentState : temp
        } else {
          independentState = { ...independentState, ...arg }
        }
      }

  // Task registration/kill must always reach the root store, even when
  // setAppState is a no-op — otherwise background tasks are never
  // registered and never killed (PPID=1 zombie).
  const setAppStateForTasks = parent.setAppStateForTasks ?? parent.setAppState

  // Clone contentReplacementState for cache stability (FR-004) or use override
  // biome-ignore lint/suspicious/noExplicitAny: generic content replacement state
  let contentReplacementState: any
  if (overrides?.contentReplacementState) {
    contentReplacementState = overrides.contentReplacementState
  } else if (parent.contentReplacementState) {
    contentReplacementState =
      typeof structuredClone === "function"
        ? structuredClone(parent.contentReplacementState)
        : JSON.parse(JSON.stringify(parent.contentReplacementState))
  }

  return {
    type: "subagent",
    agentId,
    agentType: agent.name || "unknown",
    isFork: overrides?.isFork ?? false,
    parentSystemPrompt: overrides?.parentSystemPrompt,
    cacheSafeParams: overrides?.cacheSafeParams,
    parentSessionId: parent.sessionId,
    isBuiltIn: agent.native === true,
    invocationKind: "spawn",
    queryTracking: {
      depth: (parent.queryTracking?.depth ?? 0) + 1,
    },
    abortController,
    readFileState: new Map(parent.readFileState), // shallow clone
    contentReplacementState,
    thinkingConfig: agent.thinking
      ? {
          ...(parent.thinkingConfig || {}),
          enabled: true,
          ...(agent.thinkingBudget !== undefined ? { budget: agent.thinkingBudget } : {}),
        }
      : undefined,
    getAppState,
    setAppState,
    setAppStateForTasks,
    cwd: overrides?.cwd ?? parent.cwd ?? process.cwd(),
    effort: agent.effort,
    criticalSystemReminder: overrides?.criticalSystemReminder,
    mcpClients: overrides?.mcpClients,
    execController: overrides?.execController,
  }
}
```

**M-1:** Added Phase 2/3 roadmap documentation to `TeammateAgentContext` — explains what capabilities must be added and recommends the `BaseExecutableContext` extraction pattern.

**H-4 (partial):** Added `sessionId: string` field to `RootAgentContext` so tools can reference the actual session ID rather than generating random ULIDs.

---

### [team_create.ts](file:///d:/liteai/packages/core/src/tool/team_create.ts) — H-1, H-2, H-4, M-5

```diff:team_create.ts
import z from "zod"
import { AgentExecutionContext, type AppState } from "../agent/context"
import { type TeamFile, writeTeamFile } from "../coordinator/team-helpers"
import { SessionID } from "../session/schema"
import { Tool } from "./tool"

const parameters = z.object({
  team_name: z.string().describe("Name for the new team to create"),
  description: z.string().optional().describe("Team description/purpose"),
  agent_type: z.string().optional().describe("Type/role of the team lead (e.g., 'researcher', 'coordinator')"),
})

export const TeamCreateTool = Tool.define("team_create", {
  description: `Create a new team for coordinating multiple agents.
- Takes a team_name parameter identifying the team
- Sets up team directories and context
- Use this when starting a multi-agent swarm task`,
  parameters,
  // _ctx is required by the Tool.execute signature but unused here
  async execute(params, _ctx) {
    const agentCtx = AgentExecutionContext.getStore()
    if (!agentCtx) throw new Error("No agent context found")
    if (agentCtx.type === "teammate") throw new Error("Teammates cannot create teams")

    const getAppState = agentCtx.getAppState
    const setAppState = agentCtx.setAppStateForTasks ?? agentCtx.setAppState

    const appState = getAppState()

    if (appState.teamContext) {
      return {
        title: "Team already active",
        metadata: { success: false },
        output: `Cannot create team: already in team "${appState.teamContext.teamName}"`,
      }
    }

    const teamName = params.team_name

    // In Phase 1 we only have session-scoped background agents, not
    // dedicated swarm teammates, so the leadAgentId is just a placeholder
    const leadAgentId = "team-lead"
    const leadSessionId = agentCtx?.type === "subagent" ? agentCtx.parentSessionId : SessionID.descending()

    const teamFile: TeamFile = {
      name: teamName,
      description: params.description,
      createdAt: Date.now(),
      leadAgentId,
      leadSessionId,
      members: [
        {
          agentId: leadAgentId,
          name: leadAgentId,
          agentType: params.agent_type ?? "coordinator",
          joinedAt: Date.now(),
          cwd: agentCtx?.type === "subagent" ? agentCtx.cwd : process.cwd(),
          isActive: true,
        },
      ],
    }

    const teamFilePath = await writeTeamFile(teamName, teamFile)

    setAppState((state: AppState) => ({
      ...state,
      teamContext: {
        teamName,
        teamFilePath,
        leadAgentId,
        teammates: {
          [leadAgentId]: {
            name: leadAgentId,
            agentType: params.agent_type ?? "coordinator",
            color: "blue",
            spawnedAt: Date.now(),
            cwd: teamFile.members[0].cwd,
          },
        },
      },
    }))

    return {
      title: `Created team ${teamName}`,
      metadata: { success: true, team_name: teamName } as Record<string, unknown>,
      output: `Successfully created team: ${teamName} at ${teamFilePath}`,
    }
  },
})
===
import z from "zod"
import { AgentExecutionContext, type AppState } from "../agent/context"
import { type TeamFile, readTeamFile, sanitizeTeamName, writeTeamFile } from "../coordinator/team-helpers"
import { Tool } from "./tool"

const parameters = z.object({
  team_name: z.string().describe("Name for the new team to create"),
  description: z.string().optional().describe("Team description/purpose"),
  agent_type: z.string().optional().describe("Type/role of the team lead (e.g., 'researcher', 'coordinator')"),
})

export const TeamCreateTool = Tool.define("team_create", {
  description: `Create a new team for coordinating multiple agents.
- Takes a team_name parameter identifying the team
- Sets up team directories and context
- Use this when starting a multi-agent swarm task`,
  parameters,
  async execute(params, ctx) {
    const agentCtx = AgentExecutionContext.getStore()
    if (!agentCtx) throw new Error("No agent context found")
    if (agentCtx.type === "teammate") throw new Error("Teammates cannot create teams")

    // H-1: Input validation — reject empty or whitespace-only team names
    const rawName = params.team_name.trim()
    if (rawName.length === 0) {
      throw new Error("team_name is required and must not be empty")
    }
    const sanitized = sanitizeTeamName(rawName)
    if (sanitized.length === 0) {
      throw new Error(`team_name "${params.team_name}" sanitizes to an empty string — use alphanumeric characters`)
    }

    const getAppState = agentCtx.getAppState
    const setAppState = agentCtx.setAppStateForTasks ?? agentCtx.setAppState

    const appState = getAppState()

    // M-5: Throw for invariant violation — coordinator can only lead one team
    if (appState.teamContext) {
      throw new Error(
        `Already leading team "${appState.teamContext.teamName}". A leader can only manage one team at a time. Use team_delete to end the current team before creating a new one.`,
      )
    }

    // H-2: Team name collision detection — check if team already exists on disk
    let teamName = rawName
    const existingTeam = await readTeamFile(teamName)
    if (existingTeam) {
      // Generate a unique name by appending a timestamp suffix
      teamName = `${rawName}-${Date.now().toString(36)}`
    }

    const leadAgentId = "team-lead"
    // H-4: Use the actual session ID from the tool execution context or root agent context
    const leadSessionId =
      agentCtx.type === "subagent"
        ? agentCtx.parentSessionId
        : agentCtx.type === "root"
          ? agentCtx.sessionId
          : ctx.sessionID

    const teamFile: TeamFile = {
      name: teamName,
      description: params.description,
      createdAt: Date.now(),
      leadAgentId,
      leadSessionId,
      members: [
        {
          agentId: leadAgentId,
          name: leadAgentId,
          agentType: params.agent_type ?? "coordinator",
          joinedAt: Date.now(),
          cwd: agentCtx.cwd,
          isActive: true,
        },
      ],
    }

    const teamFilePath = await writeTeamFile(teamName, teamFile)

    setAppState((state: AppState) => ({
      ...state,
      teamContext: {
        teamName,
        teamFilePath,
        leadAgentId,
        teammates: {
          [leadAgentId]: {
            name: leadAgentId,
            agentType: params.agent_type ?? "coordinator",
            color: "blue",
            spawnedAt: Date.now(),
            cwd: teamFile.members[0].cwd,
          },
        },
      },
    }))

    return {
      title: `Created team ${teamName}`,
      metadata: { success: true, team_name: teamName } as Record<string, unknown>,
      output: `Successfully created team: ${teamName} at ${teamFilePath}`,
    }
  },
})

```

**H-1: Input validation** — rejects empty and whitespace-only `team_name`, also validates the sanitized name isn't empty.

**H-2: Collision detection** — checks disk for existing team files before creating, appends timestamp suffix on collision.

**H-4: Correct leadSessionId** — uses `agentCtx.sessionId` from the root context instead of `SessionID.descending()`.

**M-5: Throws for invariant violation** — `throw new Error(...)` when team already active, instead of returning `success: false`.

---

### [team_delete.ts](file:///d:/liteai/packages/core/src/tool/team_delete.ts) — M-5, C-2

```diff:team_delete.ts
import fs from "node:fs/promises"
import path from "node:path"
import { Log } from "@liteai/util/log"
import z from "zod"
import { AgentExecutionContext, type AppState } from "../agent/context"
import { Tool } from "./tool"

const log = Log.create({ service: "tool.team_delete" })

const parameters = z.object({})

export const TeamDeleteTool = Tool.define("team_delete", {
  description: `Clean up team and task directories when the swarm work is complete.

This operation:
- Removes the team directory (~/.liteai/teams/{team-name}/)
- Clears team context from the current session

IMPORTANT: TeamDelete will fail if the team still has active members.
Gracefully terminate teammates first, then call TeamDelete.`,
  parameters,
  // _params and _ctx are required by the Tool.execute signature but unused here
  async execute(_params, _ctx) {
    const agentCtx = AgentExecutionContext.getStore()
    if (!agentCtx) throw new Error("No agent context found")
    if (agentCtx.type === "teammate") throw new Error("Teammates cannot delete teams")
    const getAppState = agentCtx.getAppState
    const setAppState = agentCtx.setAppStateForTasks ?? agentCtx.setAppState

    const appState = getAppState()
    const teamName = appState.teamContext?.teamName

    if (!teamName) {
      return {
        title: "No team active",
        metadata: { success: false } as Record<string, unknown>,
        output: "No team name found in current session context. Nothing to clean up.",
      }
    }

    // Check for active members
    const teammates = appState.teamContext?.teammates ?? {}
    const activeMembers = Object.entries(teammates).filter(([_id, t]) => t.name !== "team-lead")

    // In Phase 1, we don't have in-process teammates yet, so we
    // check AppState.tasks for any running tasks belonging to team members
    const tasks = appState.tasks ?? {}
    const runningTeamTasks = activeMembers.filter(([id]) => tasks[id]?.status === "running")

    if (runningTeamTasks.length > 0) {
      const memberNames = runningTeamTasks.map(([_, t]) => t.name).join(", ")
      return {
        title: "Team has active members",
        metadata: { success: false, team_name: teamName } as Record<string, unknown>,
        output: `Cannot cleanup team with ${runningTeamTasks.length} active member(s): ${memberNames}. Send shutdown requests to teammates first.`,
      }
    }

    // Clean up team directory
    const teamFilePath = appState.teamContext?.teamFilePath
    if (teamFilePath) {
      try {
        const teamDir = path.dirname(teamFilePath)
        await fs.rm(teamDir, { recursive: true, force: true })
        log.info("cleaned up team directory", { teamName, teamDir })
      } catch (e) {
        log.warn("failed to clean up team directory", { teamName, error: e })
      }
    }

    // Clear team context from AppState
    setAppState((state: AppState) => {
      const { teamContext: _, ...rest } = state
      return rest
    })

    return {
      title: `Deleted team ${teamName}`,
      metadata: { success: true, team_name: teamName } as Record<string, unknown>,
      output: `Cleaned up directories for team "${teamName}"`,
    }
  },
})
===
import { Log } from "@liteai/util/log"
import z from "zod"
import { AgentExecutionContext, type AppState } from "../agent/context"
import { cleanupTeamDirectories } from "../coordinator/team-helpers"
import { Tool } from "./tool"

const log = Log.create({ service: "tool.team_delete" })

const parameters = z.object({})

export const TeamDeleteTool = Tool.define("team_delete", {
  description: `Clean up team and task directories when the swarm work is complete.

This operation:
- Removes the team directory (~/.liteai/teams/{team-name}/)
- Clears team context from the current session

IMPORTANT: TeamDelete will fail if the team still has active members.
Gracefully terminate teammates first, then call TeamDelete.`,
  parameters,
  // _params and _ctx are required by the Tool.execute signature but unused here
  async execute(_params, _ctx) {
    const agentCtx = AgentExecutionContext.getStore()
    if (!agentCtx) throw new Error("No agent context found")
    if (agentCtx.type === "teammate") throw new Error("Teammates cannot delete teams")
    const getAppState = agentCtx.getAppState
    const setAppState = agentCtx.setAppStateForTasks ?? agentCtx.setAppState

    const appState = getAppState()
    const teamName = appState.teamContext?.teamName

    if (!teamName) {
      return {
        title: "No team active",
        metadata: { success: false } as Record<string, unknown>,
        output: "No team name found in current session context. Nothing to clean up.",
      }
    }

    // Check for active members — M-5: throw for invariant violation
    const teammates = appState.teamContext?.teammates ?? {}
    const activeMembers = Object.entries(teammates).filter(([_id, t]) => t.name !== "team-lead")

    // In Phase 1, we don't have in-process teammates yet, so we
    // check AppState.tasks for any running tasks belonging to team members
    const tasks = appState.tasks ?? {}
    const runningTeamTasks = activeMembers.filter(([id]) => tasks[id]?.status === "running")

    if (runningTeamTasks.length > 0) {
      const memberNames = runningTeamTasks.map(([_, t]) => t.name).join(", ")
      throw new Error(
        `Cannot cleanup team "${teamName}" with ${runningTeamTasks.length} active member(s): ${memberNames}. Send shutdown requests to teammates first.`,
      )
    }

    // Clean up team directory using the shared helper (also used by loop.ts cleanup)
    await cleanupTeamDirectories(teamName)
    log.info("cleaned up team directory", { teamName })

    // Clear team context from AppState
    setAppState((state: AppState) => {
      const { teamContext: _, ...rest } = state
      return rest
    })

    return {
      title: `Deleted team ${teamName}`,
      metadata: { success: true, team_name: teamName } as Record<string, unknown>,
      output: `Cleaned up directories for team "${teamName}"`,
    }
  },
})
```

**M-5:** Throws for active members instead of soft return.

**C-2:** Uses `cleanupTeamDirectories()` shared helper instead of inline `fs.rm`.

---

### [task_stop.ts](file:///d:/liteai/packages/core/src/tool/task_stop.ts) — H-1, H-3

```diff:task_stop.ts
import z from "zod"
import { AgentExecutionContext, type AppState } from "../agent/context"
import { SessionPrompt } from "../session/engine"
import type { SessionID } from "../session/schema"
import { Tool } from "./tool"

const parameters = z.object({
  task_id: z.string().describe("The ID of the background task to stop"),
})

export const TaskStopTool = Tool.define("task_stop", {
  description: `Stop a running background task by its ID.
- Takes a task_id parameter identifying the task to stop
- Returns a success or failure status
- Use this tool when you need to terminate a long-running task`,
  parameters,
  // _ctx is required by the Tool.execute signature but unused here
  async execute(params, _ctx) {
    const agentCtx = AgentExecutionContext.getStore()
    if (!agentCtx) throw new Error("No agent context found")
    if (agentCtx.type === "teammate") throw new Error("Teammates cannot stop tasks")
    const getAppState = agentCtx.getAppState
    const setAppState = agentCtx.setAppStateForTasks ?? agentCtx.setAppState

    const appState = getAppState()
    const task = appState.tasks?.[params.task_id]

    if (!task) {
      return {
        title: "Task not found",
        metadata: { success: false } as Record<string, unknown>,
        output: `No task found with ID: ${params.task_id}`,
      }
    }

    if (task.status !== "running") {
      return {
        title: "Task not running",
        metadata: { success: false } as Record<string, unknown>,
        output: `Task ${params.task_id} is not running (status: ${task.status})`,
      }
    }

    // Cancel the task's session execution
    SessionPrompt.cancel(params.task_id as SessionID)

    // Update task status in root AppState
    setAppState((state: AppState) => ({
      ...state,
      tasks: {
        ...state.tasks,
        [params.task_id]: {
          ...state.tasks?.[params.task_id],
          status: "stopped",
        },
      },
    }))

    return {
      title: `Stopped task ${params.task_id}`,
      metadata: { success: true, task_id: params.task_id } as Record<string, unknown>,
      output: `Successfully stopped task: ${params.task_id}`,
    }
  },
})
===
import z from "zod"
import { AgentExecutionContext, type AppState } from "../agent/context"
import { SessionPrompt } from "../session/engine"
import { SessionID } from "../session/schema"
import { Tool } from "./tool"

const parameters = z.object({
  task_id: z.string().describe("The ID of the background task to stop"),
})

export const TaskStopTool = Tool.define("task_stop", {
  description: `Stop a running background task by its ID.
- Takes a task_id parameter identifying the task to stop
- Returns a success or failure status
- Use this tool when you need to terminate a long-running task`,
  parameters,
  // _ctx is required by the Tool.execute signature but unused here
  async execute(params, _ctx) {
    const agentCtx = AgentExecutionContext.getStore()
    if (!agentCtx) throw new Error("No agent context found")
    if (agentCtx.type === "teammate") throw new Error("Teammates cannot stop tasks")

    // H-1: Input validation — reject empty task_id
    const rawId = params.task_id.trim()
    if (rawId.length === 0) {
      throw new Error("task_id is required and must not be empty")
    }

    // H-3: Validate task_id format before casting to SessionID
    const parseResult = SessionID.zod.safeParse(rawId)
    if (!parseResult.success) {
      throw new Error(`Invalid task_id format: "${rawId}" is not a valid session ID`)
    }
    const taskSessionId = parseResult.data

    const getAppState = agentCtx.getAppState
    const setAppState = agentCtx.setAppStateForTasks ?? agentCtx.setAppState

    const appState = getAppState()
    const task = appState.tasks?.[rawId]

    if (!task) {
      return {
        title: "Task not found",
        metadata: { success: false } as Record<string, unknown>,
        output: `No task found with ID: ${rawId}`,
      }
    }

    if (task.status !== "running") {
      return {
        title: "Task not running",
        metadata: { success: false } as Record<string, unknown>,
        output: `Task ${rawId} is not running (status: ${task.status})`,
      }
    }

    // Cancel the task's session execution — uses validated SessionID
    SessionPrompt.cancel(taskSessionId)

    // Update task status in root AppState
    setAppState((state: AppState) => ({
      ...state,
      tasks: {
        ...state.tasks,
        [rawId]: {
          ...state.tasks?.[rawId],
          status: "stopped",
        },
      },
    }))

    return {
      title: `Stopped task ${rawId}`,
      metadata: { success: true, task_id: rawId } as Record<string, unknown>,
      output: `Successfully stopped task: ${rawId}`,
    }
  },
})
```

**H-1:** Validates empty `task_id`.

**H-3:** Uses `SessionID.zod.safeParse()` to validate format before casting — throws structured error for invalid IDs.

---

### [swarm-tools.test.ts](file:///d:/liteai/packages/core/test/coordinator/swarm-tools.test.ts) — M-2 (NEW)

New integration test suite covering 9 test cases:

| Test | Issue | Status |
|---|---|---|
| TeamCreateTool: rejects empty team_name | H-1 | ✅ |
| TeamCreateTool: rejects whitespace-only team_name | H-1 | ✅ |
| TeamCreateTool: throws when team already active | M-5 | ✅ |
| TeamCreateTool: uses sessionId from root context | H-4 | ✅ |
| TeamCreateTool: creates team and updates AppState | Integration | ✅ |
| TeamDeleteTool: returns output for no team active | Edge case | ✅ |
| TeamDeleteTool: throws when team has running members | M-5 | ✅ |
| TaskStopTool: rejects empty task_id | H-1 | ✅ |
| TaskStopTool: rejects invalid task_id format | H-3 | ✅ |

> [!NOTE]
> Constitution §9 compliance: TeamCreate mock.module includes ALL team-helpers exports to prevent cross-test module cache pollution. TeamDelete tests avoid mock.module entirely for the same reason.

---

## Verification

```
$ bun typecheck        → 0 errors
$ bun lint:fix         → clean (no warnings)
$ bun test test/coordinator
  19 pass, 0 fail, 35 expect() calls
  Ran 19 tests across 2 files [2.22s]
```
