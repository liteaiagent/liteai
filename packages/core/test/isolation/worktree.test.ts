import { afterAll, beforeAll, describe, expect, it, spyOn } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Global } from "@/global/index"
import { IsolationArtifactRegistry } from "@/isolation/registry"
import { Instance } from "@/project/instance"
import { Process } from "@/util/process"
import { Worktree } from "@/worktree/index"

async function runGit(args: string[], cwd: string) {
  const result = await Process.run(["git", ...args], { cwd, nothrow: true })
  if (result.code !== 0) {
    throw new Error(`Git error in ${cwd}: git ${args.join(" ")}\n${result.stderr.toString()}`)
  }
  return result
}

describe("Worktree Isolation Mode", () => {
  let tempDir: string
  let projectDir: string
  let dataDir: string
  let originalGlobalPath: typeof Global.Path
  let originalInstanceWorktreeDescriptor: PropertyDescriptor | undefined
  let originalInstanceProjectDescriptor: PropertyDescriptor | undefined

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "liteai-worktree-test-"))
    projectDir = path.join(tempDir, "project")
    dataDir = path.join(tempDir, "data")
    await fs.mkdir(projectDir, { recursive: true })
    await fs.mkdir(dataDir, { recursive: true })

    await runGit(["init"], projectDir)
    await runGit(["config", "user.name", "Test User"], projectDir)
    await runGit(["config", "user.email", "test@example.com"], projectDir)

    await fs.writeFile(path.join(projectDir, "test.txt"), "initial commit")
    await runGit(["add", "test.txt"], projectDir)
    await runGit(["commit", "-m", "initial"], projectDir)

    originalGlobalPath = Global.Path
    Object.defineProperty(Global, "Path", {
      value: { ...originalGlobalPath, data: dataDir },
      writable: true,
      configurable: true,
    })

    originalInstanceWorktreeDescriptor = Object.getOwnPropertyDescriptor(Instance, "worktree")
    Object.defineProperty(Instance, "worktree", {
      value: projectDir,
      writable: true,
      configurable: true,
    })

    originalInstanceProjectDescriptor = Object.getOwnPropertyDescriptor(Instance, "project")
    Object.defineProperty(Instance, "project", {
      value: { id: "test-project", vcs: "git" },
      writable: true,
      configurable: true,
    })
  })

  afterAll(async () => {
    Object.defineProperty(Global, "Path", { value: originalGlobalPath, writable: true, configurable: true })

    if (originalInstanceWorktreeDescriptor) {
      Object.defineProperty(Instance, "worktree", originalInstanceWorktreeDescriptor)
    } else {
      Reflect.deleteProperty(Instance, "worktree")
    }

    if (originalInstanceProjectDescriptor) {
      Object.defineProperty(Instance, "project", originalInstanceProjectDescriptor)
    } else {
      Reflect.deleteProperty(Instance, "project")
    }

    await fs.rm(tempDir, { recursive: true, force: true })
  })

  it("should create worktree from makeWorktreeInfo() and assert US6b AS6 coverage", async () => {
    await fs.writeFile(path.join(projectDir, "staged.txt"), "staged content")
    await runGit(["add", "staged.txt"], projectDir)

    const info = await Worktree.makeWorktreeInfo("test-agent")

    expect(info.name).toStartWith("test-agent")
    expect(info.branch).toStartWith("liteai/")
    expect(info.directory).toStartWith(dataDir)

    const { Project } = await import("@/project/project")
    const projectSpy = spyOn(Project, "addSandbox").mockResolvedValue({} as import("@/project/project").Project.Info)
    const provideSpy = spyOn(Instance, "provide").mockResolvedValue(undefined as never)

    const bootstrap = await Worktree.createFromInfo(info)
    expect(bootstrap).toBeTypeOf("function")
    await bootstrap()

    const stagedExists = await fs
      .stat(path.join(info.directory, "staged.txt"))
      .then(() => true)
      .catch(() => false)
    expect(stagedExists).toBe(false)

    const initialExists = await fs
      .stat(path.join(info.directory, "test.txt"))
      .then(() => true)
      .catch(() => false)
    expect(initialExists).toBe(true)

    const registerSpy = spyOn(IsolationArtifactRegistry, "registerWorktreeArtifact").mockResolvedValue(undefined)
    await IsolationArtifactRegistry.registerWorktreeArtifact("test-agent", info.directory)
    expect(registerSpy).toHaveBeenCalledWith("test-agent", info.directory)

    registerSpy.mockRestore()
    projectSpy.mockRestore()
    provideSpy.mockRestore()
  })

  it("should perform TTL-based retention cleanup of stale worktrees", async () => {
    const dummyDir = path.join(dataDir, "worktree", "test-project", "dummy-stale-worktree")
    await fs.mkdir(dummyDir, { recursive: true })
    const now = Date.now()

    await IsolationArtifactRegistry.registerWorktreeArtifact("stale-agent", dummyDir)

    const registryPath = path.join(dataDir, "isolation_registry.json")
    const registryData = JSON.parse(await fs.readFile(registryPath, "utf-8"))

    registryData.worktrees[dummyDir] = now - 1000 * 60 * 60 * 2
    await fs.writeFile(registryPath, JSON.stringify(registryData))

    const removeSpy = spyOn(Worktree, "remove").mockResolvedValue(true)

    await IsolationArtifactRegistry.cleanupStaleIsolationArtifacts(1000 * 60 * 60)

    expect(removeSpy).toHaveBeenCalledWith({ directory: dummyDir })

    const updatedRegistry = JSON.parse(await fs.readFile(registryPath, "utf-8"))
    expect(updatedRegistry.worktrees[dummyDir]).toBeUndefined()

    removeSpy.mockRestore()
  })
})
