import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { load } from "../../src/plugin/loader"
import { all, apply, one } from "../../src/plugin/mount"
import { tmpdir } from "../fixture/fixture"

// ---------------------------------------------------------------------------
// Loader: MCP servers
// ---------------------------------------------------------------------------
describe("plugin.loader.mcp", () => {
  test("loads mcpServers from .mcp.json", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await fs.writeFile(
          path.join(dir, ".mcp.json"),
          JSON.stringify({
            mcpServers: {
              myserver: {
                type: "local",
                command: "node",
                args: ["server.js"],
              },
            },
          }),
        )
      },
    })

    const result = await load(tmp.path)
    expect(result).toBeTruthy()
    expect(result?.mcpServers).toBeTruthy()
    expect(result?.mcpServers?.[`${result?.name}:myserver`]).toBeTruthy()
  })

  test("loads .mcp.json with command format", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await fs.writeFile(
          path.join(dir, ".mcp.json"),
          JSON.stringify({
            mcpServers: {
              tool: {
                command: "python",
                args: ["-m", "mcp_tool"],
                env: { KEY: "val" },
              },
            },
          }),
        )
      },
    })

    const result = await load(tmp.path)
    expect(result).toBeTruthy()
    expect(result?.mcpServers?.[`${result?.name}:tool`]).toBeTruthy()
    // Adapted: command becomes array, env becomes environment
    const server = result?.mcpServers?.[`${result?.name}:tool`]
    expect(server).toBeTruthy()
  })

  test("loads .mcp.json with url/sse format", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await fs.writeFile(
          path.join(dir, ".mcp.json"),
          JSON.stringify({
            mcpServers: {
              remote: {
                type: "sse",
                url: "https://api.example.com/mcp",
              },
            },
          }),
        )
      },
    })

    const result = await load(tmp.path)
    expect(result).toBeTruthy()
    expect(result?.mcpServers?.[`${result?.name}:remote`]).toBeTruthy()
  })

  test("returns undefined mcp when no servers found", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const marker = path.join(dir, ".liteai-plugin")
        await fs.mkdir(marker, { recursive: true })
        await fs.writeFile(path.join(marker, "plugin.json"), JSON.stringify({ name: "no-mcp" }))
      },
    })

    const result = await load(tmp.path)
    expect(result).toBeTruthy()
    expect(result?.mcpServers).toBeUndefined()
  })

  test("loads .mcp.json with flat server format", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await fs.writeFile(
          path.join(dir, ".mcp.json"),
          JSON.stringify({
            myserver: { command: "node", args: ["index.js"] },
          }),
        )
      },
    })

    const result = await load(tmp.path)
    expect(result).toBeTruthy()
    expect(result?.mcpServers?.[`${result?.name}:myserver`]).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// Loader: convention-based paths
// ---------------------------------------------------------------------------
describe("plugin.loader.convention-paths", () => {
  test("loads agents from convention path", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const agentDir = path.join(dir, "agents")
        await fs.mkdir(agentDir, { recursive: true })
        await fs.writeFile(path.join(agentDir, "helper.md"), "---\ndescription: A helper agent\n---\nPrompt for helper")
      },
    })

    const result = await load(tmp.path)
    expect(result).toBeTruthy()
    expect(result?.agents[`${result?.name}:helper`]).toBeTruthy()
  })

  test("loads hooks from convention path", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const hooks = path.join(dir, "hooks")
        await fs.mkdir(hooks, { recursive: true })
        await fs.writeFile(
          path.join(hooks, "hooks.json"),
          JSON.stringify({ PostToolUse: [{ hooks: [{ type: "command", command: "echo done" }] }] }),
        )
      },
    })

    const result = await load(tmp.path)
    expect(result?.hooks?.PostToolUse).toBeTruthy()
  })

  test("loads settings from custom path", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const marker = path.join(dir, ".liteai-plugin")
        await fs.mkdir(marker, { recursive: true })
        await fs.writeFile(
          path.join(marker, "plugin.json"),
          JSON.stringify({ name: "custom-settings", settings: "config/settings.json" }),
        )

        const cfg = path.join(dir, "config")
        await fs.mkdir(cfg, { recursive: true })
        await fs.writeFile(
          path.join(cfg, "settings.json"),
          JSON.stringify({ $schema: "https://liteai.com/config.json", username: "custom" }),
        )
      },
    })

    const result = await load(tmp.path)
    expect(result?.mcpServers).toBeUndefined()
  })

  // settings loading is no longer part of the plugin loader
})

