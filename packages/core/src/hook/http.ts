import { Log } from "@liteai/util/log"
import type { Input, Result } from "./hook"

const log = Log.create({ service: "hook.http" })

/**
 * Execute an HTTP-type hook.
 *
 * POSTs the hook input JSON to the configured URL.
 * Response handling:
 *   2xx + empty body → success (exit 0 equivalent)
 *   2xx + plain text → success, text added as context
 *   2xx + JSON body → parsed using same JSON output schema as command hooks
 *   Non-2xx → non-blocking error, execution continues
 *   Connection failure/timeout → non-blocking error
 */
export async function http(opts: {
  url: string
  input: Input
  timeout: number
  headers?: Record<string, string>
  allowedEnvVars?: string[]
}): Promise<Result> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(opts.headers ? expand(opts.headers, opts.allowedEnvVars) : {}),
  }

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), opts.timeout)

    log.info("request", { url: opts.url, timeout: opts.timeout })

    const response = await fetch(opts.url, {
      method: "POST",
      headers,
      body: JSON.stringify(opts.input),
      signal: controller.signal,
    })

    clearTimeout(timer)

    if (!response.ok) {
      log.warn("non-2xx", { url: opts.url, status: response.status })
      return { proceed: true }
    }

    const text = await response.text()
    log.info("response", { status: response.status, bodyLen: text.length })
    if (!text.trim()) {
      log.info("result proceed (empty body)")
      return { proceed: true }
    }

    // Try JSON
    try {
      const parsed = JSON.parse(text)

      // hookSpecificOutput
      if (parsed.hookSpecificOutput) {
        const specific = parsed.hookSpecificOutput
        const result: Result = { proceed: true, hookOutput: specific }

        if (specific.permissionDecision === "deny") {
          result.proceed = false
          result.decision = "deny"
          result.feedback = specific.permissionDecisionReason
        } else if (specific.permissionDecision === "allow") {
          result.decision = "allow"
        }

        if (specific.decision?.behavior === "allow") {
          result.decision = "allow"
        } else if (specific.decision?.behavior === "deny") {
          result.proceed = false
          result.decision = "deny"
        }

        log.info("result structured", { proceed: result.proceed, decision: result.decision })
        return result
      }

      // Top-level decision
      if (parsed.decision === "block") {
        log.info("result blocked")
        return {
          proceed: false,
          decision: "deny",
          feedback: parsed.reason,
        }
      }

      if (parsed.continue === false) {
        log.info("result stopped", { reason: parsed.stopReason ?? parsed.reason })
        return {
          proceed: false,
          feedback: parsed.stopReason ?? parsed.reason,
        }
      }

      if (parsed.additionalContext) {
        log.info("result proceed with context", { contextLen: parsed.additionalContext.length })
        return { proceed: true, context: parsed.additionalContext }
      }

      log.info("result proceed (json, no action)")
      return { proceed: true, context: text.trim() }
    } catch {
      log.info("result proceed (plain text)", { len: text.length })
      return { proceed: true, context: text.trim() }
    }
  } catch (err) {
    log.warn("request error", { url: opts.url, error: err instanceof Error ? err.message : String(err) })
    return { proceed: true }
  }
}

/** Expand $VAR_NAME and ${VAR_NAME} in header values using allowed env vars. */
function expand(headers: Record<string, string>, allowed?: string[]): Record<string, string> {
  const set = new Set(allowed)
  const result: Record<string, string> = {}
  for (const [key, val] of Object.entries(headers)) {
    result[key] = val.replace(/\$\{?(\w+)\}?/g, (match, name) => {
      if (set.size > 0 && !set.has(name)) return match
      return process.env[name] ?? match
    })
  }
  return result
}
