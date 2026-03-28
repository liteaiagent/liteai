import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import {
  find,
  format,
  GithubSource,
  GitSubdirSource,
  Manifest,
  NpmSource,
  PluginEntry,
  PluginSource,
  parse,
  plugins,
  UrlSource,
} from "../../src/plugin/marketplace"
import { tmpdir } from "../fixture/fixture"

// ---------------------------------------------------------------------------
// Source schemas
// ---------------------------------------------------------------------------
describe("marketplace.sources", () => {
  test("GithubSource validates correct shape", () => {
    const result = GithubSource.safeParse({ source: "github", repo: "owner/repo" })
    expect(result.success).toBe(true)
  })

  test("GithubSource optionals", () => {
    const result = GithubSource.safeParse({ source: "github", repo: "a/b", ref: "main", sha: "abc123" })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.ref).toBe("main")
      expect(result.data.sha).toBe("abc123")
    }
  })

  test("GithubSource rejects missing repo", () => {
    expect(GithubSource.safeParse({ source: "github" }).success).toBe(false)
  })

  test("UrlSource validates correct shape", () => {
    const result = UrlSource.safeParse({ source: "url", url: "https://example.com/repo.git" })
    expect(result.success).toBe(true)
  })

  test("GitSubdirSource validates correct shape", () => {
    const result = GitSubdirSource.safeParse({
      source: "git-subdir",
      url: "https://github.com/foo/bar.git",
      path: "plugins/my-plugin",
    })
    expect(result.success).toBe(true)
  })

  test("GitSubdirSource rejects missing path", () => {
    expect(GitSubdirSource.safeParse({ source: "git-subdir", url: "https://github.com/foo/bar.git" }).success).toBe(
      false,
    )
  })

  test("NpmSource validates correct shape", () => {
    const result = NpmSource.safeParse({ source: "npm", package: "@scope/plugin" })
    expect(result.success).toBe(true)
  })

  test("NpmSource optionals", () => {
    const result = NpmSource.safeParse({
      source: "npm",
      package: "my-plugin",
      version: "2.0.0",
      registry: "https://registry.example.com",
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.version).toBe("2.0.0")
      expect(result.data.registry).toBe("https://registry.example.com")
    }
  })

  test("PluginSource accepts string (relative path)", () => {
    const result = PluginSource.safeParse("./plugins/foo")
    expect(result.success).toBe(true)
    if (result.success) expect(result.data).toBe("./plugins/foo")
  })

  test("PluginSource accepts github source", () => {
    const result = PluginSource.safeParse({ source: "github", repo: "a/b" })
    expect(result.success).toBe(true)
  })

  test("PluginSource accepts npm source", () => {
    const result = PluginSource.safeParse({ source: "npm", package: "x" })
    expect(result.success).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// PluginEntry schema
// ---------------------------------------------------------------------------
describe("marketplace.PluginEntry", () => {
  test("validates minimal entry", () => {
    const result = PluginEntry.safeParse({ name: "test", source: "./plugins/test" })
    expect(result.success).toBe(true)
  })

  test("validates full entry", () => {
    const result = PluginEntry.safeParse({
      name: "fancy-plugin",
      source: { source: "github", repo: "owner/repo" },
      description: "A fancy plugin",
      version: "1.0.0",
      author: { name: "Author", email: "a@b.com" },
      category: "tools",
      tags: ["productivity", "dev"],
      strict: true,
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.tags).toEqual(["productivity", "dev"])
      expect(result.data.strict).toBe(true)
    }
  })

  test("rejects missing name", () => {
    expect(PluginEntry.safeParse({ source: "./foo" }).success).toBe(false)
  })

  test("rejects missing source", () => {
    expect(PluginEntry.safeParse({ name: "foo" }).success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Marketplace Manifest schema
// ---------------------------------------------------------------------------
describe("marketplace.Manifest", () => {
  const valid = {
    name: "my-marketplace",
    owner: { name: "Owner" },
    plugins: [{ name: "a", source: "./a" }],
  }

  test("validates minimal manifest", () => {
    const result = Manifest.safeParse(valid)
    expect(result.success).toBe(true)
  })

  test("validates manifest with metadata", () => {
    const result = Manifest.safeParse({
      ...valid,
      metadata: { description: "A marketplace", version: "1.0.0", pluginRoot: "./plugins" },
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.metadata?.description).toBe("A marketplace")
  })

  test("rejects missing name", () => {
    expect(Manifest.safeParse({ owner: { name: "O" }, plugins: [] }).success).toBe(false)
  })

  test("rejects missing owner", () => {
    expect(Manifest.safeParse({ name: "m", plugins: [] }).success).toBe(false)
  })

  test("rejects missing plugins", () => {
    expect(Manifest.safeParse({ name: "m", owner: { name: "O" } }).success).toBe(false)
  })

  test("accepts empty plugins array", () => {
    const result = Manifest.safeParse({ name: "m", owner: { name: "O" }, plugins: [] })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.plugins).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Manifest parsing from filesystem
// ---------------------------------------------------------------------------
describe("marketplace.parse", () => {
  test("parses from .liteai-plugin/marketplace.json", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const marker = path.join(dir, ".liteai-plugin")
        await fs.mkdir(marker, { recursive: true })
        await fs.writeFile(
          path.join(marker, "marketplace.json"),
          JSON.stringify({
            name: "test-market",
            owner: { name: "Test" },
            plugins: [{ name: "p1", source: "./p1" }],
          }),
        )
      },
    })

    const result = await parse(tmp.path)
    expect(result).toBeTruthy()
    expect(result?.name).toBe("test-market")
    expect(result?.plugins).toHaveLength(1)
  })

  test("falls back to .claude-plugin/marketplace.json", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const marker = path.join(dir, ".claude-plugin")
        await fs.mkdir(marker, { recursive: true })
        await fs.writeFile(
          path.join(marker, "marketplace.json"),
          JSON.stringify({
            name: "claude-market",
            owner: { name: "Claude" },
            plugins: [],
          }),
        )
      },
    })

    const result = await parse(tmp.path)
    expect(result).toBeTruthy()
    expect(result?.name).toBe("claude-market")
  })

  test("falls back to root marketplace.json", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await fs.writeFile(
          path.join(dir, "marketplace.json"),
          JSON.stringify({
            name: "root-market",
            owner: { name: "Root" },
            plugins: [],
          }),
        )
      },
    })

    const result = await parse(tmp.path)
    expect(result).toBeTruthy()
    expect(result?.name).toBe("root-market")
  })

  test("prefers .liteai-plugin/ over .claude-plugin/", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        for (const marker of [".liteai-plugin", ".claude-plugin"]) {
          const d = path.join(dir, marker)
          await fs.mkdir(d, { recursive: true })
          await fs.writeFile(
            path.join(d, "marketplace.json"),
            JSON.stringify({
              name: `${marker}-market`,
              owner: { name: "X" },
              plugins: [],
            }),
          )
        }
      },
    })

    const result = await parse(tmp.path)
    expect(result?.name).toBe(".liteai-plugin-market")
  })

  test("returns undefined for empty directory", async () => {
    await using tmp = await tmpdir()
    expect(await parse(tmp.path)).toBeUndefined()
  })

  test("returns undefined for invalid JSON", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const marker = path.join(dir, ".liteai-plugin")
        await fs.mkdir(marker, { recursive: true })
        await fs.writeFile(path.join(marker, "marketplace.json"), "{ not valid }")
      },
    })

    expect(await parse(tmp.path)).toBeUndefined()
  })

  test("returns undefined for invalid schema", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await fs.writeFile(path.join(dir, "marketplace.json"), JSON.stringify({ invalid: true }))
      },
    })

    expect(await parse(tmp.path)).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Helpers: find, plugins, format
