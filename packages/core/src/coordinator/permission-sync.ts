/**
 * Swarm Permission Synchronization
 *
 * Types, schemas, and file-based storage for inter-agent permission requests.
 * Workers serialize permission requests to the team directory; leaders poll,
 * resolve, and write back responses.
 *
 * Dual transport:
 * - **In-process (primary):** Bus-event bridge via `permission-bridge.ts`
 * - **File-based (fallback):** `~/.liteai/teams/{team}/permissions/pending/` + `resolved/`
 *
 * Reference: Claude Code `utils/swarm/permissionSync.ts`
 */
import fs from "node:fs/promises"
import path from "node:path"
import { Log } from "@liteai/util/log"
import z from "zod"
import { teamDir } from "./team-helpers"

const logger = Log.create({ service: "coordinator.permission-sync" })

// ─── Schemas ─────────────────────────────────────────────────────────────────

/** A single permission suggestion (rule the leader can "always allow"). */
export const PermissionSuggestion = z.object({
  permission: z.string(),
  pattern: z.string(),
})
export type PermissionSuggestion = z.infer<typeof PermissionSuggestion>

/** Status of a swarm permission request. */
export const SwarmPermissionStatus = z.enum(["pending", "approved", "rejected"])
export type SwarmPermissionStatus = z.infer<typeof SwarmPermissionStatus>

/**
 * A permission request from a worker to the leader.
 *
 * Written to `permissions/pending/{id}.json` by the worker,
 * resolved by the leader into `permissions/resolved/{id}.json`.
 */
export const SwarmPermissionRequest = z.object({
  /** Unique request ID: `perm-{timestamp}-{random}` */
  id: z.string(),

  // ── Worker identity ──
  workerId: z.string(),
  workerName: z.string(),
  workerColor: z.string().optional(),
  teamName: z.string(),

  // ── Tool context ──
  toolName: z.string(),
  toolUseId: z.string(),
  description: z.string(),
  input: z.record(z.string(), z.unknown()),

  // ── Permission suggestions ──
  permissionSuggestions: z.array(PermissionSuggestion).optional(),

  // ── Status ──
  status: SwarmPermissionStatus,
  resolvedBy: z.enum(["worker", "leader"]).optional(),
  resolvedAt: z.number().optional(),
  feedback: z.string().optional(),
})
export type SwarmPermissionRequest = z.infer<typeof SwarmPermissionRequest>

/** Resolution data returned to the worker. */
export const PermissionResolution = z.object({
  requestId: z.string(),
  decision: z.enum(["approved", "rejected"]),
  feedback: z.string().optional(),
  /** If approved, the input may have been modified by the leader. */
  updatedInput: z.record(z.string(), z.unknown()).optional(),
})
export type PermissionResolution = z.infer<typeof PermissionResolution>

// ─── ID Generation ───────────────────────────────────────────────────────────

let _permCounter = 0

/**
 * Generate a unique permission request ID.
 * Format: `perm-{timestamp36}-{counter}-{random}`
 */
