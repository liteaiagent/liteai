import { afterAll, beforeAll, describe, expect, it, spyOn } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Process } from "@liteai/util/process"
import { Global } from "@/global/index"
import { DockerIsolation } from "@/isolation/docker"
import { IsolationArtifactRegistry } from "@/isolation/registry"

describe("Docker Isolation Mode", () => {
  let tempDir: string
  let projectDir: string
  let dataDir: string
  let originalGlobalPath: typeof Global.Path

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "liteai-docker-test-"))
    projectDir = path.join(tempDir, "project")
    dataDir = path.join(tempDir, "data")
    await fs.mkdir(projectDir, { recursive: true })
    await fs.mkdir(dataDir, { recursive: true })

    originalGlobalPath = Global.Path
    Object.defineProperty(Global, "Path", {
      value: { ...originalGlobalPath, data: dataDir },
      writable: true,
      configurable: true,
    })
  })

  afterAll(async () => {
    Object.defineProperty(Global, "Path", { value: originalGlobalPath, writable: true, configurable: true })
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  it("should throw DockerSpawnError if docker daemon is unreachable", async () => {
    const processSpy = spyOn(Process, "run").mockImplementation(async (args) => {
      if (args[0] === "docker" && args[1] === "info") {
        return { code: 1, stdout: Buffer.from(""), stderr: Buffer.from("Cannot connect to the Docker daemon") }
      }
      return { code: 0, stdout: Buffer.from(""), stderr: Buffer.from("") }
    })

    await expect(DockerIsolation.createContainer({ agentId: "test", projectPath: projectDir })).rejects.toThrow(
      /Docker daemon is not running or accessible/,
    )

    processSpy.mockRestore()
  })

  it("should spawn container via docker run -d with correct mounts and return execController", async () => {
    const processSpy = spyOn(Process, "run").mockImplementation(async () => {
      return { code: 0, stdout: Buffer.from("success"), stderr: Buffer.from("") }
    })

    const agentId = "test-agent"
    const result = await DockerIsolation.createContainer({ agentId, projectPath: projectDir })

    const expectedContainerName = "liteai-agent-test-agent"
    expect(result.containerId).toBe(expectedContainerName)
    expect(result.mappedCwd).toBe("/workspace")
    expect(result.execController).toBeDefined()

    const runCalls = processSpy.mock.calls.filter((args) => args[0]?.[1] === "run")
    expect(runCalls.length).toBeGreaterThan(0)
    const runArgs = runCalls[0][0]
    expect(runArgs).toContain("-d")
    expect(runArgs).not.toContain("--rm")

    const execRes = await result.execController.exec("echo", ["hello"])
    expect(execRes.stdout).toBe("success")

    processSpy.mockRestore()
  })

  it("should perform TTL-based retention cleanup of stale docker containers", async () => {
    const containerId = "stale-container-val"
    const now = Date.now()

    await IsolationArtifactRegistry.registerRemoteArtifact("agentId", containerId)

    const registryPath = path.join(dataDir, "isolation_registry.json")
    const registryData = JSON.parse(await fs.readFile(registryPath, "utf-8"))

    registryData.remotes[containerId] = now - 1000 * 60 * 60 * 2
    await fs.writeFile(registryPath, JSON.stringify(registryData))

    const removeSpy = spyOn(DockerIsolation, "removeContainer").mockResolvedValue(undefined)

    await IsolationArtifactRegistry.cleanupStaleIsolationArtifacts(1000 * 60 * 60)

    expect(removeSpy).toHaveBeenCalledWith(containerId)

    const updatedRegistry = JSON.parse(await fs.readFile(registryPath, "utf-8"))
    expect(updatedRegistry.remotes[containerId]).toBeUndefined()

    removeSpy.mockRestore()
  })
})
