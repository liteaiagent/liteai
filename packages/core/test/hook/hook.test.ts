import { describe, expect, test } from "bun:test"
import path from "node:path"
import { command } from "../../src/hook/command"
import * as Hook from "../../src/hook/hook"
import { Instance } from "../../src/project/instance"
import { Filesystem } from "../../src/util/filesystem"
import { tmpdir } from "../fixture/fixture"

// ---------------------------------------------------------------------------
// Schema validation (pure, no Instance needed)
// ---------------------------------------------------------------------------
describe("hook.schemas", () => {
  test("Event enum accepts valid events", () => {
    expect(Hook.Event.parse("PreToolUse")).toBe("PreToolUse")
    expect(Hook.Event.parse("PostToolUse")).toBe("PostToolUse")
    expect(Hook.Event.parse("Stop")).toBe("Stop")
    expect(Hook.Event.parse("UserPromptSubmit")).toBe("UserPromptSubmit")
    expect(Hook.Event.parse("PreCompact")).toBe("PreCompact")
    expect(Hook.Event.parse("InstructionsLoaded")).toBe("InstructionsLoaded")
  })

  test("Event enum rejects invalid events", () => {
    expect(() => Hook.Event.parse("InvalidEvent")).toThrow()
  })

  test("Handler schema validates command type", () => {
    const result = Hook.Handler.safeParse({
      type: "command",
      command: "echo hello",
      timeout: 30,
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.type).toBe("command")
      expect(result.data.command).toBe("echo hello")
      expect(result.data.timeout).toBe(30)
    }
  })

  test("Handler schema validates http type", () => {
    const result = Hook.Handler.safeParse({
      type: "http",
      url: "https://example.com/hook",
      headers: { Authorization: "Bearer $TOKEN" },
      allowedEnvVars: ["TOKEN"],
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.type).toBe("http")
      expect(result.data.url).toBe("https://example.com/hook")
    }
  })

  test("Handler schema validates optional fields", () => {
    const result = Hook.Handler.safeParse({
      type: "command",
      command: "test",
      statusMessage: "Running hook...",
      once: true,
      async: false,
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.statusMessage).toBe("Running hook...")
      expect(result.data.once).toBe(true)
      expect(result.data.async).toBe(false)
    }
  })

  test("Handler schema rejects invalid type", () => {
    const result = Hook.Handler.safeParse({ type: "invalid" })
    expect(result.success).toBe(false)
  })

  test("Group schema validates matcher + hooks array", () => {
    const result = Hook.Group.safeParse({
      matcher: "Bash",
      hooks: [
        { type: "command", command: "echo test" },
        { type: "http", url: "https://example.com" },
      ],
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.matcher).toBe("Bash")
      expect(result.data.hooks).toHaveLength(2)
    }
  })

  test("Group schema allows missing matcher", () => {
    const result = Hook.Group.safeParse({
      hooks: [{ type: "command", command: "test" }],
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.matcher).toBeUndefined()
    }
  })

  test("Schema validates full hooks config", () => {
    const result = Hook.Schema.safeParse({
      PreToolUse: [
        {
          matcher: "Bash",
          hooks: [{ type: "command", command: "echo blocked" }],
        },
      ],
      Stop: [
        {
          hooks: [{ type: "http", url: "https://example.com/stop" }],
        },
      ],
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.PreToolUse).toHaveLength(1)
      expect(result.data.Stop).toHaveLength(1)
    }
  })
})