export function generateRequestId(): string {
  _permCounter++
  return `perm-${Date.now().toString(36)}-${_permCounter}-${Math.random().toString(36).slice(2, 6)}`
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export interface CreatePermissionRequestParams {
  toolName: string
  toolUseId: string
  description: string
  input: Record<string, unknown>
  workerId: string
  workerName: string
  workerColor?: string
  teamName: string
  permissionSuggestions?: PermissionSuggestion[]
}

/**
 * Create a new `SwarmPermissionRequest` with status=pending.
 */
export function createPermissionRequest(params: CreatePermissionRequestParams): SwarmPermissionRequest {
  return {
    id: generateRequestId(),
    workerId: params.workerId,
    workerName: params.workerName,
    workerColor: params.workerColor,
    teamName: params.teamName,
    toolName: params.toolName,
    toolUseId: params.toolUseId,
    description: params.description,
    input: params.input,
    permissionSuggestions: params.permissionSuggestions,
    status: "pending",
  }
}

// ─── File-Based Storage ──────────────────────────────────────────────────────

/** Subdirectory names within the team directory. */
const PENDING_DIR = "permissions/pending"
const RESOLVED_DIR = "permissions/resolved"

/** Max age for resolved permission files before cleanup (1 hour). */
const RESOLVED_MAX_AGE_MS = 60 * 60 * 1000

/**
 * Ensure the permissions directories exist for a team.
 */
export async function ensurePermissionDirs(teamName: string): Promise<{ pending: string; resolved: string }> {
  const base = teamDir(teamName)
  const pending = path.join(base, PENDING_DIR)
  const resolved = path.join(base, RESOLVED_DIR)
  await fs.mkdir(pending, { recursive: true })
  await fs.mkdir(resolved, { recursive: true })
  return { pending, resolved }
}

/**
 * Write a permission request to the pending directory.
 *
 * Uses atomic write (write to .tmp then rename) to prevent partial reads.
 */
export async function writePermissionRequest(request: SwarmPermissionRequest): Promise<string> {
  const { pending } = await ensurePermissionDirs(request.teamName)
  const filePath = path.join(pending, `${request.id}.json`)
  const tmpPath = `${filePath}.tmp`

  await fs.writeFile(tmpPath, JSON.stringify(request, null, 2), "utf-8")
  await fs.rename(tmpPath, filePath)

  logger.info("wrote pending permission request", {
    id: request.id,
    toolName: request.toolName,
    workerName: request.workerName,
    teamName: request.teamName,
  })

  return filePath
}

/**
 * Read all pending permission requests for a team.
 */
export async function readPendingPermissions(teamName: string): Promise<SwarmPermissionRequest[]> {
  const { pending } = await ensurePermissionDirs(teamName)
  const results: SwarmPermissionRequest[] = []

  let entries: string[]
  try {
    entries = await fs.readdir(pending)
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return []
    throw error
  }

  for (const entry of entries) {
    if (!entry.endsWith(".json") || entry.endsWith(".tmp")) continue

    const filePath = path.join(pending, entry)
    try {
      const raw = await fs.readFile(filePath, "utf-8")
      const parsed = SwarmPermissionRequest.parse(JSON.parse(raw))
      results.push(parsed)
    } catch (error: unknown) {
      logger.warn("skipping malformed pending permission file", {
        file: entry,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return results
}

/**
 * Resolve a pending permission request.
 *
 * Moves the request from `pending/` to `resolved/` with the resolution data.
 * Uses file locking to prevent race conditions between concurrent resolvers.
 */
export async function resolvePermission(
  teamName: string,
  requestId: string,
  resolution: PermissionResolution,
): Promise<void> {
  const { pending, resolved } = await ensurePermissionDirs(teamName)
  const pendingPath = path.join(pending, `${requestId}.json`)
  const resolvedPath = path.join(resolved, `${requestId}.json`)

  // Read the original request
  let request: SwarmPermissionRequest
  try {
    const raw = await fs.readFile(pendingPath, "utf-8")
    request = SwarmPermissionRequest.parse(JSON.parse(raw))
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      logger.warn("permission request not found in pending — may have already been resolved", { requestId })
      return
    }
    throw error
  }

  // Update the request with resolution
  const resolvedRequest: SwarmPermissionRequest = {
    ...request,
    status: resolution.decision,
    resolvedBy: "leader",
    resolvedAt: Date.now(),
    feedback: resolution.feedback,
  }

  // Write to resolved directory
  const tmpPath = `${resolvedPath}.tmp`
  await fs.writeFile(tmpPath, JSON.stringify(resolvedRequest, null, 2), "utf-8")
  await fs.rename(tmpPath, resolvedPath)

  // Remove from pending
  try {
    await fs.unlink(pendingPath)
  } catch {
    // Best-effort — may have been cleaned up by another process
  }

  logger.info("resolved permission request", {
    requestId,
    decision: resolution.decision,
    feedback: resolution.feedback,
  })
}

/**
 * Poll for a resolution to a specific permission request.
 *
 * Checks the `resolved/` directory for a file matching the request ID.
 * Returns null if not yet resolved.
 */
export async function pollResolution(teamName: string, requestId: string): Promise<PermissionResolution | null> {
  const { resolved } = await ensurePermissionDirs(teamName)
  const resolvedPath = path.join(resolved, `${requestId}.json`)

  try {
    const raw = await fs.readFile(resolvedPath, "utf-8")
    const request = SwarmPermissionRequest.parse(JSON.parse(raw))
    return {
      requestId: request.id,
      decision: request.status === "approved" ? "approved" : "rejected",
      feedback: request.feedback,
    }
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null // Not yet resolved
    }
    throw error
  }
}

/**
 * Clean up old resolved permission files to prevent disk bloat.
 *
 * Removes files older than {@link RESOLVED_MAX_AGE_MS}.
 */
export async function cleanupOldResolutions(teamName: string): Promise<number> {
  const { resolved } = await ensurePermissionDirs(teamName)
  const now = Date.now()
  let cleaned = 0

  let entries: string[]
  try {
    entries = await fs.readdir(resolved)
  } catch {
    return 0
  }

  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue
    const filePath = path.join(resolved, entry)
    try {
      const stat = await fs.stat(filePath)
      if (now - stat.mtimeMs > RESOLVED_MAX_AGE_MS) {
        await fs.unlink(filePath)
        cleaned++
      }
    } catch {
      // Best-effort cleanup
    }
  }

  if (cleaned > 0) {
    logger.info("cleaned up old resolved permissions", { teamName, cleaned })
  }

  return cleaned
}
