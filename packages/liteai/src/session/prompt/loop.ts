import { NamedError } from "@liteai/util/error"
import { ulid } from "ulid"
import z from "zod"
import { PermissionNext } from "@/permission/next"
import { TaskTool } from "@/tool/task"
import type { Tool } from "@/tool/tool"
import { Trace } from "@/trace/trace"
import { fn } from "@/util/fn"
import { Agent } from "../../agent/agent"
import { Bus } from "../../bus"
import { Hook } from "../../hook"
import { Plugin } from "../../plugin"
import { Instance } from "../../project/instance"
import { Provider } from "../../provider/provider"
import { ModelID, ProviderID } from "../../provider/schema"
import { defer } from "../../util/defer"
import { Log } from "../../util/log"
import { Session } from ".."
import { SessionCompaction } from "../compaction"
import { InstructionPrompt } from "../instruction"
import { Message } from "../message"
import { SessionProcessor } from "../processor"
import { SessionRevert } from "../revert"
import { MessageID, PartID, SessionID } from "../schema"
import { SessionStatus } from "../status"
import { SessionSummary } from "../summary"
import { SystemPrompt } from "../system"
import MAX_STEPS from "./max-steps.txt"
import { createUserMessage } from "./message"
import { insertReminders } from "./reminders"
import { ensureTitle } from "./title"
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

  return loop({ sessionID: input.sessionID })
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
  delete s[sessionID]
  SessionStatus.set(sessionID, { type: "idle" })
  return
}

export async function lastModel(sessionID: SessionID) {
  for await (const item of Message.stream(sessionID)) {
    if (item.info.role === "user" && item.info.model) return item.info.model
  }
  const result = await Provider.defaultModel()
  if (!result) throw new Error("no model available: connect a provider first")
  return result
}