// ---------------------------------------------------------------------------
// Command executor (needs Instance.provide for Instance.worktree)
// ---------------------------------------------------------------------------
describe("hook.command", () => {
  test("exit 0 returns proceed with stdout as context", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const cmd = process.platform === "win32" ? "cmd /c echo hello" : "echo hello"
        const result = await command({
          command: cmd,
          input: { cwd: tmp.path, hook_event_name: "test" },
          timeout: 5000,
          cwd: tmp.path,
        })
        expect(result.proceed).toBe(true)
        expect(result.context?.trim()).toBe("hello")
      },
    })
  })

  test("exit 2 returns blocked with stderr as feedback", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const cmd = process.platform === "win32" ? "cmd /c echo blocked>&2 & exit 2" : "echo blocked >&2; exit 2"
        const result = await command({
          command: cmd,
          input: { cwd: tmp.path, hook_event_name: "test" },
          timeout: 5000,
          cwd: tmp.path,
        })
        expect(result.proceed).toBe(false)
        expect(result.feedback?.trim()).toBe("blocked")
        expect(result.decision).toBe("deny")
      },
    })
  })

  test("exit 1 returns proceed (non-blocking)", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const cmd = process.platform === "win32" ? "cmd /c exit 1" : "exit 1"
        const result = await command({
          command: cmd,
          input: { cwd: tmp.path, hook_event_name: "test" },
          timeout: 5000,
          cwd: tmp.path,
        })
        expect(result.proceed).toBe(true)
      },
    })
  })

  test("exit 0 with no stdout returns proceed without context", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const cmd = process.platform === "win32" ? "cmd /c rem noop" : "true"
        const result = await command({
          command: cmd,
          input: { cwd: tmp.path, hook_event_name: "test" },
          timeout: 5000,
          cwd: tmp.path,
        })
        expect(result.proceed).toBe(true)
        expect(result.context).toBeUndefined()
      },
    })
  })

  test("pipes input JSON to stdin", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const cmd = process.platform === "win32" ? "more" : "cat"
        const input = { cwd: tmp.path, hook_event_name: "test", tool_name: "bash" }
        const result = await command({
          command: cmd,
          input,
          timeout: 5000,
          cwd: tmp.path,
        })
        expect(result.proceed).toBe(true)
        expect(result.context).toBeTruthy()
        const parsed = JSON.parse(result.context as string)
        expect(parsed.tool_name).toBe("bash")
        expect(parsed.hook_event_name).toBe("test")
      },
    })
  })

  test("handles spawn error gracefully (proceeds)", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await command({
          command: "/nonexistent/binary/that_does_not_exist_anywhere",
          input: { cwd: tmp.path, hook_event_name: "test" },
          timeout: 5000,
          cwd: tmp.path,
        })
        expect(result.proceed).toBe(true)
      },
    })
  })

  test("environment variables are set for subprocess", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const cmd = process.platform === "win32" ? "cmd /c echo %LITEAI_PROJECT_DIR%" : "echo $LITEAI_PROJECT_DIR"
        const result = await command({
          command: cmd,
          input: { cwd: tmp.path, hook_event_name: "test" },
          timeout: 5000,
          cwd: tmp.path,
        })
        expect(result.proceed).toBe(true)
        expect(result.context?.trim()).toBe(tmp.path)
      },
    })
  })

  test("structured JSON output with additionalContext", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const payload = JSON.stringify({ additionalContext: "extra info" })
        const script = path.join(tmp.path, process.platform === "win32" ? "hook.cmd" : "hook.sh")
        if (process.platform === "win32") {
          await Filesystem.write(script, `@echo off\necho ${payload}`)
        } else {
          await Filesystem.write(script, `#!/bin/sh\necho '${payload}'`)
          const { chmod } = await import("node:fs/promises")
          await chmod(script, 0o755)
        }
        const result = await command({
          command: script,
          input: { cwd: tmp.path, hook_event_name: "test" },
          timeout: 5000,
          cwd: tmp.path,
        })
        expect(result.proceed).toBe(true)
        expect(result.context).toBe("extra info")
      },
    })
  })
})

