import { Log } from "@liteai/util/log"
import { ASYNC_AGENT_ALLOWED_TOOLS } from "../agent/filter"
import { Brand } from "../brand"
import { Flag } from "../flag/flag"
import type { Session } from "../session"
import { STRUCTURED_OUTPUT_TOOL_NAME } from "../tool/structured_output"

const logger = Log.create({ service: "coordinator" })

/**
 * Check if the given session is in coordinator mode.
 *
 * The authoritative source is the session's persisted `sessionMode` field.
 * Falls back to the `LITEAI_COORDINATOR_MODE` flag for new sessions
 * where the mode hasn't been persisted yet.
 *
 * This is a pure function — no global state mutation, multi-tenant safe.
 */
export function isCoordinatorMode(sessionMode?: Session.Info["sessionMode"]): boolean {
  if (sessionMode !== undefined) {
    return sessionMode === "Coordinator"
  }
  return Flag.LITEAI_COORDINATOR_MODE
}

/**
 * Checks if the current coordinator mode flag matches the session's stored mode.
 *
 * Called on session resume to prevent mode drift — e.g., user starts a session
 * in coordinator mode, restarts the server without the flag, resumes the session.
 */
export function matchSessionMode(sessionMode: Session.Info["sessionMode"] | undefined): {
  resolvedMode: Session.Info["sessionMode"]
  warning?: string
} {
  if (!sessionMode) {
    const mode = Flag.LITEAI_COORDINATOR_MODE ? "Coordinator" : "Normal"
    return { resolvedMode: mode }
  }

  const flagIsCoordinator = Flag.LITEAI_COORDINATOR_MODE
  const sessionIsCoordinator = sessionMode === "Coordinator"

  if (flagIsCoordinator === sessionIsCoordinator) {
    return { resolvedMode: sessionMode }
  }

  // Drift detected — session mode wins (it's the authoritative source)
  // Flip the env var so Flag.LITEAI_COORDINATOR_MODE stays in sync
  if (sessionIsCoordinator) {
    process.env[`${Brand.env}COORDINATOR_MODE`] = "true"
  } else {
    delete process.env[`${Brand.env}COORDINATOR_MODE`]
  }

  const warning = sessionIsCoordinator
    ? "Entered coordinator mode to match resumed session."
    : "Exited coordinator mode to match resumed session."

  logger.warn("coordinator mode drift detected", {
    sessionMode,
    flagWas: flagIsCoordinator,
    resolvedTo: sessionMode,
  })

  return { resolvedMode: sessionMode, warning }
}

/**
 * Tools the coordinator is allowed to use.
 *
 * This is an explicit allowlist — any tool not in this set is stripped
 * from the coordinator's tool pool.
 */
const COORDINATOR_ALLOWED_TOOLS = new Set([
  "task",
  "send_message",
  "yield_turn",
  "task_stop",
  "team_create",
  "team_delete",
  STRUCTURED_OUTPUT_TOOL_NAME,
])

/**
 * Filter the resolved tool pool to only coordinator-allowed tools.
 */
export function applyCoordinatorToolFilter(tools: Record<string, unknown>): Record<string, unknown> {
  const filtered: Record<string, unknown> = {}
  for (const [name, tool] of Object.entries(tools)) {
    if (COORDINATOR_ALLOWED_TOOLS.has(name)) {
      filtered[name] = tool
    }
  }
  return filtered
}

/**
 * Tools that are internal to the coordinator/swarm system and should NOT
 * be listed in the worker capabilities context.
 */
const INTERNAL_COORDINATOR_TOOLS = new Set([
  "task",
  "send_message",
  "yield_turn",
  "task_stop",
  "team_create",
  "team_delete",
])

/**
 * Build the worker capabilities context string for the coordinator's
 * user context.
 */
export function getCoordinatorUserContext(
  sessionMode: Session.Info["sessionMode"],
  mcpClients: ReadonlyArray<{ name: string }> = [],
): Record<string, string> {
  if (!isCoordinatorMode(sessionMode)) {
    return {}
  }

  const workerToolNames = ASYNC_AGENT_ALLOWED_TOOLS.filter((name) => !INTERNAL_COORDINATOR_TOOLS.has(name))
    .sort()
    .join(", ")

  let content = `Workers spawned via the task tool have access to these tools: ${workerToolNames}`

  if (mcpClients.length > 0) {
    const serverNames = mcpClients.map((c) => c.name).join(", ")
    content += `\n\nWorkers also have access to MCP tools from connected MCP servers: ${serverNames}`
  }

  return { workerToolsContext: content }
}
