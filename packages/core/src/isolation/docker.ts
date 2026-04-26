import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { NamedError } from "@liteai/util/error"
import { Log } from "@liteai/util/log"
import { Process } from "@liteai/util/process"
import z from "zod"

const log = Log.create({ service: "isolation:docker" })

export interface ExecController {
  exec(
    cmd: string,
    args: string[],
    options?: { cwd?: string; env?: Record<string, string> },
  ): Promise<{ stdout: string; stderr: string; exitCode: number }>
}

export namespace DockerIsolation {
  export const DockerSpawnError = NamedError.create(
    "DockerSpawnError",
    z.object({
      message: z.string(),
    }),
  )

  export async function createContainer(input: {
    agentId: string
    projectPath: string
    subPath?: string
    containerImage?: string
  }) {
    const sanitizedId = input.agentId.replace(/[^a-zA-Z0-9_.-]/g, "_")
    const containerName = `liteai-agent-${sanitizedId}`
    const mappedCwd = "/workspace"
    const scratchSpace = path.join(os.tmpdir(), "liteai-scratch", sanitizedId)

    // Ensure scratch space exists
    await fs.mkdir(scratchSpace, { recursive: true })

    // Check if docker is available
    const check = await Process.run(["docker", "info"], { nothrow: true })
    if (check.code !== 0) {
      throw new DockerSpawnError({ message: "Docker daemon is not running or accessible" })
    }

    log.info("Spawning docker container for isolation", { containerName, projectPath: input.projectPath })

    const image = input.containerImage || "node:20-alpine"
    const relPath = input.subPath?.startsWith(input.projectPath)
      ? input.subPath.slice(input.projectPath.length).replace(/^[/\\]+/, "")
      : ""
    const targetCwd = relPath ? `${mappedCwd}/${relPath.replace(/\\/g, "/")}` : mappedCwd

    // Spawn container
    const result = await Process.run(
      [
        "docker",
        "run",
        "-d",
        "--name",
        containerName,
        "--label",
        "liteai.agent=true",
        "-v",
        `${input.projectPath}:${mappedCwd}:ro`,
        "-v",
        `${scratchSpace}:/scratch`,
        "-w",
        targetCwd,
        image,
        "tail",
        "-f",
        "/dev/null",
      ],
      { nothrow: true },
    )

    if (result.code !== 0) {
      throw new DockerSpawnError({ message: `Failed to spawn docker container: ${result.stderr.toString()}` })
    }

    const execController: ExecController = {
      async exec(cmd: string, args: string[], options?: { cwd?: string; env?: Record<string, string> }) {
        const dockerArgs = ["docker", "exec"]
        if (options?.cwd) {
          dockerArgs.push("-w", options.cwd)
        }
        if (options?.env) {
          for (const [k, v] of Object.entries(options.env)) {
            dockerArgs.push("-e", `${k}=${v}`)
          }
        }
        dockerArgs.push(containerName, cmd, ...args)

        const execResult = await Process.run(dockerArgs, { nothrow: true })
        return {
          stdout: execResult.stdout.toString(),
          stderr: execResult.stderr.toString(),
          exitCode: execResult.code,
        }
      },
    }

    return {
      containerId: containerName,
      mappedCwd: targetCwd,
      execController,
    }
  }

  const CONTAINER_NAME_PREFIX = "liteai-agent-"

  export async function removeContainer(containerId: string) {
    try {
      await Process.run(["docker", "rm", "-f", containerId], { nothrow: true })
      log.info("Removed docker container", { containerId })
    } finally {
      // Clean up the host scratch directory associated with this container.
      // The containerId follows the convention "liteai-agent-<sanitizedId>".
      if (containerId.startsWith(CONTAINER_NAME_PREFIX)) {
        const sanitizedId = containerId.slice(CONTAINER_NAME_PREFIX.length)
        if (sanitizedId.length > 0) {
          const scratchSpace = path.join(os.tmpdir(), "liteai-scratch", sanitizedId)
          try {
            await fs.rm(scratchSpace, { recursive: true, force: true })
            log.info("Cleaned up scratch directory", { scratchSpace })
          } catch (err) {
            log.error("Failed to clean up scratch directory", { scratchSpace, error: err })
          }
        }
      }
    }
  }
}
