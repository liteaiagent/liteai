import { NamedError } from "@liteai/util/error"
import z from "zod"
import { Log } from "@/util/log"
import { Process } from "@/util/process"

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

  export async function createContainer(input: { agentId: string; projectPath: string; subPath?: string }) {
    const sanitizedId = input.agentId.replace(/[^a-zA-Z0-9_.-]/g, "_")
    const containerName = `liteai-agent-${sanitizedId}`
    const mappedCwd = "/workspace"

    // Check if docker is available
    const check = await Process.run(["docker", "info"], { nothrow: true })
    if (check.code !== 0) {
      throw new DockerSpawnError({ message: "Docker daemon is not running or accessible" })
    }

    log.info("Spawning docker container for isolation", { containerName, projectPath: input.projectPath })

    const image = "node:20-alpine"
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
        "-v",
        `${input.projectPath}:${mappedCwd}`,
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

  export async function removeContainer(containerId: string) {
    await Process.run(["docker", "rm", "-f", containerId], { nothrow: true })
    log.info("Removed docker container", { containerId })
  }
}
