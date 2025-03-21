import z from "zod"
import { Config } from "@/config/config"
import { Log } from "@/util/log"
import { command as exec } from "./command"
import { http } from "./http"

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
}

/** Load hooks from merged config. */
async function load(): Promise<Schema> {
  const cfg = await Config.get()
  if (cfg.disableAllHooks) return {}
  const hooks = (cfg.hooks as Schema) ?? {}
  const events = Object.keys(hooks)
  if (events.length) {
    log.info("loaded hooks from config", { events, groups: events.map((e) => hooks[e].length) })
  }
  return hooks
}

/** Load hooks for a specific agent (from agent frontmatter). */
export async function agentHooks(agent: string): Promise<Schema> {
  const cfg = await Config.get()
  const entry = cfg.agent?.[agent]
  if (!entry?.hooks) return {}
  // Agent hooks field is z.record(z.string(), z.any()) — parse it as our Schema
  const parsed = Schema.safeParse(entry.hooks)
  if (!parsed.success) return {}
  const events = Object.keys(parsed.data)
  if (events.length) {
    log.info("loaded hooks from agent", { agent, events })
  }
  return parsed.data
}

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
  const hooks = await load()
  const groups = [...(hooks[event] ?? []), ...(opts?.extra?.[event] ?? [])]

  if (groups.length === 0) return { proceed: true }

  const value = ctx.tool_name ?? ctx.source
  let proceed = true
  let feedback: string | undefined
  let context: string | undefined
  let decision: Result["decision"]
  let hookOutput: Record<string, unknown> | undefined

  for (const group of groups) {
    if (!matches(group.matcher, value)) continue

    for (const handler of group.hooks) {
      const input = { ...ctx, hook_event_name: event }
      try {
        const result = await run(handler, input)
        if (!result) continue

        if (!result.proceed) {
          proceed = false
          feedback = result.feedback ?? feedback
          decision = result.decision ?? decision
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
        log.error("hook execution failed", { event, type: handler.type, error: err })
      }
    }
  }

  return { proceed, feedback, context, decision, hookOutput }
}

/** Execute a single hook handler. */
async function run(handler: Handler, input: Input): Promise<Result | undefined> {
  const timeout = (handler.timeout ?? 600) * 1000

  switch (handler.type) {
    case "command": {
      if (!handler.command) return undefined
      return exec({
        command: handler.command,
        input,
        timeout,
        cwd: input.cwd,
      })
    }
    case "http": {
      if (!handler.url) return undefined
      return http({
        url: handler.url,
        input,
        timeout,
        headers: handler.headers,
        allowedEnvVars: handler.allowedEnvVars,
      })
    }
    case "prompt": {
      // For prompt hooks, we return the prompt text as context
      // Full prompt-based hook evaluation (model call) is Phase 5+ / deferred
      if (!handler.prompt) return undefined
      log.info("prompt hook (passthrough)", { prompt: handler.prompt.slice(0, 80) })
      return { proceed: true, context: handler.prompt }
    }
    case "agent": {
      // Agent hooks delegate to sub-agent — deferred until agent hook infrastructure is wired
      if (!handler.prompt) return undefined
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
export async function list(): Promise<
  {
    event: string
    source: string
    matcher?: string
    handlers: Handler[]
  }[]
> {
  const result: { event: string; source: string; matcher?: string; handlers: Handler[] }[] = []
  const cfg = await Config.get()

  // Config hooks
  const hooks = (cfg.hooks as Schema) ?? {}
  for (const [event, groups] of Object.entries(hooks)) {
    for (const group of groups) {
      result.push({
        event,
        source: "config",
        matcher: group.matcher,
        handlers: group.hooks,
      })
    }
  }

  // Agent hooks
  for (const [name, agent] of Object.entries(cfg.agent ?? {})) {
    if (!agent.hooks) continue
    const parsed = Schema.safeParse(agent.hooks)
    if (!parsed.success) continue
    for (const [event, groups] of Object.entries(parsed.data)) {
      for (const group of groups) {
        result.push({
          event,
          source: `agent:${name}`,
          matcher: group.matcher,
          handlers: group.hooks,
        })
      }
    }
  }

  return result
}

export { dispatch as trigger }
