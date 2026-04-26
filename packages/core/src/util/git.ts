import { type GitResult, git as nativeGit } from "@liteai/util/git"
import { Capabilities } from "../capabilities/context"

export type { GitResult }

/**
 * Run a git command.
 *
 * In local mode, spawns `git` via Process helpers.
 * In hosted mode, delegates to the HostCapabilities git interface,
 * which makes an HTTP callback to the Extension Server.
 */
export async function git(args: string[], opts: { cwd: string; env?: Record<string, string> }): Promise<GitResult> {
  // ─── Hosted mode: delegate to capabilities ──────────────────────────
  if (Capabilities.ready() && Capabilities.isHosted()) {
    const caps = Capabilities.get()
    const result = await caps.git.run(args, opts)
    const stdoutBuf = Buffer.from(result.stdout)
    const stderrBuf = Buffer.from(result.stderr)
    return {
      exitCode: result.exitCode,
      text: () => result.stdout,
      stdout: stdoutBuf,
      stderr: stderrBuf,
    }
  }

  // ─── Local mode: spawn git process directly ─────────────────────────
  return nativeGit(args, opts)
}
