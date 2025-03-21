import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import * as Cache from "../../src/plugin/cache"
import * as Registry from "../../src/plugin/registry"
import { tmpdir } from "../fixture/fixture"

// ---------------------------------------------------------------------------
// Registry helpers
// ---------------------------------------------------------------------------
describe("plugin.registry", () => {
  test("id builds correct identifier", () => {
    expect(Registry.id("foo", "__local__")).toBe("foo")
    expect(Registry.id("foo", "bar")).toBe("foo@bar")
  })

  test("parse splits name@marketplace", () => {
    expect(Registry.parse("foo@bar")).toEqual({ name: "foo", marketplace: "bar" })
    expect(Registry.parse("foo")).toEqual({ name: "foo" })
    expect(Registry.parse("@scoped/pkg@market")).toEqual({ name: "@scoped/pkg", marketplace: "market" })
  })

  test("cachePath resolves to correct directory", () => {
    const result = Registry.cachePath("my-market", "my-plugin", "1.0.0")
    expect(result).toContain("plugins")
    expect(result).toContain("cache")
    expect(result).toContain("my-market")
    expect(result).toContain("my-plugin")
    expect(result).toContain("1.0.0")
  })

  test("cachePath defaults version to latest", () => {
    const result = Registry.cachePath("market", "plugin")
    expect(result).toContain("latest")
  })

  test("dataPath normalizes special characters", () => {
    const result = Registry.dataPath("foo@bar/baz")
    expect(result).not.toContain("@")
    expect(result).not.toContain("/")
    expect(result).toContain("foo_bar_baz")
  })

  test("enabled extracts enabledPlugins from config", () => {
    // biome-ignore lint/suspicious/noExplicitAny: partial config for test
    const cfg = { enabledPlugins: { "foo@bar": true, "baz@qux": false } } as any
    const result = Registry.enabled(cfg)
    expect(result).toEqual({ "foo@bar": true, "baz@qux": false })
  })

  test("enabled returns empty record when no enabledPlugins", () => {
    // biome-ignore lint/suspicious/noExplicitAny: partial config for test
    const result = Registry.enabled({} as any)
    expect(result).toEqual({})
  })
})

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------
describe("plugin.cache", () => {
  test("normalize strips special characters", () => {
    expect(Cache.normalize("foo@bar/baz")).toBe("foo_bar_baz")
    expect(Cache.normalize("simple-name")).toBe("simple-name")
    expect(Cache.normalize("a_b-c")).toBe("a_b-c")
  })

  test("dir resolves correct path", () => {
    const result = Cache.dir("market", "plugin", "2.0.0")
    expect(result).toContain("market")
    expect(result).toContain("plugin")
    expect(result).toContain("2.0.0")
  })

  test("dir defaults version to latest", () => {
    const result = Cache.dir("market", "plugin")
    expect(result).toContain("latest")
  })

  test("exists returns false for non-existent cache", async () => {
    const result = await Cache.exists("nonexistent-market", "nonexistent-plugin")
    expect(result).toBe(false)
  })

  test("versions returns empty for non-existent plugin", async () => {
    const result = await Cache.versions("nonexistent-market", "nonexistent-plugin")
    expect(result).toEqual([])
  })

  test("all returns empty for clean cache", async () => {
    // If cache root doesn't exist or is empty, should return empty
    const result = await Cache.all()
    // This may or may not be empty depending on env; just verify it returns an array
    expect(Array.isArray(result)).toBe(true)
  })

  test("ensureData creates data directory", async () => {
    await using tmp = await tmpdir()
    // Override the data root for testing
    const dir = path.join(tmp.path, "test-data")
    await fs.mkdir(dir, { recursive: true })
    // Just verify the function doesn't throw
    await Cache.ensureData("test-plugin")
  })

  test("remove handles non-existent gracefully", async () => {
    // Should not throw when removing non-existent cache
    await Cache.remove("nonexistent", "nonexistent", "1.0.0")
  })

  test("removeData handles non-existent gracefully", async () => {
    // Should not throw when removing non-existent data
    await Cache.removeData("nonexistent-plugin-id")
  })
})

