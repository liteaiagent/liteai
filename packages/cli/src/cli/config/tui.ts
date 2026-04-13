import { existsSync } from "node:fs"
import { Brand } from "@liteai/core/brand"
import { Config } from "@liteai/core/config/config"
import { ConfigPaths } from "@liteai/core/config/paths"
import { Flag } from "@liteai/core/flag/flag"
import { Global } from "@liteai/core/global/index"
import { Instance } from "@liteai/core/project/instance"
import { Log } from "@liteai/core/util/log"
import { mergeDeep, unique } from "remeda"
import type z from "zod"
import { Keybinds, TuiInfo } from "./tui-schema"

export namespace TuiConfig {
  const log = Log.create({ service: "config.tui" })

  export const Info = TuiInfo

  export type Info = z.output<typeof Info>

  function mergeInfo(target: Info, source: Info): Info {
    return mergeDeep(target, source)
  }

  function customPath() {
    return Flag.LITEAI_TUI_CONFIG
  }

  const state = Instance.state(async () => {
    const directories = await ConfigPaths.directories(Instance.directory, Instance.worktree)
    const custom = customPath()
    const managed = Config.managedConfigDir()

    let result: Info = {}

    for (const file of ConfigPaths.fileInDirectory(Global.Path.config, "tui")) {
      result = mergeInfo(result, await loadFile(file))
    }

    if (custom) {
      result = mergeInfo(result, await loadFile(custom))
      log.debug("loaded custom tui config", { path: custom })
    }

    for (const dir of unique(directories)) {
      if (!dir.endsWith(Brand.dir) && dir !== Flag.LITEAI_CONFIG_DIR) continue
      for (const file of ConfigPaths.fileInDirectory(dir, "tui")) {
        result = mergeInfo(result, await loadFile(file))
      }
    }

    if (existsSync(managed)) {
      for (const file of ConfigPaths.fileInDirectory(managed, "tui")) {
        result = mergeInfo(result, await loadFile(file))
      }
    }

    result.keybinds = Keybinds.parse(result.keybinds ?? {})

    return {
      config: result,
    }
  })

  export async function get() {
    return state().then((x) => x.config)
  }

  async function loadFile(filepath: string): Promise<Info> {
    const text = await ConfigPaths.readFile(filepath)
    if (!text) return {}
    return load(text, filepath).catch((error) => {
      log.warn("failed to load tui config", { path: filepath, error })
      return {}
    })
  }

  async function load(text: string, configFilepath: string): Promise<Info> {
    const data = await ConfigPaths.parseText(text, configFilepath, "empty")
    if (!data || typeof data !== "object" || Array.isArray(data)) return {}

    // Flatten a nested "tui" key so users who wrote `{ "tui": { ... } }` inside tui.json
    // (mirroring the old liteai.json shape) still get their settings applied.
    const normalized = (() => {
      const copy = { ...(data as Record<string, unknown>) }
      if (!("tui" in copy)) return copy
      if (!copy.tui || typeof copy.tui !== "object" || Array.isArray(copy.tui)) {
        delete copy.tui
        return copy
      }
      const tui = copy.tui as Record<string, unknown>
      delete copy.tui
      return {
        ...tui,
        ...copy,
      }
    })()

    const parsed = Info.safeParse(normalized)
    if (!parsed.success) {
      log.warn("invalid tui config", { path: configFilepath, issues: parsed.error.issues })
      return {}
    }

    return parsed.data
  }
}
