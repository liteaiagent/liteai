import z from "zod"
import { Trace } from "@/trace/trace"
import { Log } from "@/util/log"
import { command as exec } from "./command"
import { http } from "./http"
import { HookLoader } from "./loader"

const log = Log.create({ service: "hook" })

/** All supported hook events, compatible with Claude Code. */
export const Event = z.enum([
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "Notification",
  "Stop",
  "SubagentStart",
  "SubagentStop",
  "SessionStart",
  "SessionEnd",
  "UserPromptSubmit",
  "PreCompact",
  "PostCompact",
  "PermissionRequest",
  "InstructionsLoaded",
  "ConfigChange",
  "StopFailure",
  "TaskCompleted",
  "TeammateIdle",
  "WorktreeCreate",
  "WorktreeRemove",
  "Elicitation",
  "ElicitationResult",
])
export type Event = z.infer<typeof Event>

/** A single hook handler entry. */
export const Handler = z
  .object({
    type: z.enum(["command", "prompt", "agent", "http"]),
    command: z.string().optional(),
    prompt: z.string().optional(),
    url: z.string().optional(),
    headers: z.record(z.string(), z.string()).optional(),
    allowedEnvVars: z.array(z.string()).optional(),
    timeout: z.number().optional(),
    statusMessage: z.string().optional(),
    once: z.boolean().optional(),
    async: z.boolean().optional(),
  })
  .meta({ ref: "HookHandler" })
export type Handler = z.infer<typeof Handler>

/** A matcher group: a regex matcher + list of hook handlers. */
export const Group = z
  .object({
    matcher: z.string().optional(),
    hooks: z.array(Handler),
  })
  .meta({ ref: "HookGroup" })
export type Group = z.infer<typeof Group>

/** Top-level hooks config: event name → array of groups. */
export const Schema = z.record(z.string(), z.array(Group)).meta({ ref: "HooksConfig" })
export type Schema = z.infer<typeof Schema>

/** Input context passed to every hook. */
export type Input = {
  session_id?: string
  cwd: string
  hook_event_name: string
  tool_name?: string
  tool_input?: Record<string, unknown>
  tool_output?: string
  prompt?: string
  source?: string
  /** If true, a stop hook is already active — avoid infinite loops. */
  stop_hook_active?: boolean
  [key: string]: unknown
}

/** Result of executing a hook group. */
export type Result = {
  /** Whether the action should proceed (true) or is blocked (false). */
  proceed: boolean
  /** Feedback sent to the model when action is blocked. */
  feedback?: string
  /** Additional context to inject into conversation. */
  context?: string
  /** Permission decision from structured output. */
  decision?: "allow" | "deny" | "ask" | "block"
  /** Structured hookSpecificOutput if present. */
  hookOutput?: Record<string, unknown>
  /** Track invoked handlers for tracing */
  invocations?: { event: string; type: string; handler: Handler; context?: string }[]
}

/** Load hooks for a specific agent (from agent frontmatter). */
export const agentHooks = HookLoader.agentHooks

/** Check if a matcher regex matches the given value. */
function matches(matcher: string | undefined, value: string | undefined): boolean {
  if (!matcher) return true
  if (!value) return true
  try {
    return new RegExp(matcher).test(value)
  } catch {
    log.warn("invalid matcher regex", { matcher })
    return false
  }
}

/**
 * Dispatch hooks for a given event.
 *
 * Finds all matching hook groups from config, executes them in order,
 * and returns a combined result.
 *
 * @param event - The hook event name
 * @param ctx - Event context (passed as JSON to command hooks)
 * @param opts - Optional extra hooks to merge (e.g. from agent/skill frontmatter)
 */
