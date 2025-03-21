// biome-ignore-all lint/suspicious/noTemplateCurlyInString: strings are literal env-var patterns under test
import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { data, expand, expandDeep, vars } from "../../src/plugin/env"
import { load } from "../../src/plugin/loader"
import { Manifest, parse } from "../../src/plugin/manifest"
import { all, apply, one } from "../../src/plugin/mount"
import { tmpdir } from "../fixture/fixture"

// ---------------------------------------------------------------------------
// Manifest parsing
// ---------------------------------------------------------------------------
describe("plugin.manifest", () => {
  test("schema validates minimal manifest", () => {
    const result = Manifest.safeParse({ name: "test-plugin" })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.name).toBe("test-plugin")
  })

  test("schema validates full manifest", () => {
    const result = Manifest.safeParse({
      name: "my-plugin",
      version: "1.0.0",
      description: "A test plugin",
      author: { name: "Test", email: "test@test.com", url: "https://test.com" },
      homepage: "https://example.com",
      repository: "owner/repo",
      license: "MIT",
      keywords: ["test", "plugin"],
      commands: "custom/commands/*.md",
      agents: ["agents/*.md", "extra/*.md"],
      skills: "skills/**/SKILL.md",
      hooks: "hooks/hooks.json",
      mcpServers: { server1: { type: "local", command: ["node", "index.js"] } },
      lspServers: "lsp.json",
      outputStyles: "styles.css",
      settings: "config.json",
    })
    expect(result.success).toBe(true)
  })

  test("schema rejects missing name", () => {
    const result = Manifest.safeParse({ version: "1.0.0" })
    expect(result.success).toBe(false)
  })

  test("parse finds manifest in .liteai-plugin/", async () => {
    await using tmp = await tmpdir()
    const marker = path.join(tmp.path, ".liteai-plugin")
    await fs.mkdir(marker, { recursive: true })
    await fs.writeFile(path.join(marker, "plugin.json"), JSON.stringify({ name: "from-liteai" }))

    const result = await parse(tmp.path)
    expect(result).toBeTruthy()
    expect(result?.manifest.name).toBe("from-liteai")
    expect(result?.dir).toBe(marker)
  })

  test("parse falls back to .claude-plugin/", async () => {
    await using tmp = await tmpdir()
    const marker = path.join(tmp.path, ".claude-plugin")
    await fs.mkdir(marker, { recursive: true })
    await fs.writeFile(path.join(marker, "plugin.json"), JSON.stringify({ name: "from-claude" }))

    const result = await parse(tmp.path)
    expect(result).toBeTruthy()
    expect(result?.manifest.name).toBe("from-claude")
  })

  test("parse falls back to root plugin.json", async () => {
    await using tmp = await tmpdir()
    await fs.writeFile(path.join(tmp.path, "plugin.json"), JSON.stringify({ name: "from-root" }))

    const result = await parse(tmp.path)
    expect(result).toBeTruthy()
    expect(result?.manifest.name).toBe("from-root")
  })

  test("parse prefers .liteai-plugin/ over .claude-plugin/", async () => {
    await using tmp = await tmpdir()
    const liteai = path.join(tmp.path, ".liteai-plugin")
    const claude = path.join(tmp.path, ".claude-plugin")
    await fs.mkdir(liteai, { recursive: true })
    await fs.mkdir(claude, { recursive: true })
    await fs.writeFile(path.join(liteai, "plugin.json"), JSON.stringify({ name: "liteai-wins" }))
    await fs.writeFile(path.join(claude, "plugin.json"), JSON.stringify({ name: "claude-loses" }))

    const result = await parse(tmp.path)
    expect(result?.manifest.name).toBe("liteai-wins")
  })

  test("parse returns undefined for non-plugin directory", async () => {
    await using tmp = await tmpdir()
    const result = await parse(tmp.path)
    expect(result).toBeUndefined()
  })

  test("parse returns undefined for invalid JSON", async () => {
    await using tmp = await tmpdir()
    const marker = path.join(tmp.path, ".liteai-plugin")
    await fs.mkdir(marker, { recursive: true })
    await fs.writeFile(path.join(marker, "plugin.json"), "{ invalid json }")

    const result = await parse(tmp.path)
    expect(result).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Environment variables
// ---------------------------------------------------------------------------
describe("plugin.env", () => {
  test("vars returns correct env var record", () => {
    const env = vars("/path/to/plugin", "my-plugin")
    expect(env.LITEAI_PLUGIN_ROOT).toBe("/path/to/plugin")
    expect(env.CLAUDE_PLUGIN_ROOT).toBe("/path/to/plugin")
    expect(env.LITEAI_PLUGIN_DATA).toContain("my-plugin")
    expect(env.CLAUDE_PLUGIN_DATA).toBe(env.LITEAI_PLUGIN_DATA)
  })

  test("data normalizes plugin id", () => {
    const dir = data("my@plugin/name")
    expect(dir).toContain("my_plugin_name")
    expect(dir).not.toContain("@")
    expect(dir).not.toContain("/")
  })

  test("expand replaces plugin vars", () => {
    const result = expand("${LITEAI_PLUGIN_ROOT}/bin/tool", "/opt/plugin", "test")
    expect(result).toBe("/opt/plugin/bin/tool")
  })

  test("expand replaces Claude compat vars", () => {
    const result = expand("${CLAUDE_PLUGIN_ROOT}/scripts", "/opt/plugin", "test")
    expect(result).toBe("/opt/plugin/scripts")
  })

  test("expand leaves unknown vars untouched", () => {
    const result = expand("${SOME_OTHER_VAR}", "/opt/plugin", "test")
    expect(result).toBe("${SOME_OTHER_VAR}")
  })

  test("expandDeep handles nested objects", () => {
    const input = {
      command: ["node", "${LITEAI_PLUGIN_ROOT}/server.js"],
      environment: { ROOT: "${LITEAI_PLUGIN_ROOT}" },
    }
    const result = expandDeep(input, "/opt/plugin", "test")
    expect(result.command[1]).toBe("/opt/plugin/server.js")
    expect(result.environment.ROOT).toBe("/opt/plugin")
  })
})

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------
describe("plugin.loader", () => {
  test("load returns undefined for non-plugin directory", async () => {
    await using tmp = await tmpdir()
    const result = await load(tmp.path)
    expect(result).toBeUndefined()
  })

  test("load reads manifest and empty components", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const marker = path.join(dir, ".liteai-plugin")
        await fs.mkdir(marker, { recursive: true })
        await fs.writeFile(path.join(marker, "plugin.json"), JSON.stringify({ name: "empty-plugin", version: "1.0.0" }))
      },
    })

    const result = await load(tmp.path)
    expect(result).toBeTruthy()
    expect(result?.name).toBe("empty-plugin")
    expect(result?.manifest.version).toBe("1.0.0")
    expect(Object.keys(result?.commands ?? {})).toHaveLength(0)
    expect(Object.keys(result?.agents ?? {})).toHaveLength(0)
    expect(result?.skills).toHaveLength(0)
    expect(result?.hooks).toBeUndefined()
    expect(result?.mcp).toBeUndefined()
    expect(result?.settings).toBeUndefined()
  })

  test("load discovers commands from default path", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const marker = path.join(dir, ".liteai-plugin")
        await fs.mkdir(marker, { recursive: true })
        await fs.writeFile(path.join(marker, "plugin.json"), JSON.stringify({ name: "cmd-plugin" }))

        const cmdDir = path.join(dir, "commands")
        await fs.mkdir(cmdDir, { recursive: true })
        await fs.writeFile(path.join(cmdDir, "greet.md"), "---\ndescription: Say hello\n---\nHello $ARGUMENTS!")
      },
    })

    const result = await load(tmp.path)
    expect(result).toBeTruthy()
    expect(result?.commands["cmd-plugin:greet"]).toBeTruthy()
    expect(result?.commands["cmd-plugin:greet"].template).toContain("Hello")
  })

  test("load discovers agents from default path", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const marker = path.join(dir, ".liteai-plugin")
        await fs.mkdir(marker, { recursive: true })
        await fs.writeFile(path.join(marker, "plugin.json"), JSON.stringify({ name: "agent-plugin" }))

        const agentDir = path.join(dir, "agents")
        await fs.mkdir(agentDir, { recursive: true })
        await fs.writeFile(
          path.join(agentDir, "helper.md"),
          "---\ndescription: A helper agent\nmode: subagent\n---\nYou are a helpful assistant.",
        )
      },
    })

    const result = await load(tmp.path)
    expect(result).toBeTruthy()
    expect(result?.agents["agent-plugin:helper"]).toBeTruthy()
    expect(result?.agents["agent-plugin:helper"].prompt).toContain("helpful assistant")
  })

  test("load discovers skills from default path", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const marker = path.join(dir, ".liteai-plugin")
        await fs.mkdir(marker, { recursive: true })
        await fs.writeFile(path.join(marker, "plugin.json"), JSON.stringify({ name: "skill-plugin" }))

        const skillDir = path.join(dir, "skills", "greet")
        await fs.mkdir(skillDir, { recursive: true })
        await fs.writeFile(
          path.join(skillDir, "SKILL.md"),
          "---\nname: greet\ndescription: Greet the user\n---\nSay hello to the user.",
        )
      },
    })

    const result = await load(tmp.path)
    expect(result).toBeTruthy()
    expect(result?.skills).toHaveLength(1)
    expect(result?.skills[0].name).toBe("skill-plugin:greet")
    expect(result?.skills[0].description).toBe("Greet the user")
    expect(result?.skills[0].content).toContain("Say hello")
  })

  test("load discovers hooks from hooks.json", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const marker = path.join(dir, ".liteai-plugin")
        await fs.mkdir(marker, { recursive: true })
        await fs.writeFile(path.join(marker, "plugin.json"), JSON.stringify({ name: "hook-plugin" }))

        const hookDir = path.join(dir, "hooks")
        await fs.mkdir(hookDir, { recursive: true })
        await fs.writeFile(
          path.join(hookDir, "hooks.json"),
          JSON.stringify({
            PreToolUse: [{ hooks: [{ type: "command", command: "echo hooked" }] }],
          }),
        )
      },
    })

    const result = await load(tmp.path)
    expect(result).toBeTruthy()
    expect(result?.hooks).toBeTruthy()
    expect(result?.hooks?.PreToolUse).toHaveLength(1)
  })

  test("load discovers settings from settings.json", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const marker = path.join(dir, ".liteai-plugin")
        await fs.mkdir(marker, { recursive: true })
        await fs.writeFile(path.join(marker, "plugin.json"), JSON.stringify({ name: "settings-plugin" }))

        await fs.writeFile(
          path.join(dir, "settings.json"),
          JSON.stringify({ $schema: "https://liteai.com/config.json", username: "plugin-user" }),
        )
      },
    })

    const result = await load(tmp.path)
    expect(result).toBeTruthy()
    expect(result?.settings?.username).toBe("plugin-user")
  })

  test("load uses custom paths from manifest", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const marker = path.join(dir, ".liteai-plugin")
        await fs.mkdir(marker, { recursive: true })
        await fs.writeFile(
          path.join(marker, "plugin.json"),
          JSON.stringify({
            name: "custom-paths",
            commands: "custom-cmd/*.md",
          }),
        )

        const cmdDir = path.join(dir, "custom-cmd")
        await fs.mkdir(cmdDir, { recursive: true })
        await fs.writeFile(path.join(cmdDir, "test.md"), "---\n---\nCustom command")
      },
    })

    const result = await load(tmp.path)
    expect(result).toBeTruthy()
    expect(result?.commands["custom-paths:test"]).toBeTruthy()
    expect(result?.commands["custom-paths:test"].template).toBe("Custom command")
  })
})

