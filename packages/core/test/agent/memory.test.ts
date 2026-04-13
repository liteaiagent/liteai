import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test"
import * as fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { AgentMemory } from "../../src/agent/memory"
import { Global } from "../../src/global"
import { Instance } from "../../src/project/instance"

describe("AgentMemory Tests", () => {
  let baseDir: string
  let tmpHome: string
  let tmpProject: string
  let tmpWorktree: string

  let orgGlobalHome: PropertyDescriptor | undefined
  let orgDirectory: PropertyDescriptor | undefined
  let orgWorktree: PropertyDescriptor | undefined
  let orgProject: PropertyDescriptor | undefined

  beforeEach(async () => {
    baseDir = await fs.mkdtemp(path.join(os.tmpdir(), "liteai_test_"))
    tmpHome = path.join(baseDir, "home")
    tmpProject = path.join(baseDir, "project")
    tmpWorktree = path.join(baseDir, "project", "worktree")

    await fs.mkdir(tmpHome, { recursive: true })
    await fs.mkdir(tmpProject, { recursive: true })
    await fs.mkdir(tmpWorktree, { recursive: true })

    orgGlobalHome = Object.getOwnPropertyDescriptor(Global.Path, "home")
    orgDirectory = Object.getOwnPropertyDescriptor(Instance, "directory")
    orgWorktree = Object.getOwnPropertyDescriptor(Instance, "worktree")
    orgProject = Object.getOwnPropertyDescriptor(Instance, "project")

    Object.defineProperty(Global.Path, "home", { get: () => tmpHome, configurable: true })
    Object.defineProperty(Instance, "directory", { get: () => tmpProject, configurable: true })
    Object.defineProperty(Instance, "worktree", { get: () => tmpWorktree, configurable: true })
    Object.defineProperty(Instance, "project", { get: () => ({ id: "test_project" }), configurable: true })

    spyOn(Instance, "state").mockImplementation(((init: () => unknown) => init) as unknown as typeof Instance.state)
    spyOn(Instance, "provide").mockImplementation((async (input: { fn: () => unknown }) =>
      input.fn()) as unknown as typeof Instance.provide)
  })

  afterEach(async () => {
    if (orgGlobalHome) Object.defineProperty(Global.Path, "home", orgGlobalHome)
    if (orgDirectory) Object.defineProperty(Instance, "directory", orgDirectory)
    if (orgWorktree) Object.defineProperty(Instance, "worktree", orgWorktree)
    if (orgProject) Object.defineProperty(Instance, "project", orgProject)

    mock.restore()
    try {
      if (baseDir) await fs.rm(baseDir, { recursive: true, force: true })
    } catch (error) {
      console.warn(`Failed to cleanup test directory ${baseDir}:`, error)
    }
  })

  describe("Scope Resolution", () => {
    it("resolves user scope correctly", () => {
      const dir = AgentMemory.getAgentMemoryDir("test_agent", "user")
      expect(dir).toBe(path.join(tmpHome, ".liteai", "memory", "test_agent"))
    })

    it("resolves project scope correctly", () => {
      const dir = AgentMemory.getAgentMemoryDir("test_agent", "project")
      expect(dir).toBe(path.join(tmpProject, ".liteai", "memory", "test_agent"))
    })

    it("resolves local scope correctly", () => {
      const dir = AgentMemory.getAgentMemoryDir("test_agent", "local")
      expect(dir).toBe(path.join(tmpWorktree, ".liteai", "memory", "test_agent"))
    })
  })

  describe("Path Traversal Prevention", () => {
    it("allows paths inside memory dir", () => {
      const dir = "/mock/mem"
      expect(AgentMemory.isAgentMemoryPath("/mock/mem/test.md", dir)).toBe(true)
      expect(AgentMemory.isAgentMemoryPath("/mock/mem/sub/test.md", dir)).toBe(true)
    })

    it("prevents paths outside memory dir", () => {
      const dir = "/mock/mem"
      expect(AgentMemory.isAgentMemoryPath("/mock/test.md", dir)).toBe(false)
      expect(AgentMemory.isAgentMemoryPath("/mock/mem/../test.md", dir)).toBe(false)
      expect(AgentMemory.isAgentMemoryPath("/mock/mem_other/test.md", dir)).toBe(false)
    })
  })

  describe("ensureMemoryDirExists", () => {
    it("is idempotent", async () => {
      const memDir = path.join(tmpHome, "ensure_test")
      await AgentMemory.ensureMemoryDirExists(memDir)
      await AgentMemory.ensureMemoryDirExists(memDir)
      const stat = await fs.stat(memDir)
      expect(stat.isDirectory()).toBe(true)
    })
  })

  describe("loadAgentMemoryPrompt", () => {
    it("returns empty memory block when file does not exist", async () => {
      const prompt = await AgentMemory.loadAgentMemoryPrompt("test_agent", "project")
      expect(prompt).toContain("<memory>\n(Empty)\n</memory>")
    })

    it("returns injected memory block when file exists", async () => {
      const memDir = AgentMemory.getAgentMemoryDir("test_agent", "project")
      await fs.mkdir(memDir, { recursive: true })
      await fs.writeFile(path.join(memDir, "MEMORY.md"), "EXISTING_MEMORY_DATA")

      const prompt = await AgentMemory.loadAgentMemoryPrompt("test_agent", "project")
      expect(prompt).toContain("<memory>\nEXISTING_MEMORY_DATA\n</memory>")
    })
  })

  describe("Tools Auto-injection", () => {
    it("injects read, write, and edit tools", () => {
      const pool: Record<string, unknown> = {}
      AgentMemory.injectAgentMemoryTools(pool, "test_agent", "project")
      expect(pool.readMemory).toBeDefined()
      expect(pool.writeMemory).toBeDefined()
      expect(pool.editMemory).toBeDefined()
    })
  })

  describe("Snapshot System", () => {
    it("checkAgentMemorySnapshot returns false if snapshot config disabled", async () => {
      process.env.AGENT_MEMORY_SNAPSHOT = "false"
      const result = await AgentMemory.checkAgentMemorySnapshot("test_agent")
      expect(result).toBe(false)
      delete process.env.AGENT_MEMORY_SNAPSHOT
    })

    it("checkAgentMemorySnapshot returns true if project memory is newer", async () => {
      process.env.AGENT_MEMORY_SNAPSHOT = "true"
      const projectDir = AgentMemory.getAgentMemoryDir("test_agent", "project")
      await fs.mkdir(projectDir, { recursive: true })
      await fs.writeFile(path.join(projectDir, "MEMORY.md"), "project data")

      const localDir = AgentMemory.getAgentMemoryDir("test_agent", "local")
      await fs.mkdir(localDir, { recursive: true })
      await fs.writeFile(path.join(localDir, "MEMORY.md"), "local data")

      // artificially modify timestamps
      const future = new Date(Date.now() + 10000)
      const past = new Date(Date.now() - 10000)
      await fs.utimes(path.join(projectDir, "MEMORY.md"), future, future)
      await fs.utimes(path.join(localDir, "MEMORY.md"), past, past)

      const result = await AgentMemory.checkAgentMemorySnapshot("test_agent")
      expect(result).toBe(true)

      delete process.env.AGENT_MEMORY_SNAPSHOT
    })

    it("copyProjectSnapshotToLocal performs copy if project scope differs from local scope", async () => {
      const projectDir = AgentMemory.getAgentMemoryDir("test_agent", "project")
      await fs.mkdir(projectDir, { recursive: true })
      await fs.writeFile(path.join(projectDir, "MEMORY.md"), "SOURCE_PROJECT_DATA")

      const localDir = AgentMemory.getAgentMemoryDir("test_agent", "local")

      await AgentMemory.copyProjectSnapshotToLocal("test_agent")

      const data = await fs.readFile(path.join(localDir, "MEMORY.md"), "utf-8")
      expect(data).toBe("SOURCE_PROJECT_DATA")
    })
  })
})