export async function dispatch(event: string, ctx: Input, opts?: { extra?: Schema }): Promise<Result> {
  const hooks = await HookLoader.load()
  const groups = [...(hooks[event] ?? []), ...(opts?.extra?.[event] ?? [])]

  log.info("dispatch", {
    event,
    groups: groups.length,
    tool: ctx.tool_name,
    source: ctx.source,
    session: ctx.session_id,
  })

  if (groups.length === 0) {
    log.info("dispatch skip — no groups", { event })
    return { proceed: true }
  }

  const value = ctx.tool_name ?? ctx.source
  let proceed = true
  let feedback: string | undefined
  let context: string | undefined
  let decision: Result["decision"]
  let hookOutput: Record<string, unknown> | undefined
  const invocations: NonNullable<Result["invocations"]> = []

  for (const [gi, group] of groups.entries()) {
    if (!matches(group.matcher, value)) {
      log.info("dispatch group skip — matcher miss", { event, gi, matcher: group.matcher, value })
      continue
    }

    log.info("dispatch group match", { event, gi, matcher: group.matcher ?? "*", handlers: group.hooks.length })

    for (const [hi, handler] of group.hooks.entries()) {
      log.info("handler start", { event, gi, hi, type: handler.type, command: handler.command, url: handler.url })
      const input = { ...ctx, hook_event_name: event }
      try {
        const result = await run(handler, input)
        if (!result) {
          log.info("handler skip — no result", { event, gi, hi, type: handler.type })
          continue
        }

        log.info("handler done", {
          event,
          gi,
          hi,
          type: handler.type,
          proceed: result.proceed,
          decision: result.decision,
          hasContext: !!result.context,
          contextLen: result.context?.length,
          hasOutput: !!result.hookOutput,
        })

        invocations.push({
          event,
          type: handler.type,
          handler,
          context: result.context,
        })

        if (!result.proceed) {
          proceed = false
          feedback = result.feedback ?? feedback
          decision = result.decision ?? decision
          log.info("handler blocked", { event, gi, hi, feedback, decision })
        }
        if (result.context) {
          context = context ? `${context}\n${result.context}` : result.context
        }
        if (result.hookOutput) {
          hookOutput = result.hookOutput
        }
        if (result.decision) {
          decision = result.decision
        }
      } catch (err) {
        log.error("handler error", { event, gi, hi, type: handler.type, error: err })
      }
    }
  }

  log.info("dispatch result", {
    event,
    proceed,
    decision,
    invocations: invocations.length,
    hasContext: !!context,
    hasFeedback: !!feedback,
  })

  if (ctx.session_id && invocations.length > 0) {
    Trace.addHooks(
      ctx.session_id as import("@/session/schema").SessionID,
      invocations.map((i) => ({
        event: i.event,
        type: i.type,
        config: i.handler,
        context: i.context,
      })),
    )
  }

  return { proceed, feedback, context, decision, hookOutput, invocations }
}

/** Execute a single hook handler. */
async function run(handler: Handler, input: Input): Promise<Result | undefined> {
  const timeout = (handler.timeout ?? 600) * 1000

  switch (handler.type) {
    case "command": {
      if (!handler.command) {
        log.warn("command handler missing command field")
        return undefined
      }
      log.info("command hook run", { command: handler.command, timeout, cwd: input.cwd })
      return exec({
        command: handler.command,
        input,
        timeout,
        cwd: input.cwd,
      })
    }
    case "http": {
      if (!handler.url) {
        log.warn("http handler missing url field")
        return undefined
      }
      log.info("http hook run", { url: handler.url, timeout })
      return http({
        url: handler.url,
        input,
        timeout,
        headers: handler.headers,
        allowedEnvVars: handler.allowedEnvVars,
      })
    }
    case "prompt": {
      if (!handler.prompt) {
        log.warn("prompt handler missing prompt field")
        return undefined
      }
      log.info("prompt hook (passthrough)", { prompt: handler.prompt.slice(0, 80) })
      return { proceed: true, context: handler.prompt }
    }
    case "agent": {
      if (!handler.prompt) {
        log.warn("agent handler missing prompt field")
        return undefined
      }
      log.info("agent hook (passthrough)", { prompt: handler.prompt.slice(0, 80) })
      return { proceed: true, context: handler.prompt }
    }
    default:
      log.warn("unknown hook type", { type: handler.type })
      return undefined
  }
}

/**
 * Get all configured hooks grouped by event and source for the /hooks command.
 */
export const list = HookLoader.list

export { dispatch as trigger }
