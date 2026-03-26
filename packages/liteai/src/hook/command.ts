import { spawn } from "node:child_process"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import type { Input, Result } from "./hook"

const log = Log.create({ service: "hook.command" })

/**
 * Execute a command-type hook.
 *
 * The hook input JSON is piped to stdin of the spawned process.
 * Exit codes:
 *   0 — proceed; stdout is added as context
 *   2 — blocked; stderr is fed back as feedback
 *   other — proceed; stderr is logged but not surfaced
 *
 * Structured JSON output on stdout is detected and parsed.
 */
export async function command(opts: { command: string; input: Input; timeout: number; cwd: string }): Promise<Result> {
  const expanded = expand(opts.command, opts.cwd)

  return new Promise<Result>((resolve) => {
    let stdout = ""
    let stderr = ""
    let done = false

    const finish = (code: number | null) => {
      if (done) return
      done = true
      clearTimeout(timer)

      const structured = tryJson(stdout)

      // Check for structured JSON output first
      if (structured) {
        return resolve(structured)
      }

      if (code === 0) {
        return resolve({
          proceed: true,
          context: stdout.trim() || undefined,
        })
      }
      if (code === 2) {
        return resolve({
          proceed: false,
          feedback: stderr.trim() || "Hook blocked the action",
          decision: "deny",
        })
      }
      // Any other exit code: proceed but log
      if (stderr.trim()) {
        log.warn("hook non-zero exit", { code, stderr: stderr.slice(0, 200) })
      }
      return resolve({ proceed: true })
    }

    const proc = spawn(expanded, {
      shell: true,
      cwd: opts.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        LITEAI_PROJECT_DIR: opts.cwd,
        CLAUDE_PROJECT_DIR: opts.cwd,
        LITEAI_WORKTREE: Instance.worktree,
      },
      timeout: opts.timeout,
    })

    proc.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    proc.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    proc.on("close", finish)
    proc.on("error", (err) => {
      log.error("hook spawn error", { error: err.message, command: expanded })
      if (!done) {
        done = true
        clearTimeout(timer)
        resolve({ proceed: true })
      }
    })

    // Write input JSON to stdin
    const json = JSON.stringify(opts.input)
    proc.stdin?.write(json, () => {
      proc.stdin?.end()
    })

    const timer = setTimeout(() => {
      if (!done) {
        done = true
        log.warn("hook timed out", { command: expanded, timeout: opts.timeout })
        proc.kill("SIGTERM")
        resolve({ proceed: true })
      }
    }, opts.timeout)
  })
}

/** Expand environment variables in command strings. */
function expand(cmd: string, cwd: string): string {
  let expanded = cmd
    .replace(/\$LITEAI_PROJECT_DIR|\$CLAUDE_PROJECT_DIR/g, cwd)
    .replace(/\$\{LITEAI_PROJECT_DIR\}|\$\{CLAUDE_PROJECT_DIR\}/g, cwd)

  // Expand standard bash-style env vars
  expanded = expanded.replace(/\$\{([^}]+)\}/g, (match, name) => {
    return process.env[name] !== undefined ? process.env[name] : match
  })
  expanded = expanded.replace(/\$([a-zA-Z_][a-zA-Z0-9_]*)/g, (match, name) => {
    return process.env[name] !== undefined ? process.env[name] : match
  })
  return expanded
}

/** Try to parse stdout as structured JSON hook output. */
function tryJson(stdout: string): Result | undefined {
  const text = stdout.trim()
  if (!text.startsWith("{")) return undefined
  try {
    const parsed = JSON.parse(text)

    // Check for hookSpecificOutput
    if (parsed.hookSpecificOutput) {
      const specific = parsed.hookSpecificOutput
      const result: Result = { proceed: true, hookOutput: specific, context: specific.additionalContext ?? specific.additional_context }

      // PreToolUse permission decisions
      if (specific.permissionDecision === "deny") {
        result.proceed = false
        result.decision = "deny"
        result.feedback = specific.permissionDecisionReason
      } else if (specific.permissionDecision === "allow") {
        result.decision = "allow"
      } else if (specific.permissionDecision === "ask") {
        result.decision = "ask"
      }

      // PermissionRequest decisions
      if (specific.decision?.behavior === "allow") {
        result.decision = "allow"
      } else if (specific.decision?.behavior === "deny") {
        result.proceed = false
        result.decision = "deny"
      }

      return result
    }

    // Top-level decision/reason
    if (parsed.decision === "block") {
      return {
        proceed: false,
        decision: "deny",
        feedback: parsed.reason,
      }
    }

    // continue: false — stop processing
    if (parsed.continue === false) {
      return {
        proceed: false,
        feedback: parsed.stopReason ?? parsed.reason,
      }
    }

    // If it has additionalContext
    const context = parsed.additionalContext ?? parsed.additional_context
    if (context) {
      return {
        proceed: true,
        context: context,
      }
    }

    return undefined
  } catch {
    return undefined
  }
}
