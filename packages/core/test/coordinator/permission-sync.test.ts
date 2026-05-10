/**
 * Tests for permission-sync.ts
 *
 * Validates SwarmPermissionRequest schema, factory, and file-based storage.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  cleanupOldResolutions,
  createPermissionRequest,
  ensurePermissionDirs,
  generateRequestId,
  pollResolution,
  readPendingPermissions,
  resolvePermission,
  writePermissionRequest,
} from "../../src/coordinator/permission-sync"
import { Global } from "../../src/global"

// ─── Fixtures ────────────────────────────────────────────────────────────────

let tmpDir: string
let originalRoot: string

beforeEach(async () => {
  tmpDir = path.join(os.tmpdir(), `liteai-perm-sync-test-${Date.now()}`)
  await fs.mkdir(tmpDir, { recursive: true })
  originalRoot = Global.Path.root
  // Override Global.Path.root so team directories go to our temp dir
  Object.defineProperty(Global.Path, "root", { value: tmpDir, writable: true, configurable: true })
})

afterEach(async () => {
  Object.defineProperty(Global.Path, "root", { value: originalRoot, writable: true, configurable: true })
  await fs.rm(tmpDir, { recursive: true, force: true })
})

// ─── Schema & Factory ────────────────────────────────────────────────────────

describe("generateRequestId", () => {
  it("produces unique IDs", () => {
    const ids = new Set<string>()
    for (let i = 0; i < 100; i++) {
      ids.add(generateRequestId())
    }
    expect(ids.size).toBe(100)
  })

  it("starts with 'perm-' prefix", () => {
    expect(generateRequestId()).toMatch(/^perm-/)
  })
})

describe("createPermissionRequest", () => {
  it("creates a pending request with correct fields", () => {
    const request = createPermissionRequest({
      toolName: "run_command",
      toolUseId: "tool-123",
      description: "execute ls",
      input: { command: "ls" },
      workerId: "researcher@alpha",
      workerName: "researcher",
      workerColor: "cyan",
      teamName: "alpha",
    })

    expect(request.id).toMatch(/^perm-/)
    expect(request.toolName).toBe("run_command")
    expect(request.toolUseId).toBe("tool-123")
    expect(request.description).toBe("execute ls")
    expect(request.input).toEqual({ command: "ls" })
    expect(request.workerId).toBe("researcher@alpha")
    expect(request.workerName).toBe("researcher")
    expect(request.workerColor).toBe("cyan")
    expect(request.teamName).toBe("alpha")
    expect(request.status).toBe("pending")
    expect(request.resolvedBy).toBeUndefined()
    expect(request.resolvedAt).toBeUndefined()
  })
})

// ─── File-Based Storage ──────────────────────────────────────────────────────

describe("ensurePermissionDirs", () => {
  it("creates pending and resolved directories", async () => {
    const dirs = await ensurePermissionDirs("test-team")
    const pendingStat = await fs.stat(dirs.pending)
    const resolvedStat = await fs.stat(dirs.resolved)
    expect(pendingStat.isDirectory()).toBe(true)
    expect(resolvedStat.isDirectory()).toBe(true)
  })
})

describe("writePermissionRequest", () => {
  it("writes a request to the pending directory", async () => {
    const request = createPermissionRequest({
      toolName: "run_command",
      toolUseId: "tool-1",
      description: "run tests",
      input: { command: "bun test" },
      workerId: "worker-1@team-a",
      workerName: "worker-1",
      teamName: "team-a",
    })

    const filePath = await writePermissionRequest(request)
    const raw = await fs.readFile(filePath, "utf-8")
    const parsed = JSON.parse(raw)
    expect(parsed.id).toBe(request.id)
    expect(parsed.toolName).toBe("run_command")
    expect(parsed.status).toBe("pending")
  })
})

describe("readPendingPermissions", () => {
  it("returns empty array when no pending requests", async () => {
    const result = await readPendingPermissions("empty-team")
    expect(result).toEqual([])
  })

  it("returns all pending requests", async () => {
    const req1 = createPermissionRequest({
      toolName: "run_command",
      toolUseId: "t1",
      description: "cmd 1",
      input: { command: "echo 1" },
      workerId: "w1@team-b",
      workerName: "w1",
      teamName: "team-b",
    })
    const req2 = createPermissionRequest({
      toolName: "write_to_file",
      toolUseId: "t2",
      description: "write file",
      input: { path: "/tmp/x" },
      workerId: "w2@team-b",
      workerName: "w2",
      teamName: "team-b",
    })

    await writePermissionRequest(req1)
    await writePermissionRequest(req2)

    const pending = await readPendingPermissions("team-b")
    expect(pending.length).toBe(2)
    const ids = pending.map((p) => p.id)
    expect(ids).toContain(req1.id)
    expect(ids).toContain(req2.id)
  })

  it("skips malformed files", async () => {
    const req = createPermissionRequest({
      toolName: "run_command",
      toolUseId: "t3",
      description: "good request",
      input: {},
      workerId: "w@team-c",
      workerName: "w",
      teamName: "team-c",
    })
    await writePermissionRequest(req)

    // Write a corrupted file
    const dirs = await ensurePermissionDirs("team-c")
    await fs.writeFile(path.join(dirs.pending, "bad.json"), "not json", "utf-8")

    const pending = await readPendingPermissions("team-c")
    expect(pending.length).toBe(1)
    expect(pending[0].id).toBe(req.id)
  })
})

describe("resolvePermission", () => {
  it("moves request from pending to resolved", async () => {
    const request = createPermissionRequest({
      toolName: "run_command",
      toolUseId: "t4",
      description: "resolve test",
      input: {},
      workerId: "w@team-d",
      workerName: "w",
      teamName: "team-d",
    })
    await writePermissionRequest(request)

    await resolvePermission("team-d", request.id, {
      requestId: request.id,
      decision: "approved",
      feedback: "looks safe",
    })

    // Pending should be empty
    const pending = await readPendingPermissions("team-d")
    expect(pending.length).toBe(0)

    // Resolution should be pollable
    const resolution = await pollResolution("team-d", request.id)
    expect(resolution).not.toBeNull()
    expect(resolution?.decision).toBe("approved")
    expect(resolution?.feedback).toBe("looks safe")
  })

  it("handles already-resolved requests gracefully", async () => {
    // Should not throw
    await resolvePermission("team-e", "nonexistent-id", {
      requestId: "nonexistent-id",
      decision: "rejected",
    })
  })
})

describe("pollResolution", () => {
  it("returns null for unresolved requests", async () => {
    const result = await pollResolution("team-f", "does-not-exist")
    expect(result).toBeNull()
  })
})

describe("cleanupOldResolutions", () => {
  it("removes old resolved files", async () => {
    const request = createPermissionRequest({
      toolName: "run_command",
      toolUseId: "t5",
      description: "cleanup test",
      input: {},
      workerId: "w@team-g",
      workerName: "w",
      teamName: "team-g",
    })
    await writePermissionRequest(request)
    await resolvePermission("team-g", request.id, {
      requestId: request.id,
      decision: "approved",
    })

    // Artificially age the resolved file
    const dirs = await ensurePermissionDirs("team-g")
    const resolvedPath = path.join(dirs.resolved, `${request.id}.json`)
    const oldTime = new Date(Date.now() - 2 * 60 * 60 * 1000) // 2 hours ago
    await fs.utimes(resolvedPath, oldTime, oldTime)

    const cleaned = await cleanupOldResolutions("team-g")
    expect(cleaned).toBe(1)

    // Should no longer be pollable
    const result = await pollResolution("team-g", request.id)
    expect(result).toBeNull()
  })
})