export const LoopInput = z.object({
  sessionID: SessionID.zod,
  resume_existing: z.boolean().optional(),
})
export const loop = fn(LoopInput, async (input) => {
  const { sessionID, resume_existing } = input

  const abort = resume_existing ? resume(sessionID) : start(sessionID)
  if (!abort) {
    return new Promise<Message.WithParts>((resolve, reject) => {
      const callbacks = state()[sessionID].callbacks
      callbacks.push({ resolve, reject })
    })
  }

  using _ = defer(() => cancel(sessionID))

  // Structured output state
  // Note: On session resumption, state is reset but outputFormat is preserved
  // on the user message and will be retrieved from lastUser below
  let structuredOutput: unknown | undefined

  let step = 0
  const session = await Session.get(sessionID)
  while (true) {
    SessionStatus.set(sessionID, { type: "busy" })
    log.info("loop", { step, sessionID })
    if (abort.aborted) {
      log.info("loop exiting: abort signal already set", { sessionID, step })
      break
    }
    let msgs = await Message.filterCompacted(Message.stream(sessionID))

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
    if (
      lastAssistant?.finish &&
      !["tool-calls", "unknown"].includes(lastAssistant.finish) &&
      lastUser.id < lastAssistant.id
    ) {
      log.info("loop exiting: model finished", { sessionID, finish: lastAssistant.finish })
      break
    }

    step++
    if (step === 1)
      ensureTitle({
        session,
        modelID: lastUser.model.modelID,
        providerID: lastUser.model.providerID,
        history: msgs,
      }).catch((e) => log.error("ensureTitle failed", { error: e }))

    const model = await Provider.getModel(lastUser.model.providerID, lastUser.model.modelID).catch((e) => {
      log.error("model resolution failed", {
        providerID: lastUser.model.providerID,
        modelID: lastUser.model.modelID,
        error: e,
      })
      if (Provider.ModelNotFoundError.isInstance(e)) {
        const hint = e.data.suggestions?.length ? ` Did you mean: ${e.data.suggestions.join(", ")}?` : ""
        Bus.publish(Session.Event.Error, {
          sessionID,
          error: new NamedError.Unknown({
            message: `Model not found: ${e.data.providerID}/${e.data.modelID}.${hint}`,
          }).toObject(),
        })
      }
      throw e
    })
    const task = tasks.pop()

    // pending subtask
    // TODO: centralize "invoke tool" logic
    if (task?.type === "subtask") {
      await processSubtask({ task, model, lastUser, sessionID, session, abort, msgs })
      continue
    }

    // pending compaction
    if (task?.type === "compaction") {
      const result = await SessionCompaction.process({
        messages: msgs,
        parentID: lastUser.id,
        abort,
        sessionID,
        auto: task.auto,
        overflow: task.overflow,
      })
      if (result === "stop") break
      continue
    }

    // context overflow, needs compaction
    if (
      lastFinished &&
      lastFinished.summary !== true &&
      (await SessionCompaction.isOverflow({ tokens: lastFinished.tokens, model }))
    ) {
      await SessionCompaction.create({
        sessionID,
        agent: lastUser.agent,
        model: lastUser.model,
        auto: true,
      })
      continue
    }

    // normal processing
    const agent = await Agent.get(lastUser.agent)
    const maxSteps = agent.steps ?? Infinity
    const isLastStep = step >= maxSteps
    if (step === 1) {
      const text = msgs
        .findLast((m) => m.info.role === "user")
        ?.parts.filter((p) => p.type === "text")
        .map((p) => p.text)
        .join(" ")
      log.info("user", {
        sessionID,
        agent: agent.name,
        model: `${lastUser.model.providerID}/${lastUser.model.modelID}`,
        temperature: agent.temperature,
        text: text?.slice(0, 200),
      })
    }
    msgs = await insertReminders({
      messages: msgs,
      agent,
      session,
    })

    const processor = SessionProcessor.create({
      assistantMessage: (await Session.updateMessage({
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
        modelID: model.id,
        providerID: model.providerID,
        time: {
          created: Date.now(),
        },
        sessionID,
      })) as Message.Assistant,
      sessionID: sessionID,
      model,
      abort,
    })
    using __ = defer(() => InstructionPrompt.clear(processor.message.id))

    // Check if user explicitly invoked an agent via @ in this turn
    const lastUserMsg = msgs.findLast((m) => m.info.role === "user")
    const bypassAgentCheck = lastUserMsg?.parts.some((p) => p.type === "agent") ?? false

    const tools = await resolveTools({
      agent,
      session,
      model,
      processor,
      bypassAgentCheck,
      messages: msgs,
    })

    // Inject StructuredOutput tool if JSON schema mode enabled
    if (lastUser.format?.type === "json_schema") {
      tools.StructuredOutput = createStructuredOutputTool({
        schema: lastUser.format.schema,
        onSuccess(output) {
          structuredOutput = output
        },
      })
    }

    if (step === 1) {
      SessionSummary.summarize({
        sessionID: sessionID,
        messageID: lastUser.id,
      })
    }

    // Ephemerally wrap queued user messages with a reminder to stay on track
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

    await Plugin.trigger("experimental.chat.messages.transform", {}, { messages: msgs })

    // Build system prompt, adding structured output instruction if needed
    // Note: the provider/agent prompt is prepended by LLM.stream() and captured
    // in resolvedSystem for trace recording
    const skills = await SystemPrompt.skills(agent)
    const system = [
      ...(await SystemPrompt.environment(model)),
      ...(skills ? [skills] : []),
      ...(await InstructionPrompt.system()),
    ]
    const format = lastUser.format ?? { type: "text" }
    if (format.type === "json_schema") {
      system.push(STRUCTURED_OUTPUT_SYSTEM_PROMPT)
    }

    const traceStart = Date.now()
    const result = await processor.process({
      user: lastUser,
      agent,
      abort,
      sessionID,
      system,
      messages: [
        ...Message.toModelMessages(msgs, model),
        ...(isLastStep
          ? [
              {
                role: "assistant" as const,
                content: MAX_STEPS,
              },
            ]
          : []),
      ],
      tools,
      model,
      toolChoice: format.type === "json_schema" ? "required" : undefined,
    })
    const traceEnd = Date.now()

    // Trace capture (after LLM call) — always record traces
    Trace.record({
      sessionID,
      messageID: processor.message.id,
      agent: agent.name,
      model: { id: model.id, providerID: model.providerID },
      params: agent.temperature !== undefined ? { temperature: agent.temperature } : undefined,
      system: (processor.resolvedSystem ?? system).join("\n\n"),
      tools: Object.entries(tools)
        .filter(([name]) => name !== "invalid")
        .map(([name, t]) => ({
          name,
          description: (t as { description?: string }).description,
          parameters: (t as { parameters?: unknown }).parameters,
        })),
      contextIDs: msgs.map((m) => m.info.id),
      hooks: Trace.flushHooks(sessionID) ?? undefined,
      timeStart: traceStart,
      timeEnd: traceEnd,
      error: processor.message.error ? JSON.stringify(processor.message.error) : undefined,
    })

    // If structured output was captured, save it and exit immediately
    // This takes priority because the StructuredOutput tool was called successfully
    if (structuredOutput !== undefined) {
      processor.message.structured = structuredOutput
      processor.message.finish = processor.message.finish ?? "stop"
      await Session.updateMessage(processor.message)
      log.info("loop exiting: structured output captured", { sessionID })
      break
    }

    // Check if model finished (finish reason is not "tool-calls" or "unknown")
    const modelFinished = processor.message.finish && !["tool-calls", "unknown"].includes(processor.message.finish)

    if (modelFinished && !processor.message.error) {
      if (format.type === "json_schema") {
        // Model stopped without calling StructuredOutput tool
        processor.message.error = new Message.StructuredOutputError({
          message: "Model did not produce structured output",
          retries: 0,
        }).toObject()
        await Session.updateMessage(processor.message)
        log.info("loop exiting: structured output error", { sessionID })
        break
      }
    }

    if (result === "stop") {
      log.info("loop exiting: processor returned stop", {
        sessionID,
        error: processor.message.error,
        finish: processor.message.finish,
      })
      break
    }
    if (result === "compact") {
      await SessionCompaction.create({
        sessionID,
        agent: lastUser.agent,
        model: lastUser.model,
        auto: true,
        overflow: !processor.message.finish,
      })
    }
  }
  // Dispatch Stop hook after the loop finishes
  await Hook.dispatch("Stop", {
    session_id: sessionID,
    cwd: Instance.directory,
    hook_event_name: "Stop",
  })
  SessionCompaction.prune({ sessionID })
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
  const traceStart = Date.now()
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

  // Record trace span for sub-agent invocation
  Trace.record({
    sessionID,
    messageID: assistantMessage.id,
    agent: task.agent,
    model: { id: taskModel.id, providerID: taskModel.providerID },
    contextIDs: msgs.map((m) => m.info.id),
    hooks: Trace.flushHooks(sessionID) ?? undefined,
    timeStart: traceStart,
    timeEnd: Date.now(),
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