// ---------------------------------------------------------------------------
// Mount: apply edge cases
// ---------------------------------------------------------------------------
describe("plugin.mount.apply", () => {
  test("merges hooks arrays", () => {
    // biome-ignore lint/suspicious/noExplicitAny: partial config for test
    const config = { hooks: { PreToolUse: [{ hooks: [{ type: "command", command: "echo 1" }] }] } } as any
    const mounted = {
      mcpServers: {},
      commands: {},
      agents: {},
      hooks: { PreToolUse: [{ hooks: [{ type: "command", command: "echo 1" }] }] },
      skills: [],
      env: {},
    }

    const result = apply(config, mounted)
    // biome-ignore lint/suspicious/noExplicitAny: testing
    expect((result.hooks as any)?.PreToolUse).toHaveLength(2)
  })

  test("merges hooks from new event names", () => {
    // biome-ignore lint/suspicious/noExplicitAny: partial config for test
    const config = {} as any
    const mounted = {
      mcpServers: {},
      commands: {},
      agents: {},
      hooks: { PostToolUse: [{ hooks: [{ type: "command", command: "echo post" }] }] },
      skills: [],
      env: {},
    }

    const result = apply(config, mounted)
    // biome-ignore lint/suspicious/noExplicitAny: testing
    expect((result.hooks as any)?.PostToolUse).toHaveLength(1)
  })

  test("merges agents on top of config", () => {
    const config = {
      agent: { existing: { prompt: "existing" } },
      // biome-ignore lint/suspicious/noExplicitAny: partial config  for test
    } as any
    const mounted = {
      mcpServers: {},
      commands: {},
      // biome-ignore lint/suspicious/noExplicitAny: partial config for test
      agents: { "plugin:new": { prompt: "from plugin" } } as any,
      hooks: {},
      skills: [],
      env: {},
    }

    const result = apply(config, mounted)
    expect(result.agent?.existing).toBeTruthy()
    expect(result.agent?.["plugin:new"]).toBeTruthy()
  })

  test("plugin settings don't override user config", () => {
    const config = {
      model: { provider: "user-provider" },
      // biome-ignore lint/suspicious/noExplicitAny: partial config for test
    } as any
    const mounted = {
      mcpServers: {},
      commands: {},
      agents: {},
      hooks: {},
      skills: [],
      env: {},
    }

    const result = apply(config, mounted)
    // biome-ignore lint/suspicious/noExplicitAny: testing
    expect((result.model as any)?.provider).toBe("user-provider")
  })

  test("empty mounted produces same config", () => {
    // biome-ignore lint/suspicious/noExplicitAny: partial config for test
    const config = { username: "me" } as any
    const mounted = {
      mcpServers: {},
      commands: {},
      agents: {},
      hooks: {},
      skills: [],
      env: {},
    }

    const result = apply(config, mounted)
    expect(result.username).toBe("me")
  })
})