// ---------------------------------------------------------------------------
describe("marketplace.helpers", () => {
  const manifest: Manifest = {
    name: "test",
    owner: { name: "Owner" },
    plugins: [
      { name: "alpha", source: "./alpha", description: "Alpha plugin", version: "1.0.0", tags: ["util"] },
      { name: "beta", source: { source: "github", repo: "org/beta" }, description: "Beta plugin" },
      { name: "gamma", source: { source: "npm", package: "gamma-pkg" } },
    ],
  }

  test("find returns matching plugin", () => {
    const result = find(manifest, "alpha")
    expect(result).toBeTruthy()
    expect(result?.name).toBe("alpha")
  })

  test("find returns undefined for non-existent", () => {
    expect(find(manifest, "unknown")).toBeUndefined()
  })

  test("plugins returns all entries", () => {
    const result = plugins(manifest)
    expect(result).toHaveLength(3)
    expect(result.map((p) => p.name)).toEqual(["alpha", "beta", "gamma"])
  })

  test("format includes marketplace name and owner", () => {
    const result = format(manifest)
    expect(result).toContain("**test**")
    expect(result).toContain("Owner")
  })

  test("format includes plugin names", () => {
    const result = format(manifest)
    expect(result).toContain("**alpha**")
    expect(result).toContain("**beta**")
    expect(result).toContain("**gamma**")
  })

  test("format includes version and description", () => {
    const result = format(manifest)
    expect(result).toContain("v1.0.0")
    expect(result).toContain("Alpha plugin")
  })

  test("format includes tags", () => {
    const result = format(manifest)
    expect(result).toContain("[util]")
  })

  test("format shows count header", () => {
    const result = format(manifest)
    expect(result).toContain("Plugins (3)")
  })

  test("format handles empty plugins list", () => {
    const empty = { name: "empty", owner: { name: "X" }, plugins: [] }
    const result = format(empty)
    expect(result).toContain("No plugins in this marketplace")
  })
})
