import { describe, expect, test } from "bun:test"
import { type ChildProcess, spawn } from "node:child_process"
import { BackgroundTask, BackgroundTaskRegistry, OutputBuffer } from "../../src/command/background"

/**
 * Spawn a process that runs for ~60 seconds on any platform.
 * Windows `timeout` requires a TTY so we use `ping` instead.
 */
function spawnLongRunning(): ChildProcess {
  if (process.platform === "win32") {
    // ping -n 61 sends 60 pings (one per second) and keeps the process alive
    return spawn("ping", ["-n", "61", "127.0.0.1"], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true })
  }
  return spawn("sleep", ["60"], { stdio: ["pipe", "pipe", "pipe"] })
}

/**
 * Spawn an echo command cross-platform. On Windows, echo is a shell built-in
 * so we must use shell: true.
 */
function spawnEcho(...args: string[]): ChildProcess {
  return spawn("echo", args, { stdio: ["pipe", "pipe", "pipe"], shell: true })
}

describe("OutputBuffer", () => {
  test("accumulates small output", () => {
    const buf = new OutputBuffer()
    buf.append("hello ")
    buf.append("world")
    expect(buf.toString()).toBe("hello world")
    expect(buf.totalBytes).toBe(11)
  })

  test("retains head and tail when output exceeds limits", () => {
    const buf = new OutputBuffer()
    // Generate data larger than HEAD_LIMIT (20KB) but verify structure
    const headData = "H".repeat(20 * 1024)
    const middleData = "M".repeat(100 * 1024)
    const tailData = "T".repeat(10 * 1024)

    buf.append(headData)
    buf.append(middleData)
    buf.append(tailData)

    const result = buf.toString()
    // Should start with head data
    expect(result.startsWith("H".repeat(100))).toBe(true)
    // Should end with tail data
    expect(result.endsWith("T".repeat(100))).toBe(true)
    // Should contain truncation marker
    expect(result).toContain("bytes truncated")
  })

  test("getChars returns tail window", () => {
    const buf = new OutputBuffer()
    buf.append("a".repeat(1000))
    const result = buf.getChars(100)
    expect(result.length).toBeLessThanOrEqual(200) // 100 chars + truncation message
    expect(result).toContain("a".repeat(100))
  })

  test("getChars returns full output when under limit", () => {
    const buf = new OutputBuffer()
    buf.append("short")
    expect(buf.getChars(1000)).toBe("short")
  })
})

describe("BackgroundTaskRegistry", () => {
  test("register and get task", () => {
    const registry = new BackgroundTaskRegistry()
    const proc = spawnEcho("hello")
    const task = registry.register(proc, {
      command: "echo hello",
      description: "Test echo",
    })

    expect(task.id).toMatch(/^cmd_[0-9a-f]{8}$/)
    expect(task.command).toBe("echo hello")
    expect(task.description).toBe("Test echo")
    expect(task.status).toBe("running")

    const found = registry.get(task.id)
    expect(found).toBe(task)

    proc.kill()
  })

  test("returns undefined for unknown ID", () => {
    const registry = new BackgroundTaskRegistry()
    expect(registry.get("cmd_nonexistent")).toBeUndefined()
  })

  test("list returns all tasks", () => {
    const registry = new BackgroundTaskRegistry()
    const proc1 = spawnEcho("1")
    const proc2 = spawnEcho("2")
    registry.register(proc1, { command: "echo 1", description: "First" })
    registry.register(proc2, { command: "echo 2", description: "Second" })

    const list = registry.list()
    expect(list.length).toBe(2)

    proc1.kill()
    proc2.kill()
  })

  test("notification tracking idempotency and filtering", async () => {
    const registry = new BackgroundTaskRegistry()
    const proc1 = spawnEcho("1")
    const proc2 = spawnEcho("2")
    const task1 = registry.register(proc1, { command: "echo 1", description: "First" })
    const task2 = registry.register(proc2, { command: "echo 2", description: "Second" })

    // Wait for both to complete
    await task1.waitForCompletion(5000)
    await task2.waitForCompletion(5000)

    // Initially, both are unnotified and completed
    let pending = registry.getUnnotifiedCompletedTasks()
    expect(pending.length).toBe(2)
    expect(pending.map((t) => t.id).sort()).toEqual([task1.id, task2.id].sort())

    // Mark one as notified
    registry.markNotified(task1.id)
    pending = registry.getUnnotifiedCompletedTasks()
    expect(pending.length).toBe(1)
    expect(pending[0].id).toBe(task2.id)

    // Idempotency: mark again, shouldn't change anything
    registry.markNotified(task1.id)
    pending = registry.getUnnotifiedCompletedTasks()
    expect(pending.length).toBe(1)

    // Mark second, should be empty
    registry.markNotified(task2.id)
    pending = registry.getUnnotifiedCompletedTasks()
    expect(pending.length).toBe(0)
  }, 10_000)

  test("getUnnotifiedCompletedTasks filters running tasks", () => {
    const registry = new BackgroundTaskRegistry()
    const proc = spawnLongRunning()
    registry.register(proc, { command: "sleep 60", description: "Running" })

    // Running task is not returned
    const pending = registry.getUnnotifiedCompletedTasks()
    expect(pending.length).toBe(0)

    proc.kill()
  })

  test("disposeAll terminates running tasks and clears registry", async () => {
    const registry = new BackgroundTaskRegistry()
    // Use a long-running command
    const proc = spawnLongRunning()
    registry.register(proc, { command: "sleep 60", description: "Long sleep" })

    expect(registry.size).toBe(1)

    await registry.disposeAll()

    expect(registry.size).toBe(0)
  }, 10_000)
})

