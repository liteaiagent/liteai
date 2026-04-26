import fs from "node:fs/promises"
import path from "node:path"
import { Log } from "@liteai/util/log"

const logger = Log.create({ service: "agent:meta" })

/**
 * Agent metadata sidecar persistence.
 *
 * Follows the MVP pattern (sessionStorage.ts L260-303): a `.meta.json` file
 * co-located with the `.jsonl` sidechain transcript. Written once at agent
 * spawn time, read on resume, zero DB schema changes.
 *
 * The sidecar stores identity fields (agentType, worktreePath, description)
 * plus the byte-exact rendered system prompt for fork children. This enables
 * zero-degradation Tier 2 system prompt recovery — no prompt reconstruction
 * or cache busting required.
 */
export namespace AgentMeta {
  /**
   * Persisted metadata for a spawned subagent.
   *
   * All fields except `agentType` and `agentId` are optional — non-fork
   * agents may omit `renderedSystemPrompt`, and agents without worktree
   * isolation omit `worktreePath`.
   */
  export interface Data {
    /** Agent type identifier (e.g., "fork", "explore", "code"). */
    agentType: string
    /** Unique agent ID within the session. */
    agentId: string
    /** Worktree path if the agent was spawned with isolation: "worktree". */
    worktreePath?: string
    /** Original task description from the spawn input. */
    description?: string
    /**
     * Byte-exact rendered system prompt from fork spawn.
     *
     * Persisted so Tier 2 resume can restore the cache-safe prompt without
     * rebuilding from session config (which risks divergence and cache busting).
     * Only set for fork children — non-fork agents recompute via their
     * agent definition's `prompt` field.
     */
    renderedSystemPrompt?: string
  }

  /**
   * Derive the metadata sidecar path from the same components as
   * `SidechainTranscript.getPath()`, replacing `.jsonl` with `.meta.json`.
   */
  export function getPath(dir: string, sessionId: string, subdir: string, agentId: string): string {
    return path.join(dir, sessionId, "subagents", subdir, `agent-${agentId}.meta.json`)
  }

  /**
   * Persist agent metadata to disk.
   *
   * Called once at agent spawn time (runner.ts). The parent directory is
   * created if it doesn't exist (matches SidechainTranscript.create() behavior).
   */
  export async function write(
    dir: string,
    sessionId: string,
    subdir: string,
    agentId: string,
    data: Data,
  ): Promise<void> {
    const metaPath = getPath(dir, sessionId, subdir, agentId)
    await fs.mkdir(path.dirname(metaPath), { recursive: true })
    await fs.writeFile(metaPath, JSON.stringify(data), "utf-8")
    logger.debug("wrote agent metadata sidecar", { agentId, agentType: data.agentType, metaPath })
  }

  /**
   * Read agent metadata from disk.
   *
   * Returns `null` on ENOENT (agent never spawned, or metadata was cleaned up).
   * Throws on all other errors (fail-fast per Constitution §5).
   */
  export async function read(dir: string, sessionId: string, subdir: string, agentId: string): Promise<Data | null> {
    const metaPath = getPath(dir, sessionId, subdir, agentId)
    try {
      const raw = await fs.readFile(metaPath, "utf-8")
      return JSON.parse(raw) as Data
    } catch (err: unknown) {
      if (typeof err === "object" && err !== null && (err as { code?: string }).code === "ENOENT") {
        return null
      }
      throw err
    }
  }
}
