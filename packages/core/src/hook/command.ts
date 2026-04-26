import { spawn } from "node:child_process"
import path from "node:path"
import { Log } from "@liteai/util/log"
import { which } from "@liteai/util/which"
import { Instance } from "@/project/instance"
import { Filesystem } from "@/util/filesystem"
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
  log.info("spawn", { original: opts.command, expanded, cwd: opts.cwd, timeout: opts.timeout })

  return new Promise<Result>((resolve) => {
    let stdout = ""
    let stderr = ""
    let done = false

    const finish = (code: number | null) => {
      if (done) return
      done = true
      clearTimeout(timer)

      log.info("exit", {
        code,
        stdoutLen: stdout.length,
        stderrLen: stderr.length,
        stdout: stdout.slice(0, 200) || undefined,
        stderr: stderr.slice(0, 200) || undefined,
      })

      const structured = tryJson(stdout)

      if (structured) {
        log.info("structured output", { proceed: structured.proceed, decision: structured.decision })
        return resolve(structured)
      }

      if (code === 0) {
        log.info("result proceed", { hasContext: !!stdout.trim() })
        return resolve({
          proceed: true,
          context: stdout.trim() || undefined,
        })
      }
      if (code === 2) {
        log.info("result blocked", { feedback: stderr.trim().slice(0, 100) })
        return resolve({
          proceed: false,
          feedback: stderr.trim() || "Hook blocked the action",
          decision: "deny",
        })
      }
      if (stderr.trim()) {
        log.warn("non-zero exit", { code, stderr: stderr.slice(0, 200) })
      }
      return resolve({ proceed: true })
    }

    const proc = spawn(expanded, {
      shell: true,
      cwd: opts.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: hookEnv(opts.cwd),
      timeout: opts.timeout,
    })

    log.info("spawned", { pid: proc.pid })

    proc.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString()
      log.info("stdout chunk", { len: text.length, preview: text.slice(0, 100) })
      stdout += text
    })
    proc.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString()
      log.info("stderr chunk", { len: text.length, preview: text.slice(0, 100) })
      stderr += text
    })

    proc.on("close", finish)
    proc.on("error", (err) => {
      log.error("spawn error", { error: err.message, command: expanded })
      if (!done) {
        done = true
        clearTimeout(timer)
        resolve({ proceed: true })
      }
    })

    const json = JSON.stringify(opts.input)
    log.info("stdin write", { bytes: json.length })
    proc.stdin?.write(json, () => {
      proc.stdin?.end()
    })

    const timer = setTimeout(() => {
      if (!done) {
        done = true
        log.warn("timed out", { command: expanded, timeout: opts.timeout })
        proc.kill("SIGTERM")
        resolve({ proceed: true })
      }
    }, opts.timeout)
  })
}

/**
 * Build the environment for a spawned hook process.
 * On Windows, prepend the Git for Windows bin/ dir to PATH so that
 * `where bash` inside run-hook.cmd resolves Git bash before WSL bash.
 */
function hookEnv(cwd: string): NodeJS.ProcessEnv {
  const base: NodeJS.ProcessEnv = {
    ...process.env,
    LITEAI_PROJECT_DIR: cwd,
    CLAUDE_PROJECT_DIR: cwd,
    LITEAI_WORKTREE: Instance.worktree,
  }
  if (process.platform !== "win32") return base
  const dir = gitBinDir()
  if (!dir) return base
  const key = Object.keys(base).find((k) => k.toLowerCase() === "path") ?? "PATH"
  base[key] = `${dir}${path.delimiter}${base[key] ?? ""}`
  log.info("prepend git bin to PATH", { dir })
  return base
}

/**
 * Locate the Git for Windows bin/ directory (contains bash.exe, sh.exe etc).
 * Returns null if not found.
 */
function gitBinDir(): string | null {
  const git = which("git")
  if (git) {
    // git.exe is at: <root>\cmd\git.exe — bash.exe is at <root>\bin\bash.exe
    const bin = path.join(git, "..", "..", "bin")
    if (Filesystem.stat(path.join(bin, "bash.exe"))?.size) return path.resolve(bin)
  }
  // Common hardcoded fallbacks
  for (const p of ["C:\\Program Files\\Git\\bin", `${String(process.env.LOCALAPPDATA)}\\Programs\\Git\\bin`]) {
    if (Filesystem.stat(path.join(p, "bash.exe"))?.size) return p
  }
  return null
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
      const result: Result = {
        proceed: true,
        hookOutput: specific,
        context: specific.additionalContext ?? specific.additional_context,
      }

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
