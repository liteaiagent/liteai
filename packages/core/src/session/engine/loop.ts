import { NamedError } from "@liteai/util/error"
import { ulid } from "ulid"
import z from "zod"
import { PermissionNext } from "@/permission/next"
import { TaskTool } from "@/tool/task"
import type { Tool } from "@/tool/tool"

import { fn } from "@/util/fn"
import { Agent } from "../../agent/agent"
import { Bundled } from "../../bundled"
import { Bus } from "../../bus"
import { Hook } from "../../hook"
import { Plugin } from "../../plugin"
import { Instance } from "../../project/instance"
import { Provider } from "../../provider/provider"
import { ModelID, ProviderID } from "../../provider/schema"
import {
  endInteractionSpan,
  endLLMRequestSpan,
  startInteractionSpan,
  startLLMRequestSpan,
} from "../../telemetry/tracing"
import { defer } from "../../util/defer"
import { Log } from "../../util/log"
import { Session } from ".."
import type { EngineEvent } from "../events"
import { Message } from "../message"
import { SessionProcessor } from "../processor"
import { SessionRevert } from "../revert"
import { MessageID, PartID, SessionID } from "../schema"
import { SessionStatus } from "../status"
import { SessionCompaction } from "../tasks/compaction"
import { SessionSummary } from "../tasks/summary"
import { ensureTitle } from "../tasks/title"
import { createUserMessage } from "./input"
import { InstructionPrompt } from "./instruction"
import { EventPersister } from "./persister"
import { type AutocompactState, createAutocompactState, executePipeline, shouldAutocompact } from "./pipeline"
import { insertPlanReminder } from "./plan-reminder"
import { queryLoop } from "./query"
import { SystemPrompt } from "./system"
import { createStructuredOutputTool, resolveTools, STRUCTURED_OUTPUT_SYSTEM_PROMPT } from "./tools"

globalThis.AI_SDK_LOG_WARNINGS = false

const log = Log.create({ service: "session.prompt" })

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
      item.abort.abort()
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

  const textPart = input.parts.find((p) => p.type === "text")
  const userText = textPart && "text" in textPart ? textPart.text : "Input"
  startInteractionSpan(userText)

  try {
    return await loop({ sessionID: input.sessionID })
  } finally {
    endInteractionSpan()
  }
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
  match.abort.abort()
}

/**
 * Cleans up session state after the processor has finished flushing.
 * Called by the deferred cleanup in loop(), NOT by the cancel API.
 */
