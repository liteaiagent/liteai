import { afterEach, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { Global } from "@liteai/core/global/index"
import { Instance } from "@liteai/core/project/instance"
import { TuiConfig } from "../../src/cli/config/tui"
import { tmpdir } from "../fixture/fixture"

const managedConfigDir = process.env.LITEAI_TEST_MANAGED_CONFIG_DIR ?? ""

afterEach(async () => {
  delete process.env.LITEAI_CONFIG
  delete process.env.LITEAI_TUI_CONFIG
  await fs.rm(path.join(Global.Path.config, "tui.json"), { force: true }).catch(() => {})
  await fs.rm(path.join(Global.Path.config, "tui.jsonc"), { force: true }).catch(() => {})
  await fs.rm(managedConfigDir, { force: true, recursive: true }).catch(() => {})
})

test("loads tui config with the same precedence order as server config paths", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(path.join(Global.Path.config, "tui.json"), JSON.stringify({ theme: "global" }, null, 2))
      await Bun.write(path.join(dir, "tui.json"), JSON.stringify({ theme: "project" }, null, 2))
      await fs.mkdir(path.join(dir, ".liteai"), { recursive: true })
      await Bun.write(
        path.join(dir, ".liteai", "tui.json"),
        JSON.stringify({ theme: "local", diff_style: "stacked" }, null, 2),
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await TuiConfig.get()
      expect(config.theme).toBe("local")
      expect(config.diff_style).toBe("stacked")
    },
  })
})

test("flattens nested tui key inside tui.json", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "tui.json"),
        JSON.stringify({
          theme: "outer",
          tui: { scroll_speed: 3, diff_style: "stacked" },
        }),
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await TuiConfig.get()
      expect(config.scroll_speed).toBe(3)
      expect(config.diff_style).toBe("stacked")
      // top-level keys take precedence over nested tui keys
      expect(config.theme).toBe("outer")
    },
  })
})

test("top-level keys in tui.json take precedence over nested tui key", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "tui.json"),
        JSON.stringify({
          diff_style: "auto",
          tui: { diff_style: "stacked", scroll_speed: 2 },
        }),
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await TuiConfig.get()
      expect(config.diff_style).toBe("auto")
      expect(config.scroll_speed).toBe(2)
    },
  })
})

test("project config takes precedence over LITEAI_TUI_CONFIG (matches LITEAI_CONFIG)", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(path.join(dir, "tui.json"), JSON.stringify({ theme: "project", diff_style: "auto" }))
      const custom = path.join(dir, "custom-tui.json")
      await Bun.write(custom, JSON.stringify({ theme: "custom", diff_style: "stacked" }))
      process.env.LITEAI_TUI_CONFIG = custom
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await TuiConfig.get()
      // project tui.json overrides the custom path, same as server config precedence
      expect(config.theme).toBe("project")
      // project also set diff_style, so that wins
      expect(config.diff_style).toBe("auto")
    },
  })
})

test("merges keybind overrides across precedence layers", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(path.join(Global.Path.config, "tui.json"), JSON.stringify({ keybinds: { app_exit: "ctrl+q" } }))
      await Bun.write(path.join(dir, "tui.json"), JSON.stringify({ keybinds: { theme_list: "ctrl+k" } }))
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await TuiConfig.get()
      expect(config.keybinds?.app_exit).toBe("ctrl+q")
      expect(config.keybinds?.theme_list).toBe("ctrl+k")
    },
  })
})

test("LITEAI_TUI_CONFIG provides settings when no project config exists", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const custom = path.join(dir, "custom-tui.json")
      await Bun.write(custom, JSON.stringify({ theme: "from-env", diff_style: "stacked" }))
      process.env.LITEAI_TUI_CONFIG = custom
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await TuiConfig.get()
      expect(config.theme).toBe("from-env")
      expect(config.diff_style).toBe("stacked")
    },
  })
})

test("does not derive tui path from LITEAI_CONFIG", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const customDir = path.join(dir, "custom")
      await fs.mkdir(customDir, { recursive: true })
      await Bun.write(path.join(customDir, "settings.json"), JSON.stringify({ model: "test/model" }))
      await Bun.write(path.join(customDir, "tui.json"), JSON.stringify({ theme: "should-not-load" }))
      process.env.LITEAI_CONFIG = path.join(customDir, "settings.json")
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await TuiConfig.get()
      expect(config.theme).toBeUndefined()
    },
  })
})

test("applies env and file substitutions in tui.json", async () => {
  const original = process.env.TUI_THEME_TEST
  process.env.TUI_THEME_TEST = "env-theme"
  try {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "keybind.txt"), "ctrl+q")
        await Bun.write(
          path.join(dir, "tui.json"),
          JSON.stringify({
            theme: "{env:TUI_THEME_TEST}",
            keybinds: { app_exit: "{file:keybind.txt}" },
          }),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const config = await TuiConfig.get()
        expect(config.theme).toBe("env-theme")
        expect(config.keybinds?.app_exit).toBe("ctrl+q")
      },
    })
  } finally {
    if (original === undefined) delete process.env.TUI_THEME_TEST
    else process.env.TUI_THEME_TEST = original
  }
})

test("applies file substitutions when first identical token is in a commented line", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(path.join(dir, "theme.txt"), "resolved-theme")
      await Bun.write(
        path.join(dir, "tui.jsonc"),
        `{
  // "theme": "{file:theme.txt}",
  "theme": "{file:theme.txt}"
}`,
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await TuiConfig.get()
      expect(config.theme).toBe("resolved-theme")
    },
  })
})

test("loads managed tui config and gives it highest precedence", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(path.join(dir, "tui.json"), JSON.stringify({ theme: "project-theme" }, null, 2))
      await fs.mkdir(managedConfigDir, { recursive: true })
      await Bun.write(path.join(managedConfigDir, "tui.json"), JSON.stringify({ theme: "managed-theme" }, null, 2))
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await TuiConfig.get()
      expect(config.theme).toBe("managed-theme")
    },
  })
})

test("loads .liteai/tui.json", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await fs.mkdir(path.join(dir, ".liteai"), { recursive: true })
      await Bun.write(path.join(dir, ".liteai", "tui.json"), JSON.stringify({ diff_style: "stacked" }, null, 2))
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await TuiConfig.get()
      expect(config.diff_style).toBe("stacked")
    },
  })
})

test("gracefully falls back when tui.json has invalid JSON", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(path.join(dir, "tui.json"), "{ invalid json }")
      await fs.mkdir(managedConfigDir, { recursive: true })
      await Bun.write(path.join(managedConfigDir, "tui.json"), JSON.stringify({ theme: "managed-fallback" }, null, 2))
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await TuiConfig.get()
      expect(config.theme).toBe("managed-fallback")
      expect(config.keybinds).toBeDefined()
    },
  })
})
