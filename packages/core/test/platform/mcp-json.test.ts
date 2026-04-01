import { describe, expect, test } from "bun:test"
import path from "node:path"
import { load } from "../../src/config/mcp-json"
import { tmpdir } from "../fixture/fixture"

describe("mcp-json", () => {
  test("loads local server from .mcp.json", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, ".mcp.json"),
          JSON.stringify({
            mcpServers: {
              github: {
                command: "npx",
                args: ["-y", "@modelcontextprotocol/server-github"],
                env: { GITHUB_TOKEN: "tok" },
              },
            },
          }),
        )
      },
    })

    const result = await load(tmp.path, tmp.path)
    expect(result.github).toEqual({
      type: "local",
      command: ["npx", "-y", "@modelcontextprotocol/server-github"],
      environment: { GITHUB_TOKEN: "tok" },
    })
  })

  test("loads remote server from .mcp.json", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, ".mcp.json"),
          JSON.stringify({
            mcpServers: {
              api: {
                type: "http",
                url: "https://example.com/mcp",
                headers: { Authorization: "Bearer tok" },
              },
            },
          }),
        )
      },
    })

    const result = await load(tmp.path, tmp.path)
    expect(result.api).toEqual({
      type: "remote",
      url: "https://example.com/mcp",
      headers: { Authorization: "Bearer tok" },
    })
  })

  test("adapts url-only entries as remote", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, ".mcp.json"),
          JSON.stringify({
            mcpServers: {
              web: { url: "https://api.example.com/mcp" },
            },
          }),
        )
      },
    })

    const result = await load(tmp.path, tmp.path)
    expect(result.web).toEqual({
      type: "remote",
      url: "https://api.example.com/mcp",
    })
  })

  test("loads command without args", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, ".mcp.json"),
          JSON.stringify({
            mcpServers: {
              simple: { command: "my-server" },
            },
          }),
        )
      },
    })

    const result = await load(tmp.path, tmp.path)
    expect(result.simple).toEqual({
      type: "local",
      command: ["my-server"],
    })
  })

  test("skips entries with neither command nor url", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, ".mcp.json"),
          JSON.stringify({
            mcpServers: {
              broken: { env: { FOO: "bar" } },
            },
          }),
        )
      },
    })

    const result = await load(tmp.path, tmp.path)
    expect(result.broken).toBeUndefined()
  })

  test("returns empty for missing .mcp.json", async () => {
    await using tmp = await tmpdir()
    const result = await load(tmp.path, tmp.path)
    expect(Object.keys(result)).toHaveLength(0)
  })

  test("preserves enabled and timeout fields", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, ".mcp.json"),
          JSON.stringify({
            mcpServers: {
              srv: {
                command: "srv",
                enabled: false,
                timeout: 10000,
              },
            },
          }),
        )
      },
    })

    const result = await load(tmp.path, tmp.path)
    expect(result.srv).toEqual({
      type: "local",
      command: ["srv"],
      enabled: false,
      timeout: 10000,
    })
  })

  test("handles flat format without mcpServers wrapper", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, ".mcp.json"),
          JSON.stringify({
            flat: { command: "flat-cmd" },
          }),
        )
      },
    })

    const result = await load(tmp.path, tmp.path)
    expect(result.flat).toEqual({
      type: "local",
      command: ["flat-cmd"],
    })
  })
})
