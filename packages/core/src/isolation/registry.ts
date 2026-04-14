import fs from "node:fs/promises"
import path from "node:path"
import { Global } from "@/global"
import { Log } from "@/util/log"
import { Process } from "@/util/process"
import { Worktree } from "@/worktree"
import { DockerIsolation } from "./docker"

const log = Log.create({ service: "isolation:registry" })

interface ArtifactRegistry {
  worktrees: Record<string, number>
  remotes: Record<string, number>
}

export type IsolationArtifactIdentifier =
  | { readonly type: "worktree"; readonly directory: string }
  | { readonly type: "remote"; readonly containerId: string }

export namespace IsolationArtifactRegistry {
  function getRegistryPath() {
    return path.join(Global.Path.data, "isolation_registry.json")
  }

  async function loadRegistry(): Promise<ArtifactRegistry> {
    try {
      const data = await fs.readFile(getRegistryPath(), "utf-8")
      return JSON.parse(data) as ArtifactRegistry
    } catch {
      return { worktrees: {}, remotes: {} }
    }
  }

  async function saveRegistry(registry: ArtifactRegistry) {
    await fs.mkdir(path.dirname(getRegistryPath()), { recursive: true })
    await fs.writeFile(getRegistryPath(), JSON.stringify(registry, null, 2), "utf-8")
  }

  export async function registerWorktreeArtifact(agentId: string, directory: string) {
    const registry = await loadRegistry()
    registry.worktrees[directory] = Date.now()
    await saveRegistry(registry)
    log.info("Registered worktree isolation artifact", { agentId, directory })
  }

  export async function registerRemoteArtifact(agentId: string, containerId: string) {
    const registry = await loadRegistry()
    registry.remotes[containerId] = Date.now()
    await saveRegistry(registry)
    log.info("Registered remote isolation artifact", { agentId, containerId })
  }

  /**
   * Immediately cleans up a specific isolation artifact by:
   * 1. Performing physical teardown (worktree removal or container destruction)
   * 2. Removing the entry from the persistent registry
   *
   * Used as a fallback when agent setup fails after artifact registration
   * but before the SubagentContext (and its AgentCleanup lifecycle) is created.
   */
  export async function deregisterArtifact(agentId: string, artifact: IsolationArtifactIdentifier): Promise<void> {
    log.info("Deregistering isolation artifact", { agentId, type: artifact.type })

    // Step 1: Physical cleanup
    if (artifact.type === "worktree") {
      try {
        await Worktree.remove({ directory: artifact.directory })
      } catch (err) {
        log.error("Failed to remove worktree during deregistration", {
          agentId,
          directory: artifact.directory,
          error: err,
        })
      }
    } else {
      try {
        await DockerIsolation.removeContainer(artifact.containerId)
      } catch (err) {
        log.error("Failed to remove container during deregistration", {
          agentId,
          containerId: artifact.containerId,
          error: err,
        })
      }
    }

    // Step 2: Registry entry removal
    try {
      const registry = await loadRegistry()
      let changed = false
      if (artifact.type === "worktree" && artifact.directory in registry.worktrees) {
        delete registry.worktrees[artifact.directory]
        changed = true
      } else if (artifact.type === "remote" && artifact.containerId in registry.remotes) {
        delete registry.remotes[artifact.containerId]
        changed = true
      }
      if (changed) {
        await saveRegistry(registry)
      }
    } catch (err) {
      log.error("Failed to update registry during deregistration", { agentId, error: err })
    }

    log.info("Isolation artifact deregistered", { agentId, type: artifact.type })
  }

  export async function cleanupStaleIsolationArtifacts(maxAgeMs = 1000 * 60 * 60 * 24) {
    log.info("Running stale isolation artifacts cleanup")
    const registry = await loadRegistry()
    const now = Date.now()
    let changed = false

    for (const [directory, timestamp] of Object.entries(registry.worktrees)) {
      if (now - timestamp > maxAgeMs) {
        log.info("Cleaning up stale worktree artifact", { directory })
        try {
          // Check for uncommitted changes
          const status = await Process.run(["git", "--no-optional-locks", "status", "--porcelain", "-uno"], {
            cwd: directory,
            nothrow: true,
          })
          if (status.code !== 0 || status.stdout.toString().trim().length > 0) {
            log.info("Skipping worktree cleanup due to uncommitted changes or git error", { directory })
            continue
          }

          // Check for unpushed commits
          const unpushed = await Process.run(["git", "rev-list", "--max-count=1", "HEAD", "--not", "--remotes"], {
            cwd: directory,
            nothrow: true,
          })
          if (unpushed.code !== 0 || unpushed.stdout.toString().trim().length > 0) {
            log.info("Skipping worktree cleanup due to unpushed commits or git error", { directory })
            continue
          }

          await Worktree.remove({ directory })
          delete registry.worktrees[directory]
          changed = true
        } catch (error) {
          log.error("Failed to cleanup stale worktree", { directory, error })
        }
      }
    }

    for (const [containerId, timestamp] of Object.entries(registry.remotes)) {
      if (now - timestamp > maxAgeMs) {
        log.info("Cleaning up stale remote artifact", { containerId })
        try {
          await DockerIsolation.removeContainer(containerId)
          delete registry.remotes[containerId]
          changed = true
        } catch (error) {
          log.error("Failed to cleanup stale remote", { containerId, error })
        }
      }
    }

    if (changed) {
      await saveRegistry(registry)
    }
  }
}