function cleanup(sessionID: SessionID) {
  log.info("cleanup", { sessionID })
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
}) {
  const { sessionID, session, abort } = input

  let persister: EventPersister | undefined
  let currentModel: Provider.Model | undefined
  let currentAssistantMessage: Message.Assistant | undefined
  let currentStreamResult: unknown
  let turnAction: string | undefined

  const generator = queryLoop({
    sessionID,
    session,
    abort,
  })

  for await (const event of generator) {
    switch (event.type) {
      // ── Turn Start: persist assistant message, create persister ──
      case "turn-start": {
        // Persist the assistant message to DB
        currentAssistantMessage = (await Session.updateMessage(
          event.assistantMessage,
        )) as Message.Assistant
        currentModel = event.model
        turnAction = undefined

        // Create fresh persister for this turn
        persister = new EventPersister(
          currentAssistantMessage,
          sessionID,
          event.model,
          abort,
        )

        // Set up instruction prompt cleanup
        // Note: InstructionPrompt.clear will be called in turn-end
        SessionStatus.set(sessionID, { type: "busy" })

        // Fire-and-forget summary on first turn
        const lastUser = event.streamInput.user
        if (lastUser) {
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

        // Flush the persister
        const flushResult = await persister.flush(currentStreamResult)
        currentStreamResult = undefined

        // Handle structured output
        if (event.structuredOutput !== undefined) {
          currentAssistantMessage.structured = event.structuredOutput
          currentAssistantMessage.finish = currentAssistantMessage.finish ?? "stop"
          await Session.updateMessage(currentAssistantMessage)
          log.info("runSession: structured output captured", { sessionID })
          // Don't call .next() — let the generator break naturally
          break
        }

        // Handle structured output error (model finished without calling tool)
        const modelFinished =
          currentAssistantMessage.finish &&
          !["tool-calls", "unknown"].includes(currentAssistantMessage.finish)
        if (modelFinished && !currentAssistantMessage.error) {
          const lastUser = await findLastUser(sessionID)
          const format = lastUser?.format ?? { type: "text" }
          if (format.type === "json_schema") {
            currentAssistantMessage.error = new Message.StructuredOutputError({
              message: "Model did not produce structured output",
              retries: 0,
            }).toObject()
            await Session.updateMessage(currentAssistantMessage)
            log.info("runSession: structured output error", { sessionID })
          }
        }

        // Process the flush result
        turnAction = flushResult
        if (flushResult === "stop") {
          log.info("runSession: persister returned stop", {
            sessionID,
            error: currentAssistantMessage.error,
            finish: currentAssistantMessage.finish,
          })
          // Generator will break on the next iteration
          // (model finished check kicks in)
          break
        }
        if (flushResult === "compact") {
          const lastUser = await findLastUser(sessionID)
          if (lastUser) {
            await SessionCompaction.create({
              sessionID,
              agent: lastUser.agent,
              model: lastUser.model,
              auto: true,
              overflow: !currentAssistantMessage.finish,
            })
          }
          break
        }

        // Clean up instruction prompt
        await InstructionPrompt.clear(currentAssistantMessage.id)
        break
      }

      // ── Tombstone: clean up orphaned message ──
      case "tombstone": {
        log.warn("runSession: tombstone received", {
          sessionID,
          messageID: event.messageID,
          reason: event.reason,
        })
        if (persister) {
          await persister.flush(currentStreamResult)
          currentStreamResult = undefined
        }
        break
      }

      // ── Control: compaction, subtask, overflow ──
      case "control": {
        switch (event.action) {
          case "subtask": {
            const { task, model, lastUser, msgs } = event.payload
            await processSubtask({ task, model, lastUser, sessionID, session, abort, msgs })
            break
          }
          case "compaction-task": {
            const { task, lastUser, msgs } = event.payload
            const model = await Provider.getModel(lastUser.model.providerID, lastUser.model.modelID)
            const result = await SessionCompaction.process({
              messages: msgs,
              parentID: lastUser.id,
              abort,
              sessionID,
              auto: task.auto,
              overflow: task.overflow,
            })
            if (result === "stop") {
              // Signal the generator to close by returning early
              // The generator detects this via the abort signal or re-scans messages
              return
            }
            break
          }
          case "overflow": {
            const { lastUser } = event.payload
            await SessionCompaction.create({
              sessionID,
              agent: lastUser.agent,
              model: lastUser.model,
              auto: true,
            })
            break
          }
          case "compact": {
            const { lastUser } = event.payload
            await SessionCompaction.create({
              sessionID,
              agent: lastUser.agent,
              model: lastUser.model,
              auto: true,
            })
            break
          }
          case "stop": {
            return
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
        if (persister) {
          const action = await persister.handleEvent(event)
          if (action === "compact" || action === "stop") {
            turnAction = action
          }

          // Capture stream result if available via the streaming events
          // (the persister tracks this internally)
        }
        break
      }
    }
  }

  // Post-loop cleanup
  SessionCompaction.prune({ sessionID })
}

/**
 * Helper: find the last user message for a session.
 */
async function findLastUser(sessionID: SessionID): Promise<Message.User | undefined> {
  const msgs = await Message.filterCompacted(Message.stream(sessionID))
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

  using _ = defer(() => cleanup(sessionID))

  const session = await Session.get(sessionID)

  // Delegate to the event-sourced orchestrator
  await runSession({ sessionID, session, abort })

  for await (const item of Message.stream(sessionID)) {
    if (item.info.role === "user") continue
    const queued = state()[sessionID]?.callbacks ?? []
    for (const q of queued) {
      q.resolve(item)
    }
    return item
  }
  throw new Error("Impossible")
})

async function processSubtask(input: {
  task: Message.SubtaskPart
  model: Provider.Model
  lastUser: Message.User
  sessionID: SessionID
  session: Session.Info
  abort: AbortSignal
  msgs: Message.WithParts[]
}) {
  const { task, lastUser, sessionID, session, abort, msgs } = input
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
  const assistantMessage = (await Session.updateMessage({
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
  })) as Message.Assistant
  let part = (await Session.updatePart({
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
  })) as Message.ToolPart
  const taskArgs = {
    prompt: task.prompt,
    description: task.description,
    subagent_type: task.agent,
    command: task.command,
  }
  startLLMRequestSpan(`${taskModel.providerID}/${taskModel.id}`, { systemPrompt: task.prompt })
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
      part = (await Session.updatePart({
        ...part,
        type: "tool",
        state: {
          ...part.state,
          ...val,
        },
      } satisfies Message.ToolPart)) as Message.ToolPart
    },
    async ask(req) {
      await PermissionNext.ask({
        ...req,
        sessionID: sessionID,
        ruleset: PermissionNext.merge(taskAgent.permission, session.permission ?? []),
      })
    },
  }
  const result = await taskTool.execute(taskArgs, ctx).catch((error) => {
    executionError = error
    log.error("subtask execution failed", { error, agent: task.agent, description: task.description })
    return undefined
  })
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
  await Session.updateMessage(assistantMessage)
  if (result && part.state.status === "running") {
    await Session.updatePart({
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
    } satisfies Message.ToolPart)
  }
  if (!result) {
    await Session.updatePart({
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
    } satisfies Message.ToolPart)
  }

  endLLMRequestSpan(undefined, {
    success: !executionError,
    error: executionError?.message,
  })

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
    await Session.updateMessage(summaryUserMsg)
    await Session.updatePart({
      id: PartID.ascending(),
      messageID: summaryUserMsg.id,
      sessionID,
      type: "text",
      text: "Summarize the task tool output above and continue with your task.",
      synthetic: true,
    } satisfies Message.TextPart)
  }
}