describe("BackgroundTask", () => {
  test("waitForCompletion resolves when process exits", async () => {
    const proc = spawnEcho("done")
    const task = new BackgroundTask(proc, {
      command: "echo done",
      description: "Quick echo",
    })

    await task.waitForCompletion(5000)
    expect(task.status).not.toBe("running")
    expect(task.exitCode).toBe(0)
  }, 10_000)

  test("waitForCompletion times out for long-running processes", async () => {
    const proc = spawnLongRunning()
    const task = new BackgroundTask(proc, {
      command: "sleep 60",
      description: "Long sleep",
    })

    const start = Date.now()
    await task.waitForCompletion(200)
    const elapsed = Date.now() - start

    expect(task.status).toBe("running")
    expect(elapsed).toBeLessThan(1000)

    await task.terminate()
  }, 10_000)

  test("terminate kills the process", async () => {
    const proc = spawnLongRunning()
    const task = new BackgroundTask(proc, {
      command: "sleep 60",
      description: "Long sleep",
    })

    await task.terminate()
    await task.waitForCompletion(2000)

    expect(task.status).not.toBe("running")
  }, 10_000)

  test("writeStdin writes to process stdin", async () => {
    // Use cat which echoes stdin to stdout
    if (process.platform === "win32") return // cat not available on Windows by default

    const proc = spawn("cat", [], { stdio: ["pipe", "pipe", "pipe"] })
    const task = new BackgroundTask(proc, {
      command: "cat",
      description: "Echo stdin",
    })

    task.writeStdin("hello\n")
    await task.waitForCompletion(1000)

    // cat should have echoed our input
    const output = task.output.toString()
    expect(output).toContain("hello")

    await task.terminate()
  }, 10_000)

  test("writeStdin throws on exited process", async () => {
    const proc = spawnEcho("hi")
    const task = new BackgroundTask(proc, {
      command: "echo hi",
      description: "Quick echo",
    })

    await task.waitForCompletion(5000)

    expect(() => task.writeStdin("test")).toThrow("already exited")
  }, 10_000)

  test("output accumulates stdout and stderr", async () => {
    // echo to stdout and stderr
    if (process.platform === "win32") return

    const proc = spawn("sh", ["-c", "echo stdout-data; echo stderr-data >&2"], {
      stdio: ["pipe", "pipe", "pipe"],
    })
    const task = new BackgroundTask(proc, {
      command: "sh -c ...",
      description: "Mixed output",
    })

    await task.waitForCompletion(5000)

    const output = task.output.toString()
    expect(output).toContain("stdout-data")
    expect(output).toContain("stderr-data")
  }, 10_000)
})
