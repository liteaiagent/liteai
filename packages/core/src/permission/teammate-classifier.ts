/**
 * Teammate Pre-Approval Classifier
 *
 * Adapts the existing YOLO classifier (`permission/classifier.ts`) for
 * teammate pre-approval of command execution. When a teammate encounters
 * an "ask" permission for `run_command`/`bash`, this module runs the
 * classifier BEFORE forwarding to the leader.
 *
 * Flow:
 * 1. Pre-filter: Only classify command execution permissions
 * 2. Build a pseudo-transcript from the tool input
 * 3. Delegate to `classifyYoloAction()` with a reduced timeout
 * 4. Map result: SAFE → auto-approve, DANGEROUS/unavailable → forward to leader
 *
 * Reference: Claude Code `inProcessRunner.ts` lines 159-176
 *            (`awaitClassifierAutoApproval` call)
 */
import { Log } from "@liteai/util/log"
import type { TranscriptMessage } from "../session/transcript"
import { ClassifierUnavailableError, classifyYoloAction } from "./classifier"

const logger = Log.create({ service: "permission:teammate-classifier" })

/** Maximum time (ms) to wait for the classifier — shorter than the full 30s default. */
const TEAMMATE_CLASSIFIER_TIMEOUT_MS = 10_000

/** Permission names that represent command execution. */
const COMMAND_PERMISSIONS = new Set(["run_command", "bash", "execute", "shell"])

/**
 * Attempt to pre-approve a teammate's tool use via the YOLO classifier.
 *
 * @returns
 * - `'SAFE'` — Classifier approved, tool can proceed without leader
 * - `'DANGEROUS'` — Classifier flagged, must forward to leader
 * - `null` — Classifier not applicable, unavailable, or timed out; forward to leader
 */
export async function tryTeammateClassifier(
  request: {
    permission: string
    patterns: string[]
    metadata: Record<string, unknown>
  },
  context: {
    agentId?: string
    agentName?: string
    cwd?: string
  },
): Promise<"SAFE" | "DANGEROUS" | null> {
  // ── Pre-filter: Only classify command execution permissions ──
  if (!COMMAND_PERMISSIONS.has(request.permission)) {
    logger.debug("teammate classifier skipped — non-command permission", {
      permission: request.permission,
      agentId: context.agentId,
    })
    return null
  }

  // ── Extract command string from metadata ──
  const command = extractCommand(request)
  if (!command) {
    logger.debug("teammate classifier skipped — no command in metadata", {
      permission: request.permission,
      agentId: context.agentId,
    })
    return null
  }

  // ── Build pseudo-transcript for the classifier ──
  const transcript = buildCommandTranscript(command, context.cwd)

  logger.info("running teammate classifier", {
    command: command.slice(0, 100),
    agentId: context.agentId,
    agentName: context.agentName,
  })

  try {
    // Race the classifier against a shorter timeout
    const result = await Promise.race([
      classifyYoloAction(transcript),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), TEAMMATE_CLASSIFIER_TIMEOUT_MS)),
    ])

    if (!result) {
      logger.warn("teammate classifier timed out", {
        command: command.slice(0, 100),
        agentId: context.agentId,
        timeoutMs: TEAMMATE_CLASSIFIER_TIMEOUT_MS,
      })
      return null
    }

    logger.info("teammate classifier result", {
      decision: result.decision,
      reason: result.reason,
      command: command.slice(0, 100),
      agentId: context.agentId,
    })

    return result.decision
  } catch (error: unknown) {
    // ClassifierUnavailableError → fallback to leader (no model available)
    if (error instanceof Error && error.name === ClassifierUnavailableError.name) {
      logger.info("teammate classifier unavailable — forwarding to leader", {
        agentId: context.agentId,
        error: error.message,
      })
      return null
    }

    // Unexpected errors → fail-closed, forward to leader
    logger.error("teammate classifier unexpected error", {
      agentId: context.agentId,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Extract the command string from the permission request metadata.
 *
 * Checks multiple fields since different tool implementations may use
 * different metadata keys.
 */
function extractCommand(request: { patterns: string[]; metadata: Record<string, unknown> }): string | null {
  // Preferred: explicit command metadata
  if (typeof request.metadata.command === "string" && request.metadata.command.length > 0) {
    return request.metadata.command
  }

  // Fallback: first pattern (often the command itself)
  if (request.patterns.length > 0 && request.patterns[0].length > 0) {
    return request.patterns[0]
  }

  // Fallback: CommandLine in metadata (used by some tool implementations)
  if (typeof request.metadata.CommandLine === "string" && request.metadata.CommandLine.length > 0) {
    return request.metadata.CommandLine
  }

  return null
}

/**
 * Build a minimal pseudo-transcript representing a command execution request.
 *
 * The YOLO classifier expects a `TranscriptMessage[]` transcript. For
 * pre-approval, we construct a synthetic assistant+tool pair that represents
 * the command the teammate wants to execute.
 */
function buildCommandTranscript(command: string, cwd?: string): TranscriptMessage[] {
  const workingDir = cwd || process.cwd()
  const now = Date.now()

  return [
    {
      isSidechain: true,
      uuid: `classifier-assistant-${now}`,
      role: "assistant",
      content: JSON.stringify({
        type: "tool_use",
        toolName: "run_command",
        input: {
          command,
          cwd: workingDir,
        },
      }),
      timestamp: now,
    },
    {
      isSidechain: true,
      uuid: `classifier-tool-${now}`,
      role: "tool",
      content: `run_command: executing "${command}" in ${workingDir}`,
      timestamp: now,
    },
  ]
}