// ---------------------------------------------------------------------------
// Dispatch (with config integration)
// ---------------------------------------------------------------------------
describe("hook.dispatch", () => {
  test("returns proceed when no hooks configured", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await Hook.dispatch("PreToolUse", {
          cwd: tmp.path,
          hook_event_name: "PreToolUse",
          tool_name: "bash",
        })
        expect(result.proceed).toBe(true)
      },
    })
  })

  test("returns proceed when disableAllHooks is true", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Filesystem.write(
          path.join(dir, ".liteai", "settings.json"),
          JSON.stringify({
            disableAllHooks: true,
            hooks: {
              PreToolUse: [
                {
                  hooks: [{ type: "command", command: "exit 2" }],
                },
              ],
            },
          }),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await Hook.dispatch("PreToolUse", {
          cwd: tmp.path,
          hook_event_name: "PreToolUse",
        })
        expect(result.proceed).toBe(true)
      },
    })
  })

  test("dispatches command hook and proceeds on exit 0", async () => {
    const cmd = process.platform === "win32" ? "cmd /c echo ok" : "echo ok"
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Filesystem.write(
          path.join(dir, ".liteai", "settings.json"),
          JSON.stringify({
            hooks: {
              PreToolUse: [
                {
                  hooks: [{ type: "command", command: cmd }],
                },
              ],
            },
          }),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await Hook.dispatch("PreToolUse", {
          cwd: tmp.path,
          hook_event_name: "PreToolUse",
        })
        expect(result.proceed).toBe(true)
      },
    })
  })

  test("dispatches command hook and blocks on exit 2", async () => {
    const cmd = process.platform === "win32" ? "cmd /c exit 2" : "exit 2"
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Filesystem.write(
          path.join(dir, ".liteai", "settings.json"),
          JSON.stringify({
            hooks: {
              PreToolUse: [
                {
                  hooks: [{ type: "command", command: cmd }],
                },
              ],
            },
          }),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await Hook.dispatch("PreToolUse", {
          cwd: tmp.path,
          hook_event_name: "PreToolUse",
        })
        expect(result.proceed).toBe(false)
        expect(result.decision).toBe("deny")
      },
    })
  })

  test("matcher filters by tool_name", async () => {
    const cmd = process.platform === "win32" ? "cmd /c exit 2" : "exit 2"
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Filesystem.write(
          path.join(dir, ".liteai", "settings.json"),
          JSON.stringify({
            hooks: {
              PreToolUse: [
                {
                  matcher: "^Bash$",
                  hooks: [{ type: "command", command: cmd }],
                },
              ],
            },
          }),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // Should not match "read" — proceeds
        const noMatch = await Hook.dispatch("PreToolUse", {
          cwd: tmp.path,
          hook_event_name: "PreToolUse",
          tool_name: "read",
        })
        expect(noMatch.proceed).toBe(true)

        // Should match "Bash" — blocks
        const match = await Hook.dispatch("PreToolUse", {
          cwd: tmp.path,
          hook_event_name: "PreToolUse",
          tool_name: "Bash",
        })
        expect(match.proceed).toBe(false)
      },
    })
  })

  test("merges extra hooks from opts", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const cmd = process.platform === "win32" ? "cmd /c echo extra" : "echo extra"
        const result = await Hook.dispatch(
          "Stop",
          {
            cwd: tmp.path,
            hook_event_name: "Stop",
          },
          {
            extra: {
              Stop: [
                {
                  hooks: [{ type: "command", command: cmd }],
                },
              ],
            },
          },
        )
        expect(result.proceed).toBe(true)
        expect(result.context).toBeTruthy()
      },
    })
  })

  test("dispatches for unknown events without error", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await Hook.dispatch("SomeCustomEvent", {
          cwd: tmp.path,
          hook_event_name: "SomeCustomEvent",
        })
        expect(result.proceed).toBe(true)
      },
    })
  })
})

// ---------------------------------------------------------------------------
// Hook list
// ---------------------------------------------------------------------------
describe("hook.list", () => {
  test("returns empty array when no hooks configured", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const items = await Hook.list()
        expect(items).toEqual([])
      },
    })
  })

  test("lists hooks from config", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Filesystem.write(
          path.join(dir, ".liteai", "settings.json"),
          JSON.stringify({
            hooks: {
              PreToolUse: [
                {
                  matcher: "Bash",
                  hooks: [{ type: "command", command: "echo test" }],
                },
              ],
              Stop: [
                {
                  hooks: [{ type: "http", url: "https://example.com" }],
                },
              ],
            },
          }),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const items = await Hook.list()
        expect(items).toHaveLength(2)

        const pre = items.find((i) => i.event === "PreToolUse")
        expect(pre).toBeTruthy()
        expect(pre?.source).toBe("config")
        expect(pre?.matcher).toBe("Bash")
        expect(pre?.handlers).toHaveLength(1)
        expect(pre?.handlers[0].type).toBe("command")

        const stop = items.find((i) => i.event === "Stop")
        expect(stop).toBeTruthy()
        expect(stop?.handlers[0].type).toBe("http")
      },
    })
  })

  test("lists multiple hooks per event", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Filesystem.write(
          path.join(dir, ".liteai", "settings.json"),
          JSON.stringify({
            hooks: {
              PreToolUse: [
                {
                  matcher: "Bash",
                  hooks: [{ type: "command", command: "hook1" }],
                },
                {
                  matcher: "Edit",
                  hooks: [{ type: "command", command: "hook2" }],
                },
              ],
            },
          }),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const items = await Hook.list()
        expect(items).toHaveLength(2)
        expect(items[0].matcher).toBe("Bash")
        expect(items[1].matcher).toBe("Edit")
      },
    })
  })
})