// ---------------------------------------------------------------------------
// Mounting
// ---------------------------------------------------------------------------
describe("plugin.mount", () => {
  test("one mounts plugin components", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const marker = path.join(dir, ".liteai-plugin")
        await fs.mkdir(marker, { recursive: true })
        await fs.writeFile(path.join(marker, "plugin.json"), JSON.stringify({ name: "mount-test" }))

        const cmdDir = path.join(dir, "commands")
        await fs.mkdir(cmdDir, { recursive: true })
        await fs.writeFile(path.join(cmdDir, "hello.md"), "---\ndescription: Hello\n---\nHello!")
      },
    })

    const loaded = await load(tmp.path)
    if (!loaded) throw new Error("expected loaded")

    const mounted = one(loaded)
    expect(mounted.commands["mount-test:hello"]).toBeTruthy()
    expect(mounted.env.LITEAI_PLUGIN_ROOT).toBe(loaded.root)
    expect(mounted.env.CLAUDE_PLUGIN_ROOT).toBe(loaded.root)
  })

  test("all merges multiple plugins", async () => {
    await using tmp1 = await tmpdir({
      init: async (dir) => {
        const marker = path.join(dir, ".liteai-plugin")
        await fs.mkdir(marker, { recursive: true })
        await fs.writeFile(path.join(marker, "plugin.json"), JSON.stringify({ name: "plugin-a" }))
        const cmdDir = path.join(dir, "commands")
        await fs.mkdir(cmdDir, { recursive: true })
        await fs.writeFile(path.join(cmdDir, "a.md"), "---\n---\nCommand A")
      },
    })

    await using tmp2 = await tmpdir({
      init: async (dir) => {
        const marker = path.join(dir, ".liteai-plugin")
        await fs.mkdir(marker, { recursive: true })
        await fs.writeFile(path.join(marker, "plugin.json"), JSON.stringify({ name: "plugin-b" }))
        const cmdDir = path.join(dir, "commands")
        await fs.mkdir(cmdDir, { recursive: true })
        await fs.writeFile(path.join(cmdDir, "b.md"), "---\n---\nCommand B")
      },
    })

    const [a, b] = await Promise.all([load(tmp1.path), load(tmp2.path)])
    expect(a).toBeTruthy()
    if (!a || !b) throw new Error("expected both plugins")

    const mounted = all([a, b])
    expect(mounted.commands["plugin-a:a"]).toBeTruthy()
    expect(mounted.commands["plugin-b:b"]).toBeTruthy()
  })

  test("apply merges settings as lowest priority", () => {
    // biome-ignore lint/suspicious/noExplicitAny: partial config for test
    const config = { username: "user-override" } as any
    const mounted = {
      mcp: {},
      commands: {},
      agents: {},
      hooks: {},
      skills: [],
      // biome-ignore lint/suspicious/noExplicitAny: partial config for test
      settings: { username: "plugin-default" } as any,
      env: {},
    }

    const result = apply(config, mounted)
    // User config wins over plugin settings
    expect(result.username).toBe("user-override")
  })

  test("apply merges commands on top", () => {
    const config = {
      command: { existing: { template: "existing" } },
      // biome-ignore lint/suspicious/noExplicitAny: partial config for test
    } as any
    const mounted = {
      mcp: {},
      // biome-ignore lint/suspicious/noExplicitAny: partial config for test
      commands: { "plugin:new": { template: "from plugin" } } as any,
      agents: {},
      hooks: {},
      skills: [],
      settings: {},
      env: {},
    }

    const result = apply(config, mounted)
    expect(result.command?.existing).toBeTruthy()
    expect(result.command?.["plugin:new"]).toBeTruthy()
  })

  test("apply merges MCP servers (existing takes precedence)", () => {
    const config = {
      mcp: { existing: { type: "local" as const, command: ["node"] } },
      // biome-ignore lint/suspicious/noExplicitAny: partial config for test
    } as any
    const mounted = {
      // biome-ignore lint/suspicious/noExplicitAny: partial config for test
      mcp: { "plugin:server": { type: "local" as const, command: ["python"] } } as any,
      commands: {},
      agents: {},
      hooks: {},
      skills: [],
      settings: {},
      env: {},
    }

    const result = apply(config, mounted)
    expect(result.mcp?.existing).toBeTruthy()
    expect(result.mcp?.["plugin:server"]).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// Namespace isolation
// ---------------------------------------------------------------------------
describe("plugin.namespace", () => {
  test("commands are namespaced with plugin name", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const marker = path.join(dir, ".liteai-plugin")
        await fs.mkdir(marker, { recursive: true })
        await fs.writeFile(path.join(marker, "plugin.json"), JSON.stringify({ name: "my-plugin" }))
        const cmdDir = path.join(dir, "commands")
        await fs.mkdir(cmdDir, { recursive: true })
        await fs.writeFile(path.join(cmdDir, "test.md"), "---\n---\nTest")
      },
    })

    const result = await load(tmp.path)
    expect(Object.keys(result?.commands ?? {})).toEqual(["my-plugin:test"])
  })

  test("skills are namespaced with plugin name", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const marker = path.join(dir, ".liteai-plugin")
        await fs.mkdir(marker, { recursive: true })
        await fs.writeFile(path.join(marker, "plugin.json"), JSON.stringify({ name: "my-plugin" }))
        const skillDir = path.join(dir, "skills", "foo")
        await fs.mkdir(skillDir, { recursive: true })
        await fs.writeFile(path.join(skillDir, "SKILL.md"), "---\nname: foo\ndescription: Foo skill\n---\nFoo content")
      },
    })

    const result = await load(tmp.path)
    expect(result?.skills[0]?.name).toBe("my-plugin:foo")
  })

  test("agents are namespaced with plugin name", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const marker = path.join(dir, ".liteai-plugin")
        await fs.mkdir(marker, { recursive: true })
        await fs.writeFile(path.join(marker, "plugin.json"), JSON.stringify({ name: "my-plugin" }))
        const agentDir = path.join(dir, "agents")
        await fs.mkdir(agentDir, { recursive: true })
        await fs.writeFile(path.join(agentDir, "bot.md"), "---\ndescription: A bot\n---\nBot prompt")
      },
    })

    const result = await load(tmp.path)
    expect(Object.keys(result?.agents ?? {})).toEqual(["my-plugin:bot"])
  })
})