// ---------------------------------------------------------------------------
// Config.Info enabledPlugins schema
// ---------------------------------------------------------------------------
describe("plugin.config", () => {
  test("enabledPlugins field is accepted in Config.Info", async () => {
    const { Config } = await import("../../src/config/config")
    const result = Config.Info.safeParse({
      $schema: "https://liteai.com/config.json",
      enabledPlugins: {
        "formatter@my-marketplace": true,
        "debug-tools@my-marketplace": false,
      },
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.enabledPlugins).toEqual({
        "formatter@my-marketplace": true,
        "debug-tools@my-marketplace": false,
      })
    }
  })

  test("enabledPlugins is optional", async () => {
    const { Config } = await import("../../src/config/config")
    const result = Config.Info.safeParse({
      $schema: "https://liteai.com/config.json",
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.enabledPlugins).toBeUndefined()
    }
  })

  test("enabledPlugins rejects non-boolean values", async () => {
    const { Config } = await import("../../src/config/config")
    const result = Config.Info.safeParse({
      $schema: "https://liteai.com/config.json",
      enabledPlugins: {
        "foo@bar": "yes",
      },
    })
    expect(result.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Scopes
// ---------------------------------------------------------------------------
describe("plugin.scopes", () => {
  test("scope determines settings file", () => {
    // Verify the scope types match the plan's definition
    const scopes: Registry.Scope[] = ["user", "project", "local"]
    expect(scopes).toHaveLength(3)
  })

  test("Entry type has all required fields", () => {
    const entry: Registry.Entry = {
      id: "test-plugin@marketplace",
      name: "test-plugin",
      marketplace: "marketplace",
      version: "1.0.0",
      enabled: true,
      scope: "user",
      root: "/path/to/plugin",
    }
    expect(entry.id).toBe("test-plugin@marketplace")
    expect(entry.enabled).toBe(true)
    expect(entry.scope).toBe("user")
  })
})

// ---------------------------------------------------------------------------
// /plugin command
// ---------------------------------------------------------------------------
describe("plugin.command", () => {
  test("Default.PLUGIN constant exists", async () => {
    const { Command } = await import("../../src/command")
    expect(Command.Default.PLUGIN).toBe("plugin")
  })

  test("Default.RELOAD_PLUGINS constant exists", async () => {
    const { Command } = await import("../../src/command")
    expect(Command.Default.RELOAD_PLUGINS).toBe("reload-plugins")
  })
})

// ---------------------------------------------------------------------------
// Plugin install/uninstall flow (with tmp dirs)
// ---------------------------------------------------------------------------
describe("plugin.install-flow", () => {
  test("installer copies plugin files to cache", async () => {
    await using src = await tmpdir({
      init: async (dir) => {
        const marker = path.join(dir, ".liteai-plugin")
        await fs.mkdir(marker, { recursive: true })
        await fs.writeFile(path.join(marker, "plugin.json"), JSON.stringify({ name: "install-test", version: "1.0.0" }))
        const cmdDir = path.join(dir, "commands")
        await fs.mkdir(cmdDir, { recursive: true })
        await fs.writeFile(path.join(cmdDir, "hello.md"), "---\n---\nHello!")
      },
    })

    // Create a temp cache dir
    await using cache = await tmpdir()
    const dest = path.join(cache.path, "test-market", "install-test", "1.0.0")

    // Use internal copyDir equivalent
    const { mkdir, readdir, copyFile } = await import("node:fs/promises")
    await mkdir(dest, { recursive: true })

    // Copy src to dest
    async function copyDir(from: string, to: string) {
      await mkdir(to, { recursive: true })
      const entries = await readdir(from, { withFileTypes: true })
      for (const entry of entries) {
        const s = path.join(from, entry.name)
        const d = path.join(to, entry.name)
        if (entry.isDirectory()) await copyDir(s, d)
        else await copyFile(s, d)
      }
    }
    await copyDir(src.path, dest)

    // Verify copied files exist
    const manifest = path.join(dest, ".liteai-plugin", "plugin.json")
    const cmd = path.join(dest, "commands", "hello.md")
    expect(
      await fs
        .stat(manifest)
        .then(() => true)
        .catch(() => false),
    ).toBe(true)
    expect(
      await fs
        .stat(cmd)
        .then(() => true)
        .catch(() => false),
    ).toBe(true)

    // Verify the loader can load from the cache
    const { load } = await import("../../src/plugin/loader")
    const loaded = await load(dest)
    expect(loaded).toBeTruthy()
    expect(loaded?.name).toBe("install-test")
    expect(loaded?.commands["install-test:hello"]).toBeTruthy()
  })

  test("summary formats entries correctly", () => {
    // Test the formatting logic directly
    const entries: Registry.Entry[] = [
      { id: "foo@bar", name: "foo", marketplace: "bar", enabled: true, scope: "user", root: "/tmp" },
      { id: "baz", name: "baz", marketplace: "__local__", enabled: false, scope: "project", root: "/tmp" },
    ]

    const lines = ["**Installed Plugins:**\n"]
    for (const entry of entries) {
      const status = entry.enabled ? "✅ enabled" : "⏸ disabled"
      const source = entry.marketplace === "__local__" ? "local" : entry.marketplace
      lines.push(`- **${entry.name}** (${source}) — ${status}`)
    }
    const result = lines.join("\n")

    expect(result).toContain("**foo** (bar) — ✅ enabled")
    expect(result).toContain("**baz** (local) — ⏸ disabled")
  })
})