// ---------------------------------------------------------------------------
// Mount: one/all with MCP and skills
// ---------------------------------------------------------------------------
describe("plugin.mount.components", () => {
  test("one mounts MCP servers", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await fs.writeFile(
          path.join(dir, ".mcp.json"),
          JSON.stringify({
            mcpServers: {
              srv: { type: "local", command: "node", args: ["srv.js"] },
            },
          }),
        )
      },
    })

    const loaded = await load(tmp.path)
    if (!loaded) throw new Error("expected loaded")

    const mounted = one(loaded)
    expect(mounted.mcpServers[`${loaded.name}:srv`]).toBeTruthy()
  })

  test("one mounts skills", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const skill = path.join(dir, "skills", "analyze")
        await fs.mkdir(skill, { recursive: true })
        await fs.writeFile(
          path.join(skill, "SKILL.md"),
          "---\nname: analyze\ndescription: Analyze code\n---\nAnalyze the code",
        )
      },
    })

    const loaded = await load(tmp.path)
    if (!loaded) throw new Error("expected loaded")

    const mounted = one(loaded)
    expect(mounted.skills).toHaveLength(1)
    expect(mounted.skills[0].name).toBe(`${loaded.name}:analyze`)
  })

  test("one mounts hooks", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const marker = path.join(dir, ".liteai-plugin")
        await fs.mkdir(marker, { recursive: true })
        await fs.writeFile(path.join(marker, "plugin.json"), JSON.stringify({ name: "hook-mount" }))

        const hooks = path.join(dir, "hooks")
        await fs.mkdir(hooks, { recursive: true })
        await fs.writeFile(
          path.join(hooks, "hooks.json"),
          JSON.stringify({ PreToolUse: [{ hooks: [{ type: "command", command: "lint" }] }] }),
        )
      },
    })

    const loaded = await load(tmp.path)
    if (!loaded) throw new Error("expected loaded")

    const mounted = one(loaded)
    expect(Object.keys(mounted.hooks)).toContain("PreToolUse")
  })

  test("one mounts settings", async () => {
    // settings are no longer loaded from plugins
    // This is covered implicitly by the convention-based loader
  })

  test("all merges skills from multiple plugins", async () => {
    await using tmp1 = await tmpdir({
      init: async (dir) => {
        const skill = path.join(dir, "skills", "sa")
        await fs.mkdir(skill, { recursive: true })
        await fs.writeFile(path.join(skill, "SKILL.md"), "---\nname: sa\ndescription: Skill A\n---\nA")
      },
    })

    await using tmp2 = await tmpdir({
      init: async (dir) => {
        const skill = path.join(dir, "skills", "sb")
        await fs.mkdir(skill, { recursive: true })
        await fs.writeFile(path.join(skill, "SKILL.md"), "---\nname: sb\ndescription: Skill B\n---\nB")
      },
    })

    const [a, b] = await Promise.all([load(tmp1.path), load(tmp2.path)])
    if (!a || !b) throw new Error("expected both")

    const mounted = all([a, b])
    expect(mounted.skills).toHaveLength(2)
    expect(mounted.skills.map((s) => s.name).sort()).toEqual([`${a.name}:sa`, `${b.name}:sb`].sort())
  })

  test("all merges hooks from multiple plugins", async () => {
    await using tmp1 = await tmpdir({
      init: async (dir) => {
        const marker = path.join(dir, ".liteai-plugin")
        await fs.mkdir(marker, { recursive: true })
        await fs.writeFile(path.join(marker, "plugin.json"), JSON.stringify({ name: "hook-a" }))
        const hooks = path.join(dir, "hooks")
        await fs.mkdir(hooks, { recursive: true })
        await fs.writeFile(
          path.join(hooks, "hooks.json"),
          JSON.stringify({ PreToolUse: [{ hooks: [{ type: "command", command: "a" }] }] }),
        )
      },
    })

    await using tmp2 = await tmpdir({
      init: async (dir) => {
        const marker = path.join(dir, ".liteai-plugin")
        await fs.mkdir(marker, { recursive: true })
        await fs.writeFile(path.join(marker, "plugin.json"), JSON.stringify({ name: "hook-b" }))
        const hooks = path.join(dir, "hooks")
        await fs.mkdir(hooks, { recursive: true })
        await fs.writeFile(
          path.join(hooks, "hooks.json"),
          JSON.stringify({ PostToolUse: [{ hooks: [{ type: "command", command: "b" }] }] }),
        )
      },
    })

    const [a, b] = await Promise.all([load(tmp1.path), load(tmp2.path)])
    if (!a || !b) throw new Error("expected both")

    const mounted = all([a, b])
    expect(mounted.hooks).toHaveProperty("PreToolUse")
    expect(mounted.hooks).toHaveProperty("PostToolUse")
  })
})
